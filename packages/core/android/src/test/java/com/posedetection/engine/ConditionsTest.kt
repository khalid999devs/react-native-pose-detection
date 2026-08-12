package com.posedetection.engine

import com.posedetection.Skeleton
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConditionsTest {
    private val landmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
    private val previous = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)

    private val frame =
        FrameContext().apply {
            landmarks = this@ConditionsTest.landmarks
            frameWidth = 720
            frameHeight = 1280
        }

    private fun place(
        joint: Int,
        x: Float,
        y: Float,
        visibility: Float = 1f,
        into: FloatArray = landmarks,
    ) {
        val base = joint * Skeleton.LANDMARK_STRIDE
        into[base] = x
        into[base + 1] = y
        into[base + 2] = 0f
        into[base + 3] = visibility
    }

    /** A right angle at the knee, laid out so the aspect correction has something to correct. */
    private fun bendKneeTo90() {
        place(Skeleton.LEFT_HIP, 0.5f, 0.2f)
        place(Skeleton.LEFT_KNEE, 0.5f, 0.5f)
        // 720/1280 means one x unit is 0.5625 y units, so this is 90 degrees only after correction.
        place(Skeleton.LEFT_ANKLE, 0.5f + 0.3f / (720f / 1280f), 0.5f)
    }

    private fun angle(
        below: Float = Float.NaN,
        above: Float = Float.NaN,
        betweenMin: Float = Float.NaN,
        betweenMax: Float = Float.NaN,
    ): AngleCondition {
        val triple = Skeleton.angleTriple("leftKnee")!!
        return AngleCondition(triple[0], triple[1], triple[2], below, above, betweenMin, betweenMax)
    }

    @Test
    fun `an angle is measured after the aspect correction, not before`() {
        bendKneeTo90()

        val measured =
            Geometry.angleDegrees(
                landmarks,
                Skeleton.LEFT_HIP,
                Skeleton.LEFT_KNEE,
                Skeleton.LEFT_ANKLE,
                frame.frameWidth,
                frame.frameHeight,
            )
        assertEquals(90f, measured, 0.5f)

        assertTrue(angle(below = 95f).matches(frame))
        assertFalse(angle(below = 85f).matches(frame))
        assertTrue(angle(above = 85f).matches(frame))
    }

    @Test
    fun `below and above are strict, between includes its ends`() {
        bendKneeTo90()

        assertFalse("below is strictly less", angle(below = 90f).matches(frame))
        assertFalse("above is strictly greater", angle(above = 90f).matches(frame))
        assertTrue("between includes its ends", angle(betweenMin = 90f, betweenMax = 120f).matches(frame))
    }

    @Test
    fun `an unmeasurable angle matches nothing rather than reading as zero`() {
        // Collinear: the vertex has no angle, and Geometry reports NaN rather than 0.
        place(Skeleton.LEFT_HIP, 0.5f, 0.2f)
        place(Skeleton.LEFT_KNEE, 0.5f, 0.5f)
        place(Skeleton.LEFT_ANKLE, 0.5f, 0.5f)

        assertFalse("a folded joint would satisfy this if NaN read as 0", angle(below = 10f).matches(frame))
        assertFalse(angle(above = 10f).matches(frame))
    }

    @Test
    fun `a landmark bound naming a joint compares against that joint in the same frame`() {
        place(Skeleton.LEFT_WRIST, 0.5f, 0.20f)
        place(Skeleton.LEFT_SHOULDER, 0.5f, 0.40f)

        // Origin is top-left, so "above the shoulder" is a smaller y.
        val wristAboveShoulder =
            LandmarkCondition(
                axis = AXIS_Y,
                joint = Skeleton.LEFT_WRIST,
                below = Float.NaN,
                belowJoint = Skeleton.LEFT_SHOULDER,
                above = Float.NaN,
                aboveJoint = NO_JOINT,
            )
        assertTrue(wristAboveShoulder.matches(frame))

        place(Skeleton.LEFT_WRIST, 0.5f, 0.60f)
        assertFalse(wristAboveShoulder.matches(frame))
    }

    @Test
    fun `velocity is unknown without a comparable previous frame`() {
        place(Skeleton.LEFT_WRIST, 0.5f, 0.5f)
        val rising = VelocityCondition(AXIS_Y, Skeleton.LEFT_WRIST, below = -1f, above = Float.NaN)

        frame.previousLandmarks = null
        frame.elapsedSeconds = Float.NaN
        assertFalse("no previous frame means no velocity, not zero velocity", rising.matches(frame))

        place(Skeleton.LEFT_WRIST, 0.5f, 0.8f, into = previous)
        frame.previousLandmarks = previous
        frame.elapsedSeconds = 0.1f
        // Moved 0.3 up over 0.1s, so -3 units per second.
        assertTrue(rising.matches(frame))
    }

    @Test
    fun `a velocity naming centerOfMass reads the one already computed for the wire`() {
        val falling = VelocityCondition(AXIS_Y, NO_JOINT, below = Float.NaN, above = 0.5f)

        frame.comVelocityY = 1.2f
        assertTrue(falling.matches(frame))

        frame.comVelocityY = 0.1f
        assertFalse(falling.matches(frame))

        frame.comVelocityY = Float.NaN
        assertFalse(falling.matches(frame))
    }

    @Test
    fun `visibility gates on tracking quality`() {
        place(Skeleton.LEFT_KNEE, 0.5f, 0.5f, visibility = 0.8f)
        assertTrue(VisibilityCondition(Skeleton.LEFT_KNEE, 0.6f).matches(frame))

        place(Skeleton.LEFT_KNEE, 0.5f, 0.5f, visibility = 0.4f)
        assertFalse(VisibilityCondition(Skeleton.LEFT_KNEE, 0.6f).matches(frame))
    }

    @Test
    fun `all needs every member and any needs one`() {
        val yes = VisibilityCondition(Skeleton.LEFT_KNEE, 0.5f)
        val no = VisibilityCondition(Skeleton.RIGHT_KNEE, 0.5f)
        place(Skeleton.LEFT_KNEE, 0.5f, 0.5f, visibility = 0.9f)
        place(Skeleton.RIGHT_KNEE, 0.5f, 0.5f, visibility = 0.1f)

        assertTrue(AllCondition(arrayOf(yes, yes)).matches(frame))
        assertFalse(AllCondition(arrayOf(yes, no)).matches(frame))
        assertTrue(AnyCondition(arrayOf(no, yes)).matches(frame))
        assertFalse(AnyCondition(arrayOf(no, no)).matches(frame))
    }

    @Test
    fun `a condition that could not be parsed never matches, and its negation always does`() {
        assertFalse(NeverCondition.matches(frame))
        assertTrue(NotCondition(NeverCondition).matches(frame))
    }
}
