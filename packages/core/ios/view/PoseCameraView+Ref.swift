import ExpoModulesCore
import UIKit

/// The imperative surface behind the ref, and every event this view sends.
extension PoseCameraView {
  func switchCamera(onDone: @escaping (String) -> Void, onFailed: @escaping (String) -> Void) {
    setFacingInternal(camera.facing.opposite, onDone: onDone, onFailed: onFailed)
  }

  func setFacingInternal(
    _ target: Facing,
    onDone: ((String) -> Void)?,
    onFailed: ((String) -> Void)? = nil
  ) {
    camera.switchTo(
      target,
      onDone: { [weak self] facing in
        guard let self = self else { return }
        // Everything from before this point belongs to the old camera. Frames already on the
        // analysis queue can still be stamped after this read, which costs at most a frame or two
        // drawn with the new mirroring.
        self.staleBefore.value = (self.detector.value?.lastTimestampMs ?? 0) + 1
        self.previousFrameMs.value = 0
        self.syncOverlayMirroring()

        // Anything still waiting from an earlier switch is settled first, so no promise is left
        // dangling when two switches overlap.
        self.completeSwitch()
        let name = facing.nameForJs
        // Weakly, because this closure is stored on the view: capturing strongly would keep the
        // view alive through its own property until the switch settles.
        self.pendingSwitchDone = { [weak self] in
          self?.onCameraChange(["facing": name])
          onDone?(name)
        }
        // A rebind is not a frame. Reporting the switch waits for the new camera to deliver one,
        // with a timeout so a camera that never does still settles the promise.
        self.awaitingFirstFrame.value = true
        self.switchTimer?.invalidate()
        self.switchTimer = Timer.scheduledTimer(
          withTimeInterval: PoseCameraView.switchFrameTimeoutSeconds,
          repeats: false
        ) { [weak self] _ in
          self?.completeSwitch()
        }
      },
      onFailed: { [weak self] code, error in
        let message = error?.localizedDescription ?? "The camera could not be switched."
        self?.emitError(code, message)
        onFailed?(message)
      }
    )
  }

  /// Main thread only. Idempotent, so the frame path and the timeout can both call it.
  func completeSwitch() {
    awaitingFirstFrame.value = false
    switchTimer?.invalidate()
    switchTimer = nil
    guard let done = pendingSwitchDone else { return }
    pendingSwitchDone = nil
    done()
  }

  func pauseCamera() {
    camera.setAnalyzerEnabled(false)
    camera.pause()
    overlayView.clearPose()
  }

  func resumeCamera() {
    camera.setAnalyzerEnabled(true)
    camera.resume { [weak self] code, error in
      self?.emitError(code, error)
    }
    syncOverlayMirroring()
  }

  func startDetection() {
    propDetection = true
    applyDetectionState()
  }

  func stopDetection() {
    propDetection = false
    applyDetectionState()
  }

  func setOverlayEnabled(_ enabled: Bool) {
    overlayEnabled = enabled
    overlayView.isHidden = !enabled
  }

  /// Setting one explicitly is a decision, so it takes effect now rather than at the next render.
  func applyProfile(_ profile: Profile) {
    propProfile = profile
    if profile != .auto { calibrator.reset() }
    applyPerformance(reason: "calibration")
    restartSessionIfGeometryChanged()
  }

  func drainFrames() -> NativeArrayBuffer {
    return NativeArrayBuffer.wrap(dataWithoutCopy: frames.drain())
  }

  func snapshotFrame() -> NativeArrayBuffer {
    return NativeArrayBuffer.wrap(dataWithoutCopy: frames.snapshot())
  }

  /// An unknown or spent ticket is an empty buffer, which is the documented contract.
  func takeTriggerSnapshot(_ snapshotId: Int) -> NativeArrayBuffer {
    return NativeArrayBuffer.wrap(dataWithoutCopy: frames.takeSnapshot(snapshotId))
  }

  func currentState() -> [String: Any] {
    return [
      "facing": camera.facing.nameForJs,
      "active": camera.isBound,
      "detecting": detector.value != nil || detectorPending,
      "fps": measuredFps.value,
      "delegate": resolvedDelegate ?? "CPU",
      "deviceTier": calibrator.tier.rawValue
    ]
  }

  /// The profile as `getProfile()` reports it.
  func profileState() -> [String: Any] {
    let current = resolved.value
    return [
      "profile": propProfile.rawValue,
      "phase": calibrator.phase.rawValue,
      "source": calibrator.source.rawValue,
      "tier": calibrator.tier.rawValue,
      "resolved": [
        "delegate": resolvedDelegate ?? "CPU",
        "targetFps": current.targetFps,
        "preview": current.preview,
        "analysis": current.analysis
      ],
      "p50InferenceMs": calibrator.p50InferenceMs
    ]
  }

  // MARK: - Events

  func emitReadyOnce() {
    guard !readySent, camera.isBound else { return }
    // onReady reports the delegate that is actually in use, and that is not known until the
    // landmarker has finished building, so a pending build holds the event back.
    guard !detectorPending else { return }
    readySent = true

    let variant = modelPath
      .map { PoseDetector.fileName(from: $0) }
      .map { $0.replacingOccurrences(of: "pose_landmarker_", with: "").replacingOccurrences(of: ".task", with: "") }
      ?? "full"

    onReady([
      "model": variant,
      "delegate": resolvedDelegate ?? "CPU",
      "delegateRequested": propDelegate,
      "targetFps": resolved.value.targetFps,
      "deviceTier": calibrator.tier.rawValue,
      "resolution": camera.previewSize.forJs,
      "analysisResolution": camera.analysisSize.forJs,
      "facing": camera.facing.nameForJs
    ])
  }

  func emitPerformanceChange(reason: String) {
    let current = resolved.value
    onPerformanceChange([
      "reason": reason,
      "delegate": resolvedDelegate ?? "CPU",
      "targetFps": current.targetFps,
      "analysisResolution": CameraSource
        .analysisSize(for: current.analysis, preview: CameraSource.previewSize(for: current.preview))
        .forJs,
      "actualFps": measuredFps.value
    ])
  }

  func emitError(_ code: ErrorCode, _ message: String) {
    PoseLog.error(.camera, "\(code.rawValue): \(message)")
    onError(["code": code.rawValue, "message": message, "fatal": code.fatal])
  }

  func emitError(_ code: ErrorCode, _ error: Error?) {
    emitError(code, error?.localizedDescription ?? code.rawValue)
  }
}

extension CaptureSize {
  var forJs: [String: Any] {
    return ["width": width, "height": height]
  }
}
