import XCTest
@testable import PoseEngine

/**
 These assert the buffer `src/frames/decodeFrames.ts` will be handed. The checks below are the ones
 that decoder performs, restated: if a change here passes and that decoder would reject it, the two
 have diverged and this suite is where it should surface, not on a device.
 */
final class FrameRingBufferTests: XCTestCase {
  /// Mirrors the ring buffer's own capacity. A change there should fail these tests.
  private let capacity = 64

  private func shape(
    joints: [Int] = FrameShape.allJoints,
    world: Bool = false,
    angles: [String] = []
  ) -> FrameShape {
    return FrameShape(jointIndices: joints, worldLandmarks: world, angleJoints: angles)
  }

  private func buffer(_ shape: FrameShape) -> FrameRingBuffer {
    let frames = FrameRingBuffer()
    frames.setLayout(shape)
    return frames
  }

  /// A frame whose every float is `seed + index`, so a misplaced block is visible as a wrong number.
  private func frame(_ shape: FrameShape, _ seed: Float) -> [Float] {
    return (0..<shape.floatsPerFrame).map { seed + Float($0) }
  }

  private func header(_ raw: Data, _ index: Int) -> Double {
    return raw.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: index * Wire.bytesPerFloat64, as: Double.self) }
  }

  private func meta(_ raw: Data, frame: Int, field: Int) -> Double {
    let slot = Wire.headerFloat64s + frame * Wire.frameMetaFloat64s + field
    return header(raw, slot)
  }

  private func body(_ raw: Data, _ index: Int) -> Float {
    let frames = Int(header(raw, Wire.indexFrameCount))
    let offset = Wire.bodyOffset(frameCount: frames) + index * Wire.bytesPerFloat32
    return raw.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: Float.self) }
  }

  /// The block arithmetic `decodeFrames` rejects a buffer over.
  private func assertBlocksAddUp(_ raw: Data, file: StaticString = #filePath, line: UInt = #line) {
    let floatsPerFrame = Int(header(raw, Wire.indexFloatsPerFrame))
    let jointCount = Int(header(raw, Wire.indexJointCount))
    let angleCount = Int(header(raw, Wire.indexAngleCount))
    let flags = Int(header(raw, Wire.indexFlags))

    let landmarkFloats = jointCount * Skeleton.landmarkStride
    let hasWorld = flags & Wire.flagWorldLandmarks != 0
    let hasAngles = flags & Wire.flagAngles != 0
    let blocks = landmarkFloats * (hasWorld ? 2 : 1) + (hasAngles ? angleCount : 0) + Wire.scalarsPerFrame

    XCTAssertEqual(floatsPerFrame, blocks, "blocks must add up to the stride", file: file, line: line)

    let frameCount = Int(header(raw, Wire.indexFrameCount))
    XCTAssertEqual(
      Wire.byteLength(frameCount: frameCount, floatsPerFrame: floatsPerFrame),
      raw.count,
      "byte length must be exactly what the header implies",
      file: file,
      line: line
    )
  }

  func testAnEmptyDrainIsABareHeader() {
    let raw = buffer(shape()).drain()

    XCTAssertEqual(raw.count, Wire.headerFloat64s * Wire.bytesPerFloat64)
    XCTAssertEqual(header(raw, Wire.indexFrameCount), 0)
    XCTAssertEqual(header(raw, Wire.indexDroppedCount), 0)
  }

  func testTheBufferIsInThePlatformsByteOrderWhichIsWhatATypedArrayReads() {
    let shape = shape()
    let frames = buffer(shape)
    frames.submit(frame(shape, 1), timestampMs: 10, processingMs: 2, buffered: true)

    // A little-endian read of the header only agrees with the native read on a little-endian
    // platform, which every Apple target is. Storing through `storeBytes` writes native order.
    let raw = frames.drain()
    let native = header(raw, Wire.indexFrameCount)
    let little = raw.withUnsafeBytes { $0.loadUnaligned(as: UInt64.self) }
    XCTAssertEqual(native.bitPattern, UInt64(littleEndian: little))
  }

  func testTheHeaderDescribesTheLayout() {
    let shape = shape(angles: ["leftKnee", "rightKnee"])
    let frames = buffer(shape)
    frames.submit(frame(shape, 0), timestampMs: 1, processingMs: 0.5, buffered: true)

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexFrameCount), 1)
    XCTAssertEqual(header(raw, Wire.indexFloatsPerFrame), Double(shape.floatsPerFrame))
    XCTAssertEqual(header(raw, Wire.indexJointCount), 33)
    XCTAssertEqual(header(raw, Wire.indexAngleCount), 2)
    XCTAssertEqual(header(raw, Wire.indexFlags), Double(Wire.flagAngles))
    assertBlocksAddUp(raw)
  }

  func testWorldLandmarksDoubleTheLandmarkBlockAndSetTheirFlag() {
    let shape = shape(world: true)
    XCTAssertEqual(shape.floatsPerFrame, 33 * 4 * 2 + Wire.scalarsPerFrame)

    let frames = buffer(shape)
    frames.submit(frame(shape, 0), timestampMs: 1, processingMs: 0, buffered: true)

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexFlags), Double(Wire.flagWorldLandmarks))
    assertBlocksAddUp(raw)
  }

  func testSelectNarrowsTheBufferAndKeepsTheOrderItWasNamedIn() {
    let shape = shape(joints: [Skeleton.rightKnee, Skeleton.leftHip])
    XCTAssertEqual(shape.floatsPerFrame, 2 * 4 + Wire.scalarsPerFrame)

    let frames = buffer(shape)
    frames.submit(frame(shape, 100), timestampMs: 1, processingMs: 0, buffered: true)

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexJointCount), 2)
    assertBlocksAddUp(raw)
  }

  func testLandmarksOffCarriesNoJointsWhichTheDecoderAllows() {
    let shape = shape(joints: [], angles: ["leftElbow"])
    XCTAssertEqual(shape.floatsPerFrame, 1 + Wire.scalarsPerFrame)

    let frames = buffer(shape)
    frames.submit(frame(shape, 0), timestampMs: 1, processingMs: 0, buffered: true)

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexJointCount), 0)
    assertBlocksAddUp(raw)
  }

  func testNoAnglesMeansTheFlagIsClearSoNoAnglesObjectIsBuilt() {
    let shape = shape()
    let frames = buffer(shape)
    frames.submit(frame(shape, 0), timestampMs: 1, processingMs: 0, buffered: true)

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexAngleCount), 0)
    XCTAssertEqual(Int(header(raw, Wire.indexFlags)) & Wire.flagAngles, 0)
  }

  func testFramesComeOutOldestFirstWithTheirOwnTimestamps() {
    let shape = shape()
    let frames = buffer(shape)
    for index in 0..<3 {
      frames.submit(
        frame(shape, Float(index) * 1000),
        timestampMs: 100 + Double(index),
        processingMs: Double(index),
        buffered: true
      )
    }

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexFrameCount), 3)
    assertBlocksAddUp(raw)

    for index in 0..<3 {
      XCTAssertEqual(meta(raw, frame: index, field: 0), 100 + Double(index))
      XCTAssertEqual(meta(raw, frame: index, field: 1), Double(index))
    }

    for index in 0..<3 {
      XCTAssertEqual(body(raw, index * shape.floatsPerFrame), Float(index) * 1000)
    }
  }

  func testAFullBufferDropsTheOldestAndReportsHowMany() {
    let shape = shape()
    let frames = buffer(shape)
    let overflow = 5
    for index in 0..<(capacity + overflow) {
      frames.submit(frame(shape, Float(index)), timestampMs: Double(index), processingMs: 0, buffered: true)
    }

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexFrameCount), Double(capacity))
    XCTAssertEqual(header(raw, Wire.indexDroppedCount), Double(overflow))
    // The oldest survivor is the one right after the last dropped frame.
    XCTAssertEqual(meta(raw, frame: 0, field: 0), Double(overflow))
    assertBlocksAddUp(raw)
  }

  func testADrainEmptiesTheBufferAndTheDroppedCount() {
    let shape = shape()
    let frames = buffer(shape)
    for index in 0..<(capacity + 3) {
      frames.submit(frame(shape, 0), timestampMs: Double(index), processingMs: 0, buffered: true)
    }
    _ = frames.drain()

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexFrameCount), 0)
    XCTAssertEqual(header(raw, Wire.indexDroppedCount), 0)
  }

  func testAnUnbufferedFrameIsStillTheLatestOne() {
    let shape = shape()
    let frames = buffer(shape)
    frames.submit(frame(shape, 7), timestampMs: 42, processingMs: 1, buffered: false)

    XCTAssertEqual(header(frames.drain(), Wire.indexFrameCount), 0)

    let raw = frames.snapshot()
    XCTAssertEqual(header(raw, Wire.indexFrameCount), 1)
    XCTAssertEqual(meta(raw, frame: 0, field: 0), 42)
    XCTAssertEqual(body(raw, 0), 7)
    assertBlocksAddUp(raw)
  }

  func testASnapshotBeforeAnyPoseIsEmptyAndSoIsOneAfterThePoseLeaves() {
    let shape = shape()
    let frames = buffer(shape)
    XCTAssertEqual(header(frames.snapshot(), Wire.indexFrameCount), 0)

    frames.submit(frame(shape, 1), timestampMs: 1, processingMs: 0, buffered: false)
    XCTAssertEqual(header(frames.snapshot(), Wire.indexFrameCount), 1)

    frames.clearLatest()
    XCTAssertEqual(header(frames.snapshot(), Wire.indexFrameCount), 0)
  }

  func testATicketRedeemsOnceAndAnUnknownOneIsEmpty() {
    let shape = shape()
    let frames = buffer(shape)
    let ticket = frames.mintSnapshot(frame(shape, 3), timestampMs: 9, processingMs: 1)
    XCTAssertNotEqual(ticket, 0)

    let claimed = frames.takeSnapshot(ticket)
    XCTAssertEqual(header(claimed, Wire.indexFrameCount), 1)
    XCTAssertEqual(body(claimed, 0), 3)

    XCTAssertEqual(header(frames.takeSnapshot(ticket), Wire.indexFrameCount), 0, "a spent ticket is empty")
    XCTAssertEqual(header(frames.takeSnapshot(9999), Wire.indexFrameCount), 0, "an unknown one too")
  }

  func testALayoutChangeDropsFramesThatCannotBeEncodedUnderTheNewStride() {
    let first = shape()
    let frames = buffer(first)
    frames.submit(frame(first, 1), timestampMs: 1, processingMs: 0, buffered: true)

    let second = shape(angles: ["leftKnee"])
    frames.setLayout(second)

    let raw = frames.drain()
    XCTAssertEqual(header(raw, Wire.indexFrameCount), 0)
    XCTAssertEqual(header(raw, Wire.indexFloatsPerFrame), Double(second.floatsPerFrame))
  }

  func testAnEquivalentLayoutKeepsTheFramesAlreadyBuffered() {
    let frames = buffer(shape(angles: ["leftKnee"]))
    frames.submit(frame(shape(angles: ["leftKnee"]), 1), timestampMs: 1, processingMs: 0, buffered: true)

    // A re-render that changes nothing about data must not throw away a pending flush.
    frames.setLayout(shape(angles: ["leftKnee"]))

    XCTAssertEqual(header(frames.drain(), Wire.indexFrameCount), 1)
  }

  func testEveryAngleJointHasATripleSoNoAngleIsSilentlyEncodedAsZero() {
    let all = Skeleton.angleJointNames
    XCTAssertEqual(all.count, 12)
    for joint in all {
      XCTAssertNotNil(Skeleton.angleTriple(joint), "\(joint) has no triple")
    }
  }
}
