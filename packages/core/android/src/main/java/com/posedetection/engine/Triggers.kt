package com.posedetection.engine

internal enum class TriggerEmit {
    ENTER,
    EXIT,
    CYCLE,
    WHILE,
    ;

    companion object {
        fun from(value: String?): TriggerEmit =
            when (value) {
                "exit" -> EXIT
                "cycle" -> CYCLE
                "while" -> WHILE
                else -> ENTER
            }
    }
}

internal class TriggerSpec(
    val id: String,
    val enter: PoseCondition,
    /**
     * Absent means "when `enter` stops holding". Without that a trigger with no `exit` would go
     * active once and have nothing that could ever return it to idle.
     */
    val exit: PoseCondition,
    val emit: TriggerEmit,
    val debounceMs: Long,
    val minDurationMs: Long,
    val snapshot: Boolean,
    val throttleMs: Long,
)

/** One fired trigger. Scalars only: a frame cannot ride an event, see ADR 0009. */
internal class TriggerFiring(
    val id: String,
    val phase: String,
    val count: Int,
    val timestampMs: Double,
    val durationMs: Double?,
    val wantsSnapshot: Boolean,
)

/**
 * The state machine from `guides/reference/trigger-schema.md`, one per trigger.
 *
 * ```text
 * IDLE   + enter holds → ACTIVE ; emit if 'enter'
 * ACTIVE + exit  holds → IDLE   ; count++ ; emit if 'cycle' or 'exit'
 * ACTIVE + enter holds → emit if 'while', throttled
 * ```
 */
internal class TriggerRuntime(
    val spec: TriggerSpec,
    /** Carried across a props update by the engine. Only unmount starts one from zero. */
    initialCount: Int = 0,
) {
    var active = false
        private set

    /** Completed cycles. Survives a props update and a camera switch; only unmount resets it. */
    var count = initialCount
        private set

    private var holdSince = 0L
    private var activeSince = 0L
    private var lastFireMs = 0L
    private var lastWhileMs = 0L

    /**
     * A hold has to be continuous, so a frame with no pose ends one. The active state survives:
     * somebody stepping out of frame mid-rep has not finished the rep, and has not abandoned it
     * either.
     */
    fun onPoseLost() {
        holdSince = 0L
    }

    fun evaluate(
        frame: FrameContext,
        nowMs: Long,
    ): TriggerFiring? = if (active) evaluateActive(frame, nowMs) else evaluateIdle(frame, nowMs)

    private fun evaluateIdle(
        frame: FrameContext,
        nowMs: Long,
    ): TriggerFiring? {
        if (!spec.enter.matches(frame)) {
            holdSince = 0L
            return null
        }

        if (holdSince == 0L) holdSince = nowMs
        if (nowMs - holdSince < spec.minDurationMs) return null
        // Debounce suppresses re-entry, not the hold: the condition keeps being measured, it just
        // cannot fire again yet.
        if (lastFireMs != 0L && nowMs - lastFireMs < spec.debounceMs) return null

        active = true
        activeSince = nowMs
        holdSince = 0L
        lastWhileMs = 0L

        if (spec.emit != TriggerEmit.ENTER) return null
        lastFireMs = nowMs
        return TriggerFiring(spec.id, "enter", count, frameTimestamp(nowMs), null, spec.snapshot)
    }

    private fun evaluateActive(
        frame: FrameContext,
        nowMs: Long,
    ): TriggerFiring? {
        if (spec.exit.matches(frame)) {
            if (holdSince == 0L) holdSince = nowMs
            if (nowMs - holdSince < spec.minDurationMs) return null

            active = false
            holdSince = 0L
            count += 1

            return when (spec.emit) {
                TriggerEmit.CYCLE -> {
                    lastFireMs = nowMs
                    TriggerFiring(
                        spec.id,
                        "cycle",
                        count,
                        frameTimestamp(nowMs),
                        (nowMs - activeSince).toDouble(),
                        spec.snapshot,
                    )
                }

                TriggerEmit.EXIT -> {
                    lastFireMs = nowMs
                    TriggerFiring(spec.id, "exit", count, frameTimestamp(nowMs), null, spec.snapshot)
                }

                else -> {
                    null
                }
            }
        }

        holdSince = 0L
        if (spec.emit != TriggerEmit.WHILE) return null
        if (lastWhileMs != 0L && nowMs - lastWhileMs < spec.throttleMs) return null

        lastWhileMs = nowMs
        lastFireMs = nowMs
        return TriggerFiring(spec.id, "enter", count, frameTimestamp(nowMs), null, spec.snapshot)
    }

    private fun frameTimestamp(nowMs: Long): Double = nowMs.toDouble()
}

/**
 * Every trigger on one camera. Rebuilt when the `triggers` prop changes, carrying counts across by
 * id: a re-render is not an unmount, and `count` is documented to survive everything but one.
 */
internal class TriggerEngine {
    /**
     * Volatile because an array reference gets no final-field freeze: without it the inference
     * thread can see a published array whose elements have not landed yet, and evaluate a null.
     */
    @Volatile
    private var runtimes: Array<TriggerRuntime> = emptyArray()

    val isEmpty: Boolean
        get() = runtimes.isEmpty()

    fun setTriggers(specs: List<TriggerSpec>) {
        val previous = runtimes
        runtimes =
            Array(specs.size) { index ->
                val spec = specs[index]
                val carried = previous.firstOrNull { it.spec.id == spec.id }
                TriggerRuntime(spec, carried?.count ?: 0)
            }
    }

    fun onPoseLost() {
        for (runtime in runtimes) runtime.onPoseLost()
    }

    /** Appends to [into] rather than returning a list, so a frame that fires nothing allocates nothing. */
    fun evaluate(
        frame: FrameContext,
        nowMs: Long,
        into: MutableList<TriggerFiring>,
    ) {
        for (runtime in runtimes) {
            val firing = runtime.evaluate(frame, nowMs) ?: continue
            into.add(firing)
        }
    }
}
