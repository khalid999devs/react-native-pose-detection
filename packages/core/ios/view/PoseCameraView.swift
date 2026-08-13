import ExpoModulesCore
import UIKit

/**
 The orchestrator. Owns the preview, the overlay, the camera, the detector, and the engine, and is
 the only thing that knows how all of them fit together.

 Threading, which everything here depends on:

 - **main** holds the props, the view tree, and every field not wrapped in `Guarded`.
 - **`analysisQueue`** receives sample buffers and calls `detectAsync` on the same thread, so a
   buffer never escapes the callback it arrived in. The detector is also built there, because
   building the heavy model takes seconds.
 - **MediaPipe's callback queue** delivers results, which is where the frame is encoded.
 - **the session queue**, inside `CameraSource`, owns the capture session.
 */
public class PoseCameraView: ExpoView {
  static let minConfidence: Float = 0.6
  static let millisPerSecond = 1_000.0
  static let nanosPerMilli = 1_000_000.0

  /// Six frames at 30 fps. Longer than a stutter, shorter than anything worth measuring across.
  static let maxVelocityGapMs = 200.0

  static let minTargetFps = 1
  static let maxTargetFps = 60

  /// No pose for this long drops the analyzer to `PerformanceResolver.idleFps`.
  static let idleAfterMs: Int64 = 2_000
  static let fpsWindowMs: Int64 = 1_000
  static let pacingTolerance = 0.9

  /// Two boxes within this much area are the same size, and the centre breaks the tie.
  static let areaTieEpsilon: Float = 1e-4

  static let preWarmSize: CGFloat = 256
  static let logFlushSeconds = 0.25
  static let detectionErrorIntervalMs: Int64 = 1_000
  static let switchFrameTimeoutSeconds = 1.5

  let onReady = EventDispatcher()
  let onError = EventDispatcher()
  let onCameraChange = EventDispatcher()

  /// Carries nothing. JavaScript answers it with `drainFrames()`, see ADR 0008.
  let onFrames = EventDispatcher()

  /// Scalars plus a claim ticket. The frame cannot ride it, see ADR 0009.
  let onTrigger = EventDispatcher()

  let onPerformanceChange = EventDispatcher()
  let onLog = EventDispatcher()

  let previewView = PreviewView(frame: .zero)
  let overlayView = OverlayView(frame: .zero)

  /// One serial queue. Sample buffers arrive here and inference runs here.
  let analysisQueue = DispatchQueue(label: "com.posedetection.analysis", qos: .userInitiated)

  private(set) lazy var camera = CameraSource(
    previewView: previewView,
    analysisQueue: analysisQueue,
    delegate: self
  )

  /// Written on main, read on the analysis queue, so a teardown is seen on the next frame.
  let detector = Guarded<PoseDetector?>(nil)
  var modelPath: String?

  /**
   In-flight construction state, main thread only. `detectorGeneration` is bumped by every teardown
   so a build landing afterwards is dropped rather than installed. `maxPoses` and the delegate are
   baked in at construction, so the last two force a rebuild when they change.
   */
  var detectorPending = false
  var detectorGeneration = 0
  var detectorRequest: DelegateRequest?
  var detectorMaxPoses = 0

  /// Survives `releaseDetector` so `getState` reports the pipeline, not instance liveness.
  var resolvedDelegate: String?

  /// A dead delegate fails every frame, and 30 identical events a second helps nobody.
  let lastDetectionErrorMs = Guarded<Int64>(0)

  /**
   A rebind only attaches the new input. The switch is reported once the new camera delivers a
   frame, with `switchTimer` resolving one that never does.
   */
  let awaitingFirstFrame = Guarded<Bool>(false)
  var pendingSwitchDone: (() -> Void)?
  var switchTimer: Timer?

  /// Results below this timestamp came from the previous camera.
  let staleBefore = Guarded<Int>(0)

  // Callback-queue only.
  var landmarkBuffer = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  var worldBuffer = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  var previousLandmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  var hasPreviousLandmarks = false
  var previousComX = Float.nan
  var previousComY = Float.nan

  let frames = FrameRingBuffer()
  let triggers = TriggerEngine()
  let smoothing = OneEuroFilter()
  let calibrator = Calibrator()
  let thermalMonitor = ThermalMonitor()

  /// What the precedence chain last produced. Read on the analysis queue, written on main.
  let resolved = Guarded(ResolvedPerformance(
    targetFps: Tiers.targetFps(.medium),
    preview: Tiers.preview(.medium),
    analysis: Tiers.analysis(.medium),
    detectionPaused: false
  ))

  /**
   The size of the buffer the last dispatched frame carried, in display orientation. The result
   callback needs it for the aspect correction and MediaPipe hands back only landmarks, so it is
   recorded at dispatch. It changes on a rotation or a rebind, never between two frames of one
   session, so a result that reads it a frame late reads the same value.
   */
  let frameSize = Guarded(CaptureSize(width: 0, height: 0))

  let thermalState = Guarded<ThermalState>(.nominal)
  var lastThermalSampleMs: Int64 = 0

  /// Frame pacing. Analysis queue only, unlike `lastPoseMs`.
  var lastDetectMs: Int64 = 0

  /// Written on the callback queue, read on the analysis queue to decide idle-search.
  let lastPoseMs = Guarded<Int64>(0)

  /// Measured from the capture callback, so `getState().fps` is what ran rather than what was asked.
  var framesInWindow = 0
  var fpsWindowStartMs: Int64 = 0
  let measuredFps = Guarded<Int>(0)

  /// Reused across frames: this is the inference path, and an allocation here is one everywhere.
  let frameContext = FrameContext()
  var firings = [TriggerFiring]()

  /// Reassigned on main when the layout changes, read on the callback queue.
  let frameLayout = Guarded<FrameShape?>(nil)

  /// Velocity is a difference, so it needs the frame before this one.
  let previousFrameMs = Guarded<Double>(0)

  /// At most one tick in flight. Without it a stalled JavaScript side queues one per frame.
  let tickPending = Guarded<Bool>(false)

  /// Last emission, so `throttled` and `batched` can decide whether this frame is due.
  let lastEmitMs = Guarded<Int64>(0)

  var logTimer: Timer?

  /// One token per notification this view registered, so detaching removes exactly those.
  var observerTokens = [NSObjectProtocol]()

  // Props. Applied together in `onPropsUpdated` rather than one at a time, so a render that
  // changes three of them rebinds the session once.
  var propFacing = "auto"
  var propDelegate = "auto"
  var propActive = true
  var propDetection = true
  var propMaxPoses = 1
  var propPreview = "auto"
  var propAnalysis = "auto"
  var overlayEnabled = true
  var pendingOverlayConfig = OverlayConfig()
  var propMode = DataMode.off
  let propThrottleMs = Guarded<Int64>(defaultThrottleMs)
  let propFlushMs = Guarded<Int64>(defaultFlushMs)
  var propLandmarks = true
  var propWorldLandmarks = false
  var propAngleJoints = [String]()
  var propSelection: [Int]?
  var propProfile = Profile.auto
  var propTargetFps: Int?
  var propThermalPolicy = ThermalPolicy.adaptive
  var propSmoothing = false
  var propMinCutoff = OneEuroFilter.defaultMinCutoff
  var propBeta = OneEuroFilter.defaultBeta

  var started = false
  var readySent = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .black
    clipsToBounds = true
    addSubview(previewView)
    addSubview(overlayView)

    // Props have not arrived yet. Without this a frame landing first would find no layout and be
    // dropped, and `snapshotFrame()` would answer empty for reasons nobody could see.
    applyFrameLayout()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewView.frame = bounds
    overlayView.frame = bounds
  }

  deinit {
    // ARC gives what Android needed `OnViewDestroys` for. The observers, the timers and the
    // session all go here, so a view that is released without ever being detached still lets go.
    removeObservers()
    logTimer?.invalidate()
    switchTimer?.invalidate()
    PoseLog.releaseStream(self)
  }
}
