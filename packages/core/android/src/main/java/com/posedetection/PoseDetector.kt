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
     * LIVE_STREAM rejects a timestamp that does not strictly increase, and one rejection takes the
     * stream down. Camera timestamps can repeat within a millisecond, so the value is clamped.
     *
     * Written on the analysis thread, read on main when a switch completes. A stale read there
     * costs one dropped frame.
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
        /** The plugin installs exactly one model, so listing beats being told which variant. */
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
                    DelegateRequest.CPU -> {
                        Delegate.CPU
                    }

                    DelegateRequest.GPU -> {
                        Delegate.GPU
                    }

                    DelegateRequest.AUTO -> {
                        if (gpuProducesAnInference(context, modelFileName)) {
                            Delegate.GPU
                        } else {
                            Delegate.CPU
                        }
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
         * Construction succeeds on devices whose GPU delegate then fails on the first real frame,
         * so the probe runs a real inference in IMAGE mode, where failure is catchable, before
         * committing to GPU. Costs one inference on a blank bitmap at setup.
         */
        private fun gpuProducesAnInference(
            context: Context,
            modelFileName: String,
        ): Boolean {
            var probe: PoseLandmarker? = null
            var blank: Bitmap? = null
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
                val bitmap = Bitmap.createBitmap(PROBE_SIZE, PROBE_SIZE, Bitmap.Config.ARGB_8888)
                blank = bitmap
                probe.detect(BitmapImageBuilder(bitmap).build())
                true
            } catch (error: Throwable) {
                PoseLog.warn(LogCategory.DETECTOR) { "GPU delegate rejected on probe, using CPU: ${error.message}" }
                false
            } finally {
                // The throwing path is the one this probe exists for, so the bitmap is recycled
                // here rather than after the detect call. The probe goes first: nothing may still
                // be holding the pixels when they are freed.
                runCatching { probe?.close() }
                blank?.recycle()
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
