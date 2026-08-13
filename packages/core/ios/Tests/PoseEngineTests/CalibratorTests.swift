import XCTest
@testable import PoseEngine

/**
 The governor: the loop that turns measured inference cost into a rate and a tier. The numbers
 here are the contract `guides/performance.md` describes, so a change that moves them should have
 to come here and say so.
 */
final class CalibratorTests: XCTestCase {
  private var suiteName = ""
  private var defaults = UserDefaults.standard

  override func setUpWithError() throws {
    try super.setUpWithError()
    suiteName = "pose-calibrator-tests-\(UUID().uuidString)"
    defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
  }

  override func tearDown() {
    defaults.removePersistentDomain(forName: suiteName)
    super.tearDown()
  }

  /// Feeds a steady inference cost at a camera-like cadence, returning whether anything moved.
  @discardableResult
  private func feed(
    _ calibrator: Calibrator,
    ms: Float,
    count: Int,
    from startMs: Int64,
    stepMs: Int64 = 33
  ) -> (moved: Bool, endMs: Int64) {
    var moved = false
    var now = startMs
    for _ in 0..<count {
      if calibrator.record(inferenceMs: ms, nowMs: now) { moved = true }
      now += stepMs
    }
    return (moved, now)
  }

  func testTheRateIsTheDevicesOwnNumberNotATierStep() {
    XCTAssertEqual(AutoTuner.targetFps(p50Ms: 14), 39)
    XCTAssertEqual(AutoTuner.targetFps(p50Ms: 16), 34)
    XCTAssertEqual(AutoTuner.targetFps(p50Ms: 20), 28)
    XCTAssertEqual(AutoTuner.targetFps(p50Ms: 33), 17)
  }

  func testTheRateIsClampedToTheBandTheSkeletonIsUsableIn() {
    XCTAssertEqual(AutoTuner.targetFps(p50Ms: 5), AutoTuner.maxFps, "no rate buys anything past the cap")
    XCTAssertEqual(AutoTuner.targetFps(p50Ms: 100), AutoTuner.minFps, "below the floor heat should pause instead")
  }

  func testTheTierFollowsTheSiliconNotTheRate() {
    XCTAssertEqual(AutoTuner.tier(p50Ms: 14), .high)
    XCTAssertEqual(AutoTuner.tier(p50Ms: 22), .high)
    XCTAssertEqual(AutoTuner.tier(p50Ms: 23), .medium)
    XCTAssertEqual(AutoTuner.tier(p50Ms: 45), .medium)
    XCTAssertEqual(AutoTuner.tier(p50Ms: 46), .low)
  }

  func testAFullWindowOfFastFramesMovesTheTierUpAndSetsTheRate() {
    let calibrator = Calibrator(defaults: defaults)
    calibrator.start(modelFileName: "pose_landmarker_full.task")

    let warmup = feed(calibrator, ms: 20, count: 59, from: 1_000)
    XCTAssertFalse(warmup.moved, "59 frames is not a window")
    XCTAssertEqual(calibrator.autoFps, 0)

    let (moved, _) = feed(calibrator, ms: 20, count: 1, from: warmup.endMs)
    XCTAssertTrue(moved)
    XCTAssertEqual(calibrator.tier, .high)
    XCTAssertEqual(calibrator.autoFps, 28)
  }

  func testASteadyDeviceSettlesInsteadOfTwitching() {
    let calibrator = Calibrator(defaults: defaults)
    calibrator.start(modelFileName: "pose_landmarker_full.task")

    let first = feed(calibrator, ms: 20, count: 60, from: 1_000)
    // Two more windows: one waiting out the cooldown, one to observe nothing left to move.
    let second = feed(calibrator, ms: 20, count: 120, from: first.endMs)
    XCTAssertTrue(second.moved, "settling is reported once so it can be persisted")
    XCTAssertEqual(calibrator.phase, .settled)

    let third = feed(calibrator, ms: 21, count: 120, from: second.endMs)
    XCTAssertFalse(third.moved, "a one millisecond wobble is inside the deadband")
    XCTAssertEqual(calibrator.autoFps, 28, "the rate did not chase it")
  }

  func testALoadedDeviceIsWalkedDownToWhatItSustains() {
    let calibrator = Calibrator(defaults: defaults)
    calibrator.start(modelFileName: "pose_landmarker_full.task")
    let fast = feed(calibrator, ms: 20, count: 180, from: 1_000)

    let (moved, _) = feed(calibrator, ms: 60, count: 180, from: fast.endMs)
    XCTAssertTrue(moved)
    XCTAssertEqual(calibrator.tier, .low)
    XCTAssertEqual(calibrator.autoFps, AutoTuner.minFps)
  }

  func testTheSecondLaunchStartsWhereTheFirstOneFinished() {
    let first = Calibrator(defaults: defaults)
    first.start(modelFileName: "pose_landmarker_full.task")
    feed(first, ms: 20, count: 300, from: 1_000)
    XCTAssertEqual(first.phase, .settled)
    first.persist(modelFileName: "pose_landmarker_full.task")

    let second = Calibrator(defaults: defaults)
    second.start(modelFileName: "pose_landmarker_full.task")
    XCTAssertEqual(second.phase, .cached)
    XCTAssertEqual(second.tier, .high)
    XCTAssertEqual(second.autoFps, 28, "the measured rate rides the cache with the tier")
  }
}
