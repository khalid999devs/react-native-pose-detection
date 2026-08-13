package com.posedetection.view

import android.content.Context
import android.graphics.Canvas
import android.view.View
import com.posedetection.Skeleton

/**
 * Draws the skeleton over the preview. Nothing here crosses to JavaScript.
 *
 * The drawing itself is [OverlayRenderer], which this view holds no special version of: the
 * exporter builds the same renderer against a bitmap. This class is the threading and the
 * lifecycle around it, not the geometry.
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

    private val renderer = OverlayRenderer(context.resources.displayMetrics.density)

    var config: OverlayConfig
        get() = renderer.config
        set(value) {
            if (value == renderer.config) return
            renderer.config = value
            invalidate()
        }

    init {
        setWillNotDraw(false)
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

        renderer.draw(
            canvas,
            landmarks,
            // The preview fills, so the skeleton fills with it.
            OverlayProjection(
                sourceWidth,
                sourceHeight,
                width.toFloat(),
                height.toFloat(),
                ContentFit.FILL,
            ),
            mirrored,
            sourceWidth,
            sourceHeight,
        )
    }
}
