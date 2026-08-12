package com.posedetection.engine

import com.posedetection.Skeleton
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

    /**
     * Visibility-weighted center of mass, written to `out[offset]` and `out[offset + 1]`.
     *
     * Hip 0.5, ankle 0.3, knee 0.2, each side carrying half of its pair's weight and scaled by its
     * own visibility, so one occluded leg shifts the result toward the leg that is actually
     * visible rather than toward the midpoint of a guess. `NaN` when nothing is visible enough to
     * weigh: a fallback would be a position the body is not in.
     *
     * Normalized frame coordinates, uncorrected. It is compared against other normalized
     * positions, which are anisotropic in the same way, and correcting one side of that
     * comparison is what would make it wrong.
     */
    fun centerOfMass(
        landmarks: FloatArray,
        out: FloatArray,
        offset: Int,
    ) {
        var x = 0f
        var y = 0f
        var total = 0f

        for (index in COM_JOINTS.indices) {
            val joint = COM_JOINTS[index]
            val base = joint * Skeleton.LANDMARK_STRIDE
            val weight = COM_WEIGHTS[index] * landmarks[base + Skeleton.OFFSET_VISIBILITY]
            if (weight <= 0f) continue
            x += landmarks[base] * weight
            y += landmarks[base + 1] * weight
            total += weight
        }

        if (total < EPSILON) {
            out[offset] = Float.NaN
            out[offset + 1] = Float.NaN
            return
        }
        out[offset] = x / total
        out[offset + 1] = y / total
    }

    /**
     * Shoulder midpoint to ankle midpoint, in normalized units and uncorrected for the same reason
     * as [centerOfMass]: it exists to be divided into other normalized distances.
     */
    fun bodySpan(landmarks: FloatArray): Float {
        val shoulderX = midpoint(landmarks, Skeleton.LEFT_SHOULDER, Skeleton.RIGHT_SHOULDER, 0)
        val shoulderY = midpoint(landmarks, Skeleton.LEFT_SHOULDER, Skeleton.RIGHT_SHOULDER, 1)
        val ankleX = midpoint(landmarks, Skeleton.LEFT_ANKLE, Skeleton.RIGHT_ANKLE, 0)
        val ankleY = midpoint(landmarks, Skeleton.LEFT_ANKLE, Skeleton.RIGHT_ANKLE, 1)

        val dx = shoulderX - ankleX
        val dy = shoulderY - ankleY
        return sqrt(dx * dx + dy * dy)
    }

    private fun midpoint(
        landmarks: FloatArray,
        left: Int,
        right: Int,
        axis: Int,
    ): Float =
        (landmarks[left * Skeleton.LANDMARK_STRIDE + axis] + landmarks[right * Skeleton.LANDMARK_STRIDE + axis]) / 2f

    private val COM_JOINTS =
        intArrayOf(
            Skeleton.LEFT_HIP,
            Skeleton.RIGHT_HIP,
            Skeleton.LEFT_KNEE,
            Skeleton.RIGHT_KNEE,
            Skeleton.LEFT_ANKLE,
            Skeleton.RIGHT_ANKLE,
        )

    private val COM_WEIGHTS = floatArrayOf(0.25f, 0.25f, 0.1f, 0.1f, 0.15f, 0.15f)

    private const val EPSILON = 1e-6f
}
