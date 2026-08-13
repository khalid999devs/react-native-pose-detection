import XCTest
@testable import PoseEngine

final class TriggerParsingTests: XCTestCase {
  func testAnAbsentDurationFallsBackAndAPresentOneIsTaken() {
    XCTAssertEqual(duration(nil, 250), 250)
    XCTAssertEqual(duration(40, 250), 40)
    XCTAssertEqual(duration(40.7, 250), 40)
  }

  func testANegativeDurationIsFlooredRatherThanTrusted() {
    XCTAssertEqual(duration(-5, 250), 0)
    XCTAssertEqual(duration(-5, 250, floor: 1), 1)
  }

  func testAZeroThrottleIsFlooredToOneBecauseEmitWhilePromisesNotToFireEveryFrame() {
    // Zero would put the whole trigger payload allocation into the steady-state frame path.
    XCTAssertEqual(duration(0, 250, floor: 1), 1)
    // Debounce and minDuration are genuinely allowed to be zero: that means no delay.
    XCTAssertEqual(duration(0, 0), 0)
  }

  func testABooleanIsNotANumberSoSmoothingTrueIsNotAMinCutoffOfOne() {
    // Bool bridges to NSNumber as 1, which would read `{ snapshot: true }` as a duration.
    XCTAssertEqual(duration(true, 250), 250)
    XCTAssertTrue(bound(true).isNaN)
  }

  func testAnAbsentExitBecomesTheNegationOfEnterRatherThanAConditionThatNeverMatches() throws {
    let parsed = parseTriggers([[
      "id": "rep",
      "enter": ["visibility": "leftKnee", "above": 0.5]
    ]])
    XCTAssertEqual(parsed.count, 1)

    let frame = FrameContext()
    var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
    landmarks[Skeleton.leftKnee * Skeleton.landmarkStride + Skeleton.offsetVisibility] = 0.9
    frame.landmarks = landmarks

    let spec = try XCTUnwrap(parsed.first)
    XCTAssertTrue(spec.enter.matches(frame))
    XCTAssertFalse(spec.exit.matches(frame), "exit is the negation of enter while enter holds")
  }

  func testAConditionNamingSomethingThatIsNotAJointNeverMatches() {
    let frame = FrameContext()
    frame.landmarks = [Float](repeating: 1, count: Skeleton.landmarkCount * Skeleton.landmarkStride)

    XCTAssertFalse(parseCondition(["visibility": "elbow"]).matches(frame))
    XCTAssertFalse(parseCondition(["angle": "nose"]).matches(frame), "nose is not an angle joint")
    XCTAssertFalse(parseCondition(["nothing": "at all"]).matches(frame))
    XCTAssertFalse(parseCondition("not an object").matches(frame))
  }
}
