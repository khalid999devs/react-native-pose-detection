package com.posedetection.camera

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import androidx.camera.core.ImageProxy
import com.posedetection.LogCategory
import com.posedetection.PoseLog

/**
 * Turns an RGBA_8888 [ImageProxy] into a bitmap MediaPipe can take, reusing bitmaps for the life
 * of the session so the frame path allocates nothing.
 *
 * Some devices pad each row to an alignment boundary. Copying such a buffer into a `width`-wide
 * bitmap shears the image diagonally, so the padded case blits through a full-stride bitmap.
 *
 * **Analysis thread only, including [release].**
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

    /**
     * Drops the bitmaps without recycling. MediaPipe may still be reading one after `detectAsync`
     * returns, and recycling there is a read of freed native memory.
     */
    fun release() {
        source = null
        cropped = null
        canvas = null
        strideWidth = 0
        frameWidth = 0
        frameHeight = 0
    }
}
