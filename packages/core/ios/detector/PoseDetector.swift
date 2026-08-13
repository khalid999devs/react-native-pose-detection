import Foundation
import MediaPipeTasksVision
import UIKit

/// Everything `PoseLandmarkerOptions` needs, so building one takes a value rather than a list.
private struct LandmarkerSpec {
  let modelPath: String
  let delegateKind: Delegate
  let maxPoses: Int
  let minConfidence: Float
  let runningMode: RunningMode
}

enum DelegateRequest {
  case auto
  case gpu
  case cpu
}

/// What a live-stream result carries back, whichever thread MediaPipe delivers it on.
protocol PoseDetectorObserver: AnyObject {
  func poseDetector(_ detector: PoseDetector, didDetect result: PoseLandmarkerResult, timestampMs: Int)
  func poseDetector(_ detector: PoseDetector, didFail error: Error)
}

/**
 Sits between the landmarker and the detector, because `poseLandmarkerLiveStreamDelegate` is a
 weak reference and the detector cannot be built until its landmarker exists. The relay can, so it
 breaks the ordering problem without making the landmarker optional for the rest of the file.
 */
private final class LiveStreamRelay: NSObject, PoseLandmarkerLiveStreamDelegate {
  weak var detector: PoseDetector?

  func poseLandmarker(
    _ poseLandmarker: PoseLandmarker,
    didFinishDetection result: PoseLandmarkerResult?,
    timestampInMilliseconds: Int,
    error: Error?
  ) {
    detector?.handle(result: result, timestampMs: timestampInMilliseconds, error: error)
  }
}

/**
 The landmarker, and the bookkeeping around handing it frames.

 Unlike Android there is no separate error listener: the live-stream delegate carries the result
 and the error in one callback, so both arrive through `PoseDetectorObserver`.
 */
final class PoseDetector {
  /// A power of two so the cursor masks rather than divides.
  private static let dispatchSlots = 8
  private static let probeSize: CGFloat = 256

  /// MediaPipe's own default, and what one subject in a file is detected at.
  static let defaultStillConfidence: Float = 0.5
  /// Asking for more than one body needs a lower bar, or the model returns one however high it is.
  static let multiPoseStillConfidence: Float = 0.3

  /// The threshold `maxPoses` implies when the caller has not chosen one.
  static func stillConfidence(forMaxPoses maxPoses: Int) -> Float {
    return maxPoses > 1 ? multiPoseStillConfidence : defaultStillConfidence
  }

  private let landmarker: PoseLandmarker
  /// Held strongly here and weakly by the landmarker, which is what keeps it alive to be called.
  private let relay: LiveStreamRelay?
  let delegateKind: Delegate
  let modelFileName: String

  weak var observer: PoseDetectorObserver?

  /**
   Guards the two pieces of state the analysis queue writes and MediaPipe's callback queue reads.
   Swift has no `volatile`, and both are read once per frame, so one uncontended lock is cheaper
   than any of the alternatives that would be correct.
   */
  private let lock = NSLock()

  /**
   LIVE_STREAM rejects a timestamp that does not strictly increase, and one rejection takes the
   stream down. Camera timestamps can repeat within a millisecond, so the value is clamped.
   */
  private var lastTimestamp = 0

  /**
   When each in-flight timestamp was handed to MediaPipe, so a result can report what it cost.
   `detectAsync` returns before the result arrives, so more than one frame is in flight and a
   single "last dispatch" field would time the wrong one.
   */
  private var dispatchTimestamps = [Int](repeating: 0, count: dispatchSlots)
  private var dispatchNanos = [UInt64](repeating: 0, count: dispatchSlots)
  private var dispatchCursor = 0

  fileprivate init(
    landmarker: PoseLandmarker,
    relay: LiveStreamRelay?,
    delegateKind: Delegate,
    modelFileName: String
  ) {
    self.landmarker = landmarker
    self.relay = relay
    self.delegateKind = delegateKind
    self.modelFileName = modelFileName
  }

  var lastTimestampMs: Int {
    lock.lock()
    defer { lock.unlock() }
    return lastTimestamp
  }

  /// Nanoseconds at dispatch for `timestampMs`, or 0 when it has already been overwritten.
  func dispatchNanos(for timestampMs: Int) -> UInt64 {
    lock.lock()
    defer { lock.unlock() }
    for slot in 0..<PoseDetector.dispatchSlots where dispatchTimestamps[slot] == timestampMs {
      return dispatchNanos[slot]
    }
    return 0
  }

  @discardableResult
  func detect(image: MPImage, cameraTimestampMs: Int) throws -> Int {
    lock.lock()
    let timestamp = max(cameraTimestampMs, lastTimestamp + 1)
    lastTimestamp = timestamp
    let slot = dispatchCursor & (PoseDetector.dispatchSlots - 1)
    dispatchTimestamps[slot] = timestamp
    dispatchNanos[slot] = Monotonic.nowNanos()
    dispatchCursor = slot + 1
    lock.unlock()

    try landmarker.detectAsync(image: image, timestampInMilliseconds: timestamp)
    return timestamp
  }

  /// IMAGE and VIDEO mode are synchronous, so there is no result callback to route.
  func detectImage(_ image: MPImage) throws -> PoseLandmarkerResult {
    return try landmarker.detect(image: image)
  }

  func detectVideo(_ image: MPImage, timestampMs: Int) throws -> PoseLandmarkerResult {
    return try landmarker.detect(videoFrame: image, timestampInMilliseconds: timestampMs)
  }

  /**
   ARC frees the landmarker when the last reference goes, so there is no `close()` to forget. The
   observer is cleared first: a result already in flight must not reach a view that is tearing down.
   */
  func shutdown() {
    observer = nil
  }
}

extension PoseDetector {
  fileprivate func handle(result: PoseLandmarkerResult?, timestampMs: Int, error: Error?) {
    if let error = error {
      observer?.poseDetector(self, didFail: error)
      return
    }
    guard let result = result else { return }
    observer?.poseDetector(self, didDetect: result, timestampMs: timestampMs)
  }
}

extension PoseDetector {
  /**
   The plugin installs exactly one model, so listing beats being told which variant. Sorted, so a
   bundle that somehow holds two picks the same one on every launch rather than an arbitrary one.
   */
  static func findModelPath() -> String? {
    guard let resources = Bundle.main.resourcePath else { return nil }
    let contents = (try? FileManager.default.contentsOfDirectory(atPath: resources)) ?? []
    guard let name = contents
      .filter({ $0.hasPrefix("pose_landmarker_") && $0.hasSuffix(".task") })
      .sorted()
      .first else { return nil }
    return (resources as NSString).appendingPathComponent(name)
  }

  static func fileName(from path: String) -> String {
    return (path as NSString).lastPathComponent
  }

  /**
   A detector for a file rather than a camera. CPU rather than the GPU probe: a still input runs
   once, and the probe would cost more than the inference it is choosing for.
   */
  static func createForStillInput(
    modelPath: String,
    maxPoses: Int,
    minConfidence: Float = defaultStillConfidence,
    video: Bool
  ) throws -> PoseDetector {
    let landmarker = try build(LandmarkerSpec(
      modelPath: modelPath,
      delegateKind: .CPU,
      maxPoses: maxPoses,
      minConfidence: minConfidence,
      runningMode: video ? .video : .image
    ), observer: nil)
    return PoseDetector(
      landmarker: landmarker,
      relay: nil,
      delegateKind: .CPU,
      modelFileName: fileName(from: modelPath)
    )
  }

  static func create(
    modelPath: String,
    request: DelegateRequest,
    maxPoses: Int,
    minConfidence: Float
  ) throws -> PoseDetector {
    let delegateKind = resolveDelegate(request, modelPath: modelPath)

    let relay = LiveStreamRelay()
    let landmarker = try build(LandmarkerSpec(
      modelPath: modelPath,
      delegateKind: delegateKind,
      maxPoses: maxPoses,
      minConfidence: minConfidence,
      runningMode: .liveStream
    ), observer: relay)
    let detector = PoseDetector(
      landmarker: landmarker,
      relay: relay,
      delegateKind: delegateKind,
      modelFileName: fileName(from: modelPath)
    )
    relay.detector = detector

    let kind = delegateKind == .GPU ? "GPU" : "CPU"
    PoseLog.info(.detector, "landmarker ready on \(kind) with \(detector.modelFileName)")
    return detector
  }

  /**
   Which delegate to actually build with.

   **The simulator never gets the GPU.** MediaPipe converts a frame to a tensor through Metal, and
   on a simulator that conversion fails inside an `absl` check, which calls `abort()`. There is no
   catching that: the process is gone, and the crash lands on the first camera frame rather than at
   setup, so nothing before it looks wrong. The probe below cannot help, because a probe that
   reproduced the failure would take the app down with it.

   Simulators have no real GPU to measure anyway, so the only thing lost is a configuration that
   could not have told anyone anything true about performance.
   */
  private static func resolveDelegate(_ request: DelegateRequest, modelPath: String) -> Delegate {
    #if targetEnvironment(simulator)
    if request != .cpu {
      PoseLog.warn(.detector, "the simulator has no usable GPU for MediaPipe, using CPU")
    }
    return .CPU
    #else
    switch request {
    case .cpu: return .CPU
    case .gpu: return .GPU
    case .auto: return gpuProducesAnInference(modelPath: modelPath) ? .GPU : .CPU
    }
    #endif
  }

  /**
   Construction succeeds on devices whose GPU delegate then fails on the first real frame, so the
   probe runs a real inference in IMAGE mode, where failure is catchable, before committing to GPU.
   Costs one inference on a blank image at setup.
   */
  private static func gpuProducesAnInference(modelPath: String) -> Bool {
    do {
      let probe = try build(LandmarkerSpec(
        modelPath: modelPath,
        delegateKind: .GPU,
        maxPoses: 1,
        minConfidence: 0.5,
        runningMode: .image
      ), observer: nil)
      let renderer = UIGraphicsImageRenderer(size: CGSize(width: probeSize, height: probeSize))
      let blank = renderer.image { context in
        UIColor.black.setFill()
        context.fill(CGRect(x: 0, y: 0, width: probeSize, height: probeSize))
      }
      _ = try probe.detect(image: try MPImage(uiImage: blank))
      return true
    } catch {
      PoseLog.warn(.detector, "GPU delegate rejected on probe, using CPU: \(error.localizedDescription)")
      return false
    }
  }

  private static func build(_ spec: LandmarkerSpec, observer: PoseLandmarkerLiveStreamDelegate?) throws
    -> PoseLandmarker {
    let options = PoseLandmarkerOptions()
    options.baseOptions.modelAssetPath = spec.modelPath
    options.baseOptions.delegate = spec.delegateKind
    options.runningMode = spec.runningMode
    options.numPoses = spec.maxPoses
    options.minPoseDetectionConfidence = spec.minConfidence
    options.minPosePresenceConfidence = spec.minConfidence
    options.minTrackingConfidence = spec.minConfidence
    if spec.runningMode == .liveStream {
      options.poseLandmarkerLiveStreamDelegate = observer
    }
    return try PoseLandmarker(options: options)
  }
}
