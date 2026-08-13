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
  /**
   How often a tier runs inference. Not the preview's frame rate, which is whatever the sensor
   delivers: this gates the model only, and between inferences the overlay holds the last pose.

   For `auto` these are the starting rates a session runs before the governor has measured
   anything; once it has, `AutoTuner` replaces them with the device's own number. A named profile
   pins them. They are deliberately modest: an iPhone 15 asked for 60 here ran warm within minutes
   for a skeleton that looked identical at half that, so ramping up from below is the cheap
   direction and the governor does it within two seconds.
   */
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

  /**
   What the model is given, which is not what the preview shows.

   It stops at 480p on purpose. MediaPipe resizes whatever it is handed to 256 by 256 before the
   detector sees it, so a 720p analysis buffer is close to a megapixel captured, converted and
   copied every frame in order to be thrown away inside the graph. That was the single largest
   piece of avoidable work in the live path, and it bought no accuracy at all for a body filling a
   normal amount of the frame. A distant subject is the one case a larger buffer helps, and
   `analysisResolution` is there to ask for it.
   */
  static func analysis(_ tier: DeviceTier) -> String {
    switch tier {
    case .low: return "360p"
    case .medium, .high: return "480p"
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

/**
 The measured half of `auto`: what rate to run and what class of device this is, both read off the
 p50 inference time, which is the one number that already contains everything that matters — the
 silicon, the delegate, the model variant, the thermal throttling, all of it.

 The rate is continuous rather than stepped. Two devices that both land in the high tier can still
 differ by ten milliseconds of inference, and quantizing them to one number either wastes the fast
 one or overloads the slow one. This is why a session settles at 34 or 27 rather than a round tier
 value: the number is the device's own.
 */
enum AutoTuner {
  /**
   The fraction of each frame interval inference may occupy. The rest is everything downstream of
   the model — conversion, smoothing, the overlay, the wire encode — plus the headroom that keeps
   a sustained session from climbing the thermal ladder it would then be knocked back down.
   */
  static let utilization: Float = 0.55

  /// Below this the skeleton reads as broken; better to hold it and let heat pause detection.
  static let minFps = 10

  /**
   Past this the visible gain is nothing and the heat is real: a body does not move meaningfully
   in 25 milliseconds. It is above 30 because that is where fast phones measurably sit, not to
   leave room for a number that impresses.
   */
  static let maxFps = 40

  /// Moves smaller than this are sensor noise, not a change in what the device can do.
  static let deadbandFps = 2

  /// A p50 that sustains ~25 fps and up is a device that can carry high-tier geometry.
  static let highTierMaxP50Ms: Float = 22
  static let mediumTierMaxP50Ms: Float = 45

  private static let millisPerSecond: Float = 1_000

  static func targetFps(p50Ms: Float) -> Int {
    guard p50Ms > 0 else { return 0 }
    let sustainable = (millisPerSecond * utilization / p50Ms).rounded()
    return min(max(Int(sustainable), minFps), maxFps)
  }

  /// The tier drives geometry, so it moves on what the silicon is, not on what the rate is set to.
  static func tier(p50Ms: Float) -> DeviceTier {
    if p50Ms <= highTierMaxP50Ms { return .high }
    return p50Ms <= mediumTierMaxP50Ms ? .medium : .low
  }
}

/// Every axis the precedence chain reads, so the resolver takes one value rather than eight.
struct PerformanceRequest {
  let profile: Profile
  let tier: DeviceTier
  /// What the governor measured, or nil before it has. Only `auto` and `unrestricted` ride it.
  let autoFps: Int?
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

    var fps = request.requestedFps ?? governedFps(request) ?? Tiers.targetFps(baseTier)
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
   The measured rate applies only where nobody has decided: an explicit `targetFps` outranks it
   before this is even consulted, and a named profile is somebody saying they have already chosen
   a tier's numbers.
   */
  private static func governedFps(_ request: PerformanceRequest) -> Int? {
    switch request.profile {
    case .auto, .unrestricted: return request.autoFps
    case .efficient, .balanced, .quality: return nil
    }
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
