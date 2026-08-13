import AVFoundation
import Foundation
import MediaPipeTasksVision
import UIKit

/// What `detectOnImage` and `detectOnVideo` were asked for. Defaults from `guides/static-input.md`.
struct StaticOptions {
  let maxPoses: Int
  let angles: Bool
  let worldLandmarks: Bool
  let smoothing: Bool
  let fps: Int
  let startMs: Int64
  let endMs: Int64

  static func forImage(_ raw: [String: Any]?) -> StaticOptions {
    return StaticOptions(
      maxPoses: count(raw?["maxPoses"], 1),
      angles: JS.bool(raw?["angles"]) ?? true,
      worldLandmarks: JS.bool(raw?["worldLandmarks"]) ?? false,
      // A single frame has nothing to smooth against, so this is off whatever was asked.
      smoothing: false,
      fps: 0,
      startMs: 0,
      endMs: 0
    )
  }

  static func forVideo(_ raw: [String: Any]?) -> StaticOptions {
    return StaticOptions(
      maxPoses: count(raw?["maxPoses"], 1),
      angles: JS.bool(raw?["angles"]) ?? true,
      worldLandmarks: JS.bool(raw?["worldLandmarks"]) ?? false,
      smoothing: JS.bool(raw?["smoothing"]) ?? true,
      fps: count(raw?["fps"], 10),
      startMs: max(0, Int64(JS.number(raw?["startMs"]) ?? 0)),
      endMs: JS.number(raw?["endMs"]).map { Int64($0) } ?? -1
    )
  }

  private static func count(_ value: Any?, _ fallback: Int) -> Int {
    guard let number = JS.number(value) else { return fallback }
    return max(1, Int(number))
  }
}

struct StaticDetectionError: LocalizedError {
  let message: String

  init(_ message: String) {
    self.message = message
  }

  var errorDescription: String? {
    return message
  }
}

/**
 The same detector, without a camera.

 Neither of these calibrates or paces itself. There is no live frame budget to hit: a still image
 has no next frame to be late for, and a video job is already as slow as decoding makes it.
 */
enum StaticDetection {
  private static let millisPerSecond: Int64 = 1_000
  private static let timescale: CMTimeScale = 1_000

  /// Sampling is even, so the filter is fed the interval it was actually sampled at.
  private static let sampleIntervalSeconds: Float = 0.1

  private static let running = CancelRegistry()

  static func cancel(taskId: Int) {
    running.cancel(taskId)
  }

  /// One entry per detected pose, so a two-person photo decodes to two frames.
  static func detectImage(
    uri: String,
    options: StaticOptions,
    angleJoints: [String],
    selection: [Int]?
  ) throws -> Data {
    guard let image = loadImage(uri: uri) else {
      throw StaticDetectionError("could not read an image from \(uri)")
    }
    let shape = shapeFor(options, angleJoints: angleJoints, selection: selection)

    // No try/finally around the decode, unlike Android: ARC releases the image and the detector
    // when a throw unwinds this frame, so there is no window where either can be stranded.
    let detector = try PoseDetector.createForStillInput(
      modelPath: try requireModel(),
      maxPoses: options.maxPoses,
      video: false
    )
    let result = try detector.detectImage(try MPImage(uiImage: image))

    let width = Int(image.size.width * image.scale)
    let height = Int(image.size.height * image.scale)
    var frames = [[Float]]()
    frames.reserveCapacity(result.landmarks.count)
    for index in result.landmarks.indices {
      frames.append(encodePose(result, poseIndex: index, shape: shape, width: width, height: height, smoothing: nil))
    }
    return write(shape: shape, frames: frames, timestamps: [Double](repeating: 0, count: frames.count))
  }

  /**
   Sampled at `fps`, not at the video's own rate, and run through VIDEO mode with monotonic
   timestamps so temporal tracking behaves the way it does live.

   Sequential rather than `generateCGImagesAsynchronously`, which would decode in parallel but
   deliver out of order: VIDEO mode rejects a timestamp that goes backwards, so the order is the
   requirement and the parallelism is not available.
   */
  static func detectVideo(
    uri: String,
    options: StaticOptions,
    angleJoints: [String],
    selection: [Int]?,
    taskId: Int,
    onProgress: (Float) -> Void
  ) throws -> Data {
    running.begin(taskId)
    defer { running.end(taskId) }

    guard let url = URL(string: uri) ?? URL(string: "file://\(uri)") else {
      throw StaticDetectionError("could not read a video from \(uri)")
    }
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // The sample times are already spaced by the requested fps, so snapping to the nearest keyframe
    // within half a step is free accuracy nobody asked for and decodes far faster.
    let tolerance = CMTime(value: CMTimeValue(millisPerSecond / Int64(max(1, options.fps)) / 2), timescale: timescale)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance

    let shape = shapeFor(options, angleJoints: angleJoints, selection: selection)
    let smoothing = options.smoothing ? OneEuroFilter() : nil
    let detector = try PoseDetector.createForStillInput(
      modelPath: try requireModel(),
      maxPoses: options.maxPoses,
      video: true
    )

    let durationMs = durationMilliseconds(of: asset)
    let start = min(options.startMs, durationMs)
    let end = (options.endMs >= 1 && options.endMs <= durationMs) ? options.endMs : durationMs
    let stepMs = max(1, millisPerSecond / Int64(max(1, options.fps)))
    let span = max(1, end - start)

    var frames = [[Float]]()
    var timestamps = [Double]()
    var positionMs = start

    while positionMs <= end && !running.isCancelled(taskId) {
      let time = CMTime(value: CMTimeValue(positionMs), timescale: timescale)
      if let cgImage = copyFrame(from: generator, at: time) {
        let image = UIImage(cgImage: cgImage)
        let result = try detector.detectVideo(try MPImage(uiImage: image), timestampMs: Int(positionMs))
        if !result.landmarks.isEmpty {
          frames.append(encodePose(
            result,
            poseIndex: 0,
            shape: shape,
            width: cgImage.width,
            height: cgImage.height,
            smoothing: smoothing
          ))
          timestamps.append(Double(positionMs))
        }
      }

      onProgress(min(1, max(0, Float(positionMs - start) / Float(span))))
      positionMs += stepMs
    }

    onProgress(1)
    return write(shape: shape, frames: frames, timestamps: timestamps)
  }

  // MARK: - Decoding

  /**
   `copyCGImage` and `duration` are what iOS 16 replaced with `image(at:)` and `load(.duration)`,
   both of which are async and neither of which exists on 15.1, the floor this package supports.
   Both calls warn, deliberately, and both are isolated here so the warning names the one decision
   behind them rather than appearing wherever a frame happens to be read. See docs/native-modules.md.

   Marking these `@available(iOS, deprecated: 16.0)` would move the warning to their call sites
   rather than remove it, so the annotation is left off and the reason written down instead.
   */
  static func copyFrame(from generator: AVAssetImageGenerator, at time: CMTime) -> CGImage? {
    return try? generator.copyCGImage(at: time, actualTime: nil)
  }

  static func durationMilliseconds(of asset: AVURLAsset) -> Int64 {
    let seconds = CMTimeGetSeconds(asset.duration)
    guard seconds.isFinite, seconds > 0 else { return 0 }
    return Int64(seconds * Double(millisPerSecond))
  }

  static func loadImage(uri: String) -> UIImage? {
    guard let url = URL(string: uri), url.scheme != nil else {
      return UIImage(contentsOfFile: uri)
    }
    if url.isFileURL {
      return UIImage(contentsOfFile: url.path)
    }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return UIImage(data: data)
  }

  static func requireModel() throws -> String {
    guard let path = PoseDetector.findModelPath() else {
      throw StaticDetectionError("No pose model is bundled. Run the CLI or prebuild first.")
    }
    return path
  }

  // MARK: - Encoding

  private static func shapeFor(_ options: StaticOptions, angleJoints: [String], selection: [Int]?) -> FrameShape {
    return FrameShape(
      jointIndices: selection ?? FrameShape.allJoints,
      worldLandmarks: options.worldLandmarks,
      angleJoints: options.angles ? angleJoints : []
    )
  }

  /// The same block order the live path writes, because it is the same decoder on the other side.
  private static func encodePose(
    _ result: PoseLandmarkerResult,
    poseIndex: Int,
    shape: FrameShape,
    width: Int,
    height: Int,
    smoothing: OneEuroFilter?
  ) -> [Float] {
    var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
    let pose = result.landmarks[poseIndex]

    for index in 0..<min(Skeleton.landmarkCount, pose.count) {
      let point = pose[index]
      let base = index * Skeleton.landmarkStride
      landmarks[base] = point.x
      landmarks[base + 1] = point.y
      landmarks[base + 2] = point.z
      landmarks[base + 3] = point.visibility?.floatValue ?? 0
    }

    smoothing?.apply(to: &landmarks, elapsedSeconds: sampleIntervalSeconds)

    var frame = [Float](repeating: 0, count: shape.floatsPerFrame)
    var cursor = 0

    for joint in shape.jointIndices {
      let base = joint * Skeleton.landmarkStride
      for offset in 0..<Skeleton.landmarkStride {
        frame[cursor + offset] = landmarks[base + offset]
      }
      cursor += Skeleton.landmarkStride
    }

    if shape.worldLandmarks {
      let world = result.worldLandmarks
      let points = world.count > poseIndex ? world[poseIndex] : nil
      for joint in shape.jointIndices {
        let point = (points?.count ?? 0) > joint ? points?[joint] : nil
        frame[cursor] = point?.x ?? 0
        frame[cursor + 1] = point?.y ?? 0
        frame[cursor + 2] = point?.z ?? 0
        frame[cursor + 3] = point?.visibility?.floatValue ?? 0
        cursor += Skeleton.landmarkStride
      }
    }

    for triple in shape.angleTriples {
      frame[cursor] = Geometry.angleDegrees(
        landmarks,
        proximal: triple[0],
        vertex: triple[1],
        distal: triple[2],
        frameWidth: width,
        frameHeight: height
      )
      cursor += 1
    }

    Geometry.centerOfMass(landmarks, into: &frame, at: cursor)
    cursor += 2
    // Velocity needs a previous frame this path does not keep. Unknown, not zero.
    frame[cursor] = .nan
    frame[cursor + 1] = .nan
    cursor += 2
    frame[cursor] = Geometry.bodySpan(landmarks)

    return frame
  }

  private static func write(shape: FrameShape, frames: [[Float]], timestamps: [Double]) -> Data {
    var buffer = WireWriter.allocate(shape: shape, frameCount: frames.count, droppedCount: 0)
    guard !frames.isEmpty else { return buffer }

    for (index, frame) in frames.enumerated() {
      WireWriter.writeMeta(
        into: &buffer,
        frameIndex: index,
        timestampMs: index < timestamps.count ? timestamps[index] : 0,
        processingMs: 0
      )
      WireWriter.writeFrame(
        into: &buffer,
        frameCount: frames.count,
        frameIndex: index,
        from: frame,
        sourceOffset: 0,
        count: shape.floatsPerFrame
      )
    }
    return buffer
  }
}
