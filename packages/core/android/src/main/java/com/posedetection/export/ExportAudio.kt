package com.posedetection.export

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import com.posedetection.LogCategory
import com.posedetection.PoseLog
import com.posedetection.detector.StaticDetection
import java.nio.ByteBuffer

/**
 * The source's audio, copied into the export without being decoded.
 *
 * Re-encoding would cost time and a generation of quality for a track this feature does not touch,
 * so the compressed samples are read off a second extractor and written straight to the muxer.
 *
 * A second extractor rather than a second track on the video one: `MediaExtractor` interleaves
 * whatever tracks are selected into a single sample stream, so reading audio and video off one
 * would mean the video loop pulling audio samples it has nowhere to put yet.
 *
 * Everything here degrades rather than fails. An MP4 muxer will not take every codec that can
 * appear in every container this package accepts, so a track it refuses is dropped with a log and
 * the export finishes silent instead of throwing away a painted video.
 */
internal class ExportAudio private constructor(
    private val extractor: MediaExtractor,
    val format: MediaFormat,
) {
    private val buffer: ByteBuffer =
        ByteBuffer.allocateDirect(
            if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE).coerceIn(MIN_BUFFER, MAX_BUFFER)
            } else {
                DEFAULT_BUFFER
            },
        )
    private val info = MediaCodec.BufferInfo()

    private var muxerIndex = -1
    private var pending = false
    private var drained = false

    /** Called when the muxer is being started, which is the only moment a track can be added. */
    fun addTo(muxer: MediaMuxer) {
        muxerIndex =
            runCatching { muxer.addTrack(format) }
                .onFailure {
                    PoseLog.warn(LogCategory.DETECTOR) {
                        "the export muxer refused the audio track, writing video only: ${it.message}"
                    }
                }.getOrDefault(-1)
    }

    /**
     * Writes audio up to where the video has reached, so the two stay interleaved in the file.
     *
     * A file whose sound is one long block at the end plays, but streams badly, and some players
     * will not start it until the whole thing has downloaded.
     */
    fun drain(
        muxer: MediaMuxer,
        upToUs: Long,
    ) {
        if (muxerIndex < 0 || drained) return
        while (true) {
            if (!pending) {
                buffer.clear()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) {
                    drained = true
                    return
                }
                info.set(0, size, extractor.sampleTime, extractor.sampleFlags())
                pending = true
            }
            if (info.presentationTimeUs > upToUs) return

            buffer.position(0)
            buffer.limit(info.size)
            muxer.writeSampleData(muxerIndex, buffer, info)
            pending = false
            extractor.advance()
        }
    }

    fun release() {
        extractor.release()
    }

    /** `MediaExtractor` reports a sync sample with its own flag, which the muxer names differently. */
    private fun MediaExtractor.sampleFlags(): Int =
        if (sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0

    companion object {
        private const val MIN_BUFFER = 16 * 1024
        private const val DEFAULT_BUFFER = 256 * 1024
        private const val MAX_BUFFER = 1024 * 1024

        /** Null when the source has no audio, which is normal rather than a problem. */
        fun open(
            context: Context,
            uri: String,
        ): ExportAudio? {
            val extractor = MediaExtractor()
            return runCatching {
                StaticDetection.openExtractor(extractor, context, uri)
                for (index in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(index)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                    if (!mime.startsWith("audio/")) continue
                    extractor.selectTrack(index)
                    return@runCatching ExportAudio(extractor, format)
                }
                null
            }.getOrNull().also { if (it == null) extractor.release() }
        }
    }
}
