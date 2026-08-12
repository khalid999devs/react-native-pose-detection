package com.posedetection

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

internal enum class DelegateRequest { AUTO, GPU, CPU }

internal class PoseDetector private constructor(
    private val landmarker: PoseLandmarker,
    val delegate: Delegate,
    val modelFileName: String,
) {
    /**
     * MediaPipe LIVE_STREAM rejects any timestamp that does not strictly increase, and a rejected
     * frame takes the whole stream down. Camera timestamps can repeat within a millisecond, so the
     * value is clamped here rather than trusted.
     *
     * Written only from the analysis thread. Volatile because the main thread reads it when a
     * camera switch completes, to work out which in-flight results belong to the old camera. A
     * slightly stale read there costs one extra dropped frame and nothing else.
     */
    @Volatile
    var lastTimestampMs = 0L
        private set

    fun detect(
        image: MPImage,
        rotationDegrees: Int,
        cameraTimestampMs: Long,
    ): Long {
        val timestamp = maxOf(cameraTimestampMs, lastTimestampMs + 1)
        lastTimestampMs = timestamp

        val options =
            ImageProcessingOptions
                .builder()
                .setRotationDegrees(-rotationDegrees)
                .build()

        landmarker.detectAsync(image, options, timestamp)
        return timestamp
    }

    fun close() {
        runCatching { landmarker.close() }
            .onFailure { PoseLog.warn(LogCategory.DETECTOR) { "closing the landmarker threw: ${it.message}" } }
    }

    companion object {
        /**
         * The plugin installs exactly one model, and its name carries the variant. Listing the assets
         * rather than hard-coding a name means the runtime does not have to be told which variant the
         * build selected.
         */
        fun findModelAsset(context: Context): String? =
            context.assets
                .list("")
                ?.firstOrNull { it.startsWith("pose_landmarker_") && it.endsWith(".task") }

        fun create(
            context: Context,
            modelFileName: String,
            request: DelegateRequest,
            maxPoses: Int,
            minConfidence: Float,
            onResult: (PoseLandmarkerResult, MPImage) -> Unit,
            onError: (RuntimeException) -> Unit,
        ): PoseDetector {
            val delegate =
                when (request) {
                    DelegateRequest.CPU -> Delegate.CPU
                    DelegateRequest.GPU -> Delegate.GPU
                    DelegateRequest.AUTO ->
                        if (gpuProducesAnInference(context, modelFileName)) {
                            Delegate.GPU
                        } else {
                            Delegate.CPU
                        }
                }

            val landmarker =
                build(
                    context = context,
                    modelFileName = modelFileName,
                    delegate = delegate,
                    maxPoses = maxPoses,
                    minConfidence = minConfidence,
                    runningMode = RunningMode.LIVE_STREAM,
                    onResult = onResult,
                    onError = onError,
                )

            PoseLog.info(LogCategory.DETECTOR) { "landmarker ready on $delegate with $modelFileName" }
            return PoseDetector(landmarker, delegate, modelFileName)
        }

        /**
         * Constructing a GPU landmarker succeeds on devices whose GPU delegate then fails on the
         * first real frame, which is how the legacy package shipped a black screen instead of a CPU
         * fallback. So the probe runs an actual inference, in IMAGE mode where the result is
         * synchronous and a failure is catchable, and only then commits to GPU.
         *
         * Cost is one inference on a blank bitmap during camera setup.
         */
        private fun gpuProducesAnInference(
            context: Context,
            modelFileName: String,
        ): Boolean {
            var probe: PoseLandmarker? = null
            return try {
                probe =
                    build(
                        context = context,
                        modelFileName = modelFileName,
                        delegate = Delegate.GPU,
                        maxPoses = 1,
                        minConfidence = 0.5f,
                        runningMode = RunningMode.IMAGE,
                        onResult = null,
                        onError = null,
                    )
                val blank = Bitmap.createBitmap(PROBE_SIZE, PROBE_SIZE, Bitmap.Config.ARGB_8888)
                probe.detect(BitmapImageBuilder(blank).build())
                blank.recycle()
                true
            } catch (error: Throwable) {
                PoseLog.warn(LogCategory.DETECTOR) { "GPU delegate rejected on probe, using CPU: ${error.message}" }
                false
            } finally {
                runCatching { probe?.close() }
            }
        }

        private fun build(
            context: Context,
            modelFileName: String,
            delegate: Delegate,
            maxPoses: Int,
            minConfidence: Float,
            runningMode: RunningMode,
            onResult: ((PoseLandmarkerResult, MPImage) -> Unit)?,
            onError: ((RuntimeException) -> Unit)?,
        ): PoseLandmarker {
            val baseOptions =
                BaseOptions
                    .builder()
                    .setModelAssetPath(modelFileName)
                    .setDelegate(delegate)
                    .build()

            val options =
                PoseLandmarker.PoseLandmarkerOptions
                    .builder()
                    .setBaseOptions(baseOptions)
                    .setRunningMode(runningMode)
                    .setNumPoses(maxPoses)
                    .setMinPoseDetectionConfidence(minConfidence)
                    .setMinPosePresenceConfidence(minConfidence)
                    .setMinTrackingConfidence(minConfidence)
                    .apply {
                        if (runningMode == RunningMode.LIVE_STREAM) {
                            onResult?.let { setResultListener(it) }
                            onError?.let { setErrorListener(it) }
                        }
                    }.build()

            return PoseLandmarker.createFromOptions(context, options)
        }

        private const val PROBE_SIZE = 256
    }
}
