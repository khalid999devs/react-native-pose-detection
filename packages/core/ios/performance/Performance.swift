import Foundation

enum DeviceTier: String {
  case low
  case medium
  case high

  func stepDown() -> DeviceTier {
    return self == .high ? .medium : .low
  }

  func stepUp() -> DeviceTier {
    return self == .low ? .medium : .high
  }
}

enum Profile: String {
  case auto
  case efficient
  case balanced
  case quality
  case unrestricted

  static func from(_ value: String?) -> Profile {
    return Profile(rawValue: value ?? "") ?? .auto
  }
}

enum ThermalPolicy {
  case adaptive
  case criticalOnly
  case off

  static func from(_ value: String?) -> ThermalPolicy {
    switch value {
    case "critical-only": return .criticalOnly
    case "off": return .off
    default: return .adaptive
    }
  }
}

/// The OS states this package acts on. Everything hotter than `serious` is `critical`.
enum ThermalState: String {
  case nominal
  case fair
  case serious
  case critical
}

/// Pixel dimensions, reported to JavaScript and compared to decide whether a rebind is needed.
struct CaptureSize: Equatable {
  let width: Int
  let height: Int

  var longestSide: Int {
    return max(width, height)
  }
}

/**
 One resolved configuration. Every axis is a concrete value: whatever combination of profile,
 props, calibration and heat produced it, this is what the session runs.
 */
struct ResolvedPerformance: Equatable {
  let targetFps: Int
  let preview: String
  let analysis: String
  let detectionPaused: Bool
}

/**
 A tier's starting configuration. Calibration steps between these rather than inventing
 intermediate values, so `getProfile()` always reports something a person can reason about.
 */
enum Tiers {
  static func targetFps(_ tier: DeviceTier) -> Int {
    switch tier {
    case .low: return 15
    case .medium: return 24
    case .high: return 30
    }
  }

  static func preview(_ tier: DeviceTier) -> String {
    switch tier {
    case .low: return "480p"
    case .medium: return "720p"
    case .high: return "1080p"
    }
  }

  static func analysis(_ tier: DeviceTier) -> String {
    switch tier {
    case .low: return "360p"
    case .medium: return "480p"
    case .high: return "720p"
    }
  }

  /// One step down the analysis ladder, which is what `serious` heat costs.
  static func analysisBelow(_ analysis: String) -> String {
    switch analysis {
    case "720p": return "480p"
    case "480p": return "360p"
    default: return "360p"
    }
  }
}

/// Every axis the precedence chain reads, so the resolver takes one value rather than seven.
struct PerformanceRequest {
  let profile: Profile
  let tier: DeviceTier
  let requestedFps: Int?
  let requestedPreview: String
  let requestedAnalysis: String
  let thermal: ThermalState
  let policy: ThermalPolicy
}

/**
 The precedence chain from `guides/performance.md`, in one place so it cannot be applied in three
 different orders by three different callers:

 ```text
 1. profile        sets the baseline
 2. explicit props override per axis
 3. calibration    adjusts only axes still 'auto'
 4. thermal ladder overrides everything, unless the policy says otherwise
 ```
 */
enum PerformanceResolver {
  static let idleFps = 8

  private static let auto = "auto"
  private static let fairFpsScale: Float = 0.75
  private static let seriousFpsScale: Float = 0.5

  static func resolve(_ request: PerformanceRequest) -> ResolvedPerformance {
    // 1. The baseline. A named profile pins the tier it names; `auto` and `unrestricted` take
    // whatever calibration decided.
    let baseTier: DeviceTier
    switch request.profile {
    case .efficient: baseTier = .low
    case .balanced: baseTier = .medium
    case .quality: baseTier = .high
    case .auto, .unrestricted: baseTier = request.tier
    }

    var fps = request.requestedFps ?? Tiers.targetFps(baseTier)
    let preview = request.requestedPreview == auto ? Tiers.preview(baseTier) : request.requestedPreview
    var analysis = request.requestedAnalysis == auto ? Tiers.analysis(baseTier) : request.requestedAnalysis
    var paused = false

    if acts(request) {
      switch request.thermal {
      case .nominal:
        break
      case .fair:
        fps = scaled(fps, fairFpsScale)
      case .serious:
        fps = scaled(fps, seriousFpsScale)
        analysis = Tiers.analysisBelow(analysis)
      case .critical:
        paused = true
      }
    }

    return ResolvedPerformance(targetFps: fps, preview: preview, analysis: analysis, detectionPaused: paused)
  }

  /**
   Heat outranks everything else. `unrestricted` opts out of all of it except critical, because a
   device that is about to shut down is not a preference anyone can hold.
   */
  private static func acts(_ request: PerformanceRequest) -> Bool {
    switch request.policy {
    case .off: return false
    case .criticalOnly: return request.thermal == .critical
    case .adaptive: return request.profile == .unrestricted ? request.thermal == .critical : true
    }
  }

  /// Never below one: an fps of zero would read as "as fast as possible", which is the opposite.
  private static func scaled(_ fps: Int, _ scale: Float) -> Int {
    return max(1, Int(Float(fps) * scale))
  }
}
