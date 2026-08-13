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
        autoFps: Int? = null,
        fps: Int? = null,
        preview: String = "auto",
        analysis: String = "auto",
        thermal: ThermalState = ThermalState.NOMINAL,
        policy: ThermalPolicy = ThermalPolicy.ADAPTIVE,
    ) = PerformanceResolver.resolve(profile, tier, autoFps, fps, preview, analysis, thermal, policy)

    @Test
    fun `auto takes the tier rate until the governor has measured one`() {
        assertEquals(15, resolve(tier = DeviceTier.LOW).targetFps)
        assertEquals(24, resolve(tier = DeviceTier.MEDIUM).targetFps)
        assertEquals(30, resolve(tier = DeviceTier.HIGH).targetFps)
    }

    @Test
    fun `auto rides the measured rate once there is one`() {
        assertEquals(34, resolve(tier = DeviceTier.HIGH, autoFps = 34).targetFps)
        assertEquals(34, resolve(profile = Profile.UNRESTRICTED, autoFps = 34).targetFps)
    }

    @Test
    fun `a named profile ignores the measured rate`() {
        assertEquals(15, resolve(profile = Profile.EFFICIENT, autoFps = 34).targetFps)
        assertEquals(30, resolve(profile = Profile.QUALITY, autoFps = 12).targetFps)
    }

    @Test
    fun `an explicit fps outranks the measured rate`() {
        assertEquals(24, resolve(autoFps = 34, fps = 24).targetFps)
    }

    @Test
    fun `heat scales the measured rate like any other`() {
        assertEquals(24, resolve(autoFps = 33, thermal = ThermalState.FAIR).targetFps)
    }

    @Test
    fun `a named profile pins its tier and ignores what was measured`() {
        val efficient = resolve(profile = Profile.EFFICIENT, tier = DeviceTier.HIGH)
        assertEquals(15, efficient.targetFps)
        assertEquals("480p", efficient.preview)
        assertEquals("360p", efficient.analysis)

        val quality = resolve(profile = Profile.QUALITY, tier = DeviceTier.LOW)
        assertEquals(30, quality.targetFps)
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
        assertEquals("one step down the analysis ladder", "360p", serious.analysis)

        assertTrue(resolve(thermal = ThermalState.CRITICAL).detectionPaused)
    }

    @Test
    fun `thermalPolicy off stops the response, and reporting is not this object's job`() {
        val resolved = resolve(thermal = ThermalState.SERIOUS, policy = ThermalPolicy.OFF)

        assertEquals(24, resolved.targetFps)
        assertFalse(resolve(thermal = ThermalState.CRITICAL, policy = ThermalPolicy.OFF).detectionPaused)
    }

    @Test
    fun `critical-only ignores everything below critical`() {
        assertEquals(
            24,
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
            24,
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
