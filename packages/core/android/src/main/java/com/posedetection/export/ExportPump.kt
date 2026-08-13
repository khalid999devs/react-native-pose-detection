package com.posedetection.export

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.PorterDuff
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMuxer
import com.posedetection.view.ContentFit
import com.posedetection.view.OverlayProjection
import com.posedetection.view.OverlayRenderer
import java.util.concurrent.atomic.AtomicBoolean

/** One sampled frame, and everybody who was in it. */
internal class Pose(
    val timeMs: Long,
    val bodies: List<FloatArray>,
)

/**
 * Draws the skeleton into the overlay bitmap, and knows when it does not have to.
 *
 * The bitmap is cleared and redrawn only when the transcode moves onto a different pose, which is
 * at the detection rate rather than the frame rate, so two frames out of three cost nothing but the
 * texture already on the GPU.
 */
internal class OverlayPainter(
    private val target: Bitmap,
    canvasSize: IntArray,
    naturalWidth: Int,
    naturalHeight: Int,
    upright: Boolean,
    private val options: ExportOptions,
) {
    private val canvas = Canvas(target)
    private val sourceWidth = if (upright) naturalHeight else naturalWidth
    private val sourceHeight = if (upright) naturalWidth else naturalHeight

    // Fit, not fill: cropping a file the user picked would cut away part of the very thing they
    // asked to have painted. The canvas already carries the source's aspect, so this fills it.
    private val projection =
        OverlayProjection(
            sourceWidth,
            sourceHeight,
            canvasSize[0].toFloat(),
            canvasSize[1].toFloat(),
            ContentFit.FIT,
        )
    private val renderer =
        OverlayRenderer(ExportCanvas.overlayScale(canvasSize[0], canvasSize[1])).apply {
            config = options.overlay
        }

    private var painted = Int.MIN_VALUE

    fun bitmap(): Bitmap = target

    /** True when the bitmap changed and has to be uploaded again. */
    fun paint(
        poses: List<Pose>,
        index: Int,
    ): Boolean {
        if (index == painted) return false
        painted = index
        canvas.drawColor(0, PorterDuff.Mode.CLEAR)
        if (index >= 0 && options.drawOverlay) {
            for (landmarks in poses[index].bodies) {
                renderer.draw(
                    canvas,
                    landmarks,
                    projection,
                    // A file is never mirrored: what was picked is what gets painted.
                    mirrored = false,
                    sourceWidth = sourceWidth,
                    sourceHeight = sourceHeight,
                )
            }
        }
        return true
    }
}

/**
 * The transcode loop: feed the decoder, render what comes out, drain the encoder into the muxer.
 *
 * All three run in one thread rather than three, because they are already serialised by the frame:
 * nothing can be encoded before it is rendered and nothing rendered before it is decoded. One
 * thread also means one place to check for cancellation, and no chance of a codec being released
 * from under a thread still using it.
 */
internal class ExportPump(
    private val decoder: MediaCodec,
    private val encoder: MediaCodec,
    private val muxer: MediaMuxer,
    private val gl: ExportGl,
    private val audio: ExportAudio?,
    private val cancelled: AtomicBoolean,
) {
    /** The last presentation time written, which is the export's real duration. */
    var lastTimeUs = 0L
        private set

    private var cursor = 0

    fun run(
        extractor: MediaExtractor,
        rotation: Int,
        poses: List<Pose>,
        painter: OverlayPainter,
        onProgress: (Float) -> Unit,
    ): Int {
        val durationUs = extractor.trackDuration()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var decodeDone = false
        var encodeDone = false
        var muxerTrack = -1
        var frames = 0

        while (!encodeDone) {
            if (cancelled.get()) throw ExportCancelled()

            if (!inputDone) inputDone = feed(extractor)

            if (!decodeDone) {
                val index = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
                if (index >= 0) {
                    val render = info.size > 0
                    decoder.releaseOutputBuffer(index, render)
                    if (render && gl.awaitFrame()) {
                        gl.drawFrame(rotation)
                        val pose = poseAt(poses, info.presentationTimeUs / MICROS_PER_MILLI)
                        gl.drawOverlay(painter.bitmap(), painter.paint(poses, pose))
                        gl.present(info.presentationTimeUs * NANOS_PER_MICRO)
                        frames++
                        lastTimeUs = info.presentationTimeUs
                        audio?.drain(muxer, info.presentationTimeUs)
                        if (durationUs > 0) onProgress(info.presentationTimeUs.toFloat() / durationUs)
                    }
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        decodeDone = true
                        encoder.signalEndOfInputStream()
                    }
                }
            }

            muxerTrack = drain(info, muxerTrack).also { encodeDone = it == FINISHED }
            if (encodeDone) muxerTrack = FINISHED
        }
        onProgress(1f)
        return frames
    }

    /** True once the extractor has nothing left and the end of stream has been queued. */
    private fun feed(extractor: MediaExtractor): Boolean {
        val index = decoder.dequeueInputBuffer(TIMEOUT_US)
        if (index < 0) return false
        val buffer = decoder.getInputBuffer(index) ?: return false

        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) {
            decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            return true
        }
        decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
        extractor.advance()
        return false
    }

    /**
     * Moves whatever the encoder has produced into the muxer.
     *
     * Returns the muxer's track index, or [FINISHED] once the encoder has reported the end of the
     * stream. The muxer cannot be started until the encoder has published its real output format,
     * which is why the track is discovered here rather than set up in advance.
     */
    private fun drain(
        info: MediaCodec.BufferInfo,
        track: Int,
    ): Int {
        var muxerTrack = track
        while (true) {
            val index = encoder.dequeueOutputBuffer(info, 0)
            when {
                index == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                    return muxerTrack
                }

                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    // The only moment a track can be added, and the video's real format is not
                    // known until the encoder publishes it, so the audio track waits for it too.
                    muxerTrack = muxer.addTrack(encoder.outputFormat)
                    audio?.addTo(muxer)
                    muxer.start()
                }

                index >= 0 -> {
                    val buffer = encoder.getOutputBuffer(index)
                    // The codec config rides in the format the muxer was started with, so writing
                    // it again would put a second one in the file.
                    val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (buffer != null && info.size > 0 && !isConfig && muxerTrack >= 0) {
                        buffer.position(info.offset)
                        buffer.limit(info.offset + info.size)
                        muxer.writeSampleData(muxerTrack, buffer, info)
                    }
                    encoder.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        // Whatever audio outlasts the last video frame, so a track that runs a
                        // fraction longer than the picture is not cut off.
                        audio?.drain(muxer, Long.MAX_VALUE)
                        return FINISHED
                    }
                }
            }
        }
    }

    /**
     * The pose that belongs to this moment, by walking rather than searching: the transcode moves
     * forward, so this is one comparison per frame in the common case.
     */
    private fun poseAt(
        poses: List<Pose>,
        timeMs: Long,
    ): Int {
        if (poses.isEmpty()) return -1
        while (cursor + 1 < poses.size && poses[cursor + 1].timeMs <= timeMs) cursor++
        return cursor
    }

    private fun MediaExtractor.trackDuration(): Long {
        val track = sampleTrackIndex
        if (track < 0) return 0
        val format = getTrackFormat(track)
        return if (format.containsKey(android.media.MediaFormat.KEY_DURATION)) {
            format.getLong(android.media.MediaFormat.KEY_DURATION)
        } else {
            0
        }
    }

    private companion object {
        const val TIMEOUT_US = 10_000L
        const val MICROS_PER_MILLI = 1_000L
        const val NANOS_PER_MICRO = 1_000L
        const val FINISHED = -2
    }
}
