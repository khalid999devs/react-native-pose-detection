package com.posedetection.performance

import com.posedetection.Skeleton
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The precedence chain from `guides/performance.md`, which is the whole point of this object. */
class PerformanceResolverTest {
    private fun resolve(
        profile: Profile = Profile.AUTO,
        tier: DeviceTier = DeviceTier.MEDIUM,
        fps: Int? = null,
        preview: String = "auto",
        analysis: String = "auto",
        thermal: ThermalState = ThermalState.NOMINAL,
        policy: ThermalPolicy = ThermalPolicy.ADAPTIVE,
    ) = PerformanceResolver.resolve(profile, tier, fps, preview, analysis, thermal, policy)

    @Test
    fun `auto takes whatever tier calibration settled on`() {
        assertEquals(15, resolve(tier = DeviceTier.LOW).targetFps)
        assertEquals(30, resolve(tier = DeviceTier.MEDIUM).targetFps)
        assertEquals(60, resolve(tier = DeviceTier.HIGH).targetFps)
    }

    @Test
    fun `a named profile pins its tier and ignores what was measured`() {
        val efficient = resolve(profile = Profile.EFFICIENT, tier = DeviceTier.HIGH)
        assertEquals(15, efficient.targetFps)
        assertEquals("480p", efficient.preview)
        assertEquals("360p", efficient.analysis)

        val quality = resolve(profile = Profile.QUALITY, tier = DeviceTier.LOW)
        assertEquals(60, quality.targetFps)
        assertEquals("1080p", quality.preview)
    }

    @Test
    fun `an explicit prop outranks the profile on its own axis only`() {
        val resolved = resolve(profile = Profile.QUALITY, fps = 12, analysis = "360p")

        assertEquals("pinned", 12, resolved.targetFps)
        assertEquals("pinned", "360p", resolved.analysis)
        assertEquals("still the profile's", "1080p", resolved.preview)
    }

    @Test
    fun `heat outranks everything the profile and the props asked for`() {
        val pinned = resolve(profile = Profile.QUALITY, fps = 40)

        assertEquals(30, resolve(profile = Profile.QUALITY, fps = 40, thermal = ThermalState.FAIR).targetFps)
        assertEquals(40, pinned.targetFps)

        val serious = resolve(profile = Profile.QUALITY, fps = 40, thermal = ThermalState.SERIOUS)
        assertEquals(20, serious.targetFps)
        assertEquals("one step down the analysis ladder", "480p", serious.analysis)

        assertTrue(resolve(thermal = ThermalState.CRITICAL).detectionPaused)
    }

    @Test
    fun `thermalPolicy off stops the response, and reporting is not this object's job`() {
        val resolved = resolve(thermal = ThermalState.SERIOUS, policy = ThermalPolicy.OFF)

        assertEquals(30, resolved.targetFps)
        assertFalse(resolve(thermal = ThermalState.CRITICAL, policy = ThermalPolicy.OFF).detectionPaused)
    }

    @Test
    fun `critical-only ignores everything below critical`() {
        assertEquals(
            30,
            resolve(thermal = ThermalState.SERIOUS, policy = ThermalPolicy.CRITICAL_ONLY).targetFps,
        )
        assertTrue(
            resolve(thermal = ThermalState.CRITICAL, policy = ThermalPolicy.CRITICAL_ONLY).detectionPaused,
        )
    }

    @Test
    fun `unrestricted opts out of the ladder, but not out of critical`() {
        assertEquals(
            "a device about to shut down is not a preference anyone can hold",
            30,
            resolve(profile = Profile.UNRESTRICTED, thermal = ThermalState.SERIOUS).targetFps,
        )
        assertTrue(
            resolve(profile = Profile.UNRESTRICTED, thermal = ThermalState.CRITICAL).detectionPaused,
        )
    }

    @Test
    fun `a scaled frame rate never reaches zero, which would read as unlimited`() {
        val resolved = resolve(fps = 1, thermal = ThermalState.SERIOUS)
        assertEquals(1, resolved.targetFps)
    }
}
