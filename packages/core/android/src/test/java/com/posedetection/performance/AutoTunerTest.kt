package com.posedetection.performance

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The governor's arithmetic. The convergence loop around it lives in [Calibrator], which needs a
 * Context and is exercised by the iOS twin of this suite; the numbers themselves are shared and
 * are what `guides/performance.md` promises.
 */
class AutoTunerTest {
    @Test
    fun `the rate is the device's own number, not a tier step`() {
        assertEquals(39, AutoTuner.targetFps(14f))
        assertEquals(34, AutoTuner.targetFps(16f))
        assertEquals(28, AutoTuner.targetFps(20f))
        assertEquals(17, AutoTuner.targetFps(33f))
    }

    @Test
    fun `the rate is clamped to the band the skeleton is usable in`() {
        assertEquals("no rate buys anything past the cap", AutoTuner.MAX_FPS, AutoTuner.targetFps(5f))
        assertEquals("below the floor heat should pause instead", AutoTuner.MIN_FPS, AutoTuner.targetFps(100f))
    }

    @Test
    fun `the tier follows the silicon, not the rate`() {
        assertEquals(DeviceTier.HIGH, AutoTuner.tier(14f))
        assertEquals(DeviceTier.HIGH, AutoTuner.tier(22f))
        assertEquals(DeviceTier.MEDIUM, AutoTuner.tier(23f))
        assertEquals(DeviceTier.MEDIUM, AutoTuner.tier(45f))
        assertEquals(DeviceTier.LOW, AutoTuner.tier(46f))
    }
}
