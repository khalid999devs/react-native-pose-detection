import Foundation
import ExpoModulesCore
import MediaPipeTasksVision

/// The four values the trigger evaluator needs back out of the scalar block.
struct FrameScalars {
  let comX: Float
  let comY: Float
  let velocityX: Float
  let velocityY: Float
}

/// What one frame was captured under, bundled so the encoder takes a value rather than a list.
struct FrameTiming {
  let size: CaptureSize
  let nowMs: Int64
  let comparable: Bool
  let elapsedSeconds: Float
}

/// The result path. Everything here runs on MediaPipe's callback queue unless it says otherwise.
extension PoseCameraView: PoseDetectorObserver {
  func poseDetector(_ detector: PoseDetector, didDetect result: PoseLandmarkerResult, timestampMs: Int) {
    if timestampMs < staleBefore.value {
      PoseLog.trace(.camera, "dropped a frame from the previous camera")
      return
    }
    accept(result)
  }

  /**
   Everything a pose goes through once it exists, whatever produced it.

   The camera reaches this through the detector callback above; a picked image or video reaches it
   from anywhere else. Keeping one path is the point: smoothing, geometry, the trigger evaluator,
   the ring buffer and the overlay all behave identically on a file and on the camera, so there is
   no second implementation to keep in step.
   */
  func accept(_ result: PoseLandmarkerResult) {
    let poses = result.landmarks
    guard !poses.isEmpty else {
      onPoseLost()
      return
    }
    let primaryIndex = poses.count > 1 ? primaryPose(poses) : 0
    let primary = poses[primaryIndex]
    guard primary.count >= Skeleton.landmarkCount else { return }

    // The same monotonic clock the log channel stamps entries with, so a log line maps to the frame
    // that caused it. It is when the pose became known, not when the sensor exposed it.
    let nowMs = Monotonic.nowMs()
    lastPoseMs.value = nowMs

    for index in 0..<Skeleton.landmarkCount {
      let landmark = primary[index]
      let base = index * Skeleton.landmarkStride
      landmarkBuffer[base + Skeleton.offsetX] = landmark.x
      landmarkBuffer[base + Skeleton.offsetY] = landmark.y
      landmarkBuffer[base + Skeleton.offsetZ] = landmark.z
      // The NSNumber already exists, so reading it costs a message send and no allocation.
      landmarkBuffer[base + Skeleton.offsetVisibility] = landmark.visibility?.floatValue ?? 0
    }

    // A gap means a switch, a pause, or a backgrounded app. The positions on either side are real,
    // the difference between them is not a movement that happened at that speed.
    let elapsedMs = Double(nowMs) - previousFrameMs.value
    let comparable = previousFrameMs.value > 0 && elapsedMs > 0 && elapsedMs <= PoseCameraView.maxVelocityGapMs
    let elapsedSeconds = comparable ? Float(elapsedMs / PoseCameraView.millisPerSecond) : Float.nan

    // Before anything reads a coordinate: the overlay, the geometry, the evaluators and the wire
    // all have to agree about where the body is.
    if propSmoothing {
      smoothing.apply(to: &landmarkBuffer, elapsedSeconds: elapsedSeconds)
    } else {
      smoothing.reset()
    }

    let size = frameSize.value
    overlayView.submit(landmarkBuffer, width: size.width, height: size.height)

    buildFrame(result: result, pose: primaryIndex, poseSize: primary.count, timing: FrameTiming(
      size: size,
      nowMs: nowMs,
      comparable: comparable,
      elapsedSeconds: elapsedSeconds
    ))
  }

  /// On MediaPipe's callback queue. Rate limited: a dead delegate fails every frame.
  func poseDetector(_ detector: PoseDetector, didFail error: Error) {
    PoseLog.warn(.detector, "inference failed: \(error.localizedDescription)")
    let now = Monotonic.nowMs()
    let shouldReport = lastDetectionErrorMs.mutate { last -> Bool in
      guard now - last >= PoseCameraView.detectionErrorIntervalMs else { return false }
      last = now
      return true
    }
    guard shouldReport else { return }

    let message = error.localizedDescription
    DispatchQueue.main.async { [weak self] in self?.emitError(.detectionFailed, message) }
  }

  private func onPoseLost() {
    overlayView.clearPose()
    // A frame is only current while a pose is in it, and velocity across the gap where someone left
    // and came back is not a speed anybody moved at.
    frames.clearLatest()
    resetVelocity()
    triggers.onPoseLost()
    // Filtering across that gap would invent the motion between the two places they stood.
    smoothing.reset()
  }

  /**
   Largest bounding box, ties broken by distance from the frame centre. MediaPipe's own order is
   detection order and means nothing about who the subject is.
   */
  private func primaryPose(_ poses: [[NormalizedLandmark]]) -> Int {
    var best = 0
    var bestArea: Float = -1
    var bestOffset = Float.greatestFiniteMagnitude

    for index in poses.indices {
      let pose = poses[index]
      if pose.count < Skeleton.landmarkCount { continue }

      var minX = Float.greatestFiniteMagnitude
      var maxX = -Float.greatestFiniteMagnitude
      var minY = Float.greatestFiniteMagnitude
      var maxY = -Float.greatestFiniteMagnitude

      for point in pose {
        minX = min(minX, point.x)
        maxX = max(maxX, point.x)
        minY = min(minY, point.y)
        maxY = max(maxY, point.y)
      }

      let area = (maxX - minX) * (maxY - minY)
      let offset = abs((minX + maxX) / 2 - 0.5) + abs((minY + maxY) / 2 - 0.5)
      let better = area > bestArea + PoseCameraView.areaTieEpsilon
        || (abs(area - bestArea) <= PoseCameraView.areaTieEpsilon && offset < bestOffset)
      if better {
        best = index
        bestArea = area
        bestOffset = offset
      }
    }
    return best
  }

  private func resetVelocity() {
    previousComX = .nan
    previousComY = .nan
    previousFrameMs.value = 0
    hasPreviousLandmarks = false
  }

  /**
   Encodes one frame into the wire layout and hands it to the ring buffer. The latest frame is
   recorded whatever the mode is, because `snapshotFrame()` is documented to answer at `mode: 'off'`;
   only buffering and the tick are the mode's business.
   */
  private func buildFrame(result: PoseLandmarkerResult, pose: Int, poseSize: Int, timing: FrameTiming) {
    let size = timing.size
    let nowMs = timing.nowMs
    let elapsedSeconds = timing.elapsedSeconds

    // One read: the scratch buffer belongs to the shape, so a layout change swaps both together and
    // this can never pair an old shape with a new buffer.
    guard let layout = frameLayout.value else { return }

    if layout.worldLandmarks {
      fillWorldBuffer(result, pose: pose, poseSize: poseSize)
    }
    let cursor = writeBlocks(into: layout, size: size)
    let timestampMs = Double(nowMs)

    let scalars = writeScalars(into: layout, at: cursor, comparable: timing.comparable, elapsed: elapsedSeconds)
    let comX = scalars.comX
    let comY = scalars.comY

    let dispatched = detector.value?.dispatchNanos(for: result.timestampInMilliseconds) ?? 0
    let processingMs = dispatched == 0
      ? 0
      : Double(Monotonic.nowNanos() - dispatched) / PoseCameraView.nanosPerMilli

    evaluateTriggers(layout: layout, measurements: FrameMeasurements(
      nowMs: nowMs,
      timestampMs: timestampMs,
      processingMs: processingMs,
      comX: comX,
      comY: comY,
      velocityX: scalars.velocityX,
      velocityY: scalars.velocityY,
      elapsedSeconds: elapsedSeconds,
      size: size
    ))

    // Only `auto` is calibrated. A named profile is somebody saying they have already decided.
    if propProfile == .auto && processingMs > 0 {
      let moved = calibrator.record(
        inferenceMs: Float(processingMs),
        targetFps: resolved.value.targetFps,
        nowMs: nowMs
      )
      if moved {
        DispatchQueue.main.async { [weak self] in self?.onCalibrationMoved() }
      }
    }

    // Element-wise, not `previousLandmarks = landmarkBuffer`: that would share one buffer between
    // the two and make the next frame's first write copy it.
    for index in previousLandmarks.indices {
      previousLandmarks[index] = landmarkBuffer[index]
    }
    hasPreviousLandmarks = true
    previousComX = comX
    previousComY = comY
    previousFrameMs.value = timestampMs

    deliver(layout.scratch, timestampMs: timestampMs, processingMs: processingMs)
  }

  /**
   The landmark, world-landmark and angle blocks, in wire order, returning where the scalars start.

   Written through the shape rather than through a local. `var scratch = layout.scratch` would leave
   two references to one array, and the first write would copy the whole thing, once per frame,
   which is exactly the allocation this buffer exists to avoid.
   */
  private func writeBlocks(into layout: FrameShape, size: CaptureSize) -> Int {
    var cursor = 0

    for joint in layout.jointIndices {
      let base = joint * Skeleton.landmarkStride
      layout.scratch[cursor] = landmarkBuffer[base]
      layout.scratch[cursor + 1] = landmarkBuffer[base + 1]
      layout.scratch[cursor + 2] = landmarkBuffer[base + 2]
      layout.scratch[cursor + 3] = landmarkBuffer[base + 3]
      cursor += Skeleton.landmarkStride
    }

    if layout.worldLandmarks {
      for joint in layout.jointIndices {
        let base = joint * Skeleton.landmarkStride
        layout.scratch[cursor] = worldBuffer[base]
        layout.scratch[cursor + 1] = worldBuffer[base + 1]
        layout.scratch[cursor + 2] = worldBuffer[base + 2]
        layout.scratch[cursor + 3] = worldBuffer[base + 3]
        cursor += Skeleton.landmarkStride
      }
    }

    for triple in layout.angleTriples {
      layout.scratch[cursor] = Geometry.angleDegrees(
        landmarkBuffer,
        proximal: triple[0],
        vertex: triple[1],
        distal: triple[2],
        frameWidth: size.width,
        frameHeight: size.height
      )
      cursor += 1
    }
    return cursor
  }

  /// Centre of mass, its velocity, and the body span: the five scalars that close every frame.
  private func writeScalars(
    into layout: FrameShape,
    at start: Int,
    comparable: Bool,
    elapsed: Float
  ) -> FrameScalars {
    var cursor = start
    Geometry.centerOfMass(landmarkBuffer, into: &layout.scratch, at: cursor)
    let comX = layout.scratch[cursor]
    let comY = layout.scratch[cursor + 1]
    cursor += 2

    if comparable {
      layout.scratch[cursor] = (comX - previousComX) / elapsed
      layout.scratch[cursor + 1] = (comY - previousComY) / elapsed
    } else {
      // Unknown, not zero: the first frame of a pose has nothing to differ from, and zero would
      // read as a body that was measured and found to be still.
      layout.scratch[cursor] = .nan
      layout.scratch[cursor + 1] = .nan
    }
    let velocityX = layout.scratch[cursor]
    let velocityY = layout.scratch[cursor + 1]
    cursor += 2

    layout.scratch[cursor] = Geometry.bodySpan(landmarkBuffer)
    return FrameScalars(comX: comX, comY: comY, velocityX: velocityX, velocityY: velocityY)
  }

  /**
   The world landmarks of the pose the rest of the frame describes.

   Indexed rather than taken from the front: with `maxPoses` above one, the pose everything else
   reads is the largest body in the frame, and `worldLandmarks[0]` is whichever one MediaPipe
   happened to detect first. Taking the front would pair one person's screen coordinates with
   another person's metric ones in a single frame.
   */
  private func fillWorldBuffer(_ result: PoseLandmarkerResult, pose: Int, poseSize: Int) {
    let world = result.worldLandmarks
    let points = pose < world.count ? world[pose] : []
    guard points.count >= poseSize else {
      for index in worldBuffer.indices {
        worldBuffer[index] = 0
      }
      return
    }

    for index in 0..<Skeleton.landmarkCount {
      let landmark = points[index]
      let base = index * Skeleton.landmarkStride
      worldBuffer[base + Skeleton.offsetX] = landmark.x
      worldBuffer[base + Skeleton.offsetY] = landmark.y
      worldBuffer[base + Skeleton.offsetZ] = landmark.z
      worldBuffer[base + Skeleton.offsetVisibility] = landmark.visibility?.floatValue ?? 0
    }
  }
}
