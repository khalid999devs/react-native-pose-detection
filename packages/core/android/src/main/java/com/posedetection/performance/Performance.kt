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
     * The frame rate a tier starts at.
     *
     * The high tier aims above the 30 a preview is usually shown at, because the resolver sets a
     * target rather than a cap: what a device actually reaches is measured, and calibration and the
     * thermal ladder walk it back down. Holding a capable phone at 30 when it can sustain more
     * meant the one number people look at was decided here rather than by their hardware.
     */
    fun targetFps(tier: DeviceTier): Int =
        when (tier) {
            DeviceTier.LOW -> 15
            DeviceTier.MEDIUM -> 30
            DeviceTier.HIGH -> 60
        }

    fun preview(tier: DeviceTier): String =
        when (tier) {
            DeviceTier.LOW -> "480p"
            DeviceTier.MEDIUM -> "720p"
            DeviceTier.HIGH -> "1080p"
        }

    fun analysis(tier: DeviceTier): String =
        when (tier) {
            DeviceTier.LOW -> "360p"
            DeviceTier.MEDIUM -> "480p"
            DeviceTier.HIGH -> "720p"
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

    fun resolve(
        profile: Profile,
        tier: DeviceTier,
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

        var fps = requestedFps ?: Tiers.targetFps(baseTier)
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
