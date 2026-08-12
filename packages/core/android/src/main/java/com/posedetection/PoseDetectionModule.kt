package com.posedetection

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseDetectionModule : Module() {
    private fun hasCameraPermission(): Boolean {
        val context = appContext.reactContext ?: return false
        return ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
    }

    override fun definition() =
        ModuleDefinition {
            Name("PoseDetection")

            Function("setLogLevel") { config: Any? ->
                when (config) {
                    is String -> {
                        PoseLog.setLevel(LogLevel.from(config))
                    }

                    is Map<*, *> -> {
                        PoseLog.setLevels(
                            config.entries
                                .mapNotNull { (key, value) ->
                                    val category = LogCategory.from(key as? String) ?: return@mapNotNull null
                                    category to LogLevel.from(value as? String)
                                }.toMap(),
                        )
                    }

                    else -> {
                        PoseLog.setLevel(LogLevel.OFF)
                    }
                }
            }

            // The ring buffer and the batched flush to JavaScript arrive with the log channel.
            // Until then entries go to Logcat, and these exist so the JS contract is satisfied.
            Function("startLogStream") {}
            Function("stopLogStream") {}

            AsyncFunction("getCameraPermission") { promise: expo.modules.kotlin.Promise ->
                val permissions = appContext.permissions
                if (permissions == null) {
                    // Readable without a manager, which is what makes this the useful fallback:
                    // an app can still find out where it stands, it just cannot ask from here.
                    // Without the manager only "granted or not" is knowable, and reporting a
                    // refusal as UNDETERMINED is the honest half of that: it says "ask to find out".
                    val status =
                        if (hasCameraPermission()) PermissionsStatus.GRANTED else PermissionsStatus.UNDETERMINED
                    promise.resolve(permissionResult(status, canAskAgain = true))
                    return@AsyncFunction
                }
                permissions.getPermissions(
                    { result -> promise.resolve(toPermissionResult(result)) },
                    Manifest.permission.CAMERA,
                )
            }

            AsyncFunction("requestCameraPermission") { promise: expo.modules.kotlin.Promise ->
                val permissions = appContext.permissions
                if (permissions == null) {
                    promise.reject(
                        "PERMISSIONS_UNAVAILABLE",
                        "No permissions manager is registered. Expo modules are not fully installed " +
                            "in this app, see the installation guide.",
                        null,
                    )
                    return@AsyncFunction
                }
                permissions.askForPermissions(
                    { result -> promise.resolve(toPermissionResult(result)) },
                    Manifest.permission.CAMERA,
                )
            }

            View(PoseCameraView::class) {
                Events("onReady", "onError", "onCameraChange", "onFrames")

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
                // `Any?` and a cast, like `overlay`: a star-projected Map has no registered type
                // converter, and that failure would only show up on a device.
                Prop("data") { view: PoseCameraView, value: Any? ->
                    view.setData(parseData(value as? Map<*, *>))
                }
                // Resolved by JavaScript, in ANGLE_JOINT_NAMES order. Re-deriving the set here
                // would be a second implementation of one rule, and a way for them to disagree.
                Prop("angleJoints") { view: PoseCameraView, value: List<String>? ->
                    view.setAngleJoints(value?.toTypedArray() ?: emptyArray())
                }
                Prop("selection") { view: PoseCameraView, value: List<String>? ->
                    view.setSelection(value?.let(::parseSelection))
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

                // Deliberately not on the main queue. These copy out of a lock the inference thread
                // also takes, and the whole point of draining is that it does not block the UI.
                AsyncFunction("drainFrames") { view: PoseCameraView -> view.drainFrames() }
                AsyncFunction("snapshotFrame") { view: PoseCameraView -> view.snapshotFrame() }
                AsyncFunction("takeTriggerSnapshot") { view: PoseCameraView, snapshotId: Int ->
                    view.takeTriggerSnapshot(snapshotId)
                }
            }
        }
}

private const val DEFAULT_THROTTLE_MS = 100L
private const val DEFAULT_FLUSH_MS = 500L

/** `data.angles` and `data.select` are not read here: they arrive resolved, as their own props. */
private fun parseData(raw: Map<*, *>?): DataSettings {
    if (raw == null) {
        return DataSettings(DataMode.OFF, DEFAULT_THROTTLE_MS, DEFAULT_FLUSH_MS, true, false)
    }
    return DataSettings(
        mode = DataMode.from(raw["mode"] as? String),
        // A zero or negative interval would emit on every frame under a name that promises not to.
        throttleMs = (raw["throttleMs"] as? Number)?.toLong()?.coerceAtLeast(1L) ?: DEFAULT_THROTTLE_MS,
        flushMs = (raw["flushMs"] as? Number)?.toLong()?.coerceAtLeast(1L) ?: DEFAULT_FLUSH_MS,
        landmarks = raw["landmarks"] as? Boolean ?: true,
        worldLandmarks = raw["worldLandmarks"] as? Boolean ?: false,
    )
}

/** In the order named, which is the order `PoseFrame.selection` promises. Unknown names drop out. */
private fun parseSelection(names: List<String>): IntArray {
    val indices = IntArray(names.size)
    var count = 0
    for (name in names) {
        val index = Skeleton.indexOf(name)
        if (index >= 0) {
            indices[count] = index
            count += 1
        } else {
            PoseLog.warn(LogCategory.DETECTOR) { "data.select named $name, which is not a joint" }
        }
    }
    return if (count == names.size) indices else indices.copyOf(count)
}

private fun parseOverlay(raw: Map<*, *>): OverlayConfig {
    val config = OverlayConfig()

    (raw["landmarks"] as? Boolean)?.let { config.landmarks = it }
    (raw["connections"] as? Boolean)?.let { config.connections = it }
    // Clamped here rather than trusted: these come from a JavaScript object that may have been
    // built dynamically and skipped validation, and a negative stroke or radius draws nothing.
    (raw["lineWidth"] as? Number)?.let { config.lineWidthDp = it.clamped(0f, Float.MAX_VALUE, 3f) }
    (raw["pointRadius"] as? Number)?.let { config.pointRadiusDp = it.clamped(0f, Float.MAX_VALUE, 4f) }
    (raw["minVisibility"] as? Number)?.let { config.minVisibility = it.clamped(0f, 1f, 0.5f) }
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
        radiusDp = (raw["radius"] as? Number)?.clamped(1f, Float.MAX_VALUE, 40f) ?: 40f,
        color = parseColor(raw["color"]),
        // Capped because the label goes into a fixed 16 char buffer: a large value would build a
        // long string on the draw path every frame only to have it truncated on the way in.
        decimals = ((raw["decimals"] as? Number)?.toInt() ?: 0).coerceIn(0, MAX_LABEL_DECIMALS),
        minVisibility = (raw["minVisibility"] as? Number)?.clamped(0f, 1f, 0.5f) ?: 0.5f,
    )
}

private const val MAX_LABEL_DECIMALS = 3

/** NaN survives `coerceIn`, and a NaN `minVisibility` disables the gate instead of clamping it. */
private fun Number.clamped(
    min: Float,
    max: Float,
    fallback: Float,
): Float {
    val value = toFloat()
    return if (value.isNaN()) fallback else value.coerceIn(min, max)
}

/**
 * `canAskAgain` is the field that matters. Without it an app cannot tell a refusal it may ask
 * about again from one the system will never prompt for, and it shows a button that does nothing.
 */
private fun permissionResult(
    status: PermissionsStatus,
    canAskAgain: Boolean,
): Map<String, Any?> =
    mapOf(
        "status" to status.status,
        "canAskAgain" to canAskAgain,
    )

private fun toPermissionResult(result: Map<String, PermissionsResponse>): Map<String, Any?> {
    val response = result[Manifest.permission.CAMERA] ?: return permissionResult(PermissionsStatus.UNDETERMINED, true)
    return permissionResult(response.status, response.canAskAgain)
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
