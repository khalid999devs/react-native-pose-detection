package com.posedetection

import android.util.Log
import java.util.concurrent.atomic.AtomicInteger

internal enum class LogLevel(
    val rank: Int,
) {
    OFF(0),
    ERROR(1),
    WARN(2),
    INFO(3),
    DEBUG(4),
    TRACE(5),
    ;

    companion object {
        fun from(name: String?): LogLevel = entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: OFF
    }
}

internal enum class LogCategory {
    CAMERA,
    DETECTOR,
    ENGINE,
    TRIGGERS,
    CALIBRATION,
    OVERLAY,
    ;

    companion object {
        fun from(name: String?): LogCategory? = entries.firstOrNull { it.name.equals(name, ignoreCase = true) }
    }
}

/**
 * A disabled call site costs one atomic read and an integer compare: the lambda is inlined and
 * never invoked, so nothing is built or allocated. Formatting outside the lambda turns that into
 * a per-frame cost at 30 fps. See docs/logging.md.
 *
 * Entries always go to Logcat, so native-only debugging works with no JavaScript listener
 * attached. They are additionally buffered for JavaScript while a listener is.
 */
internal object PoseLog {
    private const val TAG = "PoseDetection"
    private const val BITS_PER_CATEGORY = 3
    private const val CATEGORY_MASK = 0x7

    // 3 bits of level per category, packed into one int. One atomic read per call site.
    private val mask = AtomicInteger(0)

    /** Bounded and drop-oldest, like the frame buffer: a listener that stalls costs a fixed size. */
    private const val CAPACITY = 256
    private val entryLevels = arrayOfNulls<LogLevel>(CAPACITY)
    private val entryCategories = arrayOfNulls<LogCategory>(CAPACITY)
    private val entryMessages = arrayOfNulls<String>(CAPACITY)
    private val entryTimestamps = LongArray(CAPACITY)

    private val ring = Any()
    private var head = 0
    private var count = 0
    private var dropped = 0

    @Volatile
    private var streaming = false

    /**
     * One view flushes, whoever attached first. Without this every camera on screen would drain
     * the same buffer and each would receive an arbitrary share of the entries.
     */
    private var owner: Any? = null

    fun startStream() {
        synchronized(ring) {
            streaming = true
            head = 0
            count = 0
            dropped = 0
        }
    }

    fun stopStream() {
        synchronized(ring) {
            streaming = false
            count = 0
            dropped = 0
        }
    }

    val isStreaming: Boolean
        get() = streaming

    fun claimStream(candidate: Any): Boolean =
        synchronized(ring) {
            if (owner == null) owner = candidate
            owner === candidate
        }

    fun releaseStream(candidate: Any) {
        synchronized(ring) { if (owner === candidate) owner = null }
    }

    /**
     * Everything buffered since the last call, oldest first, plus how many were dropped. The maps
     * are built here rather than at the call site: a disabled channel must not build anything.
     */
    fun drain(into: MutableList<Map<String, Any?>>): Int {
        synchronized(ring) {
            val start = (head - count + CAPACITY) % CAPACITY
            for (index in 0 until count) {
                val slot = (start + index) % CAPACITY
                into.add(
                    mapOf(
                        "level" to (entryLevels[slot]?.name?.lowercase() ?: "info"),
                        "category" to (entryCategories[slot]?.name?.lowercase() ?: "engine"),
                        "message" to (entryMessages[slot] ?: ""),
                        "timestamp" to entryTimestamps[slot].toDouble(),
                    ),
                )
                entryMessages[slot] = null
            }

            val droppedCount = dropped
            head = 0
            count = 0
            dropped = 0
            return droppedCount
        }
    }

    private fun record(
        level: LogLevel,
        category: LogCategory,
        message: String,
    ) {
        synchronized(ring) {
            if (!streaming) return
            entryLevels[head] = level
            entryCategories[head] = category
            entryMessages[head] = message
            entryTimestamps[head] = android.os.SystemClock.elapsedRealtime()

            head = (head + 1) % CAPACITY
            if (count == CAPACITY) dropped += 1 else count += 1
        }
    }

    fun setLevel(level: LogLevel) {
        var packed = 0
        for (category in LogCategory.entries) {
            packed = packed or (level.rank shl (category.ordinal * BITS_PER_CATEGORY))
        }
        mask.set(packed)
    }

    fun setLevels(levels: Map<LogCategory, LogLevel>) {
        var packed = mask.get()
        for ((category, level) in levels) {
            val shift = category.ordinal * BITS_PER_CATEGORY
            packed = (packed and (CATEGORY_MASK shl shift).inv()) or (level.rank shl shift)
        }
        mask.set(packed)
    }

    fun isEnabled(
        level: LogLevel,
        category: LogCategory,
    ): Boolean {
        val shift = category.ordinal * BITS_PER_CATEGORY
        return ((mask.get() shr shift) and CATEGORY_MASK) >= level.rank
    }

    inline fun log(
        level: LogLevel,
        category: LogCategory,
        message: () -> String,
    ) {
        if (!isEnabled(level, category)) return
        emit(level, category, message())
    }

    inline fun error(
        category: LogCategory,
        message: () -> String,
    ) = log(LogLevel.ERROR, category, message)

    inline fun warn(
        category: LogCategory,
        message: () -> String,
    ) = log(LogLevel.WARN, category, message)

    inline fun info(
        category: LogCategory,
        message: () -> String,
    ) = log(LogLevel.INFO, category, message)

    inline fun debug(
        category: LogCategory,
        message: () -> String,
    ) = log(LogLevel.DEBUG, category, message)

    inline fun trace(
        category: LogCategory,
        message: () -> String,
    ) = log(LogLevel.TRACE, category, message)

    // Public because the inline functions above are, not because anything else should call it.
    fun emit(
        level: LogLevel,
        category: LogCategory,
        message: String,
    ) {
        record(level, category, message)

        val line = "[${category.name.lowercase()}] $message"
        when (level) {
            LogLevel.ERROR -> Log.e(TAG, line)
            LogLevel.WARN -> Log.w(TAG, line)
            LogLevel.INFO -> Log.i(TAG, line)
            LogLevel.DEBUG -> Log.d(TAG, line)
            LogLevel.TRACE -> Log.v(TAG, line)
            LogLevel.OFF -> Unit
        }
    }
}
