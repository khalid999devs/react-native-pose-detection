package com.posedetection.export

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.posedetection.Skeleton
import com.posedetection.detector.PoseDetector
import com.posedetection.detector.StaticDetection
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Two passes: detect the poses, then transcode the video with them painted on.
 *
 * Detection runs first, over the whole clip at `sampleFps`, and keeps only landmarks: a minute of
 * video at ten samples a second is about three hundred kilobytes, so the whole result fits in
 * memory and the transcode never has to wait for an inference. The alternative, detecting inside
 * the transcode loop, would mean reading frames back off the GPU to get pixels MediaPipe can see,
 * upside down and at full resolution, on every sampled frame.
 *
 * The transcode itself never leaves the GPU: decoder to [ExportGl] to encoder. The skeleton is
 * drawn into a bitmap only when the pose changes, ten times a second rather than thirty, and
 * uploaded as a texture.
 */
internal class VideoExporter(
    private val context: Context,
    private val uri: String,
    private val options: ExportOptions,
    private val cancelled: AtomicBoolean,
    private val onProgress: (Float) -> Unit,
) {
    private var lastReported = -1f

    fun run(): ExportSummary {
        val poses = detect()
        if (cancelled.get()) throw ExportCancelled()
        return transcode(poses)
    }

    // MARK: Pass one, the poses

    /**
     * Frames come back already rotated upright, which is the same space the transcode draws in, so
     * the landmarks need no correction between the two passes.
     */
    private fun detect(): List<Pose> {
        val retriever = MediaMetadataRetriever()
        var detector: PoseDetector? = null
        val poses = ArrayList<Pose>()
        try {
            StaticDetection.open(retriever, context, uri)
            val durationMs =
                retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
                    ?: throw ExportError("the video reports no duration")

            detector =
                PoseDetector.createForStillInput(
                    context,
                    StaticDetection.requireModel(context),
                    options.maxPoses,
                    video = true,
                )

            val stepMs = (1_000L / options.sampleFps).coerceAtLeast(1L)
            var positionMs = 0L
            while (positionMs < durationMs && !cancelled.get()) {
                val frame =
                    retriever.getFrameAtTime(
                        positionMs * MICROS_PER_MILLI,
                        MediaMetadataRetriever.OPTION_CLOSEST,
                    )
                if (frame != null) {
                    val result = detector.detectVideo(BitmapImageBuilder(frame).build(), positionMs)
                    val landmarks = FloatArray(Skeleton.LANDMARK_COUNT * Skeleton.LANDMARK_STRIDE)
                    if (PoseExport.fill(landmarks, result)) poses.add(Pose(positionMs, landmarks))
                    frame.recycle()
                }
                // The detect pass is the slow half, so it owns most of the progress bar.
                report(DETECT_SHARE * positionMs / durationMs)
                positionMs += stepMs
            }
        } finally {
            detector?.close()
            retriever.release()
        }
        return poses
    }

    // MARK: Pass two, the picture

    @Suppress("LongMethod")
    private fun transcode(poses: List<Pose>): ExportSummary {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        var gl: ExportGl? = null
        var overlay: Bitmap? = null
        val output = File(options.directory, "${options.fileName}.mp4")
        var complete = false

        try {
            StaticDetection.openExtractor(extractor, context, uri)
            val track = videoTrack(extractor)
            val format = extractor.getTrackFormat(track)
            extractor.selectTrack(track)

            val rotation =
                if (format.containsKey(MediaFormat.KEY_ROTATION)) {
                    format.getInteger(MediaFormat.KEY_ROTATION)
                } else {
                    0
                }
            val naturalWidth = format.getInteger(MediaFormat.KEY_WIDTH)
            val naturalHeight = format.getInteger(MediaFormat.KEY_HEIGHT)
            val upright = rotation == 90 || rotation == 270
            val canvas =
                ExportCanvas.size(
                    if (upright) naturalHeight else naturalWidth,
                    if (upright) naturalWidth else naturalHeight,
                    options.maxSize,
                )

            encoder = createEncoder(canvas[0], canvas[1], format)
            gl = ExportGl(encoder.createInputSurface())
            encoder.start()
            gl.setViewport(canvas[0], canvas[1])

            decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            // The rotation is applied by the renderer, so it must not travel to the decoder as
            // well: some devices honour it on a surface and the frame would come out turned twice.
            format.setInteger(MediaFormat.KEY_ROTATION, 0)
            decoder.configure(format, gl.decoderSurface, null, 0)
            decoder.start()

            muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            overlay = Bitmap.createBitmap(canvas[0], canvas[1], Bitmap.Config.ARGB_8888)

            val painter = OverlayPainter(overlay, canvas, naturalWidth, naturalHeight, upright, options)
            val pump = ExportPump(decoder, encoder, muxer, gl, cancelled)
            val frames =
                pump.run(extractor, rotation, poses, painter) { done ->
                    report(DETECT_SHARE + (1f - DETECT_SHARE) * done)
                }

            complete = true
            return ExportSummary(
                file = output,
                width = canvas[0],
                height = canvas[1],
                durationMs = (pump.lastTimeUs / MICROS_PER_MILLI).toInt(),
                frameCount = frames,
                posesFound = poses.size,
            )
        } finally {
            runCatching { decoder?.stop() }
            decoder?.release()
            runCatching { encoder?.stop() }
            encoder?.release()
            gl?.release()
            overlay?.recycle()
            runCatching { if (complete) muxer?.stop() }
            muxer?.release()
            extractor.release()
            // A half written file looks like a finished export to anything that finds it later.
            if (!complete) output.delete()
        }
    }

    private fun videoTrack(extractor: MediaExtractor): Int {
        for (index in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("video/")) return index
        }
        throw ExportError("no video track in $uri")
    }

    private fun createEncoder(
        width: Int,
        height: Int,
        source: MediaFormat,
    ): MediaCodec {
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        format.setInteger(
            MediaFormat.KEY_COLOR_FORMAT,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
        )
        format.setInteger(MediaFormat.KEY_BIT_RATE, width * height * BITS_PER_PIXEL)
        format.setInteger(
            MediaFormat.KEY_FRAME_RATE,
            if (source.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                source.getInteger(MediaFormat.KEY_FRAME_RATE)
            } else {
                DEFAULT_FRAME_RATE
            },
        )
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_SECONDS)

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        return encoder
    }

    /**
     * Throttled, because a frame by frame progress event is thirty crossings a second for a number
     * nobody can read that fast.
     */
    private fun report(progress: Float) {
        val clamped = progress.coerceIn(0f, 1f)
        if (clamped < lastReported + PROGRESS_STEP && clamped < 1f) return
        lastReported = clamped
        onProgress(clamped)
    }

    private companion object {
        const val MICROS_PER_MILLI = 1_000L
        const val BITS_PER_PIXEL = 8
        const val DEFAULT_FRAME_RATE = 30
        const val I_FRAME_SECONDS = 1
        const val PROGRESS_STEP = 0.02f

        /** Detection is the slow pass, so it owns most of the bar. */
        const val DETECT_SHARE = 0.7f
    }
}
