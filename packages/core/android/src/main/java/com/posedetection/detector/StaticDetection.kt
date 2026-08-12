package com.posedetection.detector

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import com.posedetection.Skeleton
import com.posedetection.engine.FrameShape
import com.posedetection.engine.Geometry
import com.posedetection.engine.OneEuroFilter
import com.posedetection.engine.WireWriter
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** What `detectOnImage` and `detectOnVideo` were asked for. Defaults from `guides/static-input.md`. */
internal class StaticOptions(
    val maxPoses: Int,
    val angles: Boolean,
    val worldLandmarks: Boolean,
    val smoothing: Boolean,
    val fps: Int,
    val startMs: Long,
    val endMs: Long,
) {
    companion object {
        fun forImage(raw: Map<*, *>?): StaticOptions =
            StaticOptions(
                maxPoses = count(raw?.get("maxPoses"), 1),
                angles = raw?.get("angles") as? Boolean ?: true,
                worldLandmarks = raw?.get("worldLandmarks") as? Boolean ?: false,
                // A single frame has nothing to smooth against, so this is off whatever was asked.
                smoothing = false,
                fps = 0,
                startMs = 0,
                endMs = 0,
            )

        fun forVideo(raw: Map<*, *>?): StaticOptions =
            StaticOptions(
                maxPoses = count(raw?.get("maxPoses"), 1),
                angles = raw?.get("angles") as? Boolean ?: true,
                worldLandmarks = raw?.get("worldLandmarks") as? Boolean ?: false,
                smoothing = raw?.get("smoothing") as? Boolean ?: true,
                fps = count(raw?.get("fps"), 10),
                startMs = (raw?.get("startMs") as? Number)?.toLong()?.coerceAtLeast(0L) ?: 0L,
                endMs = (raw?.get("endMs") as? Number)?.toLong() ?: -1L,
            )

        private fun count(
            value: Any?,
            fallback: Int,
        ): Int = (value as? Number)?.toInt()?.coerceAtLeast(1) ?: fallback
    }
}

/**
 * The same detector, without a camera.
 *
 * Neither of these calibrates or paces itself. There is no live frame budget to hit: a still image
 * has no next frame to be late for, and a video job is already as slow as decoding makes it.
 */
internal object StaticDetection {
    private val cancelled = ConcurrentHashMap<Int, AtomicBoolean>()

    fun cancel(taskId: Int) {
        cancelled[taskId]?.set(true)
    }

    /** One entry per detected pose, so a two-person photo decodes to two frames. */
    fun detectImage(
        context: Context,
        uri: String,
        options: StaticOptions,
        angleJoints: Array<String>,
        selection: IntArray?,
    ): ByteBuffer {
        val bitmap = loadBitmap(context, uri) ?: throw StaticDetectionError("could not read an image from $uri")
        val shape = shapeFor(options, angleJoints, selection)

        // Constructed inside the try: requireModel and createFromOptions both throw, and a throw
        // between decoding the bitmap and entering the try strands its pixels until GC.
        var detector: PoseDetector? = null
        return try {
            detector =
                PoseDetector.createForStillInput(
                    context = context,
                    modelFileName = requireModel(context),
                    maxPoses = options.maxPoses,
                    video = false,
                )
            val result = detector.detectImage(BitmapImageBuilder(bitmap).build())
            val frames = ArrayList<FloatArray>(result.landmarks().size)

            for (index in result.landmarks().indices) {
                frames.add(encodePose(result, index, shape, bitmap.width, bitmap.height, null))
            }
            write(shape, frames, DoubleArray(frames.size))
        } finally {
            detector?.close()
            bitmap.recycle()
        }
    }

    /**
     * Sampled at `fps`, not at the video's own rate, and run through `VIDEO` mode with monotonic
     * timestamps so temporal tracking behaves the way it does live.
     */
    @Suppress("LongParameterList")
    fun detectVideo(
        context: Context,
        uri: String,
        options: StaticOptions,
        angleJoints: Array<String>,
        selection: IntArray?,
        taskId: Int,
        onProgress: (Float) -> Unit,
    ): ByteBuffer {
        val flag = AtomicBoolean(false)
        cancelled[taskId] = flag

        val retriever = MediaMetadataRetriever()
        val shape = shapeFor(options, angleJoints, selection)
        val smoothing = if (options.smoothing) OneEuroFilter() else null

        // Same reason as detectImage, and one more: `cancelled` belongs to an object, so a task id
        // that never reaches the finally leaks a map entry for the life of the process.
        var detector: PoseDetector? = null
        return try {
            detector =
                PoseDetector.createForStillInput(
                    context = context,
                    modelFileName = requireModel(context),
                    maxPoses = options.maxPoses,
                    video = true,
                )
            open(retriever, context, uri)

            val durationMs =
                retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull() ?: 0L
            val start = options.startMs.coerceAtMost(durationMs)
            val end = if (options.endMs in 1..durationMs) options.endMs else durationMs
            val stepMs = (MILLIS_PER_SECOND / options.fps).coerceAtLeast(1L)
            val span = (end - start).coerceAtLeast(1L)

            val frames = ArrayList<FloatArray>()
            val timestamps = ArrayList<Double>()
            var positionMs = start

            while (positionMs <= end && !flag.get()) {
                val bitmap =
                    retriever.getFrameAtTime(
                        positionMs * MICROS_PER_MILLI,
                        MediaMetadataRetriever.OPTION_CLOSEST,
                    )
                if (bitmap != null) {
                    val result = detector.detectVideo(BitmapImageBuilder(bitmap).build(), positionMs)
                    if (result.landmarks().isNotEmpty()) {
                        frames.add(encodePose(result, 0, shape, bitmap.width, bitmap.height, smoothing))
                        timestamps.add(positionMs.toDouble())
                    }
                    bitmap.recycle()
                }

                onProgress(((positionMs - start).toFloat() / span).coerceIn(0f, 1f))
                positionMs += stepMs
            }

            onProgress(1f)
            write(shape, frames, timestamps.toDoubleArray())
        } finally {
            cancelled.remove(taskId)
            detector?.close()
            runCatching { retriever.release() }
        }
    }

    private fun shapeFor(
        options: StaticOptions,
        angleJoints: Array<String>,
        selection: IntArray?,
    ): FrameShape =
        FrameShape(
            jointIndices = selection ?: FrameShape.ALL_JOINTS,
            worldLandmarks = options.worldLandmarks,
            angleJoints = if (options.angles) angleJoints else emptyArray(),
        )

    /** The same block order the live path writes, because it is the same decoder on the other side. */
    private fun encodePose(
        result: PoseLandmarkerResult,
        poseIndex: Int,
        shape: FrameShape,
        frameWidth: Int,
        frameHeight: Int,
        smoothing: OneEuroFilter?,
    ): FloatArray {
        val landmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
        val pose = result.landmarks()[poseIndex]

        for (index in 0 until minOf(Skeleton.LANDMARK_COUNT, pose.size)) {
            val point = pose[index]
            val base = index * Skeleton.LANDMARK_STRIDE
            landmarks[base] = point.x()
            landmarks[base + 1] = point.y()
            landmarks[base + 2] = point.z()
            landmarks[base + 3] = point.visibility().orElse(0f)
        }

        smoothing?.apply(landmarks, SAMPLE_INTERVAL_SECONDS)

        val frame = FloatArray(shape.floatsPerFrame)
        var cursor = 0

        for (position in shape.jointIndices.indices) {
            val base = shape.jointIndices[position] * Skeleton.LANDMARK_STRIDE
            System.arraycopy(landmarks, base, frame, cursor, Skeleton.LANDMARK_STRIDE)
            cursor += Skeleton.LANDMARK_STRIDE
        }

        if (shape.worldLandmarks) {
            val world = result.worldLandmarks()
            val points = if (world.size > poseIndex) world[poseIndex] else null
            for (position in shape.jointIndices.indices) {
                val joint = shape.jointIndices[position]
                val point = points?.getOrNull(joint)
                frame[cursor] = point?.x() ?: 0f
                frame[cursor + 1] = point?.y() ?: 0f
                frame[cursor + 2] = point?.z() ?: 0f
                frame[cursor + 3] = point?.visibility()?.orElse(0f) ?: 0f
                cursor += Skeleton.LANDMARK_STRIDE
            }
        }

        for (triple in shape.angleTriples) {
            frame[cursor] = Geometry.angleDegrees(landmarks, triple[0], triple[1], triple[2], frameWidth, frameHeight)
            cursor += 1
        }

        Geometry.centerOfMass(landmarks, frame, cursor)
        cursor += 2
        // Velocity needs a previous frame this path does not keep. Unknown, not zero.
        frame[cursor] = Float.NaN
        frame[cursor + 1] = Float.NaN
        cursor += 2
        frame[cursor] = Geometry.bodySpan(landmarks)

        return frame
    }

    private fun write(
        shape: FrameShape,
        frames: List<FloatArray>,
        timestamps: DoubleArray,
    ): ByteBuffer {
        val buffer = WireWriter.allocate(shape, frames.size, 0)
        if (frames.isEmpty()) return buffer

        val meta = WireWriter.meta(buffer)
        for (index in frames.indices) {
            meta.put(timestamps.getOrElse(index) { 0.0 })
            meta.put(0.0)
        }

        val body = WireWriter.body(buffer, frames.size)
        for (frame in frames) body.put(frame, 0, shape.floatsPerFrame)

        buffer.rewind()
        return buffer
    }

    private fun requireModel(context: Context): String =
        PoseDetector.findModelAsset(context)
            ?: throw StaticDetectionError("No pose model is bundled. Run the CLI or prebuild first.")

    private fun loadBitmap(
        context: Context,
        uri: String,
    ): Bitmap? =
        runCatching {
            context.contentResolver.openInputStream(Uri.parse(uri)).use { stream ->
                BitmapFactory.decodeStream(stream)
            }
        }.getOrNull() ?: runCatching { BitmapFactory.decodeFile(Uri.parse(uri).path) }.getOrNull()

    private fun open(
        retriever: MediaMetadataRetriever,
        context: Context,
        uri: String,
    ) {
        val parsed = Uri.parse(uri)
        if (parsed.scheme == null || parsed.scheme == "file") {
            retriever.setDataSource(parsed.path)
        } else {
            retriever.setDataSource(context, parsed)
        }
    }

    private const val MILLIS_PER_SECOND = 1_000L
    private const val MICROS_PER_MILLI = 1_000L

    /** Sampling is even, so the filter is fed the interval it was actually sampled at. */
    private const val SAMPLE_INTERVAL_SECONDS = 0.1f
}

internal class StaticDetectionError(
    message: String,
) : Exception(message)

internal fun <T> List<T>.getOrNull(index: Int): T? = if (index in indices) this[index] else null
