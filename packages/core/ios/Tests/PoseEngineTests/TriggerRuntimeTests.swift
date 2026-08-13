import XCTest
@testable import PoseEngine

/// A condition the test drives directly, so the state machine is tested apart from the geometry.
private final class Switch: PoseCondition {
  var on = false

  func matches(_ frame: FrameContext) -> Bool {
    return on
  }
}

final class TriggerRuntimeTests: XCTestCase {
  private let enter = Switch()
  private let exit = Switch()
  private let frame = FrameContext()

  override func setUp() {
    super.setUp()
    enter.on = false
    exit.on = false
  }

  private func spec(
    _ emit: TriggerEmit,
    id: String = "rep",
    debounceMs: Int64 = 0,
    minDurationMs: Int64 = 0,
    throttleMs: Int64 = 250,
    snapshot: Bool = false,
    exitCondition: (any PoseCondition)? = nil
  ) -> TriggerSpec {
    return TriggerSpec(
      id: id,
      enter: enter,
      exit: exitCondition ?? exit,
      emit: emit,
      debounceMs: debounceMs,
      minDurationMs: minDurationMs,
      snapshot: snapshot,
      throttleMs: throttleMs
    )
  }

  private func runtime(
    _ emit: TriggerEmit,
    debounceMs: Int64 = 0,
    minDurationMs: Int64 = 0,
    throttleMs: Int64 = 250,
    snapshot: Bool = false,
    exitCondition: (any PoseCondition)? = nil
  ) -> TriggerRuntime {
    return TriggerRuntime(spec: spec(
      emit,
      debounceMs: debounceMs,
      minDurationMs: minDurationMs,
      throttleMs: throttleMs,
      snapshot: snapshot,
      exitCondition: exitCondition
    ))
  }

  func testEmitCycleFiresOncePerEnterThenExitWithTheDurationBetweenThem() throws {
    let trigger = runtime(.cycle)

    enter.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1000), "entering does not fire a cycle")

    enter.on = false
    exit.on = true
    let firing = try XCTUnwrap(trigger.evaluate(frame, nowMs: 1400))

    XCTAssertEqual(firing.phase, "cycle")
    XCTAssertEqual(firing.count, 1)
    XCTAssertEqual(try XCTUnwrap(firing.durationMs), 400)
  }

  func testEmitEnterFiresOnTheWayInAndNothingOnTheWayOut() throws {
    let trigger = runtime(.enter)

    enter.on = true
    let entering = try XCTUnwrap(trigger.evaluate(frame, nowMs: 1000))
    XCTAssertEqual(entering.phase, "enter")
    XCTAssertEqual(entering.count, 0, "count is completed cycles, and none has completed")

    enter.on = false
    exit.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1100))
  }

  func testEmitExitFiresOnTheWayOutOnly() throws {
    let trigger = runtime(.exit)

    enter.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1000))

    exit.on = true
    let firing = try XCTUnwrap(trigger.evaluate(frame, nowMs: 1100))
    XCTAssertEqual(firing.phase, "exit")
    XCTAssertEqual(firing.count, 1)
    XCTAssertNil(firing.durationMs, "only a cycle carries a duration")
  }

  func testCountCountsCompletedCyclesWhateverTheEmitModeIs() throws {
    let trigger = runtime(.enter)

    for cycle in 1...3 {
      enter.on = true
      exit.on = false
      _ = trigger.evaluate(frame, nowMs: Int64(cycle) * 1000)
      enter.on = false
      exit.on = true
      _ = trigger.evaluate(frame, nowMs: Int64(cycle) * 1000 + 100)
    }

    enter.on = true
    exit.on = false
    XCTAssertEqual(try XCTUnwrap(trigger.evaluate(frame, nowMs: 9000)).count, 3)
  }

  func testWithoutAnExitConditionLeavingEnterIsWhatReturnsItToIdle() {
    // NotCondition(enter) is what the parser substitutes for an absent exit.
    let trigger = runtime(.enter, exitCondition: NotCondition(inner: enter))

    enter.on = true
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1000))

    enter.on = false
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1100))

    enter.on = true
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1200), "a second entry has to be possible")
  }

  func testMinDurationRequiresTheConditionToHoldAndABreakRestartsTheClock() {
    let trigger = runtime(.enter, minDurationMs: 300)

    enter.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1000))
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1200))

    enter.on = false
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1250))

    enter.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1300), "the hold restarted, so 1400 is only 100ms in")
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1500))
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1650))
  }

  func testDebounceSuppressesTheNextEntryNotTheMeasurement() {
    let trigger = runtime(.enter, debounceMs: 500)

    enter.on = true
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1000))

    enter.on = false
    exit.on = true
    _ = trigger.evaluate(frame, nowMs: 1100)

    enter.on = true
    exit.on = false
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1300), "still inside the debounce window")
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1600))
  }

  func testEmitWhileRepeatsOnItsThrottleForAsLongAsEnterHolds() throws {
    let trigger = runtime(.whileActive, throttleMs: 250)

    enter.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1000), "going active is not a while emission")

    let first = try XCTUnwrap(trigger.evaluate(frame, nowMs: 1050))
    XCTAssertEqual(first.phase, "enter")

    XCTAssertNil(trigger.evaluate(frame, nowMs: 1200), "inside the throttle window")
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1310))

    exit.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1400), "exiting is not a while emission")
  }

  func testLosingThePoseBreaksAHoldWithoutAbandoningAnActiveTrigger() {
    let trigger = runtime(.cycle, minDurationMs: 200)

    enter.on = true
    _ = trigger.evaluate(frame, nowMs: 1000)
    _ = trigger.evaluate(frame, nowMs: 1250)

    // Mid-rep, the subject steps out of frame.
    trigger.onPoseLost()

    enter.on = false
    exit.on = true
    XCTAssertNil(trigger.evaluate(frame, nowMs: 1300), "the exit hold starts fresh")
    XCTAssertNotNil(trigger.evaluate(frame, nowMs: 1550), "and completes normally once it has held")
  }

  func testASnapshotTriggerAsksForOneAndAPlainOneDoesNot() throws {
    let plain = runtime(.enter)
    let withSnapshot = runtime(.enter, snapshot: true)

    enter.on = true
    XCTAssertFalse(try XCTUnwrap(plain.evaluate(frame, nowMs: 1000)).wantsSnapshot)
    XCTAssertTrue(try XCTUnwrap(withSnapshot.evaluate(frame, nowMs: 1000)).wantsSnapshot)
  }

  func testTheEngineCarriesCountsAcrossAPropsUpdateButNotAcrossARebuildById() throws {
    let engine = TriggerEngine()
    engine.setTriggers([spec(.cycle)])

    var fired = [TriggerFiring]()
    enter.on = true
    engine.evaluate(frame, nowMs: 1000, into: &fired)
    enter.on = false
    exit.on = true
    engine.evaluate(frame, nowMs: 1100, into: &fired)
    XCTAssertEqual(fired.count, 1)
    XCTAssertEqual(try XCTUnwrap(fired.first).count, 1)

    // A re-render is not an unmount.
    engine.setTriggers([spec(.cycle)])
    fired.removeAll()
    enter.on = true
    exit.on = false
    engine.evaluate(frame, nowMs: 1200, into: &fired)
    enter.on = false
    exit.on = true
    engine.evaluate(frame, nowMs: 1300, into: &fired)
    XCTAssertEqual(try XCTUnwrap(fired.first).count, 2, "the count survived")

    // A different id is a different trigger, and starts from zero.
    engine.setTriggers([spec(.cycle, id: "other")])
    fired.removeAll()
    enter.on = true
    exit.on = false
    engine.evaluate(frame, nowMs: 1400, into: &fired)
    enter.on = false
    exit.on = true
    engine.evaluate(frame, nowMs: 1500, into: &fired)
    XCTAssertEqual(try XCTUnwrap(fired.first).count, 1)
  }
}
