import Foundation

/**
 One monotonic clock for the whole module.

 Everything that gets compared or subtracted has to come from the same source: log entries are
 stamped with it, frames carry it, and the trigger state machine measures holds against it. Wall
 clock time is not usable for any of that, because it can step backwards.

 `CLOCK_UPTIME_RAW` is the direct read of the same counter `mach_absolute_time` uses, without the
 unit conversion, and it does not advance while the device is asleep. Android's counterpart is
 `SystemClock.elapsedRealtime`, which does advance across sleep, so the two differ after a device
 has been suspended. Nothing here compares a timestamp to one taken on the other platform.
 */
enum Monotonic {
  private static let nanosPerMilli: UInt64 = 1_000_000

  static func nowNanos() -> UInt64 {
    return clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
  }

  static func nowMs() -> Int64 {
    return Int64(nowNanos() / nanosPerMilli)
  }
}
