package com.posedetection.engine

import com.posedetection.Skeleton
import kotlin.math.abs

/**
 * One-Euro filter over the landmark buffer, in place.
 *
 * The trade every smoother makes is lag against jitter. This one moves the cutoff with the speed
 * of the signal: slow movement is filtered hard, because that is where jitter is visible and lag
 * is not; fast movement is barely filtered, because that is where lag is visible and jitter is
 * not. `minCutoff` sets how hard the slow case is filtered, `beta` how quickly it gets out of the
 * way when things move.
 *
 * Visibility is left alone. It is a confidence, not a position, and smoothing it would make a
 * joint that has just left frame keep reading as present.
 *
 * Casteljau et al., "1e Filter: A Simple Speed-based Low-pass Filter", CHI 2012.
 */
internal class OneEuroFilter {
    /** Filtered value and filtered derivative per axis, x/y/z of every landmark. */
    private val values = FloatArray(Skeleton.LANDMARK_COUNT * AXES)
    private val derivatives = FloatArray(Skeleton.LANDMARK_COUNT * AXES)
    private var primed = false

    var minCutoff = DEFAULT_MIN_CUTOFF
        private set
    var beta = DEFAULT_BETA
        private set

    fun configure(
        minCutoff: Float,
        beta: Float,
    ) {
        // A cutoff at or below zero divides by zero inside alpha and takes every landmark with it.
        val nextCutoff = if (minCutoff.isNaN() || minCutoff <= 0f) DEFAULT_MIN_CUTOFF else minCutoff
        val nextBeta = if (beta.isNaN() || beta < 0f) DEFAULT_BETA else beta

        if (nextCutoff == this.minCutoff && nextBeta == this.beta) return
        this.minCutoff = nextCutoff
        this.beta = nextBeta
        reset()
    }

    /** A discontinuity: a camera switch, a lost pose, a gap. Filtering across one invents motion. */
    fun reset() {
        primed = false
    }

    /**
     * [elapsedSeconds] is the real interval, not a nominal one: the filter's whole behavior is a
     * function of it, and feeding a constant makes it lie whenever a frame is late. A non-positive
     * or unknown interval leaves the frame untouched rather than dividing by it.
     */
    fun apply(
        landmarks: FloatArray,
        elapsedSeconds: Float,
    ) {
        if (!primed) {
            seed(landmarks)
            return
        }
        if (elapsedSeconds.isNaN() || elapsedSeconds <= 0f) return

        val derivativeAlpha = alpha(DERIVATIVE_CUTOFF, elapsedSeconds)

        for (joint in 0 until Skeleton.LANDMARK_COUNT) {
            val base = joint * Skeleton.LANDMARK_STRIDE
            val state = joint * AXES

            for (axis in 0 until AXES) {
                val raw = landmarks[base + axis]
                val slot = state + axis

                val speed = (raw - values[slot]) / elapsedSeconds
                val smoothedSpeed = derivatives[slot] + derivativeAlpha * (speed - derivatives[slot])
                derivatives[slot] = smoothedSpeed

                val cutoff = minCutoff + beta * abs(smoothedSpeed)
                val smoothed = values[slot] + alpha(cutoff, elapsedSeconds) * (raw - values[slot])

                values[slot] = smoothed
                landmarks[base + axis] = smoothed
            }
        }
    }

    private fun seed(landmarks: FloatArray) {
        for (joint in 0 until Skeleton.LANDMARK_COUNT) {
            val base = joint * Skeleton.LANDMARK_STRIDE
            val state = joint * AXES
            for (axis in 0 until AXES) {
                values[state + axis] = landmarks[base + axis]
                derivatives[state + axis] = 0f
            }
        }
        primed = true
    }

    private fun alpha(
        cutoff: Float,
        elapsedSeconds: Float,
    ): Float {
        val timeConstant = 1f / (TAU * cutoff)
        return 1f / (1f + timeConstant / elapsedSeconds)
    }

    companion object {
        /** x, y, z. Visibility is index 3 and is deliberately not one of these. */
        private const val AXES = 3

        /** The cutoff a body that is not moving is smoothed at. Low, because jitter lives there. */
        const val DEFAULT_MIN_CUTOFF = 1.0f

        /**
         * How hard the cutoff rises with speed, and the reason this filter is worth having.
         *
         * `cutoff = minCutoff + beta * speed`, so a beta of zero leaves the cutoff pinned at
         * [DEFAULT_MIN_CUTOFF] and turns the whole thing into a fixed 1 Hz low-pass: heavy lag
         * whatever the body is doing. That is what the filter exists to avoid, and shipping zero
         * here meant every default install smoothed a fast movement as hard as a still one.
         * Landmarks are normalized, so a brisk arm crosses roughly two units a second, and 4 lifts
         * the cutoff to about 9 Hz there while leaving a resting hand near 1 Hz. Tune it per app.
         */
        const val DEFAULT_BETA = 4.0f

        /** The derivative's own cutoff. 1 Hz is the value the paper uses and rarely needs changing. */
        private const val DERIVATIVE_CUTOFF = 1.0f

        private const val TAU = (2.0 * Math.PI).toFloat()
    }
}
