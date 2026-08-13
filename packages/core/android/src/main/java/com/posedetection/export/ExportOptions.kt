package com.posedetection.export

import android.content.Context
import android.net.Uri
import com.posedetection.detector.PoseDetector
import com.posedetection.view.OverlayConfig
import com.posedetection.view.parseOverlay
import java.io.File

/** What `exportPose` was asked for. Defaults from `guides/export.md`. */
internal class ExportOptions(
    /**
     * The same config the camera's `overlay` prop takes, so a painted file and a live preview are
     * configured with one vocabulary rather than two.
     */
    val overlay: OverlayConfig,
    val drawOverlay: Boolean,
    val maxPoses: Int,
    /**
     * How sure the model has to be before it calls something a body.
     *
     * Left out, it follows [maxPoses], because the two are one decision: 0.5 for a single subject,
     * which is MediaPipe's own, and 0.3 above that, which is where a second person actually appears
     * rather than the first person twice. A number overrides it, and what the right number is for a
     * given piece of footage is the caller's to know.
     */
    val minConfidence: Float,
    /**
     * Detection samples a second. Between samples the last pose is held, exactly as the live
     * overlay holds one between inferences.
     */
    val sampleFps: Int,
    /** Long edge of the output, or 0 for the source's own size. */
    val maxSize: Int,
    val directory: File,
    val fileName: String,
    /** Still images only. */
    val quality: Int,
) {
    companion object {
        private const val DEFAULT_SAMPLE_FPS = 10
        private const val MIN_MAX_SIZE = 120

        fun parse(
            context: Context,
            raw: Map<*, *>?,
            sourceName: String,
        ): ExportOptions {
            val overlayRaw = raw?.get("overlay")
            val maxPoses = count(raw?.get("maxPoses"), 1, 5)
            return ExportOptions(
                overlay = (overlayRaw as? Map<*, *>)?.let { parseOverlay(it) } ?: OverlayConfig(),
                drawOverlay = overlayRaw as? Boolean ?: true,
                maxPoses = maxPoses,
                minConfidence =
                    ((raw?.get("minConfidence") as? Number)?.toFloat() ?: PoseDetector.stillConfidence(maxPoses))
                        .coerceIn(0.1f, 0.9f),
                sampleFps = count(raw?.get("fps"), DEFAULT_SAMPLE_FPS, 60),
                maxSize = maxSize(raw?.get("maxSize")),
                directory = directory(context, raw?.get("directory") as? String),
                fileName = fileName(raw?.get("fileName") as? String, sourceName),
                quality =
                    ((raw?.get("quality") as? Number)?.toFloat() ?: 0.9f)
                        .coerceIn(0.1f, 1f)
                        .let { (it * 100).toInt() },
            )
        }

        /**
         * Where the file lands, created if it is not there yet.
         *
         * The default is the app's cache directory: an export is derived data, and a package that
         * wrote into the app's files directory by default would leave behind copies the user never
         * asked for and never sees. Apps that want it kept pass a directory of their own, which is
         * also how the file ends up somewhere they can upload or move it from.
         */
        private fun directory(
            context: Context,
            raw: String?,
        ): File {
            val base =
                when (raw) {
                    null, "cache" -> {
                        context.cacheDir
                    }

                    "documents" -> {
                        context.filesDir
                    }

                    else -> {
                        val parsed = Uri.parse(raw)
                        File(if (parsed.scheme == "file") parsed.path ?: raw else raw)
                    }
                }
            base.mkdirs()
            sweepStaging(base)
            return base
        }

        /**
         * Whatever a dead process left mid-write. Exports run serially on one executor, so
         * nothing swept here can belong to an export that is still running.
         */
        private fun sweepStaging(base: File) {
            base.listFiles { file -> file.name.endsWith(".partial.mp4") }?.forEach { it.delete() }
        }

        /**
         * Sanitized rather than trusted: this reaches the filesystem, and a name with a slash in it
         * would write outside the directory the caller chose.
         */
        private fun fileName(
            raw: String?,
            sourceName: String,
        ): String {
            val candidate = raw?.takeIf { it.isNotEmpty() } ?: "$sourceName-pose"
            val cleaned =
                candidate
                    .filter { it.isLetterOrDigit() || it == '-' || it == '_' || it == ' ' || it == '.' }
                    .trim()
            return cleaned.ifEmpty { "pose-export" }
        }

        private fun maxSize(value: Any?): Int {
            val size = (value as? Number)?.toInt() ?: return ExportCanvas.DEFAULT_MAX_SIZE
            return if (size <= 0) 0 else size.coerceAtLeast(MIN_MAX_SIZE)
        }

        private fun count(
            value: Any?,
            fallback: Int,
            limit: Int,
        ): Int = (value as? Number)?.toInt()?.coerceIn(1, limit) ?: fallback
    }
}

/** What came back, for the JavaScript side to turn into an `ExportResult`. */
internal class ExportSummary(
    val file: File,
    val width: Int,
    val height: Int,
    val durationMs: Int,
    val frameCount: Int,
    val posesFound: Int,
) {
    fun payload(): Map<String, Any> =
        mapOf(
            "uri" to Uri.fromFile(file).toString(),
            "width" to width,
            "height" to height,
            "durationMs" to durationMs,
            "frameCount" to frameCount,
            "posesFound" to posesFound,
        )
}

internal class ExportError(
    message: String,
) : Exception(message)

/** Thrown when the caller cancelled. Distinct from a failure, because it is not one. */
internal class ExportCancelled : Exception("the export was cancelled")
