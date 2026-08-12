package com.posedetection

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.sqrt

/** Pure functions over the flat landmark buffer. No allocation, no state, no camera. */
internal object Geometry {
    /**
     * The angle at `vertex`, in degrees, 0 to 180.
     *
     * MediaPipe divides x by width and y by height, so on a non-square frame the normalized space
     * is anisotropic and an angle read straight off it is wrong by tens of degrees. The frame size
     * is what puts both axes back in a common unit.
     *
     * `Float.NaN` when the triangle is degenerate: 0 would be indistinguishable from a folded
     * joint.
     */
    fun angleDegrees(
        landmarks: FloatArray,
        proximal: Int,
        vertex: Int,
        distal: Int,
        frameWidth: Int,
        frameHeight: Int,
    ): Float {
        if (frameWidth <= 0 || frameHeight <= 0) return Float.NaN
        val aspect = frameWidth.toFloat() / frameHeight.toFloat()

        val vx = landmarks[vertex * Skeleton.LANDMARK_STRIDE]
        val vy = landmarks[vertex * Skeleton.LANDMARK_STRIDE + 1]

        val ax = (landmarks[proximal * Skeleton.LANDMARK_STRIDE] - vx) * aspect
        val ay = landmarks[proximal * Skeleton.LANDMARK_STRIDE + 1] - vy
        val bx = (landmarks[distal * Skeleton.LANDMARK_STRIDE] - vx) * aspect
        val by = landmarks[distal * Skeleton.LANDMARK_STRIDE + 1] - vy

        val magnitude = sqrt((ax * ax + ay * ay) * (bx * bx + by * by))
        if (magnitude < EPSILON) return Float.NaN

        // Floating point can push this a hair outside [-1, 1], where acos returns NaN.
        val cosine = ((ax * bx + ay * by) / magnitude).coerceIn(-1f, 1f)
        return Math.toDegrees(acos(cosine).toDouble()).toFloat()
    }

    /**
     * Direction of the angle's bisector, for placing the arc and its label. Takes projected screen
     * pixels: a direction taken before projection lands outside the joint on a mirrored preview.
     */
    fun bisectorRadians(
        proximalX: Float,
        proximalY: Float,
        vertexX: Float,
        vertexY: Float,
        distalX: Float,
        distalY: Float,
    ): Float {
        val ax = proximalX - vertexX
        val ay = proximalY - vertexY
        val bx = distalX - vertexX
        val by = distalY - vertexY

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
