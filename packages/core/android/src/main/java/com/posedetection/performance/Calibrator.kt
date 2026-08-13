package com.posedetection.performance

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import com.posedetection.LogCategory
import com.posedetection.PoseLog

/**
 * Three stages, in the order `guides/performance.md` describes them.
 *
 * 1. A static probe of what the device claims to be, biased one step down.
 * 2. Measured convergence from real inference times, which is the only stage that can be right.
 * 3. A cache, so the second launch starts where the first one finished.
 *
 * Stage 1 is deliberately pessimistic. Ramping up after two seconds is invisible; ramping down
 * after visible jank is not.
 */
internal class Calibrator(
    private val context: Context,
) {
    enum class Phase {
        CALIBRATING,
        SETTLED,
        CACHED,
    }

    enum class Source {
        STATIC,
        MEASURED,
        CACHE,
    }

    var tier = DeviceTier.MEDIUM
        private set
    var phase = Phase.CALIBRATING
        private set
    var source = Source.STATIC
        private set

    /** The governor's rate. Zero until something has been measured or a cache supplied one. */
    var autoFps = 0
        private set

    private val samples = FloatArray(WINDOW)
    private val scratch = FloatArray(WINDOW)
    private var sampleCount = 0
    private var cursor = 0
    private var lastChangeMs = 0L

    var p50InferenceMs = 0f
        private set

    /**
     * Starts from the cache when there is one for this exact device, model and OS, and from the
     * static probe otherwise. A cached tier is still measured afterwards: the device may be hot,
     * or on battery saver, or simply different today.
     */
    fun start(modelFileName: String) {
        reset()

        val cached = readCache(modelFileName)
        if (cached != null) {
            tier = cached.first
            autoFps = cached.second
            source = Source.CACHE
            phase = Phase.CACHED
            PoseLog.info(LogCategory.CALIBRATION) {
                "starting from the cached tier ${tier.nameForJs()} at $autoFps fps"
            }
            return
        }

        tier = staticTier()
        source = Source.STATIC
        phase = Phase.CALIBRATING
        PoseLog.info(LogCategory.CALIBRATION) { "static probe suggests ${tier.nameForJs()}" }
    }

    fun reset() {
        sampleCount = 0
        cursor = 0
        lastChangeMs = 0L
        p50InferenceMs = 0f
        autoFps = 0
    }

    /**
     * One frame's cost, dispatch to result. That span breathes with load: a rate the device
     * cannot hold shows up as queue wait long before it shows up as heat, which is what closes
     * the loop. Too fast reads slow, the governor backs off, the wait drains. Returns true when
     * the tier or the rate moved, which the caller reports as an `onPerformanceChange` with
     * reason `calibration`.
     */
    fun record(
        inferenceMs: Float,
        nowMs: Long,
    ): Boolean {
        if (inferenceMs <= 0f) return false

        samples[cursor] = inferenceMs
        cursor = (cursor + 1) % WINDOW
        if (sampleCount < WINDOW) sampleCount += 1
        if (sampleCount < WINDOW) return false
        if (cursor % MEDIAN_STRIDE != 0 && p50InferenceMs != 0f) return false

        p50InferenceMs = median()

        // Hysteresis: a rate that just moved is given time to show what it costs before it moves
        // again, or a device sitting between two answers oscillates between them forever. The
        // window itself is kept: inference cost does not become untrue because the rate changed.
        if (lastChangeMs != 0L && nowMs - lastChangeMs < COOLDOWN_MS) return false

        val nextTier = AutoTuner.tier(p50InferenceMs)
        val nextFps = AutoTuner.targetFps(p50InferenceMs)
        val tierMoved = nextTier != tier
        val fpsMoved = autoFps == 0 || kotlin.math.abs(nextFps - autoFps) > AutoTuner.DEADBAND_FPS

        if (!tierMoved && !fpsMoved) {
            // Inside the deadband for a whole window with nowhere to move is what settled means.
            if (phase != Phase.SETTLED) {
                phase = Phase.SETTLED
                source = Source.MEASURED
                PoseLog.info(LogCategory.CALIBRATION) {
                    "settled at ${tier.nameForJs()}, $autoFps fps from a p50 of ${p50InferenceMs}ms"
                }
                return true
            }
            return false
        }

        if (tierMoved) tier = nextTier
        if (fpsMoved) autoFps = nextFps
        PoseLog.info(LogCategory.CALIBRATION) {
            "p50 ${p50InferenceMs}ms, moving to ${tier.nameForJs()} at $autoFps fps"
        }
        source = Source.MEASURED
        phase = Phase.CALIBRATING
        lastChangeMs = nowMs
        return true
    }

    /** Only a settled, measured answer is worth persisting. A guess is not worth a second launch. */
    fun persist(modelFileName: String) {
        if (phase != Phase.SETTLED || source != Source.MEASURED) return
        preferences()
            .edit()
            .putString(cacheKey(modelFileName), "${tier.name}|$autoFps")
            .apply()
    }

    /**
     * Cores and memory, biased down. It is a starting point that stage 2 replaces within a couple
     * of seconds, so being wrong here costs those seconds and nothing else.
     */
    private fun staticTier(): DeviceTier {
        val cores = Runtime.getRuntime().availableProcessors()
        val memoryGb = totalMemoryGb()

        val optimistic =
            when {
                cores >= HIGH_CORES && memoryGb >= HIGH_MEMORY_GB -> DeviceTier.HIGH
                cores >= MEDIUM_CORES && memoryGb >= MEDIUM_MEMORY_GB -> DeviceTier.MEDIUM
                else -> DeviceTier.LOW
            }
        return optimistic.stepDown()
    }

    private fun totalMemoryGb(): Float {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return 0f
        val info = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(info)
        return info.totalMem / BYTES_PER_GB
    }

    private fun median(): Float {
        System.arraycopy(samples, 0, scratch, 0, WINDOW)
        scratch.sort()
        return scratch[WINDOW / 2]
    }

    /** `TIER|fps`, tolerating the tier-only form an earlier version wrote. */
    private fun readCache(modelFileName: String): Pair<DeviceTier, Int>? {
        val stored = preferences().getString(cacheKey(modelFileName), null) ?: return null
        val parts = stored.split('|')
        val tier = DeviceTier.entries.firstOrNull { it.name == parts[0] } ?: return null
        val fps = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return tier to fps
    }

    /**
     * Device, model and OS version. An OS upgrade or a model change invalidates by producing a
     * different key rather than by anything having to notice and clear the old one.
     */
    private fun cacheKey(modelFileName: String): String = "${Build.MODEL}|$modelFileName|${Build.VERSION.SDK_INT}"

    private fun preferences() = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private companion object {
        const val PREFERENCES = "react-native-pose-detection"

        /** Two seconds at 30 fps, which is long enough for a p50 to mean something. */
        const val WINDOW = 60

        /**
         * The median is a copy and a sort, so it is refreshed every quarter window rather than
         * every frame. Inference cost does not change in fifteen frames; recomputing inside that
         * span is work on the hot path for a number that comes out the same.
         */
        const val MEDIAN_STRIDE = 15

        const val COOLDOWN_MS = 3_000L

        const val HIGH_CORES = 8
        const val HIGH_MEMORY_GB = 6f
        const val MEDIUM_CORES = 6
        const val MEDIUM_MEMORY_GB = 4f
        const val BYTES_PER_GB = 1_073_741_824f
    }
}

/** The OS thermal status, and low power mode, which the ladder treats as a floor of `fair`. */
internal class ThermalMonitor(
    private val context: Context,
) {
    fun read(): ThermalState {
        val power =
            context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
                ?: return ThermalState.NOMINAL

        val status =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                fromStatus(power.currentThermalStatus)
            } else {
                // No thermal API before Q. Reporting NOMINAL is honest: nothing was read.
                ThermalState.NOMINAL
            }

        // Battery saver is the user asking for less work, so it is a floor rather than a reading.
        val saving = runCatching { power.isPowerSaveMode }.getOrDefault(false)
        return if (saving && status == ThermalState.NOMINAL) ThermalState.FAIR else status
    }

    private fun fromStatus(status: Int): ThermalState =
        when {
            status >= android.os.PowerManager.THERMAL_STATUS_SEVERE -> ThermalState.CRITICAL
            status >= android.os.PowerManager.THERMAL_STATUS_MODERATE -> ThermalState.SERIOUS
            status >= android.os.PowerManager.THERMAL_STATUS_LIGHT -> ThermalState.FAIR
            else -> ThermalState.NOMINAL
        }

    /** Sampled rather than subscribed: the callback is API 29+ and this is read once per second. */
    fun shouldSample(
        nowMs: Long,
        lastMs: Long,
    ): Boolean = nowMs - lastMs >= SAMPLE_INTERVAL_MS

    private companion object {
        const val SAMPLE_INTERVAL_MS = 1_000L
    }
}
