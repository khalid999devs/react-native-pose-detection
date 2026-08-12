package com.posedetection.camera

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
import com.posedetection.ErrorCode
import com.posedetection.LogCategory
import com.posedetection.PoseLog
import java.util.concurrent.Executor

internal enum class Facing { FRONT, BACK }

/**
 * Owns the capture session. Knows about frames, not poses.
 *
 * **Every field here is main thread only.** CameraX requires `bindToLifecycle` on main, so main
 * is the serial session queue rather than a second queue racing it. Analysis runs on
 * [analysisExecutor] so inference never blocks the UI.
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

    /** `auto` prefers front and falls back to back. A pinned lens fails instead of falling back. */
    var facingFallbackAllowed: Boolean = false

    /** Tells the provider callback, which lands a turn later, whether its session still exists. */
    private var startToken = 0

    /** Kept so `resume()` can re-issue a start whose provider fetch a `pause()` cancelled. */
    private var onBound: (() -> Unit)? = null

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
        val token = ++startToken
        this.lifecycleOwner = owner
        this.facing = facing
        this.onBound = onBound

        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            // A pause, a release or a newer start landed while the provider was being fetched, so
            // this binding is no longer wanted. Without the token it would bring the camera and the
            // landmarker back up behind a session that has already stopped.
            if (token != startToken) {
                PoseLog.debug(LogCategory.CAMERA) { "ignoring a stale camera provider callback" }
                return@addListener
            }
            try {
                provider = future.get()
                bind(this.facing)
                onBound()
            } catch (error: Throwable) {
                PoseLog.error(LogCategory.CAMERA) { "camera provider failed: ${error.message}" }
                onFailed(ErrorCode.CAMERA_START_FAILED, error)
            }
        }, mainExecutor)
    }

    /** Rebinds, restoring the old lens on failure. `onDone` reports the lens actually bound. */
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
        // The `auto` fallback belongs on the first bind, not here. Letting it run would rebind the
        // lens that is already up, flash the preview, and resolve the switch as a success that
        // changed nothing. guides/camera-control.md promises a CAMERA_SWITCH_FAILED instead.
        val available = provider?.let { hasCamera(it, target) } ?: false
        if (!available) {
            onFailed(
                ErrorCode.CAMERA_SWITCH_FAILED,
                IllegalStateException("this device has no $target camera"),
            )
            return
        }

        val previous = facing
        try {
            bind(target)
            PoseLog.debug(LogCategory.CAMERA) { "switched $previous to $facing" }
            onDone(facing)
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

    /** Parks a facing change made while unbound so the next bind picks it up. */
    fun setPendingFacing(target: Facing) {
        if (isBound) return
        facing = target
    }

    fun pause() {
        startToken++
        if (!isBound) return
        provider?.unbindAll()
        isBound = false
        PoseLog.info(LogCategory.CAMERA) { "session stopped" }
    }

    fun resume(onFailed: (ErrorCode, Throwable?) -> Unit) {
        if (isBound) return
        val owner = lifecycleOwner ?: return

        // A pause that landed while the provider was still being fetched cancelled that start and
        // left `provider` null, so there is nothing to rebind to. Re-issuing the start is what
        // makes pause-then-resume during startup recoverable instead of permanently dead.
        if (provider == null) {
            start(owner, facing, onBound ?: {}, onFailed)
            return
        }
        try {
            bind(facing)
            onBound?.invoke()
        } catch (error: Throwable) {
            onFailed(ErrorCode.CAMERA_START_FAILED, error)
        }
    }

    fun release() {
        startToken++
        analysis?.clearAnalyzer()
        provider?.unbindAll()
        analysis = null
        analyzer = null
        provider = null
        lifecycleOwner = null
        onBound = null
        isBound = false
    }

    private fun bind(target: Facing) {
        val provider = this.provider ?: throw IllegalStateException("no camera provider")
        val owner = this.lifecycleOwner ?: throw IllegalStateException("no lifecycle owner")

        val lens = resolveAvailable(provider, target)
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

        provider.unbindAll()
        provider.bindToLifecycle(owner, selectorFor(lens), preview, analysis)
        preview.surfaceProvider = previewView.surfaceProvider

        this.analysis = analysis
        this.facing = lens
        this.isBound = true

        PoseLog.info(LogCategory.CAMERA) {
            "bound $lens preview=${previewSize.width}x${previewSize.height} " +
                "analysis=${analysisSize.width}x${analysisSize.height} rotation=$rotation"
        }
    }

    /** Binding a lens the device lacks throws and leaves a dead preview, so resolve first. */
    private fun resolveAvailable(
        provider: ProcessCameraProvider,
        target: Facing,
    ): Facing {
        if (!facingFallbackAllowed || hasCamera(provider, target)) return target
        val fallback = if (target == Facing.FRONT) Facing.BACK else Facing.FRONT
        if (!hasCamera(provider, fallback)) return target
        PoseLog.info(LogCategory.CAMERA) { "no $target camera on this device, using $fallback" }
        return fallback
    }

    // hasCamera throws CameraInfoUnavailableException, which is the same answer as false here.
    private fun hasCamera(
        provider: ProcessCameraProvider,
        target: Facing,
    ): Boolean = runCatching { provider.hasCamera(selectorFor(target)) }.getOrDefault(false)

    private fun selectorFor(target: Facing): CameraSelector =
        CameraSelector
            .Builder()
            .requireLensFacing(
                if (target == Facing.FRONT) CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK,
            ).build()

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
