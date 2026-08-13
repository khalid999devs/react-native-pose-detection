import XCTest

@testable import PoseEngine

/// Cancellation for the two jobs that can run for minutes: video detection and export.
final class CancelRegistryTests: XCTestCase {

  func testATaskIsNotCancelledUntilItIsAskedToBe() {
    let registry = CancelRegistry()
    registry.begin(1)
    XCTAssertFalse(registry.isCancelled(1))
    registry.cancel(1)
    XCTAssertTrue(registry.isCancelled(1))
  }

  /**
   Ids come from a counter in JavaScript that never resets, so a registry that remembered a cancel
   for a task nobody started would grow for as long as the app is open. This is the memory rule,
   as a test.
   */
  func testCancellingATaskThatNeverStartedIsForgottenRatherThanKept() {
    let registry = CancelRegistry()
    registry.cancel(99)
    XCTAssertFalse(registry.isCancelled(99))

    // And it must not poison the id if it is used later.
    registry.begin(99)
    XCTAssertFalse(registry.isCancelled(99))
  }

  func testEndingATaskClearsItsCancellation() {
    let registry = CancelRegistry()
    registry.begin(7)
    registry.cancel(7)
    registry.end(7)
    XCTAssertFalse(registry.isCancelled(7))
  }

  func testTasksDoNotCancelEachOther() {
    let registry = CancelRegistry()
    registry.begin(1)
    registry.begin(2)
    registry.cancel(2)
    XCTAssertFalse(registry.isCancelled(1))
    XCTAssertTrue(registry.isCancelled(2))
  }

  /// The camera writes from one thread and the cancel arrives on another, which is the whole
  /// reason this holds a lock rather than a plain dictionary.
  func testConcurrentBeginsAndCancelsDoNotCorruptTheRegistry() {
    let registry = CancelRegistry()
    let group = DispatchGroup()
    for taskId in 0..<200 {
      DispatchQueue.global().async(group: group) {
        registry.begin(taskId)
        registry.cancel(taskId)
        XCTAssertTrue(registry.isCancelled(taskId))
        registry.end(taskId)
      }
    }
    group.wait()
    for taskId in 0..<200 {
      XCTAssertFalse(registry.isCancelled(taskId))
    }
  }
}
