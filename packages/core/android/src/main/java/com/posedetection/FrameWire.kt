package com.posedetection

import java.nio.ByteBuffer
import java.nio.ByteOrder

internal enum class DataMode {
    OFF,
    THROTTLED,
    BATCHED,
    LIVE,
    ;

    companion object {
        fun from(value: String?): DataMode =
            when (value) {
                "live" -> LIVE
                "batched" -> BATCHED
                "throttled" -> THROTTLED
                else -> OFF
            }
    }
}

/**
 * The layout of `src/wire.ts`, restated. Every block length is derivable from the header, so a
 * drain that arrives after the props that shaped it changed is decoded correctly or rejected.
 * Any divergence from the TypeScript constants is a bug even when each side looks right alone.
 */
internal object Wire {
    const val HEADER_FLOAT64S = 6

    const val INDEX_FRAME_COUNT = 0
    const val INDEX_DROPPED_COUNT = 1
    const val INDEX_FLOATS_PER_FRAME = 2
    const val INDEX_JOINT_COUNT = 3
    const val INDEX_ANGLE_COUNT = 4
    const val INDEX_FLAGS = 5

    const val FRAME_META_FLOAT64S = 2

    const val FLAG_WORLD_LANDMARKS = 1 shl 0
    const val FLAG_ANGLES = 1 shl 1

    /** com.x, com.y, velocity.x, velocity.y, bodySpan. */
    const val SCALARS_PER_FRAME = 5

    const val BYTES_PER_FLOAT64 = 8
    const val BYTES_PER_FLOAT32 = 4

    fun byteLength(
        frameCount: Int,
        floatsPerFrame: Int,
    ): Int =
        (HEADER_FLOAT64S + frameCount * FRAME_META_FLOAT64S) * BYTES_PER_FLOAT64 +
            frameCount * floatsPerFrame * BYTES_PER_FLOAT32
}

/** The delivery half of `data`. The payload half is [FrameShape]. */
internal class DataSettings(
    val mode: DataMode,
    val throttleMs: Long,
    val flushMs: Long,
    val landmarks: Boolean,
    val worldLandmarks: Boolean,
)

/**
 * What `data.*` asked for, resolved once per props update rather than per frame. `jointIndices`
 * holds exactly the joints the buffer carries, in the order `data.select` named them, and is
 * empty when `data.landmarks` is false.
 */
internal class FrameShape(
    val jointIndices: IntArray,
    val worldLandmarks: Boolean,
    /** In `ANGLE_JOINT_NAMES` order. JavaScript applies the same rule, so neither side sends it. */
    val angleJoints: Array<String>,
) {
    val angleTriples: Array<IntArray> =
        Array(angleJoints.size) { Skeleton.angleTriple(angleJoints[it]) ?: EMPTY_TRIPLE }

    val jointCount = jointIndices.size
    val angleCount = angleJoints.size

    val floatsPerFrame =
        jointCount * Skeleton.LANDMARK_STRIDE * (if (worldLandmarks) 2 else 1) +
            angleCount +
            Wire.SCALARS_PER_FRAME

    val flags =
        (if (worldLandmarks) Wire.FLAG_WORLD_LANDMARKS else 0) or
            (if (angleCount > 0) Wire.FLAG_ANGLES else 0)

    fun sameAs(other: FrameShape): Boolean =
        worldLandmarks == other.worldLandmarks &&
            jointIndices.contentEquals(other.jointIndices) &&
            angleJoints.contentEquals(other.angleJoints)

    companion object {
        val ALL_JOINTS = IntArray(Skeleton.LANDMARK_COUNT) { it }
        private val EMPTY_TRIPLE = intArrayOf(0, 0, 0)
    }
}

/**
 * Bounded, drop-oldest, written on the inference thread and drained on the module queue.
 *
 * Backing storage is allocated once per layout and reused, so the frame path copies and does not
 * allocate. A drain allocates exactly one direct buffer, which JavaScript then owns.
 */
internal class FrameRingBuffer {
    private val lock = Any()

    private var layout: FrameShape? = null
    private var stride = 0

    private var slots = FloatArray(0)
    private var meta = DoubleArray(0)
    private var head = 0
    private var count = 0
    private var dropped = 0

    /** Kept whatever the mode is, so `snapshotFrame()` can answer at `mode: 'off'`. */
    private var latest = FloatArray(0)
    private var latestTimestamp = 0.0
    private var latestProcessingMs = 0.0
    private var hasLatest = false

    /** Frames already buffered cannot be re-encoded under a new stride, so a change clears them. */
    fun setLayout(next: FrameShape) {
        synchronized(lock) {
            val current = layout
            if (current != null && current.sameAs(next)) return

            layout = next
            stride = next.floatsPerFrame
            if (slots.size != CAPACITY * stride) slots = FloatArray(CAPACITY * stride)
            if (meta.size != CAPACITY * Wire.FRAME_META_FLOAT64S) {
                meta = DoubleArray(CAPACITY * Wire.FRAME_META_FLOAT64S)
            }
            if (latest.size != stride) latest = FloatArray(stride)
            reset()
        }
    }

    fun clear() {
        synchronized(lock) { reset() }
    }

    /** The pose left the frame, so there is no current frame. Buffered ones are still owed. */
    fun clearLatest() {
        synchronized(lock) { hasLatest = false }
    }

    /** A bare header. Decodes to no frames rather than to a malformed buffer. */
    fun empty(): ByteBuffer = emptyBuffer()

    private fun reset() {
        head = 0
        count = 0
        dropped = 0
        hasLatest = false
    }

    /**
     * [buffered] is what the delivery mode decides. The latest frame is recorded either way.
     * Returns nothing: a full buffer drops its oldest frame and counts it, which is reported in
     * the next drain's header rather than raised here.
     */
    fun submit(
        frame: FloatArray,
        timestampMs: Double,
        processingMs: Double,
        buffered: Boolean,
    ) {
        synchronized(lock) {
            if (stride == 0 || frame.size < stride) return

            System.arraycopy(frame, 0, latest, 0, stride)
            latestTimestamp = timestampMs
            latestProcessingMs = processingMs
            hasLatest = true

            if (!buffered) return

            System.arraycopy(frame, 0, slots, head * stride, stride)
            meta[head * Wire.FRAME_META_FLOAT64S] = timestampMs
            meta[head * Wire.FRAME_META_FLOAT64S + 1] = processingMs

            head = (head + 1) % CAPACITY
            if (count == CAPACITY) dropped += 1 else count += 1
        }
    }

    /**
     * Everything buffered since the last call. Empties the buffer and the dropped count.
     *
     * A plain buffer, not the one JavaScript receives: wrapping it for JNI is one call the caller
     * makes, and keeping that out of here is what lets the encoding be tested on a JVM.
     */
    fun drain(): ByteBuffer {
        synchronized(lock) {
            val layout = this.layout ?: return emptyBuffer()
            val frames = count
            val buffer = allocate(layout, frames, dropped)

            if (frames > 0) {
                val doubles = buffer.asDoubleBuffer()
                doubles.position(Wire.HEADER_FLOAT64S)
                val start = (head - frames + CAPACITY) % CAPACITY
                for (index in 0 until frames) {
                    val slot = (start + index) % CAPACITY
                    doubles.put(meta[slot * Wire.FRAME_META_FLOAT64S])
                    doubles.put(meta[slot * Wire.FRAME_META_FLOAT64S + 1])
                }

                val floats = bodyView(buffer, frames)
                for (index in 0 until frames) {
                    floats.put(slots, ((start + index) % CAPACITY) * stride, stride)
                }
            }

            count = 0
            dropped = 0
            head = 0
            buffer.rewind()
            return buffer
        }
    }

    /** The most recent frame, or a bare header when no pose has been seen. */
    fun snapshot(): ByteBuffer {
        synchronized(lock) {
            val layout = this.layout ?: return emptyBuffer()
            if (!hasLatest) return emptyBuffer()

            val buffer = allocate(layout, 1, 0)
            val doubles = buffer.asDoubleBuffer()
            doubles.position(Wire.HEADER_FLOAT64S)
            doubles.put(latestTimestamp)
            doubles.put(latestProcessingMs)

            bodyView(buffer, 1).put(latest, 0, stride)
            buffer.rewind()
            return buffer
        }
    }

    private fun allocate(
        layout: FrameShape,
        frames: Int,
        droppedCount: Int,
    ): ByteBuffer {
        // Native order, not Java's big-endian default: JavaScript reads this memory through typed
        // arrays in the same process, which use the platform's order and cannot be told otherwise.
        val buffer =
            ByteBuffer
                .allocateDirect(Wire.byteLength(frames, layout.floatsPerFrame))
                .order(ByteOrder.nativeOrder())

        val header = buffer.asDoubleBuffer()
        header.put(Wire.INDEX_FRAME_COUNT, frames.toDouble())
        header.put(Wire.INDEX_DROPPED_COUNT, droppedCount.toDouble())
        header.put(Wire.INDEX_FLOATS_PER_FRAME, layout.floatsPerFrame.toDouble())
        header.put(Wire.INDEX_JOINT_COUNT, layout.jointCount.toDouble())
        header.put(Wire.INDEX_ANGLE_COUNT, layout.angleCount.toDouble())
        header.put(Wire.INDEX_FLAGS, layout.flags.toDouble())
        return buffer
    }

    private fun bodyView(
        buffer: ByteBuffer,
        frames: Int,
    ): java.nio.FloatBuffer {
        // asFloatBuffer() views from the current position, so the body starts where the Float64
        // header and per-frame metadata end.
        buffer.position((Wire.HEADER_FLOAT64S + frames * Wire.FRAME_META_FLOAT64S) * Wire.BYTES_PER_FLOAT64)
        val floats = buffer.asFloatBuffer()
        buffer.position(0)
        return floats
    }

    private fun emptyBuffer(): ByteBuffer =
        ByteBuffer
            .allocateDirect(Wire.HEADER_FLOAT64S * Wire.BYTES_PER_FLOAT64)
            .order(ByteOrder.nativeOrder())

    companion object {
        /** Two seconds at 30 fps, which is longer than any stall a drain recovers from. */
        private const val CAPACITY = 64
    }
}
