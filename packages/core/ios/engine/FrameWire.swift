import Foundation

enum DataMode {
  case off
  case throttled
  case batched
  case live

  static func from(_ value: String?) -> DataMode {
    switch value {
    case "live": return .live
    case "batched": return .batched
    case "throttled": return .throttled
    default: return .off
    }
  }
}

/**
 The layout of `src/wire.ts`, restated. Every block length is derivable from the header, so a drain
 that arrives after the props that shaped it changed is decoded correctly or rejected. Any
 divergence from the TypeScript constants is a bug even when each side looks right alone.
 */
enum Wire {
  static let headerFloat64s = 6

  static let indexFrameCount = 0
  static let indexDroppedCount = 1
  static let indexFloatsPerFrame = 2
  static let indexJointCount = 3
  static let indexAngleCount = 4
  static let indexFlags = 5

  static let frameMetaFloat64s = 2

  static let flagWorldLandmarks = 1 << 0
  static let flagAngles = 1 << 1

  /// com.x, com.y, velocity.x, velocity.y, bodySpan.
  static let scalarsPerFrame = 5

  static let bytesPerFloat64 = 8
  static let bytesPerFloat32 = 4

  static func byteLength(frameCount: Int, floatsPerFrame: Int) -> Int {
    return (headerFloat64s + frameCount * frameMetaFloat64s) * bytesPerFloat64
      + frameCount * floatsPerFrame * bytesPerFloat32
  }

  /// Where the Float32 body starts, which is where the header and every frame's metadata end.
  static func bodyOffset(frameCount: Int) -> Int {
    return (headerFloat64s + frameCount * frameMetaFloat64s) * bytesPerFloat64
  }
}

/// The delivery half of `data`. The payload half is `FrameShape`.
struct DataSettings {
  let mode: DataMode
  let throttleMs: Int64
  let flushMs: Int64
  let landmarks: Bool
  let worldLandmarks: Bool
}

/**
 What `data.*` asked for, resolved once per props update rather than per frame. `jointIndices`
 holds exactly the joints the buffer carries, in the order `data.select` named them, and is empty
 when `data.landmarks` is false.
 */
final class FrameShape {
  static let allJoints = Array(0..<Skeleton.landmarkCount)
  private static let emptyTriple = [0, 0, 0]

  let jointIndices: [Int]
  let worldLandmarks: Bool
  /// In `ANGLE_JOINT_NAMES` order. JavaScript applies the same rule, so neither side sends it.
  let angleJoints: [String]

  let angleTriples: [[Int]]
  let jointCount: Int
  let angleCount: Int
  let floatsPerFrame: Int
  let flags: Int

  /**
   The buffer one frame is encoded into, sized for this shape and owned by it. It lives here rather
   than beside the shape so that adopting a new layout is a single reference swap. Two fields left
   a window where an old shape could be read with a new, longer scratch, and the frame written into
   it would carry zeros past the old cursor.
   */
  var scratch: [Float]

  init(jointIndices: [Int], worldLandmarks: Bool, angleJoints: [String]) {
    self.jointIndices = jointIndices
    self.worldLandmarks = worldLandmarks
    self.angleJoints = angleJoints
    self.angleTriples = angleJoints.map { Skeleton.angleTriple($0) ?? FrameShape.emptyTriple }
    self.jointCount = jointIndices.count
    self.angleCount = angleJoints.count
    self.floatsPerFrame = jointIndices.count * Skeleton.landmarkStride * (worldLandmarks ? 2 : 1)
      + angleJoints.count
      + Wire.scalarsPerFrame
    self.flags = (worldLandmarks ? Wire.flagWorldLandmarks : 0)
      | (angleJoints.isEmpty ? 0 : Wire.flagAngles)
    self.scratch = [Float](repeating: 0, count: floatsPerFrame)
  }

  func sameAs(_ other: FrameShape) -> Bool {
    return worldLandmarks == other.worldLandmarks
      && jointIndices == other.jointIndices
      && angleJoints == other.angleJoints
  }
}

/**
 Builds the buffer JavaScript decodes. The live ring buffer and the static-input path both write
 through this, so the layout exists once: a second copy of these offsets is how the two would come
 to disagree while each looked right on its own.

 Native byte order throughout, which on every Apple target is little-endian, and which is what
 `storeBytes` writes. JavaScript reads this memory through typed arrays in the same process, and
 those use the platform's order and cannot be told otherwise.
 */
enum WireWriter {
  /// A header sized for `frameCount` frames, with the body left zeroed for the caller to fill.
  static func allocate(shape: FrameShape, frameCount: Int, droppedCount: Int) -> Data {
    var buffer = Data(count: Wire.byteLength(frameCount: frameCount, floatsPerFrame: shape.floatsPerFrame))
    buffer.withUnsafeMutableBytes { raw in
      guard let base = raw.baseAddress else { return }
      putDouble(base, Wire.indexFrameCount, Double(frameCount))
      putDouble(base, Wire.indexDroppedCount, Double(droppedCount))
      putDouble(base, Wire.indexFloatsPerFrame, Double(shape.floatsPerFrame))
      putDouble(base, Wire.indexJointCount, Double(shape.jointCount))
      putDouble(base, Wire.indexAngleCount, Double(shape.angleCount))
      putDouble(base, Wire.indexFlags, Double(shape.flags))
    }
    return buffer
  }

  /// A bare header. Decodes to no frames rather than to a malformed buffer.
  static func empty() -> Data {
    return Data(count: Wire.headerFloat64s * Wire.bytesPerFloat64)
  }

  /// The two Float64s that precede the body for one frame: when it was taken, and what it cost.
  static func writeMeta(into buffer: inout Data, frameIndex: Int, timestampMs: Double, processingMs: Double) {
    buffer.withUnsafeMutableBytes { raw in
      guard let base = raw.baseAddress else { return }
      let slot = Wire.headerFloat64s + frameIndex * Wire.frameMetaFloat64s
      putDouble(base, slot, timestampMs)
      putDouble(base, slot + 1, processingMs)
    }
  }

  /// One frame's Float32 block, copied out of `source` starting at `sourceOffset`.
  static func writeFrame(
    into buffer: inout Data,
    frameCount: Int,
    frameIndex: Int,
    from source: [Float],
    sourceOffset: Int,
    count: Int
  ) {
    let byteOffset = Wire.bodyOffset(frameCount: frameCount) + frameIndex * count * Wire.bytesPerFloat32
    buffer.withUnsafeMutableBytes { raw in
      guard let base = raw.baseAddress else { return }
      source.withUnsafeBytes { src in
        guard let srcBase = src.baseAddress else { return }
        base.advanced(by: byteOffset).copyMemory(
          from: srcBase.advanced(by: sourceOffset * Wire.bytesPerFloat32),
          byteCount: count * Wire.bytesPerFloat32
        )
      }
    }
  }

  private static func putDouble(_ base: UnsafeMutableRawPointer, _ slot: Int, _ value: Double) {
    base.storeBytes(of: value, toByteOffset: slot * Wire.bytesPerFloat64, as: Double.self)
  }
}
