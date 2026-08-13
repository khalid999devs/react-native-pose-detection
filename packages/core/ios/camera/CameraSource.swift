import AVFoundation
import UIKit

enum Facing {
  case front
  case back

  var nameForJs: String {
    return self == .front ? "front" : "back"
  }

  var position: AVCaptureDevice.Position {
    return self == .front ? .front : .back
  }

  var opposite: Facing {
    return self == .front ? .back : .front
  }
}

/**
 Owns the capture session. Knows about frames, not poses.

 **Every field here belongs to `sessionQueue`**, a serial queue of its own, unlike Android where
 CameraX forces the session onto the main thread. `startRunning` blocks until the camera is up, so
 running it on main would stall the first frame of every mount behind it. Callbacks hop to main,
 because the view's state lives there.

 Sample buffers are delivered on `analysisQueue` and inference runs there too, so a buffer never
 escapes the callback it arrived in.
 */
final class CameraSource {
  private let sessionQueue = DispatchQueue(label: "com.posedetection.session")
  private let analysisQueue: DispatchQueue
  private weak var previewView: PreviewView?
  private weak var output: AVCaptureVideoDataOutput?
  private weak var sampleDelegate: AVCaptureVideoDataOutputSampleBufferDelegate?

  private var session: AVCaptureSession?
  private var input: AVCaptureDeviceInput?

  /// Main-thread mirror of the session state, so the view can report it without a queue hop.
  private(set) var facing: Facing = .front
  private(set) var isBound = false

  var previewSize = CaptureSize(width: 1280, height: 720)
  var analysisSize = CaptureSize(width: 640, height: 480)

  /// `auto` prefers front and falls back to back. A pinned lens fails instead of falling back.
  var facingFallbackAllowed = false

  /// Tells a callback that lands a turn later whether its session still exists.
  private var startToken = 0

  /// Read on the session queue, written on main when the device rotates.
  private var orientation: AVCaptureVideoOrientation = .portrait

  private var analyzerEnabled = false

  init(previewView: PreviewView, analysisQueue: DispatchQueue, delegate: AVCaptureVideoDataOutputSampleBufferDelegate) {
    self.previewView = previewView
    self.analysisQueue = analysisQueue
    self.sampleDelegate = delegate
  }

  // MARK: - Lifecycle

  func start(facing: Facing, onBound: @escaping () -> Void, onFailed: @escaping (ErrorCode, Error?) -> Void) {
    startToken += 1
    let token = startToken
    self.facing = facing
    orientation = currentOrientation()

    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      do {
        try self.configure(target: facing, token: token)
      } catch {
        PoseLog.error(.camera, "camera start failed: \(error.localizedDescription)")
        DispatchQueue.main.async { onFailed(.cameraStartFailed, error) }
        return
      }
      DispatchQueue.main.async {
        guard token == self.startToken else { return }
        self.isBound = true
        onBound()
      }
    }
  }

  /// Rebinds, restoring the old lens on failure. `onDone` reports the lens actually bound.
  func switchTo(_ target: Facing, onDone: @escaping (Facing) -> Void, onFailed: @escaping (ErrorCode, Error?) -> Void) {
    guard isBound else {
      onFailed(.cameraSwitchFailed, CameraError("camera is not running"))
      return
    }
    if target == facing {
      onDone(facing)
      return
    }
    // The `auto` fallback belongs on the first bind, not here. Letting it run would rebind the lens
    // that is already up, flash the preview, and resolve the switch as a success that changed
    // nothing. guides/camera-control.md promises a CAMERA_SWITCH_FAILED instead.
    guard device(for: target) != nil else {
      onFailed(.cameraSwitchFailed, CameraError("this device has no \(target.nameForJs) camera"))
      return
    }

    let previous = facing
    startToken += 1
    let token = startToken

    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      do {
        try self.swapInput(to: target)
        DispatchQueue.main.async {
          guard token == self.startToken else { return }
          self.facing = target
          // The preview layer keeps its connection across an input swap, so its mirroring is the
          // old lens's until this runs. Without it, switching front to back leaves the preview
          // mirrored and the overlay lands on the wrong side of the body.
          self.applyPreviewOrientation()
          PoseLog.debug(.camera, "switched \(previous.nameForJs) to \(target.nameForJs)")
          onDone(target)
        }
      } catch {
        PoseLog.warn(.camera, "switch to \(target.nameForJs) failed, rolling back: \(error.localizedDescription)")
        do {
          try self.swapInput(to: previous)
          DispatchQueue.main.async { onFailed(.cameraSwitchFailed, error) }
        } catch let rollbackError {
          // The previous camera is gone too. This is no longer recoverable.
          DispatchQueue.main.async {
            self.isBound = false
            onFailed(.cameraUnavailable, rollbackError)
          }
        }
      }
    }
  }

  /// Called on a rotation so the analysis buffer and the preview both keep arriving upright.
  func updateTargetRotation() {
    let next = currentOrientation()
    orientation = next
    applyPreviewOrientation()
    sessionQueue.async { [weak self] in
      self?.applyOrientation(next)
    }
    PoseLog.debug(.camera, "target rotation now \(next.rawValue)")
  }

  /// Parks a facing change made while unbound so the next bind picks it up.
  func setPendingFacing(_ target: Facing) {
    guard !isBound else { return }
    facing = target
  }

  /**
   Detaching the delegate rather than tearing the session down. It is the exact counterpart of
   `ImageAnalysis.clearAnalyzer()`, and it means a paused detector does not cost a camera restart.
   */
  func setAnalyzerEnabled(_ enabled: Bool) {
    analyzerEnabled = enabled
    let delegate = enabled ? sampleDelegate : nil
    let queue = analysisQueue
    sessionQueue.async { [weak self] in
      self?.output?.setSampleBufferDelegate(delegate, queue: enabled ? queue : nil)
    }
  }

  func pause() {
    startToken += 1
    guard isBound else { return }
    isBound = false
    sessionQueue.async { [weak self] in
      self?.session?.stopRunning()
      PoseLog.info(.camera, "session stopped")
    }
  }

  func resume(onFailed: @escaping (ErrorCode, Error?) -> Void) {
    guard !isBound else { return }
    let target = facing

    // A pause that landed during startup left no session to restart, so the start is re-issued.
    // That is what makes pause-then-resume during startup recoverable instead of permanently dead.
    guard session != nil else {
      start(facing: target, onBound: {}, onFailed: onFailed)
      return
    }

    startToken += 1
    let token = startToken
    sessionQueue.async { [weak self] in
      guard let self = self, let session = self.session else { return }
      session.startRunning()
      DispatchQueue.main.async {
        guard token == self.startToken else { return }
        self.isBound = true
      }
    }
  }

  func release() {
    startToken += 1
    isBound = false
    let doomed = session
    let doomedOutput = output
    session = nil
    input = nil
    sampleDelegate = nil
    previewView?.previewLayer?.session = nil
    sessionQueue.async {
      doomedOutput?.setSampleBufferDelegate(nil, queue: nil)
      doomed?.stopRunning()
    }
  }

  // MARK: - Session queue only

  private func configure(target: Facing, token: Int) throws {
    let session = AVCaptureSession()
    session.beginConfiguration()
    session.sessionPreset = CameraSource.preset(for: previewSize)

    let resolved = try resolveDevice(target)
    let deviceInput = try AVCaptureDeviceInput(device: resolved.device)
    guard session.canAddInput(deviceInput) else {
      session.commitConfiguration()
      throw CameraError("this device will not accept the \(resolved.facing.nameForJs) camera")
    }
    session.addInput(deviceInput)

    let videoOutput = AVCaptureVideoDataOutput()
    // A slow frame is dropped rather than queued, so the pipeline degrades in latency instead of
    // falling behind forever. The counterpart of STRATEGY_KEEP_ONLY_LATEST on Android.
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = videoSettings()
    guard session.canAddOutput(videoOutput) else {
      session.commitConfiguration()
      throw CameraError("this device will not accept a video data output")
    }
    session.addOutput(videoOutput)

    self.session = session
    self.input = deviceInput
    self.output = videoOutput

    applyOrientation(orientation)
    session.commitConfiguration()

    if analyzerEnabled {
      videoOutput.setSampleBufferDelegate(sampleDelegate, queue: analysisQueue)
    }

    // Before the layer is attached: assigning `previewLayer.session` opens its own configuration
    // block, and doing that from main while this queue is inside `startRunning` puts two on one
    // session, which AVFoundation aborts on. A simulator hid the overlap; an iPhone 15 did not.
    session.startRunning()

    DispatchQueue.main.async { [weak self] in
      guard let self = self, token == self.startToken else { return }
      self.facing = resolved.facing
      self.previewView?.previewLayer?.session = session
      self.applyPreviewOrientation()
    }
    PoseLog.info(
      .camera,
      "bound \(resolved.facing.nameForJs) preview=\(previewSize.width)x\(previewSize.height) "
        + "analysis=\(analysisSize.width)x\(analysisSize.height)"
    )
  }

  private func swapInput(to target: Facing) throws {
    guard let session = session else { throw CameraError("no capture session") }
    guard let device = device(for: target) else {
      throw CameraError("this device has no \(target.nameForJs) camera")
    }

    session.beginConfiguration()
    defer { session.commitConfiguration() }

    if let existing = input {
      session.removeInput(existing)
    }
    let next = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(next) else {
      throw CameraError("this device will not accept the \(target.nameForJs) camera")
    }
    session.addInput(next)
    input = next
    // Inside the configuration block, so no frame is ever delivered with the old rotation.
    applyOrientation(orientation)
  }

  private func applyOrientation(_ orientation: AVCaptureVideoOrientation) {
    guard let connection = output?.connection(with: .video) else { return }
    CaptureRotation.apply(orientation, to: connection)
    // Never mirrored: the landmarks have to describe the real world.
    CaptureRotation.mirror(false, on: connection)
  }

  private func videoSettings() -> [String: Any] {
    return [
      kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
      kCVPixelBufferWidthKey as String: analysisSize.width,
      kCVPixelBufferHeightKey as String: analysisSize.height
    ]
  }

  private func resolveDevice(_ target: Facing) throws -> (device: AVCaptureDevice, facing: Facing) {
    if let device = device(for: target) {
      return (device, target)
    }
    guard facingFallbackAllowed, let fallback = device(for: target.opposite) else {
      throw CameraError("this device has no \(target.nameForJs) camera")
    }
    PoseLog.info(.camera, "no \(target.nameForJs) camera on this device, using \(target.opposite.nameForJs)")
    return (fallback, target.opposite)
  }

  private func device(for target: Facing) -> AVCaptureDevice? {
    return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: target.position)
  }

  // MARK: - Main thread only

  private func applyPreviewOrientation() {
    guard let connection = previewView?.previewLayer?.connection else { return }
    CaptureRotation.apply(orientation, to: connection)
    CaptureRotation.mirror(facing == .front, on: connection)
  }

  private func currentOrientation() -> AVCaptureVideoOrientation {
    guard Thread.isMainThread, let interface = previewView?.window?.windowScene?.interfaceOrientation else {
      return orientation
    }
    return CaptureRotation.videoOrientation(for: interface)
  }
}
