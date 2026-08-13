import XCTest
@testable import PoseEngine

final class ConditionsTests: XCTestCase {
  private var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  private var previous = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  private let frame = FrameContext()

  override func setUp() {
    super.setUp()
    landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
    previous = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
    frame.previousLandmarks = nil
    frame.elapsedSeconds = .nan
    frame.comVelocityY = .nan
    frame.frameWidth = 720
    frame.frameHeight = 1280
  }

  private func place(_ joint: Int, _ posX: Float, _ posY: Float, visibility: Float = 1, into buffer: inout [Float]) {
    let base = joint * Skeleton.landmarkStride
    buffer[base] = posX
    buffer[base + 1] = posY
    buffer[base + 2] = 0
    buffer[base + 3] = visibility
  }

  private func place(_ joint: Int, _ posX: Float, _ posY: Float, visibility: Float = 1) {
    place(joint, posX, posY, visibility: visibility, into: &landmarks)
    frame.landmarks = landmarks
  }

  /// A right angle at the knee, laid out so the aspect correction has something to correct.
  private func bendKneeTo90() {
    place(Skeleton.leftHip, 0.5, 0.2)
    place(Skeleton.leftKnee, 0.5, 0.5)
    // 720/1280 means one x unit is 0.5625 y units, so this is 90 degrees only after correction.
    place(Skeleton.leftAnkle, 0.5 + 0.3 / (720.0 / 1280.0), 0.5)
  }

  private func angle(
    below: Float = .nan,
    above: Float = .nan,
    betweenMin: Float = .nan,
    betweenMax: Float = .nan
  ) throws -> AngleCondition {
    let triple = try XCTUnwrap(Skeleton.angleTriple("leftKnee"))
    return AngleCondition(
      proximal: triple[0],
      vertex: triple[1],
      distal: triple[2],
      below: below,
      above: above,
      betweenMin: betweenMin,
      betweenMax: betweenMax
    )
  }

  func testAnAngleIsMeasuredAfterTheAspectCorrectionNotBefore() throws {
    bendKneeTo90()

    let measured = Geometry.angleDegrees(
      landmarks,
      proximal: Skeleton.leftHip,
      vertex: Skeleton.leftKnee,
      distal: Skeleton.leftAnkle,
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight
    )
    XCTAssertEqual(measured, 90, accuracy: 0.5)

    XCTAssertTrue(try angle(below: 95).matches(frame))
    XCTAssertFalse(try angle(below: 85).matches(frame))
    XCTAssertTrue(try angle(above: 85).matches(frame))
  }

  func testBelowAndAboveAreStrictAndBetweenIncludesItsEnds() throws {
    bendKneeTo90()

    XCTAssertFalse(try angle(below: 90).matches(frame), "below is strictly less")
    XCTAssertFalse(try angle(above: 90).matches(frame), "above is strictly greater")
    XCTAssertTrue(try angle(betweenMin: 90, betweenMax: 120).matches(frame), "between includes its ends")
  }

  func testAnUnmeasurableAngleMatchesNothingRatherThanReadingAsZero() throws {
    // Collinear: the vertex has no angle, and Geometry reports NaN rather than 0.
    place(Skeleton.leftHip, 0.5, 0.2)
    place(Skeleton.leftKnee, 0.5, 0.5)
    place(Skeleton.leftAnkle, 0.5, 0.5)

    XCTAssertFalse(try angle(below: 10).matches(frame), "a folded joint would satisfy this if NaN read as 0")
    XCTAssertFalse(try angle(above: 10).matches(frame))
  }

  func testALandmarkBoundNamingAJointComparesAgainstThatJointInTheSameFrame() {
    place(Skeleton.leftWrist, 0.5, 0.20)
    place(Skeleton.leftShoulder, 0.5, 0.40)

    // Origin is top-left, so "above the shoulder" is a smaller y.
    let wristAboveShoulder = LandmarkCondition(
      axis: axisY,
      joint: Skeleton.leftWrist,
      below: .nan,
      belowJoint: Skeleton.leftShoulder,
      above: .nan,
      aboveJoint: noJoint
    )
    XCTAssertTrue(wristAboveShoulder.matches(frame))

    place(Skeleton.leftWrist, 0.5, 0.60)
    XCTAssertFalse(wristAboveShoulder.matches(frame))
  }

  func testVelocityIsUnknownWithoutAComparablePreviousFrame() {
    place(Skeleton.leftWrist, 0.5, 0.5)
    let rising = VelocityCondition(axis: axisY, joint: Skeleton.leftWrist, below: -1, above: .nan)

    frame.previousLandmarks = nil
    frame.elapsedSeconds = .nan
    XCTAssertFalse(rising.matches(frame), "no previous frame means no velocity, not zero velocity")

    place(Skeleton.leftWrist, 0.5, 0.8, into: &previous)
    frame.previousLandmarks = previous
    frame.elapsedSeconds = 0.1
    // Moved 0.3 up over 0.1s, so -3 units per second.
    XCTAssertTrue(rising.matches(frame))
  }

  func testAVelocityNamingCenterOfMassReadsTheOneAlreadyComputedForTheWire() {
    let falling = VelocityCondition(axis: axisY, joint: noJoint, below: .nan, above: 0.5)

    frame.comVelocityY = 1.2
    XCTAssertTrue(falling.matches(frame))

    frame.comVelocityY = 0.1
    XCTAssertFalse(falling.matches(frame))

    frame.comVelocityY = .nan
    XCTAssertFalse(falling.matches(frame))
  }

  func testVisibilityGatesOnTrackingQuality() {
    place(Skeleton.leftKnee, 0.5, 0.5, visibility: 0.8)
    XCTAssertTrue(VisibilityCondition(joint: Skeleton.leftKnee, above: 0.6).matches(frame))

    place(Skeleton.leftKnee, 0.5, 0.5, visibility: 0.4)
    XCTAssertFalse(VisibilityCondition(joint: Skeleton.leftKnee, above: 0.6).matches(frame))
  }

  func testAllNeedsEveryMemberAndAnyNeedsOne() {
    let yes = VisibilityCondition(joint: Skeleton.leftKnee, above: 0.5)
    let no = VisibilityCondition(joint: Skeleton.rightKnee, above: 0.5)
    place(Skeleton.leftKnee, 0.5, 0.5, visibility: 0.9)
    place(Skeleton.rightKnee, 0.5, 0.5, visibility: 0.1)

    XCTAssertTrue(AllCondition(members: [yes, yes]).matches(frame))
    XCTAssertFalse(AllCondition(members: [yes, no]).matches(frame))
    XCTAssertTrue(AnyCondition(members: [no, yes]).matches(frame))
    XCTAssertFalse(AnyCondition(members: [no, no]).matches(frame))
  }

  func testAConditionThatCouldNotBeParsedNeverMatchesAndItsNegationAlwaysDoes() {
    XCTAssertFalse(NeverCondition().matches(frame))
    XCTAssertTrue(NotCondition(inner: NeverCondition()).matches(frame))
  }
}
