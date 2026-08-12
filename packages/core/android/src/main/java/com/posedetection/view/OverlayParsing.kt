package com.posedetection.view

import android.graphics.Color
import com.posedetection.LogCategory
import com.posedetection.PoseLog
import com.posedetection.Skeleton

internal fun parseOverlay(raw: Map<*, *>): OverlayConfig {
    val config = OverlayConfig()

    (raw["landmarks"] as? Boolean)?.let { config.landmarks = it }
    (raw["connections"] as? Boolean)?.let { config.connections = it }
    // Clamped here rather than trusted: these come from a JavaScript object that may have been
    // built dynamically and skipped validation, and a negative stroke or radius draws nothing.
    (raw["lineWidth"] as? Number)?.let { config.lineWidthDp = it.clamped(0f, Float.MAX_VALUE, 3f) }
    (raw["pointRadius"] as? Number)?.let { config.pointRadiusDp = it.clamped(0f, Float.MAX_VALUE, 4f) }
    (raw["minVisibility"] as? Number)?.let { config.minVisibility = it.clamped(0f, 1f, 0.5f) }
    parseColor(raw["color"])?.let { config.color = it }

    (raw["only"] as? List<*>)?.let { names ->
        val mask = BooleanArray(Skeleton.LANDMARK_COUNT)
        for (name in names) {
            val index = Skeleton.indexOf(name as? String ?: continue)
            if (index >= 0) mask[index] = true
        }
        config.only = mask
    }

    (raw["angles"] as? List<*>)?.let { specs ->
        config.angles = specs.mapNotNull { entry -> parseAngle(entry as? Map<*, *> ?: return@mapNotNull null) }
    }

    return config
}

internal fun parseAngle(raw: Map<*, *>): AngleOverlaySpec? {
    val joint = raw["joint"] as? String ?: return null
    // JS validation rejects a non-angle joint before it reaches here, so a miss means a config
    // built dynamically and skipped that check. Skipping the arc beats drawing a wrong one.
    val triple =
        Skeleton.angleTriple(joint) ?: run {
            PoseLog.warn(LogCategory.OVERLAY) { "$joint has no angle, skipping its arc" }
            return null
        }

    return AngleOverlaySpec(
        joint = joint,
        triple = triple,
        label = raw["label"] as? Boolean ?: true,
        radiusDp = (raw["radius"] as? Number)?.clamped(1f, Float.MAX_VALUE, 40f) ?: 40f,
        color = parseColor(raw["color"]),
        // Capped because the label goes into a fixed 16 char buffer: a large value would build a
        // long string on the draw path every frame only to have it truncated on the way in.
        decimals = ((raw["decimals"] as? Number)?.toInt() ?: 0).coerceIn(0, MAX_LABEL_DECIMALS),
        minVisibility = (raw["minVisibility"] as? Number)?.clamped(0f, 1f, 0.5f) ?: 0.5f,
    )
}

internal const val MAX_LABEL_DECIMALS = 3

/** NaN survives `coerceIn`, and a NaN `minVisibility` disables the gate instead of clamping it. */
internal fun Number.clamped(
    min: Float,
    max: Float,
    fallback: Float,
): Float {
    val value = toFloat()
    return if (value.isNaN()) fallback else value.coerceIn(min, max)
}

internal fun parseColor(value: Any?): Int? {
    val text = value as? String ?: return null
    return try {
        Color.parseColor(text)
    } catch (error: IllegalArgumentException) {
        PoseLog.warn(LogCategory.OVERLAY) { "could not parse the color \"$text\": ${error.message}" }
        null
    }
}
