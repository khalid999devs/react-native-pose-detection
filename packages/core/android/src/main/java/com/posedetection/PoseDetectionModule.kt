package com.posedetection

import android.graphics.Color
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseDetectionModule : Module() {
    override fun definition() =
        ModuleDefinition {
            Name("PoseDetection")

            Function("setLogLevel") { config: Any? ->
                when (config) {
                    is String -> PoseLog.setLevel(LogLevel.from(config))
                    is Map<*, *> ->
                        PoseLog.setLevels(
                            config.entries
                                .mapNotNull { (key, value) ->
                                    val category = LogCategory.from(key as? String) ?: return@mapNotNull null
                                    category to LogLevel.from(value as? String)
                                }.toMap(),
                        )
                    else -> PoseLog.setLevel(LogLevel.OFF)
                }
            }

            // The ring buffer and the batched flush to JavaScript arrive in Phase 4. Until then entries
            // go to Logcat, and these exist so the JS contract is already satisfied.
            Function("startLogStream") {}
            Function("stopLogStream") {}

            View(PoseCameraView::class) {
                Events("onReady", "onError", "onCameraChange")

                Prop("facing") { view: PoseCameraView, value: String? ->
                    view.setFacing(value ?: "auto")
                }
                Prop("delegate") { view: PoseCameraView, value: String? ->
                    view.setDelegate(value ?: "auto")
                }
                Prop("active") { view: PoseCameraView, value: Boolean? ->
                    view.setActive(value ?: true)
                }
                Prop("detection") { view: PoseCameraView, value: Boolean? ->
                    view.setDetection(value ?: true)
                }
                Prop("maxPoses") { view: PoseCameraView, value: Int? ->
                    view.setMaxPoses(value ?: 1)
                }
                Prop("resolution") { view: PoseCameraView, value: String? ->
                    view.setResolution(value ?: "auto")
                }
                Prop("analysisResolution") { view: PoseCameraView, value: String? ->
                    view.setAnalysisResolution(value ?: "auto")
                }
                Prop("overlay") { view: PoseCameraView, value: Any? ->
                    when (value) {
                        null, true -> view.setOverlay(true, OverlayConfig())
                        false -> view.setOverlay(false, OverlayConfig())
                        is Map<*, *> -> view.setOverlay(true, parseOverlay(value))
                        else -> view.setOverlay(true, OverlayConfig())
                    }
                }

                OnViewDidUpdateProps { view: PoseCameraView ->
                    view.onPropsUpdated()
                }

                OnViewDestroys { view: PoseCameraView ->
                    view.releaseEverything()
                }

                // Every one of these touches the capture session, which CameraX requires on the main
                // thread. That is also the serial queue all session state lives on, see CameraSource.
                AsyncFunction("switchCamera") { view: PoseCameraView, promise: expo.modules.kotlin.Promise ->
                    view.switchCamera(
                        onDone = { promise.resolve(null) },
                        onFailed = { message -> promise.reject("CAMERA_SWITCH_FAILED", message, null) },
                    )
                }.runOnQueue(Queues.MAIN)

                AsyncFunction(
                    "setFacing",
                ) { view: PoseCameraView, facing: String, promise: expo.modules.kotlin.Promise ->
                    val target = if (facing == "back") Facing.BACK else Facing.FRONT
                    view.setFacingInternal(
                        target = target,
                        onDone = { promise.resolve(null) },
                        onFailed = { message -> promise.reject("CAMERA_SWITCH_FAILED", message, null) },
                    )
                }.runOnQueue(Queues.MAIN)

                AsyncFunction("pause") { view: PoseCameraView -> view.pauseCamera() }.runOnQueue(Queues.MAIN)
                AsyncFunction("resume") { view: PoseCameraView -> view.resumeCamera() }.runOnQueue(Queues.MAIN)

                AsyncFunction("startDetection") { view: PoseCameraView ->
                    view.startDetection()
                }.runOnQueue(Queues.MAIN)

                AsyncFunction("stopDetection") { view: PoseCameraView ->
                    view.stopDetection()
                }.runOnQueue(Queues.MAIN)

                AsyncFunction("setOverlayEnabled") { view: PoseCameraView, enabled: Boolean ->
                    view.setOverlayEnabled(enabled)
                }.runOnQueue(Queues.MAIN)

                AsyncFunction("getState") { view: PoseCameraView ->
                    view.currentState()
                }.runOnQueue(Queues.MAIN)
            }
        }
}

private fun parseOverlay(raw: Map<*, *>): OverlayConfig {
    val config = OverlayConfig()

    (raw["landmarks"] as? Boolean)?.let { config.landmarks = it }
    (raw["connections"] as? Boolean)?.let { config.connections = it }
    (raw["lineWidth"] as? Number)?.let { config.lineWidthDp = it.toFloat() }
    (raw["pointRadius"] as? Number)?.let { config.pointRadiusDp = it.toFloat() }
    (raw["minVisibility"] as? Number)?.let { config.minVisibility = it.toFloat() }
    parseColor(raw["color"])?.let { config.color = it }

    (raw["only"] as? List<*>)?.let { names ->
        val mask = BooleanArray(Skeleton.LANDMARK_COUNT)
        for (name in names) {
            val index = Skeleton.indexOf(name as? String ?: continue)
            if (index >= 0) mask[index] = true
        }
        config.only = mask
    }

    (raw["angles"] as? List<*>)?.let { specs ->
        config.angles = specs.mapNotNull { entry -> parseAngle(entry as? Map<*, *> ?: return@mapNotNull null) }
    }

    return config
}

private fun parseAngle(raw: Map<*, *>): AngleOverlaySpec? {
    val joint = raw["joint"] as? String ?: return null
    // JS validation rejects a non-angle joint before it reaches here, so a miss means a config
    // built dynamically and skipped that check. Skipping the arc beats drawing a wrong one.
    val triple =
        Skeleton.angleTriple(joint) ?: run {
            PoseLog.warn(LogCategory.OVERLAY) { "$joint has no angle, skipping its arc" }
            return null
        }

    return AngleOverlaySpec(
        joint = joint,
        triple = triple,
        label = raw["label"] as? Boolean ?: true,
        radiusDp = (raw["radius"] as? Number)?.toFloat() ?: 40f,
        color = parseColor(raw["color"]),
        decimals = (raw["decimals"] as? Number)?.toInt() ?: 0,
        minVisibility = (raw["minVisibility"] as? Number)?.toFloat() ?: 0.5f,
    )
}

private fun parseColor(value: Any?): Int? {
    val text = value as? String ?: return null
    return try {
        Color.parseColor(text)
    } catch (error: IllegalArgumentException) {
        PoseLog.warn(LogCategory.OVERLAY) { "could not parse the color \"$text\": ${error.message}" }
        null
    }
}
