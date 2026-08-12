package com.posedetection

import android.Manifest
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.util.Size
import android.widget.FrameLayout
import androidx.camera.core.ImageAnalysis
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

class PoseCameraView(
    context: Context,
    appContext: AppContext,
) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true

    private val onReady by EventDispatcher<Map<String, Any?>>()
    private val onError by EventDispatcher<Map<String, Any?>>()
    private val onCameraChange by EventDispatcher<Map<String, Any?>>()

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

    private var detector: PoseDetector? = null
    private var modelFileName: String? = null

    /**
     * Results with a timestamp below this were produced by the previous camera. Set on the main
     * thread at the moment a switch succeeds, read on MediaPipe's callback thread. An atomic rather
     * than a lock because dropping one extra frame is harmless and blocking the frame path is not.
     */
    private val staleBefore = AtomicLong(0)

    private val landmarkBuffer = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)

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

    /**
     * Runs once after a batch of prop writes. Resolution changes need a rebind and the rest do not,
     * so the expensive path is taken only when something on it actually moved.
     */
    fun onPropsUpdated() {
        overlayView.config = pendingOverlayConfig
        overlayView.visibility = if (overlayEnabled) VISIBLE else GONE

        val preview = CameraSource.previewSizeFor(propPreview)
        val analysis = CameraSource.analysisSizeFor(propAnalysis)
        val geometryChanged = preview != camera.previewSize || analysis != camera.analysisSize
        camera.previewSize = preview
        camera.analysisSize = analysis

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

        val target = resolveFacing()
        if (target != camera.facing) setFacingInternal(target, null)
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
        converter.release()
        overlayView.clearPose()
        started = false
        readySent = false
    }

    private fun restartSession() {
        stopSession()
        startSession()
    }

    /**
     * `detection = false` tears the landmarker down rather than gating a running pipeline, so the
     * GPU memory it holds is actually returned. The preview keeps running.
     */
    private fun applyDetectionState() {
        if (propDetection) {
            ensureDetector()
        } else {
            releaseDetector()
            overlayView.clearPose()
        }
    }

    private fun ensureDetector() {
        if (detector != null) return
        val model = modelFileName ?: return

        val request =
            when (propDelegate) {
                "gpu" -> DelegateRequest.GPU
                "cpu" -> DelegateRequest.CPU
                else -> DelegateRequest.AUTO
            }

        try {
            detector =
                PoseDetector.create(
                    context = context,
                    modelFileName = model,
                    request = request,
                    maxPoses = propMaxPoses,
                    minConfidence = MIN_CONFIDENCE,
                    onResult = ::onLandmarks,
                    onError = { error ->
                        PoseLog.warn(LogCategory.DETECTOR) { "inference failed: ${error.message}" }
                        post { emitError(ErrorCode.DETECTION_FAILED, error.message ?: "inference failed") }
                    },
                )
            if (request == DelegateRequest.GPU && detector?.delegate?.name == "CPU") {
                emitError(ErrorCode.GPU_UNAVAILABLE, "The GPU delegate is unavailable, running on CPU.")
            }
        } catch (error: Throwable) {
            PoseLog.error(LogCategory.DETECTOR) { "landmarker init failed: ${error.message}" }
            emitError(
                ErrorCode.DETECTOR_INIT_FAILED,
                error.message ?: "The pose landmarker could not be created.",
            )
        }
    }

    private fun releaseDetector() {
        detector?.close()
        detector = null
    }

    // endregion

    // region frame path

    private val analyzer =
        ImageAnalysis.Analyzer { proxy ->
            // One missed close stalls the analyzer forever, so it is the only thing in the finally.
            try {
                val detector = this.detector ?: return@Analyzer
                val bitmap = converter.convert(proxy)
                val image = BitmapImageBuilder(bitmap).build()
                detector.detect(image, proxy.imageInfo.rotationDegrees, proxy.imageInfo.timestamp / 1_000_000)
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

        overlayView.setSourceSize(image.width, image.height)
        overlayView.setMirrored(camera.facing == Facing.FRONT)
        overlayView.submit(landmarkBuffer)
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
                // Everything from before this point belongs to the old camera.
                staleBefore.set((detector?.lastTimestampMs ?: 0L) + 1)
                val name = facing.nameForJs()
                onCameraChange(mapOf("facing" to name))
                onDone?.invoke(name)
            },
            onFailed = { code, error ->
                emitError(code, error?.message ?: "The camera could not be switched.")
                onFailed?.invoke(error?.message ?: code.name)
            },
        )
    }

    fun pauseCamera() {
        camera.setAnalyzer(null)
        camera.pause()
        overlayView.clearPose()
    }

    fun resumeCamera() {
        camera.setAnalyzer(analyzer)
        camera.resume(::emitError)
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

    fun currentState(): Map<String, Any?> =
        mapOf(
            "facing" to camera.facing.nameForJs(),
            "active" to camera.isBound,
            "detecting" to (detector != null),
            // Measured frame rate and the resolved tier arrive with calibration in Phase 4.
            "fps" to 0.0,
            "delegate" to (detector?.delegate?.name ?: "CPU"),
            "deviceTier" to "medium",
        )

    // endregion

    private fun emitReadyOnce() {
        if (readySent) return
        readySent = true

        val variant =
            modelFileName
                ?.removePrefix("pose_landmarker_")
                ?.removeSuffix(".task")
                ?: "full"

        onReady(
            mapOf(
                "model" to variant,
                "delegate" to (detector?.delegate?.name ?: "CPU"),
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

    override fun onDetachedFromWindow() {
        runCatching { context.applicationContext.unregisterComponentCallbacks(memoryCallbacks) }
        lifecycleOwnerOrNull()?.lifecycle?.removeObserver(lifecycleObserver)
        releaseForDetach()
        super.onDetachedFromWindow()
    }

    /**
     * Views do not receive `onTrimMemory`, the application does, so the view subscribes for the
     * time it is attached. Without this the handler is dead code that reads like a feature.
     */
    private val memoryCallbacks =
        object : ComponentCallbacks2 {
            override fun onTrimMemory(level: Int) = this@PoseCameraView.onTrimMemory(level)

            override fun onConfigurationChanged(newConfig: Configuration) = Unit

            @Deprecated("Required by ComponentCallbacks, superseded by onTrimMemory")
            override fun onLowMemory() = this@PoseCameraView.onTrimMemory(TRIM_MEMORY_COMPLETE_LEVEL)
        }

    /**
     * Backgrounding gives up the landmarker entirely rather than holding a few hundred megabytes
     * of GPU memory for a screen nobody is looking at. CameraX releases the capture session on
     * its own through the lifecycle owner; this is the half it does not know about.
     */
    private val lifecycleObserver =
        object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                PoseLog.info(LogCategory.CAMERA) { "backgrounded, releasing the detector" }
                releaseDetector()
                converter.release()
                overlayView.clearPose()
            }

            override fun onStart(owner: LifecycleOwner) {
                if (!started || !propActive) return
                PoseLog.info(LogCategory.CAMERA) { "foregrounded, restoring detection" }
                applyDetectionState()
            }
        }

    /**
     * `TRIM_MEMORY_COMPLETE` means the process is next in line to be killed. Dropping the
     * landmarker gives back the largest block we hold; the preview costs little and keeps the
     * screen from going black.
     */
    fun onTrimMemory(level: Int) {
        if (level >= TRIM_MEMORY_COMPLETE_LEVEL) {
            PoseLog.warn(LogCategory.DETECTOR) { "trim level $level, releasing the landmarker" }
            releaseDetector()
            converter.release()
            overlayView.clearPose()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        context.applicationContext.registerComponentCallbacks(memoryCallbacks)
        lifecycleOwnerOrNull()?.lifecycle?.addObserver(lifecycleObserver)
        // Reattaching after a temporary detach re-establishes whatever the props already say,
        // rather than waiting for a prop to change before the camera comes back.
        onPropsUpdated()
    }

    private fun lifecycleOwnerOrNull(): LifecycleOwner? =
        context as? LifecycleOwner ?: appContext.currentActivity as? LifecycleOwner

    /**
     * Detaching is not destruction. A view scrolled out of a list, or moved during a relayout,
     * gets detached and attached again, so this releases the session but keeps the analysis
     * thread alive. Shutting the executor down here would leave a reattached view with a camera
     * it can never feed.
     */
    private fun releaseForDetach() {
        camera.setAnalyzer(null)
        camera.release()
        releaseDetector()
        converter.release()
        started = false
        readySent = false
    }

    /** Called from `OnViewDestroys`, where the view really is going away. */
    fun releaseEverything() {
        releaseForDetach()
        analysisExecutor.shutdown()
    }

    private companion object {
        const val MIN_CONFIDENCE = 0.6f
        const val TRIM_MEMORY_COMPLETE_LEVEL = 80
    }
}

internal fun Facing.nameForJs(): String = if (this == Facing.FRONT) "front" else "back"

internal fun Size.toMap(): Map<String, Any?> = mapOf("width" to width, "height" to height)
