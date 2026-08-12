package com.posedetection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * These assert the buffer `src/decodeFrames.ts` will be handed. The checks below are the ones that
 * decoder performs, restated: if a change here passes and that decoder would reject it, the two
 * have diverged and this suite is where it should surface, not on a device.
 */
class FrameRingBufferTest {
    private fun shape(
        joints: IntArray = FrameShape.ALL_JOINTS,
        world: Boolean = false,
        angles: Array<String> = emptyArray(),
    ) = FrameShape(joints, world, angles)

    private fun buffer(shape: FrameShape): FrameRingBuffer = FrameRingBuffer().apply { setLayout(shape) }

    /** A frame whose every float is `seed + index`, so a misplaced block is visible as a wrong number. */
    private fun frame(
        shape: FrameShape,
        seed: Float,
    ) = FloatArray(shape.floatsPerFrame) { seed + it }

    private fun header(
        raw: ByteBuffer,
        index: Int,
    ): Double = raw.asDoubleBuffer().get(index)

    private fun meta(
        raw: ByteBuffer,
        frame: Int,
        field: Int,
    ): Double = raw.asDoubleBuffer().get(Wire.HEADER_FLOAT64S + frame * Wire.FRAME_META_FLOAT64S + field)

    private fun body(raw: ByteBuffer): java.nio.FloatBuffer {
        val frames = header(raw, Wire.INDEX_FRAME_COUNT).toInt()
        val copy = raw.duplicate().order(raw.order())
        copy.position((Wire.HEADER_FLOAT64S + frames * Wire.FRAME_META_FLOAT64S) * Wire.BYTES_PER_FLOAT64)
        return copy.asFloatBuffer()
    }

    /** The block arithmetic `decodeFrames` rejects a buffer over. */
    private fun assertBlocksAddUp(raw: ByteBuffer) {
        val floatsPerFrame = header(raw, Wire.INDEX_FLOATS_PER_FRAME).toInt()
        val jointCount = header(raw, Wire.INDEX_JOINT_COUNT).toInt()
        val angleCount = header(raw, Wire.INDEX_ANGLE_COUNT).toInt()
        val flags = header(raw, Wire.INDEX_FLAGS).toInt()

        val landmarkFloats = jointCount * Skeleton.LANDMARK_STRIDE
        val hasWorld = flags and Wire.FLAG_WORLD_LANDMARKS != 0
        val hasAngles = flags and Wire.FLAG_ANGLES != 0
        val blocks =
            landmarkFloats * (if (hasWorld) 2 else 1) +
                (if (hasAngles) angleCount else 0) +
                Wire.SCALARS_PER_FRAME

        assertEquals("blocks must add up to the stride", floatsPerFrame, blocks)

        val frameCount = header(raw, Wire.INDEX_FRAME_COUNT).toInt()
        assertEquals(
            "byte length must be exactly what the header implies",
            Wire.byteLength(frameCount, floatsPerFrame),
            raw.capacity(),
        )
    }

    @Test
    fun `an empty drain is a bare header`() {
        val raw = buffer(shape()).drain()

        assertEquals(Wire.HEADER_FLOAT64S * Wire.BYTES_PER_FLOAT64, raw.capacity())
        assertEquals(0.0, header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertEquals(0.0, header(raw, Wire.INDEX_DROPPED_COUNT), 0.0)
    }

    @Test
    fun `the buffer is in the platform's byte order, which is what a typed array reads`() {
        val shape = shape()
        val frames = buffer(shape)
        frames.submit(frame(shape, 1f), 10.0, 2.0, buffered = true)

        assertEquals(ByteOrder.nativeOrder(), frames.drain().order())
        // The whole point: Java's default is the other one.
        assertNotEquals(ByteOrder.BIG_ENDIAN, ByteOrder.nativeOrder())
    }

    @Test
    fun `the header describes the layout`() {
        val shape = shape(angles = arrayOf("leftKnee", "rightKnee"))
        val frames = buffer(shape)
        frames.submit(frame(shape, 0f), 1.0, 0.5, buffered = true)

        val raw = frames.drain()
        assertEquals(1.0, header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertEquals(shape.floatsPerFrame.toDouble(), header(raw, Wire.INDEX_FLOATS_PER_FRAME), 0.0)
        assertEquals(33.0, header(raw, Wire.INDEX_JOINT_COUNT), 0.0)
        assertEquals(2.0, header(raw, Wire.INDEX_ANGLE_COUNT), 0.0)
        assertEquals(Wire.FLAG_ANGLES.toDouble(), header(raw, Wire.INDEX_FLAGS), 0.0)
        assertBlocksAddUp(raw)
    }

    @Test
    fun `world landmarks double the landmark block and set their flag`() {
        val shape = shape(world = true)
        assertEquals(33 * 4 * 2 + Wire.SCALARS_PER_FRAME, shape.floatsPerFrame)

        val frames = buffer(shape)
        frames.submit(frame(shape, 0f), 1.0, 0.0, buffered = true)

        val raw = frames.drain()
        assertEquals(Wire.FLAG_WORLD_LANDMARKS.toDouble(), header(raw, Wire.INDEX_FLAGS), 0.0)
        assertBlocksAddUp(raw)
    }

    @Test
    fun `select narrows the buffer and keeps the order it was named in`() {
        val named = intArrayOf(Skeleton.RIGHT_KNEE, Skeleton.LEFT_HIP)
        val shape = shape(joints = named)
        assertEquals(2 * 4 + Wire.SCALARS_PER_FRAME, shape.floatsPerFrame)

        val frames = buffer(shape)
        frames.submit(frame(shape, 100f), 1.0, 0.0, buffered = true)

        val raw = frames.drain()
        assertEquals(2.0, header(raw, Wire.INDEX_JOINT_COUNT), 0.0)
        assertBlocksAddUp(raw)
    }

    @Test
    fun `landmarks off carries no joints, which the decoder allows`() {
        val shape = shape(joints = IntArray(0), angles = arrayOf("leftElbow"))
        assertEquals(1 + Wire.SCALARS_PER_FRAME, shape.floatsPerFrame)

        val frames = buffer(shape)
        frames.submit(frame(shape, 0f), 1.0, 0.0, buffered = true)

        val raw = frames.drain()
        assertEquals(0.0, header(raw, Wire.INDEX_JOINT_COUNT), 0.0)
        assertBlocksAddUp(raw)
    }

    @Test
    fun `no angles means the flag is clear, so no angles object is built`() {
        val raw =
            buffer(shape()).let {
                it.submit(frame(shape(), 0f), 1.0, 0.0, buffered = true)
                it.drain()
            }
        assertEquals(0.0, header(raw, Wire.INDEX_ANGLE_COUNT), 0.0)
        assertEquals(0, header(raw, Wire.INDEX_FLAGS).toInt() and Wire.FLAG_ANGLES)
    }

    @Test
    fun `frames come out oldest first, with their own timestamps`() {
        val shape = shape()
        val frames = buffer(shape)
        for (index in 0 until 3) {
            frames.submit(frame(shape, index * 1000f), 100.0 + index, index.toDouble(), buffered = true)
        }

        val raw = frames.drain()
        assertEquals(3.0, header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertBlocksAddUp(raw)

        for (index in 0 until 3) {
            assertEquals(100.0 + index, meta(raw, index, 0), 0.0)
            assertEquals(index.toDouble(), meta(raw, index, 1), 0.0)
        }

        val floats = body(raw)
        for (index in 0 until 3) {
            assertEquals(index * 1000f, floats.get(index * shape.floatsPerFrame), 0f)
        }
    }

    @Test
    fun `a full buffer drops the oldest and reports how many`() {
        val shape = shape()
        val frames = buffer(shape)
        val overflow = 5
        for (index in 0 until CAPACITY + overflow) {
            frames.submit(frame(shape, index.toFloat()), index.toDouble(), 0.0, buffered = true)
        }

        val raw = frames.drain()
        assertEquals(CAPACITY.toDouble(), header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertEquals(overflow.toDouble(), header(raw, Wire.INDEX_DROPPED_COUNT), 0.0)
        // The oldest survivor is the one right after the last dropped frame.
        assertEquals(overflow.toDouble(), meta(raw, 0, 0), 0.0)
        assertBlocksAddUp(raw)
    }

    @Test
    fun `a drain empties the buffer and the dropped count`() {
        val shape = shape()
        val frames = buffer(shape)
        for (index in 0 until CAPACITY + 3) {
            frames.submit(frame(shape, 0f), index.toDouble(), 0.0, buffered = true)
        }
        frames.drain()

        val raw = frames.drain()
        assertEquals(0.0, header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertEquals(0.0, header(raw, Wire.INDEX_DROPPED_COUNT), 0.0)
    }

    @Test
    fun `an unbuffered frame is still the latest one`() {
        val shape = shape()
        val frames = buffer(shape)
        frames.submit(frame(shape, 7f), 42.0, 1.0, buffered = false)

        assertEquals(0.0, header(frames.drain(), Wire.INDEX_FRAME_COUNT), 0.0)

        val raw = frames.snapshot()
        assertEquals(1.0, header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertEquals(42.0, meta(raw, 0, 0), 0.0)
        assertEquals(7f, body(raw).get(0), 0f)
        assertBlocksAddUp(raw)
    }

    @Test
    fun `a snapshot before any pose is empty, and so is one after the pose leaves`() {
        val shape = shape()
        val frames = buffer(shape)
        assertEquals(0.0, header(frames.snapshot(), Wire.INDEX_FRAME_COUNT), 0.0)

        frames.submit(frame(shape, 1f), 1.0, 0.0, buffered = false)
        assertEquals(1.0, header(frames.snapshot(), Wire.INDEX_FRAME_COUNT), 0.0)

        frames.clearLatest()
        assertEquals(0.0, header(frames.snapshot(), Wire.INDEX_FRAME_COUNT), 0.0)
    }

    @Test
    fun `a layout change drops frames that cannot be encoded under the new stride`() {
        val first = shape()
        val frames = buffer(first)
        frames.submit(frame(first, 1f), 1.0, 0.0, buffered = true)

        val second = shape(angles = arrayOf("leftKnee"))
        frames.setLayout(second)

        val raw = frames.drain()
        assertEquals(0.0, header(raw, Wire.INDEX_FRAME_COUNT), 0.0)
        assertEquals(second.floatsPerFrame.toDouble(), header(raw, Wire.INDEX_FLOATS_PER_FRAME), 0.0)
    }

    @Test
    fun `an equivalent layout keeps the frames already buffered`() {
        val frames = buffer(shape(angles = arrayOf("leftKnee")))
        frames.submit(frame(shape(angles = arrayOf("leftKnee")), 1f), 1.0, 0.0, buffered = true)

        // A re-render that changes nothing about data must not throw away a pending flush.
        frames.setLayout(shape(angles = arrayOf("leftKnee")))

        assertEquals(1.0, header(frames.drain(), Wire.INDEX_FRAME_COUNT), 0.0)
    }

    @Test
    fun `every angle joint has a triple, so no angle is silently encoded as zero`() {
        val all = Skeleton.ANGLE_JOINT_NAMES
        assertEquals(12, all.size)
        for (joint in all) {
            assertTrue("$joint has no triple", Skeleton.angleTriple(joint) != null)
        }
    }

    private companion object {
        /** Mirrors the ring buffer's own capacity. A change there should fail these tests. */
        const val CAPACITY = 64
    }
}
