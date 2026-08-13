package com.posedetection.view

import android.Manifest
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Size
import android.widget.FrameLayout
import androidx.camera.core.ImageAnalysis
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import com.posedetection.ErrorCode
import com.posedetection.LogCategory
import com.posedetection.PoseLog
import com.posedetection.Skeleton
import com.posedetection.camera.CameraSource
import com.posedetection.camera.Facing
import com.posedetection.camera.FrameConverter
import com.posedetection.detector.DelegateRequest
import com.posedetection.detector.PoseDetector
import com.posedetection.engine.DEFAULT_FLUSH_MS
import com.posedetection.engine.DEFAULT_THROTTLE_MS
import com.posedetection.engine.DataMode
import com.posedetection.engine.DataSettings
import com.posedetection.engine.FrameContext
import com.posedetection.engine.FrameRingBuffer
import com.posedetection.engine.FrameShape
import com.posedetection.engine.Geometry
import com.posedetection.engine.OneEuroFilter
import com.posedetection.engine.TriggerEngine
import com.posedetection.engine.TriggerFiring
import com.posedetection.engine.TriggerSpec
import com.posedetection.performance.Calibrator
import com.posedetection.performance.DeviceTier
import com.posedetection.performance.PerformanceResolver
import com.posedetection.performance.Profile
import com.posedetection.performance.ResolvedPerformance
import com.posedetection.performance.ThermalMonitor
import com.posedetection.performance.ThermalPolicy
import com.posedetection.performance.ThermalState
import com.posedetection.performance.Tiers
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.jni.NativeArrayBuffer
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs

class PoseCameraView(
    context: Context,
    appContext: AppContext,
) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true

    private val onReady by EventDispatcher<Map<String, Any?>>()
    private val onError by EventDispatcher<Map<String, Any?>>()
    private val onCameraChange by EventDispatcher<Map<String, Any?>>()

    /** Carries nothing. JavaScript answers it with `drainFrames()`, see ADR 0008. */
    private val onFrames by EventDispatcher<Map<String, Any?>>()

    /** Scalars plus a claim ticket. The frame cannot ride it, see ADR 0009. */
    private val onTrigger by EventDispatcher<Map<String, Any?>>()

    private val onPerformanceChange by EventDispatcher<Map<String, Any?>>()
    private val onLog by EventDispatcher<Map<String, Any?>>()

    private val previewView =
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.PERFORMANCE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    private val overlayView = OverlayView(context)

    // One dedicated thread. The analyzer runs here and calls detectAsync here, so sample buffers
    // never hop threads and the UI never waits on inference.
    private val analysisExecutor =
        Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "pose-analysis").apply { priority = Thread.NORM_PRIORITY + 1 }
        }

    private val camera = CameraSource(context, previewView, analysisExecutor)
    private val converter = FrameConverter()

    /** `View.post` holds runnables while detached, which would strand a landmarker unclosed. */
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Written on main, read on the analysis thread, so a teardown is seen on the next frame. */
    @Volatile
    private var detector: PoseDetector? = null
    private var modelFileName: String? = null

    /**
     * In-flight construction state, main thread only. [detectorGeneration] is bumped by every
     * teardown so a build landing afterwards is closed rather than installed. `maxPoses` and the
     * delegate are baked in at construction, so the last two force a rebuild when they change.
     */
    private var detectorPending = false
    private var detectorGeneration = 0
    private var detectorRequest: DelegateRequest? = null
    private var detectorMaxPoses = 0
    private var detectorMinConfidence = 0f

    /** Survives [releaseDetector] so `getState` reports the pipeline, not instance liveness. */
    private var resolvedDelegate: String? = null

    /** A dead delegate fails every frame, and 30 identical events a second helps nobody. */
    private val lastDetectionErrorMs = AtomicLong(0)

    /**
     * A rebind only attaches the use cases. The switch is reported once the new camera delivers a
     * frame, with [switchTimeout] resolving one that never does.
     */
    private val awaitingFirstFrame = AtomicBoolean(false)
    private var pendingSwitchDone: (() -> Unit)? = null
    private val switchTimeout = Runnable { completeSwitch() }

    /**
     * Rotation of the most recent analysis frame. The bitmap is never rotated, so this is what
     * turns the sensor buffer size into the display-upright size the overlay projects against.
     */
    @Volatile
    private var frameRotationDegrees = 0

    /** The owner the observer was actually registered on, see [observeLifecycle]. */
    private var observedOwner: LifecycleOwner? = null

    /**
     * Results below this timestamp came from the previous camera. Atomic rather than locked:
     * dropping one extra frame is harmless, blocking the frame path is not.
     */
    private val staleBefore = AtomicLong(0)

    private val landmarkBuffer = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
    private val worldBuffer = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)

    private val frames = FrameRingBuffer()
    private val triggers = TriggerEngine()
    private val smoothing = OneEuroFilter()
    private val calibrator = Calibrator(context)
    private val thermalMonitor = ThermalMonitor(context)

    /** What the precedence chain last produced. Read on the analysis thread, written on main. */
    @Volatile
    private var resolved =
        ResolvedPerformance(
            targetFps = Tiers.targetFps(DeviceTier.MEDIUM),
            preview = Tiers.preview(DeviceTier.MEDIUM),
            analysis = Tiers.analysis(DeviceTier.MEDIUM),
            detectionPaused = false,
        )

    @Volatile
    private var thermalState = ThermalState.NOMINAL
    private var lastThermalSampleMs = 0L

    /** Frame pacing. Analysis thread only, unlike [lastPoseMs]. */
    private var lastDetectMs = 0L

    /**
     * Written on the inference thread, read on the analysis thread to decide idle-search. Volatile
     * for visibility and because a 64-bit read is not guaranteed atomic on armeabi-v7a, where a
     * torn value pins the analyzer at the idle rate with somebody standing in front of it.
     */
    @Volatile
    private var lastPoseMs = 0L

    /** Measured from the analyzer, so `getState().fps` is what ran rather than what was asked for. */
    private var framesInWindow = 0
    private var fpsWindowStartMs = 0L

    @Volatile
    private var measuredFps = 0

    /** Reused across frames: this is the inference path, and a per-frame allocation here is one everywhere. */
    private val frameContext = FrameContext()
    private val firings = ArrayList<TriggerFiring>(4)

    /** Velocity conditions read a joint's own movement, which needs the frame before this one. */
    private val previousLandmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
    private var hasPreviousLandmarks = false

    /**
     * Reassigned on the main thread when the layout changes, read on the inference thread. Volatile
     * so the new array's contents are published with the reference rather than after it.
     */
    @Volatile
    private var frameLayout: FrameShape? = null

    /**
     * Velocity is a difference, so it needs the frame before this one. Written on the inference
     * thread; `previousFrameMs` is also cleared from main on a camera switch, which is what makes
     * it volatile and the other two not: they are only read when it is greater than zero.
     */
    private var previousComX = Float.NaN
    private var previousComY = Float.NaN

    @Volatile
    private var previousFrameMs = 0.0

    /** At most one tick in flight. Without it a detached view queues one per frame and floods on reattach. */
    private val tickPending = AtomicBoolean(false)

    /** Last emission, so `throttled` and `batched` can decide whether this frame is due. */
    private val lastEmitMs = AtomicLong(0)

    /**
     * One view drains the shared buffer, whoever attached first, and hands it over as an event.
     * The timer runs while the view is attached and costs one volatile read per tick when nothing
     * is streaming, which is cheaper than a way for the module to reach every view.
     */
    private val logFlush =
        object : Runnable {
            override fun run() {
                mainHandler.postDelayed(this, LOG_FLUSH_MS)
                if (!PoseLog.isStreaming || !PoseLog.claimStream(this@PoseCameraView)) return

                val entries = ArrayList<Map<String, Any?>>()
                val dropped = PoseLog.drain(entries)
                if (entries.isEmpty() && dropped == 0) return

                // The drop count opens the batch as a warn entry rather than riding beside it, so a
                // listener that only reads entries still sees that something was lost.
                if (dropped > 0) {
                    entries.add(
                        0,
                        mapOf(
                            "level" to "warn",
                            "category" to "engine",
                            "message" to "$dropped log entries were dropped before this batch",
                            "timestamp" to SystemClock.elapsedRealtime().toDouble(),
                            "data" to mapOf("droppedCount" to dropped),
                        ),
                    )
                }
                onLog(mapOf("entries" to entries))
            }
        }

    /** Allocation-free because it captures nothing: the tick is per emission, not per frame. */
    private val emitFramesTick =
        Runnable {
            tickPending.set(false)
            onFrames(EMPTY_PAYLOAD)
        }

    // Props. Applied together in onPropsUpdated rather than one at a time, so a render that changes
    // three of them rebinds the session once.
    private var propFacing: String = "auto"
    private var propDelegate: String = "auto"
    private var propActive: Boolean = true
    private var propDetection: Boolean = true
    private var propMaxPoses: Int = 1

    /** null is `'auto'`, resolved by [resolvedMinConfidence]. */
    private var propMinConfidence: Float? = null

    private var propPreview: String = "auto"
    private var propAnalysis: String = "auto"
    private var overlayEnabled: Boolean = true
    private var pendingOverlayConfig: OverlayConfig = OverlayConfig()
    private var propMode: DataMode = DataMode.OFF

    // Written on main, read on the inference thread, and 64-bit: same tearing exposure as above.
    @Volatile
    private var propThrottleMs: Long = DEFAULT_THROTTLE_MS

    @Volatile
    private var propFlushMs: Long = DEFAULT_FLUSH_MS
    private var propLandmarks: Boolean = true
    private var propWorldLandmarks: Boolean = false
    private var propAngleJoints: Array<String> = EMPTY_NAMES
    private var propSelection: IntArray? = null
    private var propProfile: Profile = Profile.AUTO
    private var propTargetFps: Int? = null
    private var propThermalPolicy: ThermalPolicy = ThermalPolicy.ADAPTIVE
    private var propSmoothing = false
    private var propMinCutoff = OneEuroFilter.DEFAULT_MIN_CUTOFF
    private var propBeta = OneEuroFilter.DEFAULT_BETA

    private var started = false
    private var readySent = false

    init {
        val container =
            FrameLayout(context).apply {
                layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
                setBackgroundColor(Color.BLACK)
            }
        container.addView(
            previewView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        container.addView(
            overlayView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        addView(container)

        // Props have not arrived yet. Without this a frame landing first would find no layout and
        // be dropped, and `snapshotFrame()` would answer empty for reasons nobody could see.
        applyFrameLayout()
    }

    // region props

    fun setFacing(value: String) {
        propFacing = value
    }

    fun setDelegate(value: String) {
        propDelegate = value
    }

    fun setActive(value: Boolean) {
        propActive = value
    }

    fun setDetection(value: Boolean) {
        propDetection = value
    }

    fun setMaxPoses(value: Int) {
        propMaxPoses = value.coerceIn(1, 5)
    }

    /** Baked into the landmarker at construction, so a change rebuilds it. See `applyDetectionState`. */
    fun setMinConfidence(value: Double?) {
        propMinConfidence = value?.toFloat()?.coerceIn(0.1f, 1f)
    }

    /** The prop, or the value `maxPoses` implies when nobody has chosen one. */
    private fun resolvedMinConfidence(): Float =
        propMinConfidence ?: if (propMaxPoses > 1) MULTI_POSE_CONFIDENCE else MIN_CONFIDENCE

    fun setResolution(value: String) {
        propPreview = value
    }

    fun setAnalysisResolution(value: String) {
        propAnalysis = value
    }

    internal fun setOverlay(
        enabled: Boolean,
        config: OverlayConfig,
    ) {
        overlayEnabled = enabled
        pendingOverlayConfig = config
    }

    internal fun setData(config: DataSettings) {
        propMode = config.mode
        propThrottleMs = config.throttleMs
        propFlushMs = config.flushMs
        propLandmarks = config.landmarks
        propWorldLandmarks = config.worldLandmarks
    }

    /** Already resolved and ordered by JavaScript. Reproducing that rule here would be a way to disagree with it. */
    internal fun setAngleJoints(joints: Array<String>) {
        propAngleJoints = joints
    }

    internal fun setSelection(indices: IntArray?) {
        propSelection = indices
    }

    internal fun setProfile(value: Profile) {
        propProfile = value
    }

    /** Null is `auto`, which is the only value calibration is allowed to move. */
    internal fun setTargetFps(value: Int?) {
        propTargetFps = value?.coerceIn(MIN_TARGET_FPS, MAX_TARGET_FPS)
    }

    internal fun setThermalPolicy(value: ThermalPolicy) {
        propThermalPolicy = value
    }

    internal fun setSmoothing(
        enabled: Boolean,
        minCutoff: Float,
        beta: Float,
    ) {
        propSmoothing = enabled
        propMinCutoff = minCutoff
        propBeta = beta
    }

    internal fun setTriggers(specs: List<TriggerSpec>) {
        // Not deferred to onPropsUpdated: the engine carries counts across by id, so applying it
        // twice would be harmless but applying it late would evaluate one frame against the old set.
        triggers.setTriggers(specs)
    }

    /** Runs once per prop batch. Only a resolution change takes the rebind path. */
    fun onPropsUpdated() {
        overlayView.config = pendingOverlayConfig
        overlayView.visibility = if (overlayEnabled) VISIBLE else GONE

        applyFrameLayout()
        smoothing.configure(propMinCutoff, propBeta)
        applyPerformance(reason = null)

        val preview = CameraSource.previewSizeFor(resolved.preview)
        val analysis = CameraSource.analysisSizeFor(resolved.analysis)
        val geometryChanged = preview != camera.previewSize || analysis != camera.analysisSize
        camera.previewSize = preview
        camera.analysisSize = analysis
        // Only 'auto' is documented to fall back to the other lens; a pinned one stays pinned.
        val pinnedFacing = propFacing == "front" || propFacing == "back"
        camera.facingFallbackAllowed = !pinnedFacing

        if (!propActive) {
            stopSession()
            return
        }

        if (!started) {
            startSession()
            return
        }

        if (geometryChanged) {
            restartSession()
            return
        }

        applyDetectionState()

        // 'auto' takes whatever the device could bind, the fallback lens included, and it is also
        // what `switchCamera()` leaves behind, so only a pinned facing is reconciled here.
        if (!pinnedFacing) return
        val target = resolveFacing()
        if (target == camera.facing) return
        // Reconciling a prop is not the interactive switch, and a paused session has nothing to
        // switch, so the value is parked for the next bind instead of failing a switch nobody asked
        // for and then losing the change.
        if (camera.isBound) setFacingInternal(target, null) else camera.setPendingFacing(target)
    }

    // endregion

    // region session

    private fun resolveFacing(): Facing =
        when (propFacing) {
            "back" -> Facing.BACK
            "front" -> Facing.FRONT
            else -> Facing.FRONT
        }

    private fun startSession() {
        if (started) return

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            emitError(ErrorCode.PERMISSION_DENIED, "Camera permission has not been granted.")
            return
        }

        val owner = lifecycleOwnerOrNull()
        if (owner == null) {
            emitError(ErrorCode.CAMERA_START_FAILED, "No lifecycle owner is available for the camera.")
            return
        }

        val model = modelFileName ?: PoseDetector.findModelAsset(context)
        if (model == null) {
            emitError(
                ErrorCode.MODEL_NOT_FOUND,
                "No pose_landmarker_*.task in the app assets. Run `npx expo prebuild`, " +
                    "or `npx react-native-pose-detection fetch-model full` for bare React Native.",
            )
            return
        }
        modelFileName = model

        started = true
        camera.setAnalyzer(analyzer)
        camera.start(
            owner = owner,
            facing = resolveFacing(),
            onBound = {
                syncOverlayMirroring()
                applyDetectionState()
                emitReadyOnce()
            },
            onFailed = ::emitError,
        )
    }

    private fun stopSession() {
        if (!started) return
        camera.setAnalyzer(null)
        camera.pause()
        releaseDetector()
        releaseConverter()
        overlayView.clearPose()
        completeSwitch()
        started = false
        readySent = false
    }

    private fun restartSession() {
        stopSession()
        startSession()
    }

    /** `detection = false` tears the landmarker down so its GPU memory is actually returned. */
    private fun applyDetectionState() {
        if (!propDetection) {
            releaseDetector()
            overlayView.clearPose()
            // Nothing else will emit ready once the pending build is discarded, and a camera that
            // is running with detection off is still a camera that came up.
            emitReadyOnce()
            return
        }

        // The delegate, maxPoses and minConfidence are baked into the landmarker at construction,
        // so a change to any of them has to rebuild it rather than wait for the next unrelated
        // restart to notice.
        val request = delegateRequest()
        val changed =
            request != detectorRequest ||
                propMaxPoses != detectorMaxPoses ||
                resolvedMinConfidence() != detectorMinConfidence
        if ((detector != null || detectorPending) && changed) {
            PoseLog.info(LogCategory.DETECTOR) { "delegate, maxPoses or minConfidence changed, rebuilding" }
            releaseDetector()
        }
        ensureDetector()
    }

    private fun delegateRequest(): DelegateRequest =
        when (propDelegate) {
            "gpu" -> DelegateRequest.GPU
            "cpu" -> DelegateRequest.CPU
            else -> DelegateRequest.AUTO
        }

    /**
     * Runs on the analysis thread. The heavy model takes seconds to build and `auto` runs a probe
     * inference first, which on main is an ANR window on every foreground.
     */
    private fun ensureDetector() {
        if (detector != null || detectorPending) return
        val model = modelFileName ?: return

        val request = delegateRequest()
        val maxPoses = propMaxPoses
        val minConfidence = resolvedMinConfidence()
        val generation = detectorGeneration
        detectorPending = true
        detectorRequest = request
        detectorMaxPoses = maxPoses
        detectorMinConfidence = minConfidence

        val submitted =
            onAnalysisThread {
                try {
                    val created =
                        PoseDetector.create(
                            context = context,
                            modelFileName = model,
                            request = request,
                            maxPoses = maxPoses,
                            minConfidence = minConfidence,
                            onResult = ::onLandmarks,
                            onError = ::onDetectionError,
                        )
                    mainHandler.post { adoptDetector(created, request, generation) }
                } catch (error: Throwable) {
                    PoseLog.error(LogCategory.DETECTOR) { "landmarker init failed: ${error.message}" }
                    mainHandler.post { failDetector(error, generation) }
                }
            }
        if (!submitted) detectorPending = false
    }

    private fun adoptDetector(
        created: PoseDetector,
        request: DelegateRequest,
        generation: Int,
    ) {
        if (generation != detectorGeneration) {
            // A teardown landed while this was still building, so it is closed instead of installed.
            closeDetector(created)
            return
        }
        detectorPending = false
        detector = created
        resolvedDelegate = created.delegate.name

        calibrator.start(created.modelFileName)
        applyPerformance(reason = null)
        preWarm(created)

        // The one path that actually downgrades is 'auto'. An explicit 'gpu' is pinned and never
        // falls back, so comparing the resolved delegate against the request is the whole test.
        if (request != DelegateRequest.CPU && created.delegate == Delegate.CPU) {
            emitError(ErrorCode.GPU_UNAVAILABLE, "The GPU delegate is unavailable, running on CPU.")
        }
        emitReadyOnce()
    }

    /**
     * One inference on a blank frame, on the analysis thread, before the user's first real one.
     * The first inference through a freshly built graph is several times slower than the rest, and
     * without this the frame that pays for that is the one somebody is watching.
     */
    private fun preWarm(created: PoseDetector) {
        onAnalysisThread {
            var blank: android.graphics.Bitmap? = null
            try {
                val bitmap =
                    android.graphics.Bitmap.createBitmap(
                        PRE_WARM_SIZE,
                        PRE_WARM_SIZE,
                        android.graphics.Bitmap.Config.ARGB_8888,
                    )
                blank = bitmap
                created.detect(BitmapImageBuilder(bitmap).build(), 0, 0)
            } catch (error: Throwable) {
                PoseLog.debug(LogCategory.DETECTOR) { "pre-warm did not run: ${error.message}" }
            } finally {
                // The result arrives asynchronously and MediaPipe copies the pixels in, so the
                // bitmap is not needed past this point.
                blank?.recycle()
            }
        }
    }

    /** The profile as `getProfile()` reports it. */
    fun profileState(): Map<String, Any?> {
        val current = resolved
        return mapOf(
            "profile" to propProfile.nameForJs(),
            "phase" to
                when (calibrator.phase) {
                    Calibrator.Phase.CALIBRATING -> "calibrating"
                    Calibrator.Phase.SETTLED -> "settled"
                    Calibrator.Phase.CACHED -> "cached"
                },
            "source" to
                when (calibrator.source) {
                    Calibrator.Source.STATIC -> "static"
                    Calibrator.Source.MEASURED -> "measured"
                    Calibrator.Source.CACHE -> "cache"
                },
            "tier" to calibrator.tier.nameForJs(),
            "resolved" to
                mapOf(
                    "delegate" to (resolvedDelegate ?: "CPU"),
                    "targetFps" to current.targetFps,
                    "preview" to current.preview,
                    "analysis" to current.analysis,
                ),
            "p50InferenceMs" to calibrator.p50InferenceMs,
        )
    }

    /** Setting one explicitly is a decision, so it takes effect now rather than at the next render. */
    internal fun applyProfile(profile: Profile) {
        propProfile = profile
        if (profile != Profile.AUTO) calibrator.reset()
        applyPerformance(reason = "calibration")
        restartSessionIfGeometryChanged()
    }

    private fun restartSessionIfGeometryChanged() {
        val preview = CameraSource.previewSizeFor(resolved.preview)
        val analysis = CameraSource.analysisSizeFor(resolved.analysis)
        if (preview == camera.previewSize && analysis == camera.analysisSize) return

        camera.previewSize = preview
        camera.analysisSize = analysis
        if (started) restartSession()
    }

    private fun failDetector(
        error: Throwable,
        generation: Int,
    ) {
        if (generation != detectorGeneration) return
        detectorPending = false
        // The build that would have set it failed, so keeping the previous value would report a
        // delegate that nothing is running on.
        resolvedDelegate = null
        emitError(
            ErrorCode.DETECTOR_INIT_FAILED,
            error.message ?: "The pose landmarker could not be created.",
        )
        emitReadyOnce()
    }

    /**
     * The analysis thread may be inside `detectAsync` right now, so the field is cleared on main,
     * stopping the next frame, and the close is queued behind the frame already running.
     */
    private fun releaseDetector() {
        detectorGeneration++
        detectorPending = false
        detectorRequest = null
        val doomed = detector ?: return
        detector = null
        closeDetector(doomed)
    }

    private fun closeDetector(doomed: PoseDetector) {
        // A rejected task means the analysis thread is gone, so there is nothing left to serialise
        // against and closing here is safe.
        if (!onAnalysisThread { doomed.close() }) doomed.close()
    }

    /** The bitmaps belong to the analysis thread, so the reset queues behind the frame using them. */
    private fun releaseConverter() {
        onAnalysisThread { converter.release() }
    }

    /** Serial queue for everything the landmarker touches, so build, close and detect cannot overlap. */
    private fun onAnalysisThread(block: () -> Unit): Boolean =
        runCatching { analysisExecutor.execute(block) }
            .onFailure { PoseLog.warn(LogCategory.DETECTOR) { "the analysis thread is gone: ${it.message}" } }
            .isSuccess

    // endregion

    // region frame path

    private val analyzer =
        ImageAnalysis.Analyzer { proxy ->
            // One missed close stalls the analyzer forever, so it is the only thing in the finally.
            try {
                // The first frame after a rebind is what tells the main thread the new camera is
                // really producing, which is what a switch waits on.
                if (awaitingFirstFrame.compareAndSet(true, false)) post { completeSwitch() }

                val detector = this.detector ?: return@Analyzer
                val now = SystemClock.elapsedRealtime()

                sampleThermal(now)
                if (resolved.detectionPaused) return@Analyzer
                if (!frameIsDue(now)) return@Analyzer

                val rotation = proxy.imageInfo.rotationDegrees
                frameRotationDegrees = rotation
                val bitmap = converter.convert(proxy)
                val image = BitmapImageBuilder(bitmap).build()
                detector.detect(image, rotation, proxy.imageInfo.timestamp / 1_000_000)
                countFrame(now)
            } catch (error: Throwable) {
                PoseLog.warn(LogCategory.DETECTOR) { "frame dropped: ${error.message}" }
            } finally {
                proxy.close()
            }
        }

    /**
     * The pacing gate. It serves `targetFps` and idle-search with one mechanism, because they are
     * the same thing: a rate the analyzer is allowed to run at. CameraX keeps delivering at sensor
     * rate either way, and a frame that is not due is closed without ever reaching the model.
     */
    private fun frameIsDue(nowMs: Long): Boolean {
        val idle = lastPoseMs != 0L && nowMs - lastPoseMs > IDLE_AFTER_MS
        val fps = if (idle) PerformanceResolver.IDLE_FPS else resolved.targetFps
        if (fps <= 0) return false

        // Slightly under the exact interval: a strict compare against a jittery sensor clock drops
        // every other frame and halves the rate it was asked to hold.
        val minIntervalMs = (MILLIS_PER_SECOND / fps * PACING_TOLERANCE).toLong()
        if (nowMs - lastDetectMs < minIntervalMs) return false

        lastDetectMs = nowMs
        return true
    }

    private fun countFrame(nowMs: Long) {
        framesInWindow += 1
        if (fpsWindowStartMs == 0L) fpsWindowStartMs = nowMs
        val elapsed = nowMs - fpsWindowStartMs
        if (elapsed < FPS_WINDOW_MS) return

        measuredFps = ((framesInWindow * MILLIS_PER_SECOND) / elapsed).toInt()
        framesInWindow = 0
        fpsWindowStartMs = nowMs
    }

    /** Sampled rather than subscribed: the listener API is 29+ and heat does not change quickly. */
    private fun sampleThermal(nowMs: Long) {
        if (!thermalMonitor.shouldSample(nowMs, lastThermalSampleMs)) return
        lastThermalSampleMs = nowMs

        val next = thermalMonitor.read()
        if (next == thermalState) return

        PoseLog.info(LogCategory.ENGINE) { "thermal state is now ${next.nameForJs()}" }
        thermalState = next
        // Reported even when the policy says not to act on it, so an app can decide for itself.
        post { applyPerformance(reason = "thermal") }
    }

    private fun onLandmarks(
        result: PoseLandmarkerResult,
        image: com.google.mediapipe.framework.image.MPImage,
    ) {
        if (result.timestampMs() < staleBefore.get()) {
            PoseLog.trace(LogCategory.CAMERA) { "dropped a frame from the previous camera" }
            return
        }

        val poses = result.landmarks()
        if (poses.isEmpty()) {
            overlayView.clearPose()
            // A frame is only current while a pose is in it, and velocity across the gap where
            // someone left and came back is not a speed anybody moved at.
            frames.clearLatest()
            resetVelocity()
            triggers.onPoseLost()
            // Filtering across the gap where somebody left and came back would invent the motion
            // between the two places they stood.
            smoothing.reset()
            return
        }

        val primaryIndex = primaryPose(poses)
        val pose = poses[primaryIndex]
        if (pose.size < Skeleton.LANDMARK_COUNT) return

        // Same monotonic clock the log channel stamps entries with, so a log line maps to the frame
        // that caused it. It is when the pose became known, not when the sensor exposed it.
        val nowMs = SystemClock.elapsedRealtime()
        lastPoseMs = nowMs

        for (index in 0 until Skeleton.LANDMARK_COUNT) {
            val landmark = pose[index]
            val base = index * Skeleton.LANDMARK_STRIDE
            landmarkBuffer[base + Skeleton.OFFSET_X] = landmark.x()
            landmarkBuffer[base + Skeleton.OFFSET_Y] = landmark.y()
            landmarkBuffer[base + Skeleton.OFFSET_Z] = landmark.z()
            // Not orElse(0f): that takes an Object, so the literal is boxed once per landmark.
            val visibility = landmark.visibility()
            landmarkBuffer[base + Skeleton.OFFSET_VISIBILITY] = if (visibility.isPresent) visibility.get() else 0f
        }

        // A gap means a switch, a pause, or a backgrounded app. The positions on either side are
        // real, the difference between them is not a movement that happened at that speed.
        val elapsedMs = nowMs.toDouble() - previousFrameMs
        val comparable = previousFrameMs > 0.0 && elapsedMs > 0.0 && elapsedMs <= MAX_VELOCITY_GAP_MS
        val elapsedSeconds = if (comparable) (elapsedMs / MILLIS_PER_SECOND).toFloat() else Float.NaN

        // Before anything reads a coordinate: the overlay, the geometry, the evaluators and the
        // wire all have to agree about where the body is.
        if (propSmoothing) smoothing.apply(landmarkBuffer, elapsedSeconds) else smoothing.reset()

        // Landmarks are normalized to the rotated frame MediaPipe was asked to process, not to the
        // sensor buffer, so the overlay is handed the display-upright size. The mirror flag comes
        // from the session, which is main-thread state, and is pushed in from there.
        val rotation = frameRotationDegrees
        val frameWidth = if (rotation % 180 == 0) image.width else image.height
        val frameHeight = if (rotation % 180 == 0) image.height else image.width

        overlayView.submit(landmarkBuffer, frameWidth, frameHeight)

        buildFrame(result, primaryIndex, pose.size, frameWidth, frameHeight, nowMs, comparable, elapsedSeconds)
    }

    /**
     * Largest bounding box, ties broken by distance from the frame centre. With one pose this is
     * index 0 without measuring anything; MediaPipe's own order is detection order and means
     * nothing about who the subject is.
     */
    private fun primaryPose(
        poses: List<List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>>,
    ): Int {
        if (poses.size <= 1) return 0

        var best = 0
        var bestArea = -1f
        var bestOffset = Float.MAX_VALUE

        for (index in poses.indices) {
            val pose = poses[index]
            if (pose.size < Skeleton.LANDMARK_COUNT) continue

            var minX = Float.MAX_VALUE
            var maxX = -Float.MAX_VALUE
            var minY = Float.MAX_VALUE
            var maxY = -Float.MAX_VALUE

            // Indexed, not for-in: a List iterator here is an allocation per pose per frame.
            for (position in pose.indices) {
                val point = pose[position]
                if (point.x() < minX) minX = point.x()
                if (point.x() > maxX) maxX = point.x()
                if (point.y() < minY) minY = point.y()
                if (point.y() > maxY) maxY = point.y()
            }

            val area = (maxX - minX) * (maxY - minY)
            val offset = abs((minX + maxX) / 2f - 0.5f) + abs((minY + maxY) / 2f - 0.5f)

            val better =
                area > bestArea + AREA_TIE_EPSILON || (abs(area - bestArea) <= AREA_TIE_EPSILON && offset < bestOffset)
            if (better) {
                best = index
                bestArea = area
                bestOffset = offset
            }
        }
        return best
    }

    private fun resetVelocity() {
        previousComX = Float.NaN
        previousComY = Float.NaN
        previousFrameMs = 0.0
        hasPreviousLandmarks = false
    }

    /**
     * Encodes one frame into the wire layout and hands it to the ring buffer. Runs on MediaPipe's
     * callback thread. The latest frame is recorded whatever the mode is, because `snapshotFrame()`
     * is documented to answer at `mode: 'off'`; only buffering and the tick are the mode's business.
     */
    @Suppress("LongParameterList")
    private fun buildFrame(
        result: PoseLandmarkerResult,
        pose: Int,
        poseSize: Int,
        frameWidth: Int,
        frameHeight: Int,
        nowMs: Long,
        comparable: Boolean,
        elapsedSeconds: Float,
    ) {
        // One volatile read: the scratch buffer belongs to the shape, so a layout change swaps
        // both together and this can never pair an old shape with a new buffer.
        val layout = frameLayout ?: return
        val scratch = layout.scratch

        val indices = layout.jointIndices
        var cursor = 0

        for (position in indices.indices) {
            val base = indices[position] * Skeleton.LANDMARK_STRIDE
            scratch[cursor] = landmarkBuffer[base]
            scratch[cursor + 1] = landmarkBuffer[base + 1]
            scratch[cursor + 2] = landmarkBuffer[base + 2]
            scratch[cursor + 3] = landmarkBuffer[base + 3]
            cursor += Skeleton.LANDMARK_STRIDE
        }

        if (layout.worldLandmarks) {
            fillWorldBuffer(result, pose, poseSize)
            for (position in indices.indices) {
                val base = indices[position] * Skeleton.LANDMARK_STRIDE
                scratch[cursor] = worldBuffer[base]
                scratch[cursor + 1] = worldBuffer[base + 1]
                scratch[cursor + 2] = worldBuffer[base + 2]
                scratch[cursor + 3] = worldBuffer[base + 3]
                cursor += Skeleton.LANDMARK_STRIDE
            }
        }

        val triples = layout.angleTriples
        for (position in triples.indices) {
            val triple = triples[position]
            scratch[cursor] =
                Geometry.angleDegrees(landmarkBuffer, triple[0], triple[1], triple[2], frameWidth, frameHeight)
            cursor += 1
        }

        val timestampMs = nowMs.toDouble()

        Geometry.centerOfMass(landmarkBuffer, scratch, cursor)
        val comX = scratch[cursor]
        val comY = scratch[cursor + 1]
        cursor += 2

        if (comparable) {
            scratch[cursor] = (comX - previousComX) / elapsedSeconds
            scratch[cursor + 1] = (comY - previousComY) / elapsedSeconds
        } else {
            // Unknown, not zero: the first frame of a pose has nothing to differ from, and zero
            // would read as a body that was measured and found to be still.
            scratch[cursor] = Float.NaN
            scratch[cursor + 1] = Float.NaN
        }
        cursor += 2

        val velocityX = scratch[cursor - 2]
        val velocityY = scratch[cursor - 1]
        scratch[cursor] = Geometry.bodySpan(landmarkBuffer)

        val dispatchNanos = detector?.dispatchNanosFor(result.timestampMs()) ?: 0L
        val processingMs =
            if (dispatchNanos == 0L) 0.0 else (System.nanoTime() - dispatchNanos) / NANOS_PER_MILLI

        evaluateTriggers(
            nowMs = nowMs,
            timestampMs = timestampMs,
            processingMs = processingMs,
            scratch = scratch,
            comX = comX,
            comY = comY,
            velocityX = velocityX,
            velocityY = velocityY,
            elapsedSeconds = elapsedSeconds,
            frameWidth = frameWidth,
            frameHeight = frameHeight,
        )

        // Only `auto` is calibrated. A named profile is somebody saying they have already decided.
        if (propProfile == Profile.AUTO && processingMs > 0.0) {
            val moved = calibrator.record(processingMs.toFloat(), resolved.targetFps, nowMs)
            if (moved) post { onCalibrationMoved() }
        }

        System.arraycopy(landmarkBuffer, 0, previousLandmarks, 0, landmarkBuffer.size)
        hasPreviousLandmarks = true

        previousComX = comX
        previousComY = comY
        previousFrameMs = timestampMs

        deliver(scratch, timestampMs, processingMs)
    }

    /**
     * Runs before the frame is delivered, because a `snapshot: true` trigger claims the frame it
     * fired on and that has to be this one rather than whatever is current when JavaScript asks.
     */
    @Suppress("LongParameterList")
    private fun evaluateTriggers(
        nowMs: Long,
        timestampMs: Double,
        processingMs: Double,
        scratch: FloatArray,
        comX: Float,
        comY: Float,
        velocityX: Float,
        velocityY: Float,
        elapsedSeconds: Float,
        frameWidth: Int,
        frameHeight: Int,
    ) {
        if (triggers.isEmpty) return

        frameContext.landmarks = landmarkBuffer
        frameContext.previousLandmarks = if (hasPreviousLandmarks) previousLandmarks else null
        frameContext.elapsedSeconds = elapsedSeconds
        frameContext.comX = comX
        frameContext.comY = comY
        frameContext.comVelocityX = velocityX
        frameContext.comVelocityY = velocityY
        frameContext.frameWidth = frameWidth
        frameContext.frameHeight = frameHeight

        firings.clear()
        triggers.evaluate(frameContext, nowMs, firings)
        if (firings.isEmpty()) return

        for (index in firings.indices) {
            val firing = firings[index]
            val ticket =
                if (firing.wantsSnapshot) frames.mintSnapshot(scratch, timestampMs, processingMs) else 0

            val payload = HashMap<String, Any?>(TRIGGER_PAYLOAD_SLOTS)
            payload["id"] = firing.id
            payload["phase"] = firing.phase
            payload["count"] = firing.count
            payload["timestamp"] = firing.timestampMs
            // Held as Double? and stored as-is: `?.let { payload[k] = it }` unboxes then re-boxes.
            val durationMs: Double? = firing.durationMs
            if (durationMs != null) payload["durationMs"] = durationMs
            // Zero means the frame could not be held, and the event says nothing rather than
            // handing over a ticket that redeems to an empty buffer.
            if (ticket != 0) payload["snapshotId"] = ticket

            mainHandler.post { onTrigger(payload) }
        }
        firings.clear()
    }

    private fun onCalibrationMoved() {
        applyPerformance(reason = "calibration")
        modelFileName?.let(calibrator::persist)
    }

    /** The delivery mode decides only two things: whether this frame is kept, and whether to tick. */
    private fun deliver(
        scratch: FloatArray,
        timestampMs: Double,
        processingMs: Double,
    ) {
        val mode = propMode
        val now = SystemClock.elapsedRealtime()
        val sinceEmit = now - lastEmitMs.get()

        val due =
            when (mode) {
                DataMode.OFF -> false
                DataMode.LIVE -> true
                DataMode.THROTTLED -> sinceEmit >= propThrottleMs
                DataMode.BATCHED -> sinceEmit >= propFlushMs
            }

        // `throttled` drops the frames between emissions rather than buffering them, which is what
        // the mode means. `batched` buffers everything and flushes on the interval.
        val buffered = mode == DataMode.LIVE || mode == DataMode.BATCHED || (mode == DataMode.THROTTLED && due)

        frames.submit(scratch, timestampMs, processingMs, buffered)

        if (!due || mode == DataMode.OFF) return
        lastEmitMs.set(now)
        // A tick already queued has not been answered yet, so a second one would ask for the same
        // drain twice. mainHandler rather than View.post: that one holds runnables while detached.
        if (tickPending.compareAndSet(false, true)) mainHandler.post(emitFramesTick)
    }

    /**
     * The world landmarks of the pose the rest of the frame describes.
     *
     * Indexed rather than taken from the front: with `maxPoses` above one, the pose everything else
     * reads is the largest body in the frame, and `worldLandmarks()[0]` is whichever one MediaPipe
     * happened to detect first. Taking the front would pair one person's screen coordinates with
     * another person's metric ones in a single frame.
     */
    private fun fillWorldBuffer(
        result: PoseLandmarkerResult,
        pose: Int,
        poseSize: Int,
    ) {
        val world = result.worldLandmarks()
        val points = if (pose < world.size) world[pose] else null

        if (points == null || points.size < poseSize) {
            java.util.Arrays.fill(worldBuffer, 0f)
            return
        }

        for (index in 0 until Skeleton.LANDMARK_COUNT) {
            val landmark = points[index]
            val base = index * Skeleton.LANDMARK_STRIDE
            worldBuffer[base + Skeleton.OFFSET_X] = landmark.x()
            worldBuffer[base + Skeleton.OFFSET_Y] = landmark.y()
            worldBuffer[base + Skeleton.OFFSET_Z] = landmark.z()
            val visibility = landmark.visibility()
            worldBuffer[base + Skeleton.OFFSET_VISIBILITY] = if (visibility.isPresent) visibility.get() else 0f
        }
    }

    /** On MediaPipe's callback thread. Rate limited: a dead delegate fails every frame. */
    private fun onDetectionError(error: RuntimeException) {
        PoseLog.warn(LogCategory.DETECTOR) { "inference failed: ${error.message}" }
        val now = SystemClock.elapsedRealtime()
        val previous = lastDetectionErrorMs.get()
        if (now - previous < DETECTION_ERROR_INTERVAL_MS) return
        if (!lastDetectionErrorMs.compareAndSet(previous, now)) return
        val message = error.message ?: "inference failed"
        post { emitError(ErrorCode.DETECTION_FAILED, message) }
    }

    // endregion

    // region ref methods

    fun switchCamera(
        onDone: (String) -> Unit,
        onFailed: (String) -> Unit,
    ) {
        val target = if (camera.facing == Facing.FRONT) Facing.BACK else Facing.FRONT
        setFacingInternal(target, onDone, onFailed)
    }

    internal fun setFacingInternal(
        target: Facing,
        onDone: ((String) -> Unit)?,
        onFailed: ((String) -> Unit)? = null,
    ) {
        camera.switchTo(
            target = target,
            onDone = { facing ->
                // Everything from before this point belongs to the old camera. Frames already on
                // the analysis thread can still be stamped after this read, which costs at most a
                // frame or two drawn with the new mirroring.
                staleBefore.set((detector?.lastTimestampMs ?: 0L) + 1)
                previousFrameMs = 0.0
                syncOverlayMirroring()

                // Anything still waiting from an earlier switch is settled first, so no promise is
                // left dangling when two switches overlap.
                completeSwitch()
                val name = facing.nameForJs()
                pendingSwitchDone = {
                    onCameraChange(mapOf("facing" to name))
                    onDone?.invoke(name)
                }
                // A rebind is not a frame. Reporting the switch waits for the new camera to deliver
                // one, with a timeout so a camera that never does still settles the promise.
                awaitingFirstFrame.set(true)
                postDelayed(switchTimeout, SWITCH_FRAME_TIMEOUT_MS)
            },
            onFailed = { code, error ->
                emitError(code, error?.message ?: "The camera could not be switched.")
                onFailed?.invoke(error?.message ?: code.name)
            },
        )
    }

    /** Main thread only. Idempotent, so the frame path and the timeout can both call it. */
    private fun completeSwitch() {
        awaitingFirstFrame.set(false)
        removeCallbacks(switchTimeout)
        val done = pendingSwitchDone ?: return
        pendingSwitchDone = null
        done()
    }

    /** Facing is main-thread state, so it is pushed on bind rather than read per frame. */
    private fun syncOverlayMirroring() {
        overlayView.setMirrored(camera.facing == Facing.FRONT)
    }

    fun pauseCamera() {
        camera.setAnalyzer(null)
        camera.pause()
        overlayView.clearPose()
    }

    fun resumeCamera() {
        camera.setAnalyzer(analyzer)
        camera.resume(::emitError)
        syncOverlayMirroring()
    }

    fun startDetection() {
        propDetection = true
        applyDetectionState()
    }

    fun stopDetection() {
        propDetection = false
        applyDetectionState()
    }

    fun setOverlayEnabled(enabled: Boolean) {
        overlayEnabled = enabled
        overlayView.visibility = if (enabled) VISIBLE else GONE
    }

    /**
     * Runs the precedence chain and adopts the result. [reason] is what `onPerformanceChange`
     * reports; null means this is a props update rather than something the engine decided, and
     * fires no event.
     */
    private fun applyPerformance(reason: String?) {
        val next =
            PerformanceResolver.resolve(
                profile = propProfile,
                tier = calibrator.tier,
                requestedFps = propTargetFps,
                requestedPreview = propPreview,
                requestedAnalysis = propAnalysis,
                thermal = thermalState,
                policy = propThermalPolicy,
            )

        val changed = next != resolved
        resolved = next
        if (reason == null || !changed) return

        post { emitPerformanceChange(reason) }
    }

    private fun emitPerformanceChange(reason: String) {
        val current = resolved
        onPerformanceChange(
            mapOf(
                "reason" to reason,
                "delegate" to (resolvedDelegate ?: "CPU"),
                "targetFps" to current.targetFps,
                "analysisResolution" to CameraSource.analysisSizeFor(current.analysis).toMap(),
                "actualFps" to measuredFps,
            ),
        )
    }

    /**
     * The layout is rebuilt on every props batch but only adopted when it differs: a re-render that
     * changes nothing about `data` would otherwise clear frames that were waiting to be flushed.
     */
    private fun applyFrameLayout() {
        val indices =
            when {
                !propLandmarks -> EMPTY_INDICES
                else -> propSelection ?: FrameShape.ALL_JOINTS
            }
        val next = FrameShape(indices, propWorldLandmarks, propAngleJoints)

        val current = frameLayout
        if (current != null && current.sameAs(next)) return

        frameLayout = next
        frames.setLayout(next)
    }

    fun drainFrames(): NativeArrayBuffer = NativeArrayBuffer.wrap(frames.drain())

    fun snapshotFrame(): NativeArrayBuffer = NativeArrayBuffer.wrap(frames.snapshot())

    /** An unknown or spent ticket is an empty buffer, which is the documented contract. */
    fun takeTriggerSnapshot(snapshotId: Int): NativeArrayBuffer =
        NativeArrayBuffer.wrap(frames.takeSnapshot(snapshotId))

    fun currentState(): Map<String, Any?> =
        mapOf(
            "facing" to camera.facing.nameForJs(),
            "active" to camera.isBound,
            "detecting" to (detector != null || detectorPending),
            "fps" to measuredFps,
            "delegate" to (resolvedDelegate ?: "CPU"),
            "deviceTier" to calibrator.tier.nameForJs(),
        )

    // endregion

    private fun emitReadyOnce() {
        if (readySent || !camera.isBound) return
        // onReady reports the delegate that is actually in use, and that is not known until the
        // landmarker has finished building, so a pending build holds the event back.
        if (detectorPending) return
        readySent = true

        val variant =
            modelFileName
                ?.removePrefix("pose_landmarker_")
                ?.removeSuffix(".task")
                ?: "full"

        onReady(
            mapOf(
                "model" to variant,
                "delegate" to (resolvedDelegate ?: "CPU"),
                "delegateRequested" to propDelegate,
                "targetFps" to resolved.targetFps,
                "deviceTier" to calibrator.tier.nameForJs(),
                "resolution" to camera.previewSize.toMap(),
                "analysisResolution" to camera.analysisSize.toMap(),
                "facing" to camera.facing.nameForJs(),
            ),
        )
    }

    private fun emitError(
        code: ErrorCode,
        message: String,
    ) {
        PoseLog.error(LogCategory.CAMERA) { "$code: $message" }
        onError(mapOf("code" to code.name, "message" to message, "fatal" to code.fatal))
    }

    private fun emitError(
        code: ErrorCode,
        error: Throwable?,
    ) {
        emitError(code, error?.message ?: code.name)
    }

    override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        // The analysis buffer has to be rotated to match, or the landmarks arrive sideways.
        camera.updateTargetRotation()
    }

    /**
     * Android reports no configuration change for a 180 degree turn, so the analysis buffer would
     * keep a stale rotation and every landmark would arrive upside down. Watch the display instead.
     */
    private val displayListener =
        object : DisplayManager.DisplayListener {
            override fun onDisplayAdded(displayId: Int) = Unit

            override fun onDisplayRemoved(displayId: Int) = Unit

            override fun onDisplayChanged(displayId: Int) {
                if (displayId != previewView.display?.displayId) return
                camera.updateTargetRotation()
            }
        }

    private val displayManager: DisplayManager?
        get() = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager

    override fun onDetachedFromWindow() {
        unregisterEverything()
        stopObservingLifecycle()
        releaseForDetach()
        super.onDetachedFromWindow()
    }

    /**
     * Everything [onAttachedToWindow] registered. Extracted because destroy and detach both have to
     * undo it, and when only detach did, a view destroyed without a detach left the Application
     * holding a memory callback, `DisplayManagerGlobal` holding a listener, a self-reposting
     * runnable in the main queue, and `PoseLog` holding the log-stream claim. Each of those retains
     * the view, and the view retains an Activity.
     *
     * Every call is idempotent, so running it twice on the normal path costs nothing.
     */
    private fun unregisterEverything() {
        runCatching { context.applicationContext.unregisterComponentCallbacks(memoryCallbacks) }
        runCatching { displayManager?.unregisterDisplayListener(displayListener) }
        mainHandler.removeCallbacks(logFlush)
        PoseLog.releaseStream(this)
    }

    /** Views do not receive `onTrimMemory`, the application does, so subscribe while attached. */
    private val memoryCallbacks =
        object : ComponentCallbacks2 {
            override fun onTrimMemory(level: Int) = this@PoseCameraView.onTrimMemory(level)

            override fun onConfigurationChanged(newConfig: Configuration) = Unit

            @Deprecated("Required by ComponentCallbacks, superseded by onTrimMemory")
            override fun onLowMemory() = this@PoseCameraView.onTrimMemory(TRIM_MEMORY_COMPLETE_LEVEL)
        }

    /**
     * Backgrounding gives up the landmarker rather than holding its GPU memory. CameraX releases
     * the capture session itself; this is the half it does not know about.
     */
    private val lifecycleObserver =
        object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                PoseLog.info(LogCategory.CAMERA) { "backgrounded, releasing the detector" }
                releaseDetector()
                releaseConverter()
                overlayView.clearPose()
            }

            override fun onStart(owner: LifecycleOwner) {
                if (!started || !propActive) return
                PoseLog.info(LogCategory.CAMERA) { "foregrounded, restoring detection" }
                applyDetectionState()
            }
        }

    /** The process is next to be killed. The landmarker is the largest block we can give back. */
    fun onTrimMemory(level: Int) {
        if (level >= TRIM_MEMORY_COMPLETE_LEVEL) {
            PoseLog.warn(LogCategory.DETECTOR) { "trim level $level, releasing the landmarker" }
            releaseDetector()
            releaseConverter()
            overlayView.clearPose()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        context.applicationContext.registerComponentCallbacks(memoryCallbacks)
        observeLifecycle()
        displayManager?.registerDisplayListener(displayListener, null)
        mainHandler.removeCallbacks(logFlush)
        mainHandler.postDelayed(logFlush, LOG_FLUSH_MS)
        // Reattaching after a temporary detach re-establishes whatever the props already say,
        // rather than waiting for a prop to change before the camera comes back.
        onPropsUpdated()
    }

    /**
     * The current activity can change while this view lives, so the owner actually observed is
     * remembered. Resolving again at detach can leave the observer registered on the old one.
     */
    private fun observeLifecycle() {
        stopObservingLifecycle()
        val owner = lifecycleOwnerOrNull() ?: return
        observedOwner = owner
        owner.lifecycle.addObserver(lifecycleObserver)
    }

    private fun stopObservingLifecycle() {
        observedOwner?.lifecycle?.removeObserver(lifecycleObserver)
        observedOwner = null
    }

    private fun lifecycleOwnerOrNull(): LifecycleOwner? =
        context as? LifecycleOwner ?: appContext.currentActivity as? LifecycleOwner

    /**
     * Detaching is not destruction: a view scrolled out of a list comes back. Releases the session
     * but keeps the analysis thread, which a reattached view still needs.
     */
    private fun releaseForDetach() {
        camera.setAnalyzer(null)
        camera.release()
        releaseDetector()
        releaseConverter()
        completeSwitch()
        started = false
        readySent = false
    }

    /** Called from `OnViewDestroys`, where the view really is going away. */
    fun releaseEverything() {
        unregisterEverything()
        releaseForDetach()
        stopObservingLifecycle()
        // Shutdown, not shutdownNow: the queued close of the landmarker has to run before the
        // thread goes away.
        analysisExecutor.shutdown()
    }

    private companion object {
        /**
         * Confidence for one subject and for several, which is one decision rather than two.
         *
         * 0.6 keeps a single subject cleanly tracked and keeps scenery from being offered as a
         * body. It also means the model returns one pose whatever `maxPoses` says, so asking for
         * more than one drops to 0.3, which is measured to be where a second person actually
         * appears rather than the first person twice. See guides/reference/pose-camera.md.
         */
        const val MIN_CONFIDENCE = 0.6f
        const val MULTI_POSE_CONFIDENCE = 0.3f
        const val DEFAULT_THROTTLE_MS = 100L
        const val DEFAULT_FLUSH_MS = 500L
        const val MILLIS_PER_SECOND = 1_000.0
        const val NANOS_PER_MILLI = 1_000_000.0

        /** Six frames at 30 fps. Longer than a stutter, shorter than anything worth measuring across. */
        const val MAX_VELOCITY_GAP_MS = 200.0

        /** id, phase, count, timestamp, and at most durationMs and snapshotId. */
        const val TRIGGER_PAYLOAD_SLOTS = 6

        const val MIN_TARGET_FPS = 1
        const val MAX_TARGET_FPS = 60

        /** No pose for this long drops the analyzer to [PerformanceResolver.IDLE_FPS]. */
        const val IDLE_AFTER_MS = 2_000L

        const val FPS_WINDOW_MS = 1_000L
        const val PACING_TOLERANCE = 0.9

        /** Two boxes within this much area are the same size, and the centre breaks the tie. */
        const val AREA_TIE_EPSILON = 1e-4f

        const val PRE_WARM_SIZE = 256
        const val LOG_FLUSH_MS = 250L
        val EMPTY_PAYLOAD = emptyMap<String, Any?>()
        val EMPTY_NAMES = emptyArray<String>()
        val EMPTY_INDICES = IntArray(0)
        const val TRIM_MEMORY_COMPLETE_LEVEL = 80
        const val DETECTION_ERROR_INTERVAL_MS = 1_000L
        const val SWITCH_FRAME_TIMEOUT_MS = 1_500L
    }
}

internal fun Facing.nameForJs(): String = if (this == Facing.FRONT) "front" else "back"

internal fun Size.toMap(): Map<String, Any?> = mapOf("width" to width, "height" to height)
