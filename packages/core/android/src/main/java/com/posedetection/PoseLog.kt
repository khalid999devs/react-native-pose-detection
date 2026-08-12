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
 * Disabled logging has to be free. The only cost at a disabled call site is one atomic read and
 * an integer compare: the message lambda is inlined and never invoked, so no string is built and
 * nothing is allocated.
 *
 * A call site that formats a string outside the lambda silently turns that into a per-frame cost
 * at 30 fps. See docs/logging.md.
 *
 * Phase 4 adds the bounded ring buffer and the batched flush to JavaScript. Today entries go to
 * Logcat only, which is what native-only debugging needs during bring-up.
 */
internal object PoseLog {
    private const val TAG = "PoseDetection"
    private const val BITS_PER_CATEGORY = 3
    private const val CATEGORY_MASK = 0x7

    // 3 bits of level per category, packed into one int. One atomic read per call site.
    private val mask = AtomicInteger(0)

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
