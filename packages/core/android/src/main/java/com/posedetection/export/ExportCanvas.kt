package com.posedetection.export

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The size an export writes at, and how heavily the skeleton is drawn on it.
 *
 * No `android.graphics` here on purpose, exactly as with `OverlayProjection`: this is arithmetic
 * that decides whether the encoder accepts the file and whether the result looks like the preview,
 * so it runs under a plain JVM test rather than only on a device.
 */
internal object ExportCanvas {
    const val DEFAULT_MAX_SIZE = 1920

    /** A phone screen is around this many dp across, the size the overlay defaults look right at. */
    private const val REFERENCE_EDGE = 400f

    /**
     * The source's displayed frame, capped to a long edge.
     *
     * Capping is the single biggest lever on how long an export takes and how large the file is,
     * and the default is 1920 because a painted copy is something to review or share rather than a
     * master. The aspect ratio never changes, so the skeleton drawn against the source's
     * proportions still lands on the body.
     *
     * Both axes come back even. H.264 encodes in macroblocks, and an odd dimension is rejected
     * outright by the encoder on some devices and silently rounded on others, which is the worse of
     * the two because it moves every pixel half a step away from where the skeleton was projected.
     *
     * @param maxSize long edge cap, or 0 for the source's own size.
     */
    fun size(
        displayWidth: Int,
        displayHeight: Int,
        maxSize: Int,
    ): IntArray {
        if (displayWidth <= 0 || displayHeight <= 0) return intArrayOf(2, 2)

        val longEdge = max(displayWidth, displayHeight).toFloat()
        // Only ever down. Painting a 480p clip at 1920 would cost four times the encode for four
        // times the pixels of the same picture.
        val scale = if (maxSize > 0) min(1f, maxSize / longEdge) else 1f
        return intArrayOf(even(displayWidth * scale), even(displayHeight * scale))
    }

    /**
     * How much to multiply the overlay's widths and radii by when painting onto a canvas this size.
     *
     * A live preview draws in dp on a screen a few hundred dp wide, so a `lineWidth` of 3 is a
     * clearly visible line. An export draws in pixels, where 3 on a 1080 pixel frame is a hair.
     * Scaling by the canvas's short edge against a nominal phone width means one config produces a
     * skeleton that looks the same in the preview and in the file, at any output size, which is the
     * whole promise of configuring both with the same numbers.
     *
     * The short edge rather than the long one, so a clip and the portrait video of the same scene
     * do not come back with different weights of line.
     */
    fun overlayScale(
        canvasWidth: Int,
        canvasHeight: Int,
    ): Float {
        val shortEdge = min(canvasWidth, canvasHeight)
        if (shortEdge <= 0) return 1f
        return max(1f, shortEdge / REFERENCE_EDGE)
    }

    private fun even(value: Float): Int {
        val rounded = max(2, value.roundToInt())
        return rounded - rounded % 2
    }
}
