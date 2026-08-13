import ExpoModulesCore
import UIKit

/// The props, and what one batch of them does to the session.
extension PoseCameraView {
  func setFacing(_ value: String) { propFacing = value }
  func setDelegate(_ value: String) { propDelegate = value }
  func setActive(_ value: Bool) { propActive = value }

  func setDetection(_ value: Bool) { propDetection = value }
  func setMaxPoses(_ value: Int) { propMaxPoses = min(max(value, 1), 5) }
  func setResolution(_ value: String) { propPreview = value }
  func setAnalysisResolution(_ value: String) { propAnalysis = value }

  func setOverlay(enabled: Bool, config: OverlayConfig) {
    overlayEnabled = enabled
    pendingOverlayConfig = config
  }

  func setData(_ config: DataSettings) {
    propMode = config.mode
    propThrottleMs.value = config.throttleMs
    propFlushMs.value = config.flushMs
    propLandmarks = config.landmarks
    propWorldLandmarks = config.worldLandmarks
  }

  /// Already resolved and ordered by JavaScript. Reproducing that rule here would be a way to disagree.
  func setAngleJoints(_ joints: [String]) { propAngleJoints = joints }
  func setSelection(_ indices: [Int]?) { propSelection = indices }
  func setProfile(_ value: Profile) { propProfile = value }

  /// Nil is `auto`, which is the only value calibration is allowed to move.
  func setTargetFps(_ value: Int?) {
    propTargetFps = value.map { min(max($0, PoseCameraView.minTargetFps), PoseCameraView.maxTargetFps) }
  }

  func setThermalPolicy(_ value: ThermalPolicy) { propThermalPolicy = value }

  func setSmoothing(enabled: Bool, minCutoff: Float, beta: Float) {
    propSmoothing = enabled
    propMinCutoff = minCutoff
    propBeta = beta
  }

  func setTriggers(_ specs: [TriggerSpec]) {
    // Not deferred to `onPropsUpdated`: the engine carries counts across by id, so applying it
    // twice would be harmless but applying it late would evaluate one frame against the old set.
    triggers.setTriggers(specs)
  }

  /// Runs once per prop batch. Only a resolution change takes the rebind path.
  func onPropsUpdated() {
    overlayView.config = pendingOverlayConfig
    overlayView.isHidden = !overlayEnabled

    applyFrameLayout()
    smoothing.configure(minCutoff: propMinCutoff, beta: propBeta)
    applyPerformance(reason: nil)

    let current = resolved.value
    let preview = CameraSource.previewSize(for: current.preview)
    let analysis = CameraSource.analysisSize(for: current.analysis, preview: preview)
    let geometryChanged = preview != camera.previewSize || analysis != camera.analysisSize
    camera.previewSize = preview
    camera.analysisSize = analysis
    // Only 'auto' is documented to fall back to the other lens; a pinned one stays pinned.
    let pinnedFacing = propFacing == "front" || propFacing == "back"
    camera.facingFallbackAllowed = !pinnedFacing

    if !propActive {
      stopSession()
      return
    }
    if !started {
      startSession()
      return
    }
    if geometryChanged {
      restartSession()
      return
    }

    applyDetectionState()

    // 'auto' takes whatever the device could bind, the fallback lens included, and it is also what
    // `switchCamera()` leaves behind, so only a pinned facing is reconciled here.
    guard pinnedFacing else { return }
    let target = resolveFacing()
    guard target != camera.facing else { return }
    // Reconciling a prop is not the interactive switch, and a paused session has nothing to switch,
    // so the value is parked for the next bind instead of failing a switch nobody asked for.
    if camera.isBound {
      setFacingInternal(target, onDone: nil)
    } else {
      camera.setPendingFacing(target)
    }
  }

  func resolveFacing() -> Facing {
    return propFacing == "back" ? .back : .front
  }

  /**
   The layout is rebuilt on every props batch but only adopted when it differs: a re-render that
   changes nothing about `data` would otherwise clear frames that were waiting to be flushed.
   */
  func applyFrameLayout() {
    let indices = propLandmarks ? (propSelection ?? FrameShape.allJoints) : []
    let next = FrameShape(jointIndices: indices, worldLandmarks: propWorldLandmarks, angleJoints: propAngleJoints)

    if let current = frameLayout.value, current.sameAs(next) { return }

    frameLayout.value = next
    frames.setLayout(next)
  }

  /**
   Runs the precedence chain and adopts the result. `reason` is what `onPerformanceChange` reports;
   nil means this is a props update rather than something the engine decided, and fires no event.
   */
  func applyPerformance(reason: String?) {
    let next = PerformanceResolver.resolve(PerformanceRequest(
      profile: propProfile,
      tier: calibrator.tier,
      requestedFps: propTargetFps,
      requestedPreview: propPreview,
      requestedAnalysis: propAnalysis,
      thermal: thermalState.value,
      policy: propThermalPolicy
    ))

    let changed = next != resolved.value
    resolved.value = next
    guard let reason = reason, changed else { return }
    emitPerformanceChange(reason: reason)
  }
}
