import Foundation

/**
 Three stages, in the order `guides/performance.md` describes them.

 1. A static probe of what the device claims to be, biased one step down.
 2. Measured convergence from real inference times, which is the only stage that can be right.
 3. A cache, so the second launch starts where the first one finished.

 Stage 1 is deliberately pessimistic. Ramping up after two seconds is invisible; ramping down after
 visible jank is not.
 */
final class Calibrator {
  enum Phase: String {
    case calibrating
    case settled
    case cached
  }

  enum Source: String {
    case staticProbe = "static"
    case measured
    case cache
  }

  /// Two seconds at 30 fps, which is long enough for a p50 to mean something.
  private static let window = 60

  private static let cooldownMs: Int64 = 3_000
  private static let stepUpRatio: Float = 0.6
  private static let stepDownRatio: Float = 1.2
  private static let millisPerSecond: Float = 1_000

  /**
   Memory only, unlike Android, which also reads the core count. Apple has shipped the same 6-core
   layout from the A11 to the A18, so on iPhone the core count separates nothing; RAM is what
   actually tracks the generation. iPads with more cores land in the same bands by memory anyway.
   */
  private static let highMemoryGb: Float = 6
  private static let mediumMemoryGb: Float = 4
  private static let bytesPerGb: Float = 1_073_741_824

  private static let defaultsPrefix = "react-native-pose-detection."

  private(set) var tier: DeviceTier = .medium
  private(set) var phase: Phase = .calibrating
  private(set) var source: Source = .staticProbe
  private(set) var p50InferenceMs: Float = 0

  private var samples = [Float](repeating: 0, count: Calibrator.window)
  private var scratch = [Float](repeating: 0, count: Calibrator.window)
  private var sampleCount = 0
  private var cursor = 0
  private var lastChangeMs: Int64 = 0

  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  /**
   Starts from the cache when there is one for this exact device, model and OS, and from the static
   probe otherwise. A cached tier is still measured afterwards: the device may be hot, or in low
   power mode, or simply different today.
   */
  func start(modelFileName: String) {
    reset()

    if let cached = readCache(modelFileName) {
      tier = cached
      source = .cache
      phase = .cached
      PoseLog.info(.calibration, "starting from the cached tier \(tier.rawValue)")
      return
    }

    tier = Calibrator.staticTier()
    source = .staticProbe
    phase = .calibrating
    PoseLog.info(.calibration, "static probe suggests \(tier.rawValue)")
  }

  func reset() {
    sampleCount = 0
    cursor = 0
    lastChangeMs = 0
    p50InferenceMs = 0
  }

  /**
   One frame's cost. Returns true when the tier moved, which is what the caller reports as an
   `onPerformanceChange` with reason `calibration`.
   */
  func record(inferenceMs: Float, targetFps: Int, nowMs: Int64) -> Bool {
    guard inferenceMs > 0, targetFps > 0 else { return false }

    samples[cursor] = inferenceMs
    cursor = (cursor + 1) % Calibrator.window
    if sampleCount < Calibrator.window { sampleCount += 1 }
    guard sampleCount >= Calibrator.window else { return false }

    p50InferenceMs = median()

    // Hysteresis: a tier that just moved is given time to show what it costs before it moves
    // again, or a device sitting between two tiers oscillates between them forever.
    if lastChangeMs != 0 && nowMs - lastChangeMs < Calibrator.cooldownMs { return false }

    let budgetMs = Calibrator.millisPerSecond / Float(targetFps)
    let next: DeviceTier
    if p50InferenceMs > budgetMs * Calibrator.stepDownRatio {
      next = tier.stepDown()
    } else if p50InferenceMs < budgetMs * Calibrator.stepUpRatio {
      next = tier.stepUp()
    } else {
      next = tier
    }

    if next == tier {
      // Inside the band for a whole window with nowhere to move is what settled means.
      guard phase != .settled else { return false }
      phase = .settled
      source = .measured
      PoseLog.info(
        .calibration,
        "settled at \(tier.rawValue), p50 \(p50InferenceMs)ms against a \(budgetMs)ms budget"
      )
      return true
    }

    PoseLog.info(
      .calibration,
      "p50 \(p50InferenceMs)ms against a \(budgetMs)ms budget, moving to \(next.rawValue)"
    )
    tier = next
    source = .measured
    phase = .calibrating
    lastChangeMs = nowMs
    sampleCount = 0
    cursor = 0
    return true
  }

  /// Only a settled, measured tier is worth persisting. A guess is not worth a second launch.
  func persist(modelFileName: String) {
    guard phase == .settled, source == .measured else { return }
    defaults.set(tier.rawValue, forKey: Calibrator.cacheKey(modelFileName))
  }

  /**
   Memory, biased down. It is a starting point that stage 2 replaces within a couple of seconds, so
   being wrong here costs those seconds and nothing else.
   */
  private static func staticTier() -> DeviceTier {
    let memoryGb = Float(ProcessInfo.processInfo.physicalMemory) / bytesPerGb

    let optimistic: DeviceTier
    if memoryGb >= highMemoryGb {
      optimistic = .high
    } else if memoryGb >= mediumMemoryGb {
      optimistic = .medium
    } else {
      optimistic = .low
    }
    return optimistic.stepDown()
  }

  private func median() -> Float {
    scratch = samples
    scratch.sort()
    return scratch[Calibrator.window / 2]
  }

  private func readCache(_ modelFileName: String) -> DeviceTier? {
    guard let stored = defaults.string(forKey: Calibrator.cacheKey(modelFileName)) else { return nil }
    return DeviceTier(rawValue: stored)
  }

  /**
   Device, model and OS version. An OS upgrade or a model change invalidates by producing a
   different key rather than by anything having to notice and clear the old one.
   */
  private static func cacheKey(_ modelFileName: String) -> String {
    let os = ProcessInfo.processInfo.operatingSystemVersion
    return "\(defaultsPrefix)\(hardwareModel())|\(modelFileName)|\(os.majorVersion).\(os.minorVersion)"
  }

  /// `iPhone16,2` and the like. `UIDevice.model` only ever answers "iPhone", which separates nothing.
  private static func hardwareModel() -> String {
    var info = utsname()
    uname(&info)
    let machine = info.machine
    let size = MemoryLayout.size(ofValue: machine)
    return withUnsafePointer(to: machine) { pointer in
      pointer.withMemoryRebound(to: CChar.self, capacity: size) { String(cString: $0) }
    }
  }
}

/// The OS thermal status, and low power mode, which the ladder treats as a floor of `fair`.
final class ThermalMonitor {
  private static let sampleIntervalMs: Int64 = 1_000

  func read() -> ThermalState {
    let status: ThermalState
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: status = .nominal
    case .fair: status = .fair
    case .serious: status = .serious
    case .critical: status = .critical
    @unknown default: status = .nominal
    }

    // Low power mode is the user asking for less work, so it is a floor rather than a reading.
    let saving = ProcessInfo.processInfo.isLowPowerModeEnabled
    return saving && status == .nominal ? .fair : status
  }

  /// Sampled rather than subscribed, to match Android, where the callback needs API 29.
  func shouldSample(nowMs: Int64, lastMs: Int64) -> Bool {
    return nowMs - lastMs >= ThermalMonitor.sampleIntervalMs
  }
}
