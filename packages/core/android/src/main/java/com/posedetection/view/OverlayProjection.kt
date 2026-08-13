package com.posedetection.view

/** How the source is fitted into the view. The camera preview covers it; static media is fitted. */
enum class ContentFit {
    FILL,
    FIT,
}

/**
 * Where the source lands inside the view, and where one normalized landmark lands inside that.
 *
 * A class of its own rather than a pair of methods on [OverlayView] for one reason: the picture and
 * the skeleton have to agree to the pixel, and the only way to be sure of that is for both to come
 * from a single computation that is tested on its own. [OverlayView] projects through it; a media
 * surface is positioned with [left], [top], [width] and [height] from it.
 *
 * Deliberately free of `android.graphics`, so it runs under a plain JVM unit test. The iOS
 * counterpart is `OverlayProjection.swift` and the two test suites assert the same cases.
 */
class OverlayProjection(
    sourceWidth: Int,
    sourceHeight: Int,
    viewWidth: Float,
    viewHeight: Float,
    fit: ContentFit,
) {
    val left: Float
    val top: Float
    val width: Float
    val height: Float

    init {
        if (sourceWidth <= 0 || sourceHeight <= 0 || viewWidth <= 0f || viewHeight <= 0f) {
            left = 0f
            top = 0f
            width = viewWidth
            height = viewHeight
        } else {
            val sourceAspect = sourceWidth.toFloat() / sourceHeight.toFloat()
            val viewAspect = viewWidth / viewHeight
            // Fill takes the larger scale so the view is covered, fit the smaller so the source is
            // whole. The comparison is the only thing that differs between them.
            val heightLeads =
                if (fit == ContentFit.FILL) sourceAspect > viewAspect else sourceAspect < viewAspect

            if (heightLeads) {
                height = viewHeight
                width = height * sourceAspect
            } else {
                width = viewWidth
                height = width / sourceAspect
            }
            left = (viewWidth - width) / 2f
            top = (viewHeight - height) / 2f
        }
    }

    /**
     * Landmarks are un-mirrored so they describe the real world. The front camera preview is
     * mirrored, so the overlay mirrors here to stay aligned with what is on screen. Static media is
     * never mirrored, which is why this is a parameter rather than something the projection assumes.
     */
    fun x(
        normalizedX: Float,
        mirrored: Boolean,
    ): Float = left + (if (mirrored) 1f - normalizedX else normalizedX) * width

    fun y(normalizedY: Float): Float = top + normalizedY * height
}
