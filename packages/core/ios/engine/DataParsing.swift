import Foundation

let defaultThrottleMs: Int64 = 100
let defaultFlushMs: Int64 = 500

/// `data.angles` and `data.select` are not read here: they arrive resolved, as their own props.
func parseData(_ raw: [String: Any]?) -> DataSettings {
  guard let raw = raw else {
    return DataSettings(
      mode: .off,
      throttleMs: defaultThrottleMs,
      flushMs: defaultFlushMs,
      landmarks: true,
      worldLandmarks: false
    )
  }

  return DataSettings(
    mode: DataMode.from(JS.string(raw["mode"])),
    // A zero or negative interval would emit on every frame under a name that promises not to.
    throttleMs: duration(raw["throttleMs"], defaultThrottleMs, floor: 1),
    flushMs: duration(raw["flushMs"], defaultFlushMs, floor: 1),
    landmarks: JS.bool(raw["landmarks"]) ?? true,
    worldLandmarks: JS.bool(raw["worldLandmarks"]) ?? false
  )
}

/// In the order named, which is the order `PoseFrame.selection` promises. Unknown names drop out.
func parseSelection(_ names: [String]) -> [Int] {
  var indices = [Int]()
  indices.reserveCapacity(names.count)
  for name in names {
    let index = Skeleton.indexOf(name)
    if index >= 0 {
      indices.append(index)
    } else {
      PoseLog.warn(.detector, "data.select named \(name), which is not a joint")
    }
  }
  return indices
}
