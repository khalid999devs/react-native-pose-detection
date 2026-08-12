package com.posedetection

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import kotlin.math.cos
import kotlin.math.sin

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
}

/**
 * Draws the skeleton over the preview. Nothing here crosses to JavaScript.
 *
 * The draw path allocates nothing. Points and segments go through preallocated float arrays
 * handed to `drawPoints` and `drawLines` in one call each, rather than a Path rebuilt per frame,
 * and degree labels are formatted into a reusable char buffer.
 */
internal class OverlayView(
    context: Context,
) : View(context) {
    private val landmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
    private var hasPose = false
    private var mirrored = false

    /** Source frame dimensions in display orientation, which set the aspect for the fill. */
    private var sourceWidth = 0
    private var sourceHeight = 0

    var config = OverlayConfig()
        set(value) {
            field = value
            applyConfig()
            invalidate()
        }

    private val density = context.resources.displayMetrics.density

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

    init {
        setWillNotDraw(false)
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

    fun setSourceSize(
        width: Int,
        height: Int,
    ) {
        if (width == sourceWidth && height == sourceHeight) return
        sourceWidth = width
        sourceHeight = height
    }

    fun setMirrored(mirrored: Boolean) {
        this.mirrored = mirrored
    }

    /** Called from the analysis thread; copies into the view's buffer and posts a redraw. */
    fun submit(frame: FloatArray) {
        System.arraycopy(frame, 0, landmarks, 0, landmarks.size)
        hasPose = true
        postInvalidateOnAnimation()
    }

    fun clearPose() {
        hasPose = false
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!hasPose || sourceWidth == 0 || sourceHeight == 0) return
        if (width == 0 || height == 0) return

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
        for (spec in config.angles) {
            val vertex = spec.triple[1]
            if (Geometry.visibility(landmarks, vertex) < spec.minVisibility) continue

            val degrees = Geometry.angleDegrees(landmarks, spec.triple[0], vertex, spec.triple[2])
            if (degrees.isNaN()) continue

            val bisector = Geometry.bisectorRadians(landmarks, spec.triple[0], vertex, spec.triple[2])
            if (bisector.isNaN()) continue

            project(vertex)
            val cx = screen[0]
            val cy = screen[1]
            val radius = spec.radiusDp * density

            arcPaint.color = spec.color ?: config.color
            arcBounds.set(cx - radius, cy - radius, cx + radius, cy + radius)

            // The sweep is the angle itself, centred on the bisector, so the arc sits inside the two
            // limb segments rather than crossing them.
            val sweep = degrees
            val start = Math.toDegrees(bisector.toDouble()).toFloat() - sweep / 2f
            canvas.drawArc(arcBounds, start, sweep, false, arcPaint)

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
        val metrics = labelPaint.fontMetrics
        val padding = LABEL_PADDING_DP * density

        labelBounds.set(
            lx - textWidth / 2f - padding,
            ly + metrics.ascent - padding / 2f,
            lx + textWidth / 2f + padding,
            ly + metrics.descent + padding / 2f,
        )
        val corner = padding
        canvas.drawRoundRect(labelBounds, corner, corner, labelBackdrop)

        labelPaint.color = spec.color ?: config.color
        canvas.drawText(labelChars, 0, length, lx, ly, labelPaint)
    }

    /**
     * Writes the degree label into the reusable buffer and returns its length. Whole degrees, the
     * default, take an integer path that allocates nothing. Fractional degrees fall back to
     * `String.format`, which does allocate, but only when a consumer opts into decimals.
     */
    private fun formatDegrees(
        degrees: Float,
        decimals: Int,
    ): Int {
        if (decimals <= 0) {
            var value = Math.round(degrees)
            if (value < 0) value = 0
            var digits = 0
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

        val text = String.format("%.${decimals}f$DEGREE_SIGN", degrees)
        val length = minOf(text.length, labelChars.size)
        text.toCharArray(labelChars, 0, 0, length)
        return length
    }

    /**
     * Normalized frame coordinates to view pixels, matching `PreviewView`'s FILL_CENTER: the source
     * is scaled to cover and the overflowing axis is cropped evenly, so the skeleton stays on the
     * body instead of drifting on a letterboxed preview.
     */
    private fun project(joint: Int) {
        val base = joint * Skeleton.LANDMARK_STRIDE
        var x = landmarks[base + Skeleton.OFFSET_X]
        val y = landmarks[base + Skeleton.OFFSET_Y]

        // Landmarks are un-mirrored so they describe the real world. The preview is mirrored on the
        // front camera, so the overlay mirrors here to stay aligned with what is on screen.
        if (mirrored) x = 1f - x

        val sourceAspect = sourceWidth.toFloat() / sourceHeight.toFloat()
        val viewAspect = width.toFloat() / height.toFloat()

        val scaledWidth: Float
        val scaledHeight: Float
        if (sourceAspect > viewAspect) {
            scaledHeight = height.toFloat()
            scaledWidth = scaledHeight * sourceAspect
        } else {
            scaledWidth = width.toFloat()
            scaledHeight = scaledWidth / sourceAspect
        }

        screen[0] = (width - scaledWidth) / 2f + x * scaledWidth
        screen[1] = (height - scaledHeight) / 2f + y * scaledHeight
    }

    private companion object {
        const val LABEL_SP = 13f
        const val LABEL_GAP_DP = 18f
        const val LABEL_PADDING_DP = 5f
        const val DEGREE_SIGN = '°'
    }
}
