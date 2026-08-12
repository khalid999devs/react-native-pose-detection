package com.posedetection

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import androidx.camera.core.ImageProxy

/**
 * Turns an RGBA_8888 [ImageProxy] into a bitmap MediaPipe can take, reusing the same bitmaps for
 * the life of the session so the frame path allocates nothing.
 *
 * The awkward part is row padding. CameraX usually hands back a buffer whose rows are exactly
 * `width * 4` bytes, and then a straight `copyPixelsFromBuffer` is correct. Some devices pad each
 * row out to an alignment boundary, and copying that buffer into a `width`-wide bitmap shears the
 * image diagonally: every row lands a few pixels further left than the one above it. So the
 * padded case copies into a full-stride bitmap and blits the real region out of it.
 */
internal class FrameConverter {
    private var source: Bitmap? = null
    private var cropped: Bitmap? = null
    private var canvas: Canvas? = null
    private val sourceRect = Rect()
    private val destRect = Rect()

    private var strideWidth = 0
    private var frameWidth = 0
    private var frameHeight = 0

    /** Returns a bitmap holding this frame. Valid until the next call. */
    fun convert(proxy: ImageProxy): Bitmap {
        val plane = proxy.planes[0]
        val pixelStride = plane.pixelStride
        val stride = plane.rowStride / pixelStride

        prepare(stride, proxy.width, proxy.height)

        val buffer = plane.buffer
        buffer.rewind()
        val source = this.source!!
        source.copyPixelsFromBuffer(buffer)

        if (stride == proxy.width) return source

        val cropped = this.cropped!!
        canvas!!.drawBitmap(source, sourceRect, destRect, null)
        return cropped
    }

    private fun prepare(
        stride: Int,
        width: Int,
        height: Int,
    ) {
        if (stride == strideWidth && width == frameWidth && height == frameHeight) return

        release()
        strideWidth = stride
        frameWidth = width
        frameHeight = height

        source = Bitmap.createBitmap(stride, height, Bitmap.Config.ARGB_8888)

        if (stride != width) {
            val cropped = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            this.cropped = cropped
            canvas = Canvas(cropped)
            sourceRect.set(0, 0, width, height)
            destRect.set(0, 0, width, height)
            PoseLog.debug(LogCategory.DETECTOR) { "row padding: stride $stride for width $width" }
        }
    }

    fun release() {
        source?.recycle()
        cropped?.recycle()
        source = null
        cropped = null
        canvas = null
        strideWidth = 0
        frameWidth = 0
        frameHeight = 0
    }
}
