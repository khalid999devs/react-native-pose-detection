package com.posedetection.detector

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
import com.posedetection.LogCategory
import com.posedetection.PoseLog

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

    /**
     * When each in-flight timestamp was handed to MediaPipe, so a result can report what it cost.
     * `detectAsync` returns before the result arrives, so more than one frame is in flight and a
     * single "last dispatch" field would time the wrong one.
     */
    private val dispatchTimestamps = LongArray(DISPATCH_SLOTS)
    private val dispatchNanos = LongArray(DISPATCH_SLOTS)

    @Volatile
    private var dispatchCursor = 0

    /**
     * Nanoseconds at dispatch for [timestampMs], or 0 when it has already been overwritten.
     * Written on the analysis thread, read on MediaPipe's callback thread: reading the volatile
     * cursor first is what makes the array writes that preceded it visible here.
     */
    fun dispatchNanosFor(timestampMs: Long): Long {
        @Suppress("UNUSED_VARIABLE")
        val fence = dispatchCursor
        for (slot in 0 until DISPATCH_SLOTS) {
            if (dispatchTimestamps[slot] == timestampMs) return dispatchNanos[slot]
        }
        return 0
    }

    fun detect(
        image: MPImage,
        rotationDegrees: Int,
        cameraTimestampMs: Long,
    ): Long {
        val timestamp = maxOf(cameraTimestampMs, lastTimestampMs + 1)
        lastTimestampMs = timestamp

        val slot = dispatchCursor and (DISPATCH_SLOTS - 1)
        dispatchTimestamps[slot] = timestamp
        dispatchNanos[slot] = System.nanoTime()
        dispatchCursor = slot + 1

        landmarker.detectAsync(image, rotationOptions(rotationDegrees), timestamp)
        return timestamp
    }

    fun close() {
        runCatching { landmarker.close() }
            .onFailure { PoseLog.warn(LogCategory.DETECTOR) { "closing the landmarker threw: ${it.message}" } }
    }

    /** IMAGE and VIDEO mode are synchronous, so there is no result listener to route. */
    fun detectImage(image: MPImage): PoseLandmarkerResult = landmarker.detect(image)

    fun detectVideo(
        image: MPImage,
        timestampMs: Long,
    ): PoseLandmarkerResult = landmarker.detectForVideo(image, timestampMs)

    companion object {
        /** MediaPipe's own default, and what one subject in a file is detected at. */
        const val DEFAULT_STILL_CONFIDENCE = 0.5f

        /** Asking for more than one body needs a lower bar, or the model returns one however high it is. */
        const val MULTI_POSE_STILL_CONFIDENCE = 0.3f

        /** The threshold `maxPoses` implies when the caller has not chosen one. */
        fun stillConfidence(maxPoses: Int): Float =
            if (maxPoses > 1) MULTI_POSE_STILL_CONFIDENCE else DEFAULT_STILL_CONFIDENCE

        /**
         * A detector for a file rather than a camera. CPU rather than the GPU probe: a still input
         * runs once, and the probe would cost more than the inference it is choosing for.
         */
        fun createForStillInput(
            context: Context,
            modelFileName: String,
            maxPoses: Int,
            video: Boolean,
            minConfidence: Float = DEFAULT_STILL_CONFIDENCE,
        ): PoseDetector {
            val landmarker =
                build(
                    context = context,
                    modelFileName = modelFileName,
                    delegate = Delegate.CPU,
                    maxPoses = maxPoses,
                    minConfidence = minConfidence,
                    runningMode = if (video) RunningMode.VIDEO else RunningMode.IMAGE,
                    onResult = null,
                    onError = null,
                )
            return PoseDetector(landmarker, Delegate.CPU, modelFileName)
        }

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

        /**
         * Built once. The builder, the AutoValue instance and the boxed rotation it holds were
         * three allocations per frame for a value with four possible states that changes when the
         * device turns, not when a frame arrives.
         */
        private val ROTATION_OPTIONS =
            Array(QUARTER_TURNS) { quarter ->
                ImageProcessingOptions
                    .builder()
                    .setRotationDegrees(-(quarter * DEGREES_PER_QUARTER))
                    .build()
            }

        fun rotationOptions(rotationDegrees: Int): ImageProcessingOptions {
            val quarter = ((rotationDegrees % FULL_TURN) / DEGREES_PER_QUARTER) and (QUARTER_TURNS - 1)
            return ROTATION_OPTIONS[quarter]
        }

        private const val QUARTER_TURNS = 4
        private const val DEGREES_PER_QUARTER = 90
        private const val FULL_TURN = 360

        private const val PROBE_SIZE = 256

        /** A power of two so the cursor masks rather than divides. */
        private const val DISPATCH_SLOTS = 8
    }
}
