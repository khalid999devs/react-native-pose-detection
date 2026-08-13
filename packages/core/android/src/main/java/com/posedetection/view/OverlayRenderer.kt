package com.posedetection.view

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import com.posedetection.Skeleton
import com.posedetection.engine.Geometry
import java.util.Locale
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * The skeleton, drawn onto any [Canvas].
 *
 * This is the only place the overlay is drawn. [OverlayView] owns one and hands it the screen's
 * canvas; the exporter owns one and hands it a canvas over the bitmap it is about to encode.
 * Because the geometry lives here rather than in either of them, a painted export and a live
 * preview of the same pose cannot disagree about where a joint goes. [OverlayProjection] makes the
 * same guarantee one level down, for the rectangle the pose is projected into.
 *
 * The draw path allocates nothing: preallocated float arrays go to `drawPoints` and `drawLines` in
 * one call each, and degree labels are formatted into a reusable char buffer. The paints and those
 * buffers belong to the renderer, so a view that keeps one keeps them across frames.
 *
 * @param density pixels per unit for widths, radii and text. A view passes the display's density,
 *   so a `lineWidth` of 3 is 3dp. An export passes a factor derived from the output size, because 3
 *   pixels on a 1080 pixel frame is a hair rather than a line: see `overlayScale`.
 */
internal class OverlayRenderer(
    private val density: Float,
) {
    var config: OverlayConfig = OverlayConfig()
        set(value) {
            field = value
            applyConfig()
        }

    private val pointPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            strokeCap = Paint.Cap.ROUND
        }
    private val linePaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
    private val arcPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
        }
    private val labelPaint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            textAlign = Paint.Align.CENTER
        }
    private val labelBackdrop =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.argb(140, 0, 0, 0)
        }

    // Reused across frames.
    private val pointBuffer = FloatArray(Skeleton.LANDMARK_COUNT * 2)
    private val lineBuffer = FloatArray(Skeleton.CONNECTION_COUNT * 4)
    private val arcBounds = RectF()
    private val labelBounds = RectF()
    private val labelChars = CharArray(16)
    private val screen = FloatArray(2)
    private val fontMetrics = Paint.FontMetrics()

    // The frame being drawn, set at the top of draw so the helpers below do not each need it.
    private var landmarks = EMPTY
    private var projection = OverlayProjection(0, 0, 0f, 0f, ContentFit.FILL)
    private var mirrored = false
    private var sourceWidth = 0
    private var sourceHeight = 0

    init {
        applyConfig()
    }

    private fun applyConfig() {
        pointPaint.color = config.color
        linePaint.color = config.color
        linePaint.strokeWidth = config.lineWidthDp * density
        pointPaint.strokeWidth = config.pointRadiusDp * 2f * density
        arcPaint.strokeWidth = (config.lineWidthDp * 0.75f) * density
        labelPaint.textSize = LABEL_SP * density
    }

    fun draw(
        canvas: Canvas,
        landmarks: FloatArray,
        projection: OverlayProjection,
        mirrored: Boolean,
        sourceWidth: Int,
        sourceHeight: Int,
    ) {
        if (sourceWidth == 0 || sourceHeight == 0) return
        this.landmarks = landmarks
        this.projection = projection
        this.mirrored = mirrored
        this.sourceWidth = sourceWidth
        this.sourceHeight = sourceHeight

        if (config.connections) drawConnections(canvas)
        if (config.landmarks) drawLandmarks(canvas)
        if (config.angles.isNotEmpty()) drawAngles(canvas)
    }

    private fun isDrawable(joint: Int): Boolean {
        if (Geometry.visibility(landmarks, joint) < config.minVisibility) return false
        val only = config.only ?: return true
        return only[joint]
    }

    private fun drawLandmarks(canvas: Canvas) {
        var count = 0
        for (joint in 0 until Skeleton.LANDMARK_COUNT) {
            if (!isDrawable(joint)) continue
            project(joint)
            pointBuffer[count++] = screen[0]
            pointBuffer[count++] = screen[1]
        }
        if (count > 0) canvas.drawPoints(pointBuffer, 0, count, pointPaint)
    }

    private fun drawConnections(canvas: Canvas) {
        var count = 0
        var index = 0
        while (index < Skeleton.CONNECTIONS.size) {
            val from = Skeleton.CONNECTIONS[index]
            val to = Skeleton.CONNECTIONS[index + 1]
            index += 2

            // A segment with one bad endpoint is a line to a guess, so it is not drawn at all.
            if (!isDrawable(from) || !isDrawable(to)) continue

            project(from)
            lineBuffer[count++] = screen[0]
            lineBuffer[count++] = screen[1]
            project(to)
            lineBuffer[count++] = screen[0]
            lineBuffer[count++] = screen[1]
        }
        if (count > 0) canvas.drawLines(lineBuffer, 0, count, linePaint)
    }

    private fun drawAngles(canvas: Canvas) {
        val angles = config.angles
        // By index, because a for-in over a List allocates an iterator on every frame.
        for (index in angles.indices) {
            val spec = angles[index]
            val vertex = spec.triple[1]
            if (Geometry.visibility(landmarks, vertex) < spec.minVisibility) continue

            val degrees =
                Geometry.angleDegrees(
                    landmarks,
                    spec.triple[0],
                    vertex,
                    spec.triple[2],
                    sourceWidth,
                    sourceHeight,
                )
            if (degrees.isNaN()) continue

            project(spec.triple[0])
            val proximalX = screen[0]
            val proximalY = screen[1]
            project(vertex)
            val cx = screen[0]
            val cy = screen[1]
            project(spec.triple[2])
            val distalX = screen[0]
            val distalY = screen[1]

            // Taken in screen pixels, after the mirror and the fill, so the arc opens into the
            // joint on both cameras instead of straddling the limb on the front one.
            val bisector = Geometry.bisectorRadians(proximalX, proximalY, cx, cy, distalX, distalY)
            if (bisector.isNaN()) continue

            val radius = spec.radiusDp * density

            arcPaint.color = spec.color ?: config.color
            arcBounds.set(cx - radius, cy - radius, cx + radius, cy + radius)

            // The sweep is the angle itself, centered on the bisector, so the arc sits inside the
            // two limb segments rather than crossing them.
            val start = Math.toDegrees(bisector.toDouble()).toFloat() - degrees / 2f
            canvas.drawArc(arcBounds, start, degrees, false, arcPaint)

            if (spec.label) drawLabel(canvas, degrees, spec, cx, cy, radius, bisector)
        }
    }

    private fun drawLabel(
        canvas: Canvas,
        degrees: Float,
        spec: AngleOverlaySpec,
        cx: Float,
        cy: Float,
        radius: Float,
        bisector: Float,
    ) {
        val labelRadius = radius + LABEL_GAP_DP * density
        val lx = cx + cos(bisector) * labelRadius
        val ly = cy + sin(bisector) * labelRadius

        val length = formatDegrees(degrees, spec.decimals)
        val textWidth = labelPaint.measureText(labelChars, 0, length)
        labelPaint.getFontMetrics(fontMetrics)
        val padding = LABEL_PADDING_DP * density

        labelBounds.set(
            lx - textWidth / 2f - padding,
            ly + fontMetrics.ascent - padding / 2f,
            lx + textWidth / 2f + padding,
            ly + fontMetrics.descent + padding / 2f,
        )
        canvas.drawRoundRect(labelBounds, padding, padding, labelBackdrop)

        labelPaint.color = spec.color ?: config.color
        canvas.drawText(labelChars, 0, length, lx, ly, labelPaint)
    }

    /**
     * Writes the label into the reusable buffer and returns its length. Whole degrees allocate
     * nothing; decimals fall back to `String.format`, only when a consumer opts in.
     */
    private fun formatDegrees(
        degrees: Float,
        decimals: Int,
    ): Int {
        if (decimals <= 0) {
            var value = Math.round(degrees)
            if (value < 0) value = 0
            val digits: Int
            if (value == 0) {
                labelChars[0] = '0'
                digits = 1
            } else {
                var remaining = value
                var start = 0
                while (remaining > 0) {
                    labelChars[start++] = ('0' + remaining % 10)
                    remaining /= 10
                }
                digits = start
                var left = 0
                var right = digits - 1
                while (left < right) {
                    val swap = labelChars[left]
                    labelChars[left] = labelChars[right]
                    labelChars[right] = swap
                    left++
                    right--
                }
            }
            labelChars[digits] = DEGREE_SIGN
            return digits + 1
        }

        // Locale.US because a de-DE device would otherwise render "90,5" for the same build. The
        // pattern is looked up rather than built: `"%.${decimals}f°"` rebuilt the same handful of
        // strings on the draw path, once per labelled angle per frame.
        val text = String.format(Locale.US, DECIMAL_PATTERNS[decimals], degrees)
        val length = min(text.length, labelChars.size)
        text.toCharArray(labelChars, 0, 0, length)
        return length
    }

    /** Normalized frame coordinates to canvas pixels, through the projection it was given. */
    private fun project(joint: Int) {
        val base = joint * Skeleton.LANDMARK_STRIDE
        screen[0] = projection.x(landmarks[base + Skeleton.OFFSET_X], mirrored)
        screen[1] = projection.y(landmarks[base + Skeleton.OFFSET_Y])
    }

    private companion object {
        const val LABEL_SP = 13f
        const val LABEL_GAP_DP = 18f
        const val LABEL_PADDING_DP = 5f
        const val DEGREE_SIGN = '°'

        val EMPTY = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)

        /** Indexed by `decimals`, which OverlayParsing caps at 3. */
        val DECIMAL_PATTERNS =
            arrayOf("%.0f$DEGREE_SIGN", "%.1f$DEGREE_SIGN", "%.2f$DEGREE_SIGN", "%.3f$DEGREE_SIGN")
    }
}
