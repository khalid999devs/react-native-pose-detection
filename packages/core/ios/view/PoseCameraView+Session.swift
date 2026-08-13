import AVFoundation
import ExpoModulesCore
import MediaPipeTasksVision
import UIKit

/// Bringing the camera and the detector up and down, and keeping the two in step.
extension PoseCameraView {
  func startSession() {
    guard !started else { return }

    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      emitError(.permissionDenied, "Camera permission has not been granted.")
      return
    }

    guard let model = modelPath ?? PoseDetector.findModelPath() else {
      emitError(
        .modelNotFound,
        "No pose_landmarker_*.task in the app bundle. Run `npx expo prebuild`, "
          + "or `npx react-native-pose-detection fetch-model full` for bare React Native."
      )
      return
    }
    modelPath = model

    started = true
    camera.setAnalyzerEnabled(true)
    camera.start(
      facing: resolveFacing(),
      onBound: { [weak self] in
        guard let self = self else { return }
        self.syncOverlayMirroring()
        self.applyDetectionState()
        self.emitReadyOnce()
      },
      onFailed: { [weak self] code, error in
        self?.emitError(code, error)
      }
    )
  }

  func stopSession() {
    guard started else { return }
    camera.setAnalyzerEnabled(false)
    camera.pause()
    releaseDetector()
    overlayView.clearPose()
    completeSwitch()
    started = false
    readySent = false
  }

  func restartSession() {
    stopSession()
    startSession()
  }

  func restartSessionIfGeometryChanged() {
    let current = resolved.value
    let preview = CameraSource.previewSize(for: current.preview)
    let analysis = CameraSource.analysisSize(for: current.analysis, preview: preview)
    guard preview != camera.previewSize || analysis != camera.analysisSize else { return }

    camera.previewSize = preview
    camera.analysisSize = analysis
    if started { restartSession() }
  }

  /// `detection = false` tears the landmarker down so its GPU memory is actually returned.
  func applyDetectionState() {
    guard propDetection else {
      releaseDetector()
      overlayView.clearPose()
      // Nothing else will emit ready once the pending build is discarded, and a camera that is
      // running with detection off is still a camera that came up.
      emitReadyOnce()
      return
    }

    // maxPoses and the delegate are baked into the landmarker at construction, so a change to
    // either has to rebuild it rather than wait for the next unrelated restart to notice.
    let request = delegateRequest()
    let live = detector.value != nil || detectorPending
    if live && (request != detectorRequest || propMaxPoses != detectorMaxPoses) {
      PoseLog.info(.detector, "delegate or maxPoses changed, rebuilding")
      releaseDetector()
    }
    ensureDetector()
  }

  func delegateRequest() -> DelegateRequest {
    switch propDelegate {
    case "gpu": return .gpu
    case "cpu": return .cpu
    default: return .auto
    }
  }

  /**
   Runs on the analysis queue. The heavy model takes seconds to build and `auto` runs a probe
   inference first, which on main is a watchdog kill on every foreground.
   */
  func ensureDetector() {
    guard detector.value == nil, !detectorPending, let model = modelPath else { return }

    let request = delegateRequest()
    let maxPoses = propMaxPoses
    let generation = detectorGeneration
    detectorPending = true
    detectorRequest = request
    detectorMaxPoses = maxPoses

    analysisQueue.async { [weak self] in
      guard let self = self else { return }
      do {
        let created = try PoseDetector.create(
          modelPath: model,
          request: request,
          maxPoses: maxPoses,
          minConfidence: PoseCameraView.minConfidence
        )
        DispatchQueue.main.async { self.adoptDetector(created, request: request, generation: generation) }
      } catch {
        PoseLog.error(.detector, "landmarker init failed: \(error.localizedDescription)")
        DispatchQueue.main.async { self.failDetector(error, generation: generation) }
      }
    }
  }

  private func adoptDetector(_ created: PoseDetector, request: DelegateRequest, generation: Int) {
    guard generation == detectorGeneration else {
      // A teardown landed while this was still building, so it is dropped instead of installed.
      created.shutdown()
      return
    }
    detectorPending = false
    created.observer = self
    detector.value = created
    resolvedDelegate = created.delegateKind == .GPU ? "GPU" : "CPU"

    calibrator.start(modelFileName: created.modelFileName)
    applyPerformance(reason: nil)
    preWarm(created)

    // The one path that actually downgrades is 'auto'. An explicit 'gpu' is pinned and never falls
    // back, so comparing the resolved delegate against the request is the whole test.
    if request != .cpu && created.delegateKind == .CPU {
      emitError(.gpuUnavailable, "The GPU delegate is unavailable, running on CPU.")
    }
    emitReadyOnce()
  }

  /**
   One inference on a blank frame, on the analysis queue, before the user's first real one. The
   first inference through a freshly built graph is several times slower than the rest, and without
   this the frame that pays for that is the one somebody is watching.
   */
  private func preWarm(_ created: PoseDetector) {
    analysisQueue.async {
      autoreleasepool {
        do {
          let size = CGSize(width: PoseCameraView.preWarmSize, height: PoseCameraView.preWarmSize)
          let blank = UIGraphicsImageRenderer(size: size).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))
          }
          try created.detect(image: try MPImage(uiImage: blank), cameraTimestampMs: 0)
        } catch {
          PoseLog.debug(.detector, "pre-warm did not run: \(error.localizedDescription)")
        }
      }
    }
  }

  private func failDetector(_ error: Error, generation: Int) {
    guard generation == detectorGeneration else { return }
    detectorPending = false
    // The build that would have set it failed, so keeping the previous value would report a
    // delegate that nothing is running on.
    resolvedDelegate = nil
    emitError(.detectorInitFailed, error.localizedDescription)
    emitReadyOnce()
  }

  /**
   The analysis queue may be inside `detectAsync` right now, so the observer is cleared on main,
   stopping the next result, and the reference is dropped behind the frame already running.
   */
  func releaseDetector() {
    detectorGeneration += 1
    detectorPending = false
    detectorRequest = nil
    guard let doomed = detector.value else { return }
    doomed.shutdown()
    detector.value = nil
    // Released on the queue that hands it frames, so the deallocation cannot overlap a detect call.
    analysisQueue.async { _ = doomed }
  }

  func syncOverlayMirroring() {
    overlayView.setMirrored(camera.facing == .front)
  }

  func onCalibrationMoved() {
    applyPerformance(reason: "calibration")
    if let model = modelPath {
      calibrator.persist(modelFileName: PoseDetector.fileName(from: model))
    }
  }
}
