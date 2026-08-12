package com.posedetection.engine

import com.posedetection.Skeleton
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sin

class OneEuroFilterTest {
    private val filter = OneEuroFilter()

    private fun frame(
        x: Float,
        y: Float = 0.5f,
    ): FloatArray {
        val landmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
        for (joint in 0 until Skeleton.LANDMARK_COUNT) {
            val base = joint * Skeleton.LANDMARK_STRIDE
            landmarks[base] = x
            landmarks[base + 1] = y
            landmarks[base + 2] = 0f
            landmarks[base + 3] = 0.9f
        }
        return landmarks
    }

    private fun x(landmarks: FloatArray): Float = landmarks[0]

    @Test
    fun `the first frame passes through, because there is nothing to filter against`() {
        val first = frame(0.42f)
        filter.apply(first, 1f / 30f)
        assertEquals(0.42f, x(first), 0f)
    }

    @Test
    fun `visibility is never smoothed`() {
        filter.apply(frame(0.5f), 1f / 30f)

        val next = frame(0.5f)
        next[Skeleton.LANDMARK_STRIDE - 1] = 0.1f
        filter.apply(next, 1f / 30f)

        // A joint that has just left frame must not keep reading as present.
        assertEquals(0.1f, next[Skeleton.LANDMARK_STRIDE - 1], 0f)
    }

    @Test
    fun `jitter around a still position is reduced`() {
        filter.configure(minCutoff = 0.5f, beta = 0f)
        filter.apply(frame(0.5f), 1f / 30f)

        var rawSwing = 0f
        var filteredSwing = 0f

        for (step in 1..60) {
            val noise = if (step % 2 == 0) 0.02f else -0.02f
            val raw = 0.5f + noise
            val landmarks = frame(raw)
            filter.apply(landmarks, 1f / 30f)

            rawSwing += abs(raw - 0.5f)
            filteredSwing += abs(x(landmarks) - 0.5f)
        }

        assertTrue(
            "filtered swing $filteredSwing should be well under raw $rawSwing",
            filteredSwing < rawSwing / 2f,
        )
    }

    @Test
    fun `beta lets fast movement through that a fixed cutoff would lag`() {
        val lagOf = { beta: Float ->
            val filter = OneEuroFilter()
            filter.configure(minCutoff = 0.5f, beta = beta)

            var landmarks = frame(0f)
            filter.apply(landmarks, 1f / 30f)

            var position = 0f
            repeat(20) {
                position += 0.05f
                landmarks = frame(position)
                filter.apply(landmarks, 1f / 30f)
            }
            abs(position - x(landmarks))
        }

        assertTrue("a higher beta must track faster", lagOf(1f) < lagOf(0f))
    }

    @Test
    fun `an unknown interval leaves the frame alone rather than dividing by it`() {
        filter.apply(frame(0.5f), 1f / 30f)

        val landmarks = frame(0.9f)
        filter.apply(landmarks, Float.NaN)
        assertEquals("untouched, not filtered against nothing", 0.9f, x(landmarks), 0f)
    }

    @Test
    fun `a reset makes the next frame the first one again`() {
        filter.configure(minCutoff = 0.1f, beta = 0f)
        filter.apply(frame(0f), 1f / 30f)
        repeat(10) { filter.apply(frame(0f), 1f / 30f) }

        filter.reset()
        val afterReset = frame(0.8f)
        filter.apply(afterReset, 1f / 30f)

        assertEquals("no filtering across a discontinuity", 0.8f, x(afterReset), 0f)
    }

    @Test
    fun `a cutoff of zero would divide by zero, so it is refused`() {
        filter.configure(minCutoff = 0f, beta = -1f)

        assertEquals(OneEuroFilter.DEFAULT_MIN_CUTOFF, filter.minCutoff, 0f)
        assertEquals(OneEuroFilter.DEFAULT_BETA, filter.beta, 0f)
    }

    @Test
    fun `a smoothed signal follows a real movement rather than flattening it`() {
        filter.configure(minCutoff = 1f, beta = 0.5f)

        var landmarks = frame(0.5f)
        filter.apply(landmarks, 1f / 30f)

        var last = 0f
        for (step in 1..90) {
            val truth = 0.5f + 0.3f * sin(step / 15f)
            landmarks = frame(truth)
            filter.apply(landmarks, 1f / 30f)
            last = abs(x(landmarks) - truth)
        }

        assertTrue("a lag of $last is not following the signal", last < 0.1f)
    }
}
