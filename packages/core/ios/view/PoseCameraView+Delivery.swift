import Foundation
import ExpoModulesCore

/// Everything measured about one frame, so the functions below take a value rather than a list.
struct FrameMeasurements {
  let nowMs: Int64
  let timestampMs: Double
  let processingMs: Double
  let comX: Float
  let comY: Float
  let velocityX: Float
  let velocityY: Float
  let elapsedSeconds: Float
  let size: CaptureSize
}

/// Triggers and the delivery mode. Both run on MediaPipe's callback queue.
extension PoseCameraView {
  /**
   Runs before the frame is delivered, because a `snapshot: true` trigger claims the frame it fired
   on and that has to be this one rather than whatever is current when JavaScript asks.
   */
  func evaluateTriggers(layout: FrameShape, measurements: FrameMeasurements) {
    guard !triggers.isEmpty else { return }

    frameContext.landmarks = landmarkBuffer
    frameContext.previousLandmarks = hasPreviousLandmarks ? previousLandmarks : nil
    frameContext.elapsedSeconds = measurements.elapsedSeconds
    frameContext.comX = measurements.comX
    frameContext.comY = measurements.comY
    frameContext.comVelocityX = measurements.velocityX
    frameContext.comVelocityY = measurements.velocityY
    frameContext.frameWidth = measurements.size.width
    frameContext.frameHeight = measurements.size.height

    firings.removeAll(keepingCapacity: true)
    triggers.evaluate(frameContext, nowMs: measurements.nowMs, into: &firings)

    // Released before returning, and not at the end of the frame by accident: an array held here
    // between frames is a second reference to the landmark buffers, and the next write to either
    // would copy the whole thing.
    frameContext.landmarks = []
    frameContext.previousLandmarks = nil

    guard !firings.isEmpty else { return }

    for firing in firings {
      let ticket = firing.wantsSnapshot
        ? frames.mintSnapshot(
          layout.scratch,
          timestampMs: measurements.timestampMs,
          processingMs: measurements.processingMs
        )
        : 0

      var payload: [String: Any] = [
        "id": firing.id,
        "phase": firing.phase,
        "count": firing.count,
        "timestamp": firing.timestampMs
      ]
      if let durationMs = firing.durationMs {
        payload["durationMs"] = durationMs
      }
      // Zero means the frame could not be held, and the event says nothing rather than handing over
      // a ticket that redeems to an empty buffer.
      if ticket != 0 {
        payload["snapshotId"] = ticket
      }

      DispatchQueue.main.async { [weak self] in self?.onTrigger(payload) }
    }
    firings.removeAll(keepingCapacity: true)
  }

  /// The delivery mode decides only two things: whether this frame is kept, and whether to tick.
  func deliver(_ scratch: [Float], timestampMs: Double, processingMs: Double) {
    let mode = propMode
    let now = Monotonic.nowMs()
    let sinceEmit = now - lastEmitMs.value

    let due: Bool
    switch mode {
    case .off: due = false
    case .live: due = true
    case .throttled: due = sinceEmit >= propThrottleMs.value
    case .batched: due = sinceEmit >= propFlushMs.value
    }

    // `throttled` drops the frames between emissions rather than buffering them, which is what the
    // mode means. `batched` buffers everything and flushes on the interval.
    let buffered = mode == .live || mode == .batched || (mode == .throttled && due)

    frames.submit(scratch, timestampMs: timestampMs, processingMs: processingMs, buffered: buffered)

    guard due, mode != .off else { return }
    lastEmitMs.value = now

    // A tick already queued has not been answered yet, so a second one would ask for the same drain
    // twice.
    let shouldTick = tickPending.mutate { pending -> Bool in
      guard !pending else { return false }
      pending = true
      return true
    }
    guard shouldTick else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.tickPending.value = false
      self.onFrames([:])
    }
  }
}
