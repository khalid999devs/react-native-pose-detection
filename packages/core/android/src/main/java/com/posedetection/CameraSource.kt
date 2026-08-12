package com.posedetection

import android.content.Context
import android.util.Size
import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicInteger

internal enum class Facing { FRONT, BACK }

/**
 * Owns the capture session and nothing else. It knows about frames, not about poses.
 *
 * **Every field here is read and written on the main thread only.** CameraX requires
 * `bindToLifecycle` on the main thread, so the main thread is the serial session queue rather
 * than a second queue racing it. Booleans shared across queues were the root cause of the legacy
 * package's camera-switch crashes, and the fix is not to have two queues.
 *
 * Analysis runs on its own single thread, handed in as [analysisExecutor], so inference never
 * blocks the UI.
 */
internal class CameraSource(
    private val context: Context,
    private val previewView: PreviewView,
    private val analysisExecutor: Executor,
) {
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var analyzer: ImageAnalysis.Analyzer? = null
    private var lifecycleOwner: LifecycleOwner? = null

    var facing: Facing = Facing.FRONT
        private set

    var isBound: Boolean = false
        private set

    var previewSize: Size = Size(1280, 720)
    var analysisSize: Size = Size(640, 480)

    /**
     * Bumped on every switch. Results produced before the bump are dropped by the view rather than
     * drawn against the new camera's geometry.
     */
    val generation = AtomicInteger(0)

    private val mainExecutor: Executor = ContextCompat.getMainExecutor(context)

    fun setAnalyzer(analyzer: ImageAnalysis.Analyzer?) {
        this.analyzer = analyzer
        val analysis = this.analysis ?: return
        if (analyzer == null) {
            analysis.clearAnalyzer()
        } else {
            analysis.setAnalyzer(analysisExecutor, analyzer)
        }
    }

    fun start(
        owner: LifecycleOwner,
        facing: Facing,
        onBound: () -> Unit,
        onFailed: (ErrorCode, Throwable?) -> Unit,
    ) {
        this.lifecycleOwner = owner
        this.facing = facing

        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                provider = future.get()
                bind(facing)
                onBound()
            } catch (error: Throwable) {
                PoseLog.error(LogCategory.CAMERA) { "camera provider failed: ${error.message}" }
                onFailed(ErrorCode.CAMERA_START_FAILED, error)
            }
        }, mainExecutor)
    }

    /**
     * Rebinds to the other camera, and puts the old one back if that fails. The generation is only
     * bumped once the new binding succeeded, so a failed switch leaves nothing to reconcile.
     */
    fun switchTo(
        target: Facing,
        onDone: (Facing) -> Unit,
        onFailed: (ErrorCode, Throwable?) -> Unit,
    ) {
        if (!isBound) {
            onFailed(ErrorCode.CAMERA_SWITCH_FAILED, IllegalStateException("camera is not running"))
            return
        }
        if (target == facing) {
            onDone(facing)
            return
        }

        val previous = facing
        try {
            bind(target)
            generation.incrementAndGet()
            PoseLog.debug(LogCategory.CAMERA) { "switched $previous to $target, gen=${generation.get()}" }
            onDone(target)
        } catch (error: Throwable) {
            PoseLog.warn(LogCategory.CAMERA) { "switch to $target failed, rolling back: ${error.message}" }
            try {
                bind(previous)
                onFailed(ErrorCode.CAMERA_SWITCH_FAILED, error)
            } catch (rollbackError: Throwable) {
                // The previous camera is gone too. This is no longer recoverable.
                isBound = false
                onFailed(ErrorCode.CAMERA_UNAVAILABLE, rollbackError)
            }
        }
    }

    /** Called on a configuration change so the analysis buffer keeps arriving upright. */
    fun updateTargetRotation() {
        val rotation = currentRotation()
        analysis?.targetRotation = rotation
        PoseLog.debug(LogCategory.CAMERA) { "target rotation now $rotation" }
    }

    fun pause() {
        if (!isBound) return
        provider?.unbindAll()
        isBound = false
        PoseLog.info(LogCategory.CAMERA) { "session stopped" }
    }

    fun resume(onFailed: (ErrorCode, Throwable?) -> Unit) {
        if (isBound || provider == null || lifecycleOwner == null) return
        try {
            bind(facing)
        } catch (error: Throwable) {
            onFailed(ErrorCode.CAMERA_START_FAILED, error)
        }
    }

    fun release() {
        analysis?.clearAnalyzer()
        provider?.unbindAll()
        analysis = null
        analyzer = null
        provider = null
        lifecycleOwner = null
        isBound = false
    }

    private fun bind(target: Facing) {
        val provider = this.provider ?: throw IllegalStateException("no camera provider")
        val owner = this.lifecycleOwner ?: throw IllegalStateException("no lifecycle owner")

        val rotation = currentRotation()

        val preview =
            Preview
                .Builder()
                .setResolutionSelector(resolutionSelector(previewSize))
                .setTargetRotation(rotation)
                .build()

        // RGBA_8888 is converted by the camera hardware, which is far cheaper than a YUV to RGB
        // pass in our own code. KEEP_ONLY_LATEST means a slow frame is dropped rather than queued,
        // so the pipeline degrades in latency instead of falling behind forever.
        val analysis =
            ImageAnalysis
                .Builder()
                .setResolutionSelector(resolutionSelector(analysisSize))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setTargetRotation(rotation)
                .build()

        analyzer?.let { analysis.setAnalyzer(analysisExecutor, it) }

        val selector =
            CameraSelector
                .Builder()
                .requireLensFacing(
                    if (target == Facing.FRONT) CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK,
                ).build()

        provider.unbindAll()
        provider.bindToLifecycle(owner, selector, preview, analysis)
        preview.surfaceProvider = previewView.surfaceProvider

        this.analysis = analysis
        this.facing = target
        this.isBound = true

        PoseLog.info(LogCategory.CAMERA) {
            "bound $target preview=${previewSize.width}x${previewSize.height} " +
                "analysis=${analysisSize.width}x${analysisSize.height} rotation=$rotation"
        }
    }

    private fun currentRotation(): Int = previewView.display?.rotation ?: Surface.ROTATION_0

    private fun resolutionSelector(size: Size) =
        ResolutionSelector
            .Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(
                ResolutionStrategy(size, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
            ).build()

    companion object {
        fun previewSizeFor(preset: String): Size =
            when (preset) {
                "480p" -> Size(640, 480)
                "1080p" -> Size(1920, 1080)
                else -> Size(1280, 720)
            }

        fun analysisSizeFor(preset: String): Size =
            when (preset) {
                "360p" -> Size(640, 360)
                "720p" -> Size(1280, 720)
                else -> Size(640, 480)
            }
    }
}
