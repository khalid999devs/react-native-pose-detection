package com.posedetection

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.sqrt

/**
 * Pure functions over the flat landmark buffer. No allocation, no state, no camera.
 *
 * Phase 4 adds center of mass, velocity, and body span here. Phase 3 needs only the joint angle,
 * because the overlay can draw one.
 */
internal object Geometry {
    /**
     * The angle at `vertex` between the segments to `proximal` and `distal`, in degrees, 0 to 180.
     *
     * Returns `Float.NaN` when the triangle is degenerate, which happens when a joint is tracked
     * badly enough that two points land on top of each other. NaN is the honest answer: 0 would be
     * indistinguishable from a fully folded joint.
     */
    fun angleDegrees(
        landmarks: FloatArray,
        proximal: Int,
        vertex: Int,
        distal: Int,
    ): Float {
        val vx = landmarks[vertex * Skeleton.LANDMARK_STRIDE]
        val vy = landmarks[vertex * Skeleton.LANDMARK_STRIDE + 1]

        val ax = landmarks[proximal * Skeleton.LANDMARK_STRIDE] - vx
        val ay = landmarks[proximal * Skeleton.LANDMARK_STRIDE + 1] - vy
        val bx = landmarks[distal * Skeleton.LANDMARK_STRIDE] - vx
        val by = landmarks[distal * Skeleton.LANDMARK_STRIDE + 1] - vy

        val magnitude = sqrt((ax * ax + ay * ay) * (bx * bx + by * by))
        if (magnitude < EPSILON) return Float.NaN

        // Floating point can push this a hair outside [-1, 1], where acos returns NaN.
        val cosine = ((ax * bx + ay * by) / magnitude).coerceIn(-1f, 1f)
        return Math.toDegrees(acos(cosine).toDouble()).toFloat()
    }

    /** The direction of the angle's bisector at the vertex, used to place the arc and its label. */
    fun bisectorRadians(
        landmarks: FloatArray,
        proximal: Int,
        vertex: Int,
        distal: Int,
    ): Float {
        val vx = landmarks[vertex * Skeleton.LANDMARK_STRIDE]
        val vy = landmarks[vertex * Skeleton.LANDMARK_STRIDE + 1]

        val ax = landmarks[proximal * Skeleton.LANDMARK_STRIDE] - vx
        val ay = landmarks[proximal * Skeleton.LANDMARK_STRIDE + 1] - vy
        val bx = landmarks[distal * Skeleton.LANDMARK_STRIDE] - vx
        val by = landmarks[distal * Skeleton.LANDMARK_STRIDE + 1] - vy

        val aLength = sqrt(ax * ax + ay * ay)
        val bLength = sqrt(bx * bx + by * by)
        if (aLength < EPSILON || bLength < EPSILON) return Float.NaN

        val sumX = ax / aLength + bx / bLength
        val sumY = ay / aLength + by / bLength
        if (abs(sumX) < EPSILON && abs(sumY) < EPSILON) return Float.NaN

        return kotlin.math.atan2(sumY, sumX)
    }

    fun visibility(
        landmarks: FloatArray,
        joint: Int,
    ): Float = landmarks[joint * Skeleton.LANDMARK_STRIDE + Skeleton.OFFSET_VISIBILITY]

    private const val EPSILON = 1e-6f
}
