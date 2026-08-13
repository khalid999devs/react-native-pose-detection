package com.posedetection.view

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import com.posedetection.Skeleton
import com.posedetection.engine.Geometry
import java.util.Locale
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

/**
 * Draws the skeleton over the preview. Nothing here crosses to JavaScript.
 *
 * The draw path allocates nothing: preallocated float arrays go to `drawPoints` and `drawLines`
 * in one call each, and degree labels are formatted into a reusable char buffer.
 */
internal class OverlayView(
    context: Context,
) : View(context) {
    // The detector's result thread writes `incoming`, the UI thread draws from `landmarks`, and
    // `frameLock` is held only for the copy between them. Without it a draw already in flight can
    // read some joints from one frame and the rest from the next, and the skeleton snaps apart.
    private val frameLock = Any()
    private val incoming = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
    private var incomingHasPose = false
    private var incomingMirrored = false
    private var incomingWidth = 0
    private var incomingHeight = 0

    // Everything below is the snapshot taken under the lock at the top of onDraw, and is touched
    // only on the UI thread from there on. Mirroring and the source size ride in the same snapshot
    // as the landmarks, so a camera switch can never draw new landmarks with the old mirroring.
    private val landmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
    private var hasPose = false
    private var mirrored = false

    /**
     * Frame size in display orientation, the space the landmarks are normalized against. At 90 and
     * 270 degrees the sensor dimensions are swapped, so portrait is 480x640, not 640x480.
     */
    private var sourceWidth = 0
    private var sourceHeight = 0

    var config = OverlayConfig()
        set(value) {
            if (value == field) return
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
    private val fontMetrics = Paint.FontMetrics()

    // The fill scale and offsets are constant within a draw, so they are computed once per frame
    // rather than on each of the hundred-odd project() calls a frame makes.
    // Constant within a draw, so it is built once per frame rather than on each of the
    // hundred-odd projections a frame makes.
    private var projection = OverlayProjection(0, 0, 0f, 0f, ContentFit.FILL)

    /**
     * `FILL` matches `PreviewView` FILL_CENTER. `FIT` is what a picked image or video wants, and a
     * media surface is positioned with [contentRect] so the picture and the skeleton come from one
     * computation rather than two that can disagree.
     */
    var contentFit = ContentFit.FILL
        set(value) {
            if (field == value) return
            field = value
            postInvalidateOnAnimation()
        }

    /** Where the source lands inside this view, for whatever surface is showing it. */
    fun contentRect(): OverlayProjection {
        val sourceSize = synchronized(frameLock) { incomingWidth to incomingHeight }
        return OverlayProjection(
            sourceSize.first,
            sourceSize.second,
            width.toFloat(),
            height.toFloat(),
            contentFit,
        )
    }

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

    fun setMirrored(mirrored: Boolean) {
        synchronized(frameLock) {
            incomingMirrored = mirrored
        }
    }

    /**
     * Called from the detector's result thread; copies into the view's buffer and posts a redraw.
     *
     * The size travels with the landmarks rather than in a call of its own. Two critical sections
     * let `onDraw` land between them and draw new landmarks against the previous frame size, which
     * is exactly the interleaving the snapshot in this class exists to prevent. The caller has
     * already folded rotation into the width and height.
     */
    fun submit(
        frame: FloatArray,
        rotatedWidth: Int,
        rotatedHeight: Int,
    ) {
        synchronized(frameLock) {
            System.arraycopy(frame, 0, incoming, 0, incoming.size)
            incomingWidth = rotatedWidth
            incomingHeight = rotatedHeight
            incomingHasPose = true
        }
        postInvalidateOnAnimation()
    }

    fun clearPose() {
        synchronized(frameLock) {
            incomingHasPose = false
        }
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        // One copy under the lock, then the rest of the draw runs on a frame that cannot change
        // underneath it. The producer waits only for the copy, never for the draw.
        synchronized(frameLock) {
            hasPose = incomingHasPose
            mirrored = incomingMirrored
            sourceWidth = incomingWidth
            sourceHeight = incomingHeight
            if (hasPose) System.arraycopy(incoming, 0, landmarks, 0, landmarks.size)
        }

        if (!hasPose || sourceWidth == 0 || sourceHeight == 0) return
        if (width == 0 || height == 0) return

        updateProjection()

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

            // The sweep is the angle itself, centered on the bisector, so the arc sits inside the two
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
        labelPaint.getFontMetrics(fontMetrics)
        val padding = LABEL_PADDING_DP * density

        labelBounds.set(
            lx - textWidth / 2f - padding,
            ly + fontMetrics.ascent - padding / 2f,
            lx + textWidth / 2f + padding,
            ly + fontMetrics.descent + padding / 2f,
        )
        val corner = padding
        canvas.drawRoundRect(labelBounds, corner, corner, labelBackdrop)

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

        // Locale.US because a de-DE device would otherwise render "90,5" for the same build. The
        // pattern is looked up rather than built: `"%.${decimals}f°"` rebuilt the same handful of
        // strings on the draw path, once per labelled angle per frame.
        val text = String.format(Locale.US, DECIMAL_PATTERNS[decimals], degrees)
        val length = minOf(text.length, labelChars.size)
        text.toCharArray(labelChars, 0, 0, length)
        return length
    }

    private fun updateProjection() {
        projection =
            OverlayProjection(sourceWidth, sourceHeight, width.toFloat(), height.toFloat(), contentFit)
    }

    /** Normalized frame coordinates to view pixels, through the projection [updateProjection] built. */
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

        /** Indexed by `decimals`, which OverlayParsing caps at 3. */
        private val DECIMAL_PATTERNS =
            arrayOf("%.0f$DEGREE_SIGN", "%.1f$DEGREE_SIGN", "%.2f$DEGREE_SIGN", "%.3f$DEGREE_SIGN")
    }
}
