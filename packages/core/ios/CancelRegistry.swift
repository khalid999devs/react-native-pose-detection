import Foundation

/**
 Which long-running jobs are cancelled, keyed by the id JavaScript minted for them.

 An entry exists only while its job runs, so cancelling a task nobody started is a no-op rather
 than a note kept for the life of the process. That matters because ids come from a counter in
 JavaScript that never resets: a registry that remembered every cancel would grow for as long as
 the app is open.

 Used by video detection and by export, which are the two things here that can take minutes.
 */
final class CancelRegistry {
  private let lock = NSLock()
  private var cancelled = [Int: Bool]()

  func begin(_ taskId: Int) {
    lock.lock()
    defer { lock.unlock() }
    cancelled[taskId] = false
  }

  func end(_ taskId: Int) {
    lock.lock()
    defer { lock.unlock() }
    cancelled.removeValue(forKey: taskId)
  }

  /// Ignored unless the task is running, which is what keeps this from accumulating.
  func cancel(_ taskId: Int) {
    lock.lock()
    defer { lock.unlock() }
    if cancelled[taskId] != nil {
      cancelled[taskId] = true
    }
  }

  func isCancelled(_ taskId: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled[taskId] == true
  }
}
