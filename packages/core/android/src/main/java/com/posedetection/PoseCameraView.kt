package com.posedetection

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
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

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

    /**
     * Reassigned on the main thread when the layout changes, read on the inference thread. Volatile
     * so the new array's contents are published with the reference rather than after it.
     */
    @Volatile
    private var frameLayout: FrameShape? = null

    /** Written on the inference thread only, then copied into the ring buffer under its lock. */
    @Volatile
    private var frameScratch = FloatArray(0)

    /** Velocity is a difference, so it needs the frame before this one. Inference thread only. */
    private var previousComX = Float.NaN
    private var previousComY = Float.NaN
    private var previousFrameMs = 0.0

    /** Last emission, so `throttled` and `batched` can decide whether this frame is due. */
    private val lastEmitMs = AtomicLong(0)

    /** Allocation-free because it captures nothing: the tick is per emission, not per frame. */
    private val emitFramesTick = Runnable { onFrames(EMPTY_PAYLOAD) }

    // Props. Applied together in onPropsUpdated rather than one at a time, so a render that changes
    // three of them rebinds the session once.
    private var propFacing: String = "auto"
    private var propDelegate: String = "auto"
    private var propActive: Boolean = true
    private var propDetection: Boolean = true
    private var propMaxPoses: Int = 1
    private var propPreview: String = "auto"
    private var propAnalysis: String = "auto"
    private var overlayEnabled: Boolean = true
    private var pendingOverlayConfig: OverlayConfig = OverlayConfig()
    private var propMode: DataMode = DataMode.OFF
    private var propThrottleMs: Long = DEFAULT_THROTTLE_MS
    private var propFlushMs: Long = DEFAULT_FLUSH_MS
    private var propLandmarks: Boolean = true
    private var propWorldLandmarks: Boolean = false
    private var propAngleJoints: Array<String> = EMPTY_NAMES
    private var propSelection: IntArray? = null

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

    /** Runs once per prop batch. Only a resolution change takes the rebind path. */
    fun onPropsUpdated() {
        overlayView.config = pendingOverlayConfig
        overlayView.visibility = if (overlayEnabled) VISIBLE else GONE

        applyFrameLayout()

        val preview = CameraSource.previewSizeFor(propPreview)
        val analysis = CameraSource.analysisSizeFor(propAnalysis)
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

        // maxPoses and the delegate are baked into the landmarker at construction, so a change to
        // either has to rebuild it rather than wait for the next unrelated restart to notice.
        val request = delegateRequest()
        if ((detector != null || detectorPending) &&
            (request != detectorRequest || propMaxPoses != detectorMaxPoses)
        ) {
            PoseLog.info(LogCategory.DETECTOR) { "delegate or maxPoses changed, rebuilding" }
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
        val generation = detectorGeneration
        detectorPending = true
        detectorRequest = request
        detectorMaxPoses = maxPoses

        val submitted =
            onAnalysisThread {
                try {
                    val created =
                        PoseDetector.create(
                            context = context,
                            modelFileName = model,
                            request = request,
                            maxPoses = maxPoses,
                            minConfidence = MIN_CONFIDENCE,
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

        // The one path that actually downgrades is 'auto'. An explicit 'gpu' is pinned and never
        // falls back, so comparing the resolved delegate against the request is the whole test.
        if (request != DelegateRequest.CPU && created.delegate == Delegate.CPU) {
            emitError(ErrorCode.GPU_UNAVAILABLE, "The GPU delegate is unavailable, running on CPU.")
        }
        emitReadyOnce()
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
                val rotation = proxy.imageInfo.rotationDegrees
                frameRotationDegrees = rotation
                val bitmap = converter.convert(proxy)
                val image = BitmapImageBuilder(bitmap).build()
                detector.detect(image, rotation, proxy.imageInfo.timestamp / 1_000_000)
            } catch (error: Throwable) {
                PoseLog.warn(LogCategory.DETECTOR) { "frame dropped: ${error.message}" }
            } finally {
                proxy.close()
            }
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
            return
        }

        // Phase 4 adds primary-pose selection for maxPoses > 1. Until then the first pose is used.
        val pose = poses[0]
        if (pose.size < Skeleton.LANDMARK_COUNT) return

        for (index in 0 until Skeleton.LANDMARK_COUNT) {
            val landmark = pose[index]
            val base = index * Skeleton.LANDMARK_STRIDE
            landmarkBuffer[base + Skeleton.OFFSET_X] = landmark.x()
            landmarkBuffer[base + Skeleton.OFFSET_Y] = landmark.y()
            landmarkBuffer[base + Skeleton.OFFSET_Z] = landmark.z()
            landmarkBuffer[base + Skeleton.OFFSET_VISIBILITY] = landmark.visibility().orElse(0f)
        }

        // Landmarks are normalized to the rotated frame MediaPipe was asked to process, not to the
        // sensor buffer, so the overlay is handed the display-upright size. The mirror flag comes
        // from the session, which is main-thread state, and is pushed in from there.
        val rotation = frameRotationDegrees
        val frameWidth = if (rotation % 180 == 0) image.width else image.height
        val frameHeight = if (rotation % 180 == 0) image.height else image.width

        overlayView.setSourceSize(frameWidth, frameHeight)
        overlayView.submit(landmarkBuffer)

        buildFrame(result, pose.size, frameWidth, frameHeight)
    }

    private fun resetVelocity() {
        previousComX = Float.NaN
        previousComY = Float.NaN
        previousFrameMs = 0.0
    }

    /**
     * Encodes one frame into the wire layout and hands it to the ring buffer. Runs on MediaPipe's
     * callback thread. The latest frame is recorded whatever the mode is, because `snapshotFrame()`
     * is documented to answer at `mode: 'off'`; only buffering and the tick are the mode's business.
     */
    private fun buildFrame(
        result: PoseLandmarkerResult,
        poseSize: Int,
        frameWidth: Int,
        frameHeight: Int,
    ) {
        val layout = frameLayout ?: return
        val scratch = frameScratch
        if (scratch.size < layout.floatsPerFrame) return

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
            fillWorldBuffer(result, poseSize)
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

        // Same monotonic clock the log channel stamps entries with, so a log line maps to the frame
        // that caused it. It is when the pose became known, not when the sensor exposed it.
        val timestampMs = SystemClock.elapsedRealtime().toDouble()

        Geometry.centerOfMass(landmarkBuffer, scratch, cursor)
        val comX = scratch[cursor]
        val comY = scratch[cursor + 1]
        cursor += 2

        val elapsedSeconds = (timestampMs - previousFrameMs) / MILLIS_PER_SECOND
        if (previousFrameMs > 0.0 && elapsedSeconds > 0.0) {
            scratch[cursor] = ((comX - previousComX) / elapsedSeconds).toFloat()
            scratch[cursor + 1] = ((comY - previousComY) / elapsedSeconds).toFloat()
        } else {
            // Unknown, not zero: the first frame of a pose has nothing to differ from, and zero
            // would read as a body that was measured and found to be still.
            scratch[cursor] = Float.NaN
            scratch[cursor + 1] = Float.NaN
        }
        cursor += 2

        scratch[cursor] = Geometry.bodySpan(landmarkBuffer)

        previousComX = comX
        previousComY = comY
        previousFrameMs = timestampMs

        val dispatchNanos = detector?.dispatchNanosFor(result.timestampMs()) ?: 0L
        val processingMs =
            if (dispatchNanos == 0L) 0.0 else (System.nanoTime() - dispatchNanos) / NANOS_PER_MILLI

        deliver(layout, scratch, timestampMs, processingMs)
    }

    /** The delivery mode decides only two things: whether this frame is kept, and whether to tick. */
    private fun deliver(
        layout: FrameShape,
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
        post(emitFramesTick)
    }

    private fun fillWorldBuffer(
        result: PoseLandmarkerResult,
        poseSize: Int,
    ) {
        val world = result.worldLandmarks()
        val points = if (world.isEmpty()) null else world[0]

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
            worldBuffer[base + Skeleton.OFFSET_VISIBILITY] = landmark.visibility().orElse(0f)
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
        if (frameScratch.size != next.floatsPerFrame) frameScratch = FloatArray(next.floatsPerFrame)
    }

    fun drainFrames() = frames.drain()

    fun snapshotFrame() = frames.snapshot()

    /**
     * Always empty until the trigger evaluator exists to mint a ticket. The contract already says
     * an unknown or spent one returns an empty buffer, so this is that case and not a stub.
     */
    @Suppress("UNUSED_PARAMETER")
    fun takeTriggerSnapshot(snapshotId: Int) = frames.empty()

    fun currentState(): Map<String, Any?> =
        mapOf(
            "facing" to camera.facing.nameForJs(),
            "active" to camera.isBound,
            "detecting" to (detector != null || detectorPending),
            // Measured frame rate and the resolved tier arrive with calibration in Phase 4.
            "fps" to 0.0,
            "delegate" to (resolvedDelegate ?: "CPU"),
            "deviceTier" to "medium",
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
                "targetFps" to 30,
                "deviceTier" to "medium",
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
        runCatching { context.applicationContext.unregisterComponentCallbacks(memoryCallbacks) }
        runCatching { displayManager?.unregisterDisplayListener(displayListener) }
        stopObservingLifecycle()
        releaseForDetach()
        super.onDetachedFromWindow()
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
        releaseForDetach()
        stopObservingLifecycle()
        // Shutdown, not shutdownNow: the queued close of the landmarker has to run before the
        // thread goes away.
        analysisExecutor.shutdown()
    }

    private companion object {
        const val MIN_CONFIDENCE = 0.6f
        const val DEFAULT_THROTTLE_MS = 100L
        const val DEFAULT_FLUSH_MS = 500L
        const val MILLIS_PER_SECOND = 1_000.0
        const val NANOS_PER_MILLI = 1_000_000.0
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
