import AVFoundation
import ExpoModulesCore

public class PoseDetectionModule: Module {
  // The two functions below are declarations rather than logic: every line names one prop, one
  // function or one event, and splitting them further would only scatter the surface this module
  // exports across several places to satisfy a line count.
  // swiftlint:disable:next function_body_length
  public func definition() -> ModuleDefinition {
    Name("PoseDetection")

    Function("setLogLevel") { (config: Either<String, [String: String]>?) in
      applyLogLevel(unwrap(config))
    }

    // The buffer is global because the level mask is. A view runs the flush, see PoseLog.
    Function("startLogStream") { PoseLog.startStream() }
    Function("stopLogStream") { PoseLog.stopStream() }

    Events("onVideoProgress")

    AsyncFunction("detectOnImage") { (uri: String, options: [String: Any]?, promise: Promise) in
      do {
        let buffer = try StaticDetection.detectImage(
          uri: uri,
          options: StaticOptions.forImage(options),
          angleJoints: angleJoints(from: options),
          selection: selection(from: options)
        )
        promise.resolve(NativeArrayBuffer.wrap(dataWithoutCopy: buffer))
      } catch {
        promise.reject("DETECTION_FAILED", error.localizedDescription)
      }
    }

    AsyncFunction("detectOnVideo") { (uri: String, options: [String: Any]?, taskId: Int, promise: Promise) in
      do {
        let buffer = try StaticDetection.detectVideo(
          uri: uri,
          options: StaticOptions.forVideo(options),
          angleJoints: angleJoints(from: options),
          selection: selection(from: options),
          taskId: taskId,
          onProgress: { [weak self] progress in
            self?.sendEvent("onVideoProgress", ["taskId": taskId, "progress": progress])
          }
        )
        promise.resolve(NativeArrayBuffer.wrap(dataWithoutCopy: buffer))
      } catch {
        promise.reject("DETECTION_FAILED", error.localizedDescription)
      }
    }

    Function("cancelDetectOnVideo") { (taskId: Int) in
      StaticDetection.cancel(taskId: taskId)
    }

    AsyncFunction("getCameraPermission") { () -> [String: Any] in
      return currentCameraPermission()
    }

    AsyncFunction("requestCameraPermission") { (promise: Promise) in
      let status = AVCaptureDevice.authorizationStatus(for: .video)
      // Only `notDetermined` can produce a dialog. Asking again in any other state resolves
      // immediately with what is already true, which is what the JavaScript side documents.
      guard status == .notDetermined else {
        promise.resolve(permissionResult(status))
        return
      }
      AVCaptureDevice.requestAccess(for: .video) { _ in
        promise.resolve(permissionResult(AVCaptureDevice.authorizationStatus(for: .video)))
      }
    }

    cameraView()
  }
}

extension PoseDetectionModule {
  // Extracted from `definition()` so each half stays readable; the DSL composes either way, and
  // like `definition()` this is a list of declarations rather than a long function.
  // swiftlint:disable:next function_body_length
  fileprivate func cameraView() -> ViewDefinition<PoseCameraView> {
    return View(PoseCameraView.self) {
      Events(
        "onReady",
        "onError",
        "onCameraChange",
        "onFrames",
        "onTrigger",
        "onPerformanceChange",
        "onLog"
      )

      Prop("facing") { (view: PoseCameraView, value: String?) in view.setFacing(value ?? "auto") }
      Prop("delegate") { (view: PoseCameraView, value: String?) in view.setDelegate(value ?? "auto") }
      Prop("active") { (view: PoseCameraView, value: Bool?) in view.setActive(value ?? true) }
      Prop("detection") { (view: PoseCameraView, value: Bool?) in view.setDetection(value ?? true) }
      Prop("maxPoses") { (view: PoseCameraView, value: Int?) in view.setMaxPoses(value ?? 1) }
      Prop("resolution") { (view: PoseCameraView, value: String?) in view.setResolution(value ?? "auto") }
      Prop("analysisResolution") { (view: PoseCameraView, value: String?) in
        view.setAnalysisResolution(value ?? "auto")
      }
      Prop("data") { (view: PoseCameraView, value: [String: Any]?) in view.setData(parseData(value)) }

      // Resolved by JavaScript, in ANGLE_JOINT_NAMES order. Re-deriving the set here would be a
      // second implementation of one rule, and a way for them to disagree.
      Prop("angleJoints") { (view: PoseCameraView, value: [String]?) in view.setAngleJoints(value ?? []) }
      Prop("selection") { (view: PoseCameraView, value: [String]?) in
        view.setSelection(value.map(parseSelection))
      }
      Prop("profile") { (view: PoseCameraView, value: String?) in view.setProfile(Profile.from(value)) }
      Prop("targetFps") { (view: PoseCameraView, value: Int?) in view.setTargetFps(value) }
      Prop("thermalPolicy") { (view: PoseCameraView, value: String?) in
        view.setThermalPolicy(ThermalPolicy.from(value))
      }

      Prop("smoothing") { (view: PoseCameraView, value: Either<Bool, [String: Any]>?) in
        applySmoothing(view, unwrap(value))
      }

      // The level is global, and the prop is a convenience for setting it per camera.
      Prop("logLevel") { (_: PoseCameraView, value: Either<String, [String: String]>?) in
        applyLogLevel(unwrap(value))
      }

      Prop("triggers") { (view: PoseCameraView, value: [[String: Any]]?) in
        view.setTriggers(parseTriggers(value?.map { $0 as Any }))
      }

      Prop("overlay") { (view: PoseCameraView, value: Either<Bool, [String: Any]>?) in
        applyOverlay(view, unwrap(value))
      }

      OnViewDidUpdateProps { (view: PoseCameraView) in
        view.onPropsUpdated()
      }

      // Every one of these runs on the main queue: ExpoModulesCore puts view functions there, and
      // unlike Android there is no way to opt a drain out of it. A drain is a memcpy under a lock
      // the inference thread also takes, so it is short, but it is on the UI thread.
      AsyncFunction("switchCamera") { (view: PoseCameraView, promise: Promise) in
        view.switchCamera(
          onDone: { _ in promise.resolve(nil) },
          onFailed: { message in promise.reject("CAMERA_SWITCH_FAILED", message) }
        )
      }

      AsyncFunction("setFacing") { (view: PoseCameraView, facing: String, promise: Promise) in
        view.setFacingInternal(
          facing == "back" ? .back : .front,
          onDone: { _ in promise.resolve(nil) },
          onFailed: { message in promise.reject("CAMERA_SWITCH_FAILED", message) }
        )
      }

      AsyncFunction("pause") { (view: PoseCameraView) in view.pauseCamera() }
      AsyncFunction("resume") { (view: PoseCameraView) in view.resumeCamera() }
      AsyncFunction("startDetection") { (view: PoseCameraView) in view.startDetection() }
      AsyncFunction("stopDetection") { (view: PoseCameraView) in view.stopDetection() }
      AsyncFunction("setOverlayEnabled") { (view: PoseCameraView, enabled: Bool) in
        view.setOverlayEnabled(enabled)
      }
      AsyncFunction("getState") { (view: PoseCameraView) -> [String: Any] in view.currentState() }
      AsyncFunction("getProfile") { (view: PoseCameraView) -> [String: Any] in view.profileState() }
      AsyncFunction("setProfile") { (view: PoseCameraView, profile: String) in
        view.applyProfile(Profile.from(profile))
      }

      AsyncFunction("drainFrames") { (view: PoseCameraView) -> NativeArrayBuffer in view.drainFrames() }
      AsyncFunction("snapshotFrame") { (view: PoseCameraView) -> NativeArrayBuffer in view.snapshotFrame() }
      AsyncFunction("takeTriggerSnapshot") { (view: PoseCameraView, snapshotId: Int) -> NativeArrayBuffer in
        view.takeTriggerSnapshot(snapshotId)
      }
    }
  }
}

/// `Either.value` is internal to ExpoModulesCore, so the typed getters are the way in from out
/// here. Asked in declaration order because an `NSNumber` bridges to `Bool` and a dictionary never
/// does: reversing it would read `smoothing: true` as a config object.
private func unwrap(_ either: Either<String, [String: String]>?) -> Any? {
  guard let either else { return nil }
  if let name: String = either.get() { return name }
  if let map: [String: String] = either.get() { return map }
  return nil
}

private func unwrap(_ either: Either<Bool, [String: Any]>?) -> Any? {
  guard let either else { return nil }
  if let flag: Bool = either.get() { return flag }
  if let map: [String: Any] = either.get() { return map }
  return nil
}

/// Resolved by JavaScript for the live path, and passed the same way here.
func angleJoints(from options: [String: Any]?) -> [String] {
  guard let names = JS.strings(options?["angleJoints"]) else { return Skeleton.angleJointNames }
  return names
}

func selection(from options: [String: Any]?) -> [Int]? {
  guard let names = JS.strings(options?["select"]) else { return nil }
  return parseSelection(names)
}

func applyLogLevel(_ config: Any?) {
  if let name = JS.string(config) {
    PoseLog.setLevel(LogLevel.from(name))
    return
  }
  if let map = config as? [String: String] {
    var levels = [LogCategory: LogLevel]()
    for (key, value) in map {
      guard let category = LogCategory.from(key) else { continue }
      levels[category] = LogLevel.from(value)
    }
    PoseLog.setLevels(levels)
    return
  }
  PoseLog.setLevel(.off)
}

func applySmoothing(_ view: PoseCameraView, _ value: Any?) {
  // Absent is on: the documented default is true, and an unset prop is not somebody asking for
  // raw landmarks.
  guard !JS.isNull(value) else {
    view.setSmoothing(enabled: true, minCutoff: OneEuroFilter.defaultMinCutoff, beta: OneEuroFilter.defaultBeta)
    return
  }
  if let enabled = JS.bool(value) {
    view.setSmoothing(
      enabled: enabled,
      minCutoff: OneEuroFilter.defaultMinCutoff,
      beta: OneEuroFilter.defaultBeta
    )
    return
  }
  guard let map = JS.dictionary(value) else {
    view.setSmoothing(enabled: false, minCutoff: OneEuroFilter.defaultMinCutoff, beta: OneEuroFilter.defaultBeta)
    return
  }
  view.setSmoothing(
    enabled: true,
    minCutoff: JS.number(map["minCutoff"]).map(Float.init) ?? OneEuroFilter.defaultMinCutoff,
    beta: JS.number(map["beta"]).map(Float.init) ?? OneEuroFilter.defaultBeta
  )
}

func applyOverlay(_ view: PoseCameraView, _ value: Any?) {
  guard !JS.isNull(value) else {
    view.setOverlay(enabled: true, config: OverlayConfig())
    return
  }
  if let enabled = JS.bool(value) {
    view.setOverlay(enabled: enabled, config: OverlayConfig())
    return
  }
  guard let map = JS.dictionary(value) else {
    view.setOverlay(enabled: true, config: OverlayConfig())
    return
  }
  view.setOverlay(enabled: true, config: parseOverlay(map))
}
