import AVFoundation
import ExpoModulesCore
import MediaPipeTasksVision

/**
 The capture callback. Runs on `analysisQueue`, and calls `detectAsync` on the same thread, so a
 sample buffer never outlives the callback that delivered it.
 */
extension PoseCameraView: AVCaptureVideoDataOutputSampleBufferDelegate {
  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    // MPImage and the CoreVideo objects behind it are autoreleased, so without this the pool for
    // this queue only drains when it goes idle, which under load is never.
    autoreleasepool {
      // The first frame after a rebind is what tells the main thread the new camera is really
      // producing, which is what a switch waits on.
      let wasAwaiting = awaitingFirstFrame.mutate { pending -> Bool in
        let was = pending
        pending = false
        return was
      }
      if wasAwaiting {
        DispatchQueue.main.async { [weak self] in self?.completeSwitch() }
      }

      guard let detector = detector.value else { return }
      let now = Monotonic.nowMs()

      sampleThermal(now)
      if resolved.value.detectionPaused { return }
      guard frameIsDue(now) else { return }

      guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
      frameSize.value = CaptureSize(
        width: CVPixelBufferGetWidth(pixels),
        height: CVPixelBufferGetHeight(pixels)
      )

      do {
        // Always `.up`: the capture connection has already rotated the buffer, see CaptureRotation.
        let image = try MPImage(sampleBuffer: sampleBuffer, orientation: .up)
        try detector.detect(image: image, cameraTimestampMs: presentationMilliseconds(sampleBuffer))
        countFrame(now)
      } catch {
        PoseLog.warn(.detector, "frame dropped: \(error.localizedDescription)")
      }
    }
  }

  /// The capture clock, which starts at zero for the session and only ever moves forward.
  private func presentationMilliseconds(_ sampleBuffer: CMSampleBuffer) -> Int {
    let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    guard seconds.isFinite, seconds > 0 else { return 0 }
    return Int(seconds * PoseCameraView.millisPerSecond)
  }

  /**
   The pacing gate. It serves `targetFps` and idle-search with one mechanism, because they are the
   same thing: a rate the analyzer is allowed to run at. AVFoundation keeps delivering at sensor
   rate either way, and a frame that is not due is dropped without ever reaching the model.
   */
  private func frameIsDue(_ nowMs: Int64) -> Bool {
    let lastPose = lastPoseMs.value
    let idle = lastPose != 0 && nowMs - lastPose > PoseCameraView.idleAfterMs
    let fps = idle ? PerformanceResolver.idleFps : resolved.value.targetFps
    guard fps > 0 else { return false }

    // Slightly under the exact interval: a strict compare against a jittery sensor clock drops
    // every other frame and halves the rate it was asked to hold.
    let minIntervalMs = Int64(PoseCameraView.millisPerSecond / Double(fps) * PoseCameraView.pacingTolerance)
    if nowMs - lastDetectMs < minIntervalMs { return false }

    lastDetectMs = nowMs
    return true
  }

  private func countFrame(_ nowMs: Int64) {
    framesInWindow += 1
    if fpsWindowStartMs == 0 { fpsWindowStartMs = nowMs }
    let elapsed = nowMs - fpsWindowStartMs
    guard elapsed >= PoseCameraView.fpsWindowMs else { return }

    measuredFps.value = Int((Int64(framesInWindow) * PoseCameraView.fpsWindowMs) / elapsed)
    framesInWindow = 0
    fpsWindowStartMs = nowMs
  }

  /// Sampled rather than subscribed, to match Android, where the callback needs API 29.
  private func sampleThermal(_ nowMs: Int64) {
    guard thermalMonitor.shouldSample(nowMs: nowMs, lastMs: lastThermalSampleMs) else { return }
    lastThermalSampleMs = nowMs

    let next = thermalMonitor.read()
    guard next != thermalState.value else { return }

    PoseLog.info(.engine, "thermal state is now \(next.rawValue)")
    thermalState.value = next
    // Reported even when the policy says not to act on it, so an app can decide for itself.
    DispatchQueue.main.async { [weak self] in self?.applyPerformance(reason: "thermal") }
  }
}
