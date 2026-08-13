package com.posedetection.performance

import android.util.Size
import com.posedetection.view.nameForJs

internal enum class DeviceTier {
    LOW,
    MEDIUM,
    HIGH,
    ;

    fun nameForJs(): String = name.lowercase()

    fun stepDown(): DeviceTier = if (this == HIGH) MEDIUM else LOW

    fun stepUp(): DeviceTier = if (this == LOW) MEDIUM else HIGH
}

internal enum class Profile {
    AUTO,
    EFFICIENT,
    BALANCED,
    QUALITY,
    UNRESTRICTED,
    ;

    fun nameForJs(): String = name.lowercase()

    companion object {
        fun from(value: String?): Profile =
            when (value) {
                "efficient" -> EFFICIENT
                "balanced" -> BALANCED
                "quality" -> QUALITY
                "unrestricted" -> UNRESTRICTED
                else -> AUTO
            }
    }
}

internal enum class ThermalPolicy {
    ADAPTIVE,
    CRITICAL_ONLY,
    OFF,
    ;

    companion object {
        fun from(value: String?): ThermalPolicy =
            when (value) {
                "critical-only" -> CRITICAL_ONLY
                "off" -> OFF
                else -> ADAPTIVE
            }
    }
}

/** The OS states this package acts on. Everything hotter than `serious` is `critical`. */
internal enum class ThermalState {
    NOMINAL,
    FAIR,
    SERIOUS,
    CRITICAL,
    ;

    fun nameForJs(): String = name.lowercase()
}

/**
 * One resolved configuration. Every axis is a concrete value: whatever combination of profile,
 * props, calibration and heat produced it, this is what the session runs.
 */
internal data class ResolvedPerformance(
    val targetFps: Int,
    val preview: String,
    val analysis: String,
    val detectionPaused: Boolean,
)

/**
 * A tier's starting configuration. Calibration steps between these rather than inventing
 * intermediate values, so `getProfile()` always reports something a person can reason about.
 */
internal object Tiers {
    /**
     * How often a tier runs inference. Not the preview's frame rate, which is whatever the sensor
     * delivers: this gates the model only, and between inferences the overlay holds the last pose.
     *
     * For `auto` these are the starting rates a session runs before the governor has measured
     * anything; once it has, [AutoTuner] replaces them with the device's own number. A named
     * profile pins them. They are deliberately modest: ramping up from below is the cheap
     * direction, and the governor does it within two seconds.
     */
    fun targetFps(tier: DeviceTier): Int =
        when (tier) {
            DeviceTier.LOW -> 15
            DeviceTier.MEDIUM -> 24
            DeviceTier.HIGH -> 30
        }

    fun preview(tier: DeviceTier): String =
        when (tier) {
            DeviceTier.LOW -> "480p"
            DeviceTier.MEDIUM -> "720p"
            DeviceTier.HIGH -> "1080p"
        }

    /**
     * What the model is given, which is not what the preview shows.
     *
     * It stops at 480p on purpose. MediaPipe resizes whatever it is handed to 256 by 256 before the
     * detector sees it, so a 720p analysis buffer is close to a megapixel captured, converted and
     * copied every frame in order to be thrown away inside the graph. A distant subject is the one
     * case a larger buffer helps, and `analysisResolution` is there to ask for it.
     */
    fun analysis(tier: DeviceTier): String =
        when (tier) {
            DeviceTier.LOW -> "360p"
            DeviceTier.MEDIUM, DeviceTier.HIGH -> "480p"
        }

    /** One step down the analysis ladder, which is what `serious` heat costs. */
    fun analysisBelow(analysis: String): String =
        when (analysis) {
            "720p" -> "480p"
            "480p" -> "360p"
            else -> "360p"
        }
}

/**
 * The measured half of `auto`: what rate to run and what class of device this is, both read off
 * the p50 inference time, which is the one number that already contains everything that matters,
 * the silicon, the delegate, the model variant, the thermal throttling, all of it.
 *
 * The rate is continuous rather than stepped. Two devices that both land in the high tier can
 * still differ by ten milliseconds of inference, and quantizing them to one number either wastes
 * the fast one or overloads the slow one. This is why a session settles at 34 or 27 rather than a
 * round tier value: the number is the device's own.
 */
internal object AutoTuner {
    /**
     * The fraction of each frame interval inference may occupy. The rest is everything downstream
     * of the model, conversion, smoothing, the overlay, the wire encode, plus the headroom that
     * keeps a sustained session from climbing the thermal ladder it would then be knocked back
     * down.
     */
    const val UTILIZATION = 0.55f

    /** Below this the skeleton reads as broken; better to hold it and let heat pause detection. */
    const val MIN_FPS = 10

    /**
     * Past this the visible gain is nothing and the heat is real: a body does not move
     * meaningfully in 25 milliseconds. It is above 30 because that is where fast phones measurably
     * sit, not to leave room for a number that impresses.
     */
    const val MAX_FPS = 40

    /** Moves smaller than this are sensor noise, not a change in what the device can do. */
    const val DEADBAND_FPS = 2

    /** A p50 that sustains ~25 fps and up is a device that can carry high-tier geometry. */
    const val HIGH_TIER_MAX_P50_MS = 22f
    const val MEDIUM_TIER_MAX_P50_MS = 45f

    private const val MILLIS_PER_SECOND = 1_000f

    fun targetFps(p50Ms: Float): Int {
        if (p50Ms <= 0f) return 0
        val sustainable = Math.round(MILLIS_PER_SECOND * UTILIZATION / p50Ms)
        return sustainable.coerceIn(MIN_FPS, MAX_FPS)
    }

    /** The tier drives geometry, so it moves on what the silicon is, not on what the rate is set to. */
    fun tier(p50Ms: Float): DeviceTier =
        when {
            p50Ms <= HIGH_TIER_MAX_P50_MS -> DeviceTier.HIGH
            p50Ms <= MEDIUM_TIER_MAX_P50_MS -> DeviceTier.MEDIUM
            else -> DeviceTier.LOW
        }
}

/**
 * The precedence chain from `guides/performance.md`, in one place so it cannot be applied in
 * three different orders by three different callers:
 *
 * ```text
 * 1. profile        sets the baseline
 * 2. explicit props override per axis
 * 3. calibration    adjusts only axes still 'auto'
 * 4. thermal ladder overrides everything, unless the policy says otherwise
 * ```
 */
internal object PerformanceResolver {
    const val IDLE_FPS = 8

    @Suppress("LongParameterList")
    fun resolve(
        profile: Profile,
        tier: DeviceTier,
        autoFps: Int?,
        requestedFps: Int?,
        requestedPreview: String,
        requestedAnalysis: String,
        thermal: ThermalState,
        policy: ThermalPolicy,
    ): ResolvedPerformance {
        // 1. The baseline. A named profile pins the tier it names; `auto` and `unrestricted` take
        // whatever calibration decided.
        val baseTier =
            when (profile) {
                Profile.EFFICIENT -> DeviceTier.LOW
                Profile.BALANCED -> DeviceTier.MEDIUM
                Profile.QUALITY -> DeviceTier.HIGH
                Profile.AUTO, Profile.UNRESTRICTED -> tier
            }

        // The measured rate applies only where nobody has decided: an explicit `targetFps`
        // outranks it, and a named profile is somebody saying they have already chosen a tier's
        // numbers.
        val governed =
            when (profile) {
                Profile.AUTO, Profile.UNRESTRICTED -> autoFps
                Profile.EFFICIENT, Profile.BALANCED, Profile.QUALITY -> null
            }

        var fps = requestedFps ?: governed ?: Tiers.targetFps(baseTier)
        val preview = if (requestedPreview == AUTO) Tiers.preview(baseTier) else requestedPreview
        var analysis = if (requestedAnalysis == AUTO) Tiers.analysis(baseTier) else requestedAnalysis
        var paused = false

        // 4. Heat outranks all of it. `unrestricted` opts out of everything except critical,
        // because a device that is about to shut down is not a preference anyone can hold.
        val acts =
            when {
                policy == ThermalPolicy.OFF -> false
                policy == ThermalPolicy.CRITICAL_ONLY -> thermal == ThermalState.CRITICAL
                profile == Profile.UNRESTRICTED -> thermal == ThermalState.CRITICAL
                else -> true
            }

        if (acts) {
            when (thermal) {
                ThermalState.NOMINAL -> {
                    Unit
                }

                ThermalState.FAIR -> {
                    fps = scaled(fps, FAIR_FPS_SCALE)
                }

                ThermalState.SERIOUS -> {
                    fps = scaled(fps, SERIOUS_FPS_SCALE)
                    analysis = Tiers.analysisBelow(analysis)
                }

                ThermalState.CRITICAL -> {
                    paused = true
                }
            }
        }

        return ResolvedPerformance(fps, preview, analysis, paused)
    }

    /** Never below one: a fps of zero would read as "as fast as possible", which is the opposite. */
    private fun scaled(
        fps: Int,
        scale: Float,
    ): Int = maxOf(1, (fps * scale).toInt())

    private const val AUTO = "auto"
    private const val FAIR_FPS_SCALE = 0.75f
    private const val SERIOUS_FPS_SCALE = 0.5f
}

internal fun Size.longestSide(): Int = maxOf(width, height)
