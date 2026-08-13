import Foundation

/**
 One value, readable and writable from more than one thread.

 Swift has no `volatile`, and the Android side leans on it in a dozen places where the main thread
 publishes something the inference thread reads a frame later. A lock around a single load or store
 is the closest correct equivalent: uncontended it is tens of nanoseconds, and every use here is
 read or written a handful of times per frame rather than per landmark.

 Anything hotter than that, the landmark buffers and the wire scratch, stays confined to one thread
 instead of coming through here.
 */
final class Guarded<Value> {
  private let lock = NSLock()
  private var storage: Value

  init(_ value: Value) {
    self.storage = value
  }

  var value: Value {
    get {
      lock.lock()
      defer { lock.unlock() }
      return storage
    }
    set {
      lock.lock()
      storage = newValue
      lock.unlock()
    }
  }

  /// Read and write as one step, for a counter that would otherwise lose an increment.
  func mutate<Result>(_ body: (inout Value) -> Result) -> Result {
    lock.lock()
    defer { lock.unlock() }
    return body(&storage)
  }
}
