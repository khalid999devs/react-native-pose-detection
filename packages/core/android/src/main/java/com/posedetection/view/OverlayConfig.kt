package com.posedetection.view

import android.graphics.Color

internal data class AngleOverlaySpec(
    val joint: String,
    val triple: IntArray,
    val label: Boolean,
    val radiusDp: Float,
    val color: Int?,
    val decimals: Int,
    val minVisibility: Float,
) {
    // IntArray in a data class means the generated equals compares references. The overlay compares
    // specs when props change, so it has to compare contents.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is AngleOverlaySpec) return false
        return joint == other.joint &&
            triple.contentEquals(other.triple) &&
            label == other.label &&
            radiusDp == other.radiusDp &&
            color == other.color &&
            decimals == other.decimals &&
            minVisibility == other.minVisibility
    }

    override fun hashCode(): Int {
        var result = joint.hashCode()
        result = 31 * result + triple.contentHashCode()
        result = 31 * result + label.hashCode()
        result = 31 * result + radiusDp.hashCode()
        result = 31 * result + (color ?: 0)
        result = 31 * result + decimals
        result = 31 * result + minVisibility.hashCode()
        return result
    }
}

internal class OverlayConfig {
    var landmarks: Boolean = true
    var connections: Boolean = true
    var color: Int = Color.parseColor("#00E5FF")
    var lineWidthDp: Float = 3f
    var pointRadiusDp: Float = 4f
    var minVisibility: Float = 0.5f

    /** `null` means every joint. A set of indices when `only` narrows it. */
    var only: BooleanArray? = null
    var angles: List<AngleOverlaySpec> = emptyList()

    // React hands down a fresh overlay object on most renders, so the view is reassigned a config
    // that is usually identical to the one it holds. Comparing by content lets it skip the redraw.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is OverlayConfig) return false
        return landmarks == other.landmarks &&
            connections == other.connections &&
            color == other.color &&
            lineWidthDp == other.lineWidthDp &&
            pointRadiusDp == other.pointRadiusDp &&
            minVisibility == other.minVisibility &&
            only.contentEquals(other.only) &&
            angles == other.angles
    }

    override fun hashCode(): Int {
        var result = landmarks.hashCode()
        result = 31 * result + connections.hashCode()
        result = 31 * result + color
        result = 31 * result + lineWidthDp.hashCode()
        result = 31 * result + pointRadiusDp.hashCode()
        result = 31 * result + minVisibility.hashCode()
        result = 31 * result + (only?.contentHashCode() ?: 0)
        result = 31 * result + angles.hashCode()
        return result
    }
}
