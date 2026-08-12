package com.posedetection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** A condition the test drives directly, so the state machine is tested apart from the geometry. */
private class Switch(
    var on: Boolean = false,
) : PoseCondition() {
    override fun matches(frame: FrameContext): Boolean = on
}

class TriggerRuntimeTest {
    private val enter = Switch()
    private val exit = Switch()
    private val frame = FrameContext()

    private fun runtime(
        emit: TriggerEmit,
        debounceMs: Long = 0,
        minDurationMs: Long = 0,
        throttleMs: Long = 250,
        snapshot: Boolean = false,
        exitCondition: PoseCondition = exit,
    ) = TriggerRuntime(
        TriggerSpec(
            id = "rep",
            enter = enter,
            exit = exitCondition,
            emit = emit,
            debounceMs = debounceMs,
            minDurationMs = minDurationMs,
            snapshot = snapshot,
            throttleMs = throttleMs,
        ),
    )

    @Test
    fun `emit cycle fires once per enter then exit, with the duration between them`() {
        val trigger = runtime(TriggerEmit.CYCLE)

        enter.on = true
        assertNull("entering does not fire a cycle", trigger.evaluate(frame, 1000))

        enter.on = false
        exit.on = true
        val firing = trigger.evaluate(frame, 1400)

        assertNotNull(firing)
        assertEquals("cycle", firing!!.phase)
        assertEquals(1, firing.count)
        assertEquals(400.0, firing.durationMs!!, 0.0)
    }

    @Test
    fun `emit enter fires on the way in and nothing on the way out`() {
        val trigger = runtime(TriggerEmit.ENTER)

        enter.on = true
        val entering = trigger.evaluate(frame, 1000)
        assertEquals("enter", entering!!.phase)
        assertEquals("count is completed cycles, and none has completed", 0, entering.count)

        enter.on = false
        exit.on = true
        assertNull(trigger.evaluate(frame, 1100))
    }

    @Test
    fun `emit exit fires on the way out only`() {
        val trigger = runtime(TriggerEmit.EXIT)

        enter.on = true
        assertNull(trigger.evaluate(frame, 1000))

        exit.on = true
        val firing = trigger.evaluate(frame, 1100)
        assertEquals("exit", firing!!.phase)
        assertEquals(1, firing.count)
        assertNull("only a cycle carries a duration", firing.durationMs)
    }

    @Test
    fun `count counts completed cycles whatever the emit mode is`() {
        val trigger = runtime(TriggerEmit.ENTER)

        for (cycle in 1..3) {
            enter.on = true
            exit.on = false
            trigger.evaluate(frame, cycle * 1000L)
            enter.on = false
            exit.on = true
            trigger.evaluate(frame, cycle * 1000L + 100)
        }

        enter.on = true
        exit.on = false
        assertEquals(3, trigger.evaluate(frame, 9000)!!.count)
    }

    @Test
    fun `without an exit condition, leaving enter is what returns it to idle`() {
        // NotCondition(enter) is what the parser substitutes for an absent exit.
        val trigger = runtime(TriggerEmit.ENTER, exitCondition = NotCondition(enter))

        enter.on = true
        assertNotNull(trigger.evaluate(frame, 1000))

        enter.on = false
        assertNull(trigger.evaluate(frame, 1100))

        enter.on = true
        assertNotNull("a second entry has to be possible", trigger.evaluate(frame, 1200))
    }

    @Test
    fun `minDurationMs requires the condition to hold, and a break restarts the clock`() {
        val trigger = runtime(TriggerEmit.ENTER, minDurationMs = 300)

        enter.on = true
        assertNull(trigger.evaluate(frame, 1000))
        assertNull(trigger.evaluate(frame, 1200))

        enter.on = false
        assertNull(trigger.evaluate(frame, 1250))

        enter.on = true
        assertNull("the hold restarted, so 1400 is only 100ms in", trigger.evaluate(frame, 1300))
        assertNull(trigger.evaluate(frame, 1500))
        assertNotNull(trigger.evaluate(frame, 1650))
    }

    @Test
    fun `debounceMs suppresses the next entry, not the measurement`() {
        val trigger = runtime(TriggerEmit.ENTER, debounceMs = 500)

        enter.on = true
        assertNotNull(trigger.evaluate(frame, 1000))

        enter.on = false
        exit.on = true
        trigger.evaluate(frame, 1100)

        enter.on = true
        exit.on = false
        assertNull("still inside the debounce window", trigger.evaluate(frame, 1300))
        assertNotNull(trigger.evaluate(frame, 1600))
    }

    @Test
    fun `emit while repeats on its throttle for as long as enter holds`() {
        val trigger = runtime(TriggerEmit.WHILE, throttleMs = 250)

        enter.on = true
        assertNull("going active is not a while emission", trigger.evaluate(frame, 1000))

        val first = trigger.evaluate(frame, 1050)
        assertEquals("enter", first!!.phase)

        assertNull("inside the throttle window", trigger.evaluate(frame, 1200))
        assertNotNull(trigger.evaluate(frame, 1310))

        exit.on = true
        assertNull("exiting is not a while emission", trigger.evaluate(frame, 1400))
    }

    @Test
    fun `losing the pose breaks a hold without abandoning an active trigger`() {
        val trigger = runtime(TriggerEmit.CYCLE, minDurationMs = 200)

        enter.on = true
        trigger.evaluate(frame, 1000)
        trigger.evaluate(frame, 1250)

        // Mid-rep, the subject steps out of frame.
        trigger.onPoseLost()

        enter.on = false
        exit.on = true
        assertNull("the exit hold starts fresh", trigger.evaluate(frame, 1300))
        assertNotNull("and completes normally once it has held", trigger.evaluate(frame, 1550))
    }

    @Test
    fun `a snapshot trigger asks for one and a plain one does not`() {
        val plain = runtime(TriggerEmit.ENTER)
        val withSnapshot = runtime(TriggerEmit.ENTER, snapshot = true)

        enter.on = true
        assertEquals(false, plain.evaluate(frame, 1000)!!.wantsSnapshot)
        assertEquals(true, withSnapshot.evaluate(frame, 1000)!!.wantsSnapshot)
    }

    @Test
    fun `the engine carries counts across a props update but not across a rebuild by id`() {
        val engine = TriggerEngine()
        val spec = { id: String ->
            TriggerSpec(id, enter, exit, TriggerEmit.CYCLE, 0, 0, false, 250)
        }
        engine.setTriggers(listOf(spec("rep")))

        val fired = ArrayList<TriggerFiring>()
        enter.on = true
        engine.evaluate(frame, 1000, fired)
        enter.on = false
        exit.on = true
        engine.evaluate(frame, 1100, fired)
        assertEquals(1, fired.single().count)

        // A re-render is not an unmount.
        engine.setTriggers(listOf(spec("rep")))
        fired.clear()
        enter.on = true
        exit.on = false
        engine.evaluate(frame, 1200, fired)
        enter.on = false
        exit.on = true
        engine.evaluate(frame, 1300, fired)
        assertEquals("the count survived", 2, fired.single().count)

        // A different id is a different trigger, and starts from zero.
        engine.setTriggers(listOf(spec("other")))
        fired.clear()
        enter.on = true
        exit.on = false
        engine.evaluate(frame, 1400, fired)
        enter.on = false
        exit.on = true
        engine.evaluate(frame, 1500, fired)
        assertEquals(1, fired.single().count)
    }
}
