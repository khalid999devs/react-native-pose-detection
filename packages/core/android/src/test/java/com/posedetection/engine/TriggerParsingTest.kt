package com.posedetection.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class TriggerParsingTest {
    @Test
    fun `an absent duration falls back and a present one is taken`() {
        assertEquals(250L, duration(null, 250L))
        assertEquals(40L, duration(40, 250L))
        assertEquals(40L, duration(40.7, 250L))
    }

    @Test
    fun `a negative duration is floored rather than trusted`() {
        assertEquals(0L, duration(-5, 250L))
        assertEquals(1L, duration(-5, 250L, floor = 1L))
    }

    @Test
    fun `a zero throttle is floored to one, because emit while promises not to fire every frame`() {
        // Zero would put the whole trigger payload allocation into the steady-state frame path.
        assertEquals(1L, duration(0, 250L, floor = 1L))
        // Debounce and minDuration are genuinely allowed to be zero: that means no delay.
        assertEquals(0L, duration(0, 0L))
    }
}
