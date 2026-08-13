import UIKit

/**
 Packed ARGB, the same representation Android's `Color` uses, so a config that draws one color
 there cannot quietly draw another here. The `UIColor` is derived once when the view adopts a
 config, never on the draw path.
 */
struct PackedColor: Equatable {
  let argb: UInt32

  static let defaultOverlay = PackedColor(argb: 0xFF00_E5FF)

  var uiColor: UIColor {
    let alpha = CGFloat((argb >> 24) & 0xFF) / 255
    let red = CGFloat((argb >> 16) & 0xFF) / 255
    let green = CGFloat((argb >> 8) & 0xFF) / 255
    let blue = CGFloat(argb & 0xFF) / 255
    return UIColor(red: red, green: green, blue: blue, alpha: alpha)
  }
}

struct AngleOverlaySpec: Equatable {
  let joint: String
  let triple: [Int]
  let label: Bool
  let radius: CGFloat
  let color: PackedColor?
  let decimals: Int
  let minVisibility: Float
}

struct OverlayConfig: Equatable {
  var landmarks = true
  var connections = true
  var color = PackedColor.defaultOverlay
  var lineWidth: CGFloat = 3
  var pointRadius: CGFloat = 4
  var minVisibility: Float = 0.5

  /// `nil` means every joint. A mask of indices when `only` narrows it.
  var only: [Bool]?
  var angles: [AngleOverlaySpec] = []
}

let maxLabelDecimals = 3

func parseOverlay(_ raw: [String: Any]) -> OverlayConfig {
  var config = OverlayConfig()

  if let value = JS.bool(raw["landmarks"]) { config.landmarks = value }
  if let value = JS.bool(raw["connections"]) { config.connections = value }
  // Clamped rather than trusted: these come from a JavaScript object that may have been built
  // dynamically and skipped validation, and a negative stroke or radius draws nothing.
  config.lineWidth = size(raw["lineWidth"], fallback: 3)
  config.pointRadius = size(raw["pointRadius"], fallback: 4)
  if let value = JS.number(raw["minVisibility"]) { config.minVisibility = Float(clamped(value, 0, 1, 0.5)) }
  if let color = parseColor(raw["color"]) { config.color = color }
  if let names = JS.array(raw["only"]) { config.only = jointMask(names) }

  if let specs = JS.array(raw["angles"]) {
    config.angles = specs.compactMap { entry in
      guard let map = JS.dictionary(entry) else { return nil }
      return parseAngle(map)
    }
  }

  return config
}

private func size(_ value: Any?, fallback: Double) -> CGFloat {
  guard let value = JS.number(value) else { return CGFloat(fallback) }
  return CGFloat(clamped(value, 0, .greatestFiniteMagnitude, fallback))
}

private func jointMask(_ names: [Any]) -> [Bool] {
  var mask = [Bool](repeating: false, count: Skeleton.landmarkCount)
  for name in names {
    let index = Skeleton.indexOf(JS.string(name) ?? "")
    if index >= 0 { mask[index] = true }
  }
  return mask
}

func parseAngle(_ raw: [String: Any]) -> AngleOverlaySpec? {
  guard let joint = JS.string(raw["joint"]) else { return nil }
  // JS validation rejects a non-angle joint before it reaches here, so a miss means a config built
  // dynamically that skipped that check. Skipping the arc beats drawing a wrong one.
  guard let triple = Skeleton.angleTriple(joint) else {
    PoseLog.warn(.overlay, "\(joint) has no angle, skipping its arc")
    return nil
  }

  return AngleOverlaySpec(
    joint: joint,
    triple: triple,
    label: JS.bool(raw["label"]) ?? true,
    radius: CGFloat(JS.number(raw["radius"]).map { clamped($0, 1, .greatestFiniteMagnitude, 40) } ?? 40),
    color: parseColor(raw["color"]),
    // Capped because a large value would build a long string on the draw path every frame.
    decimals: min(max(Int(JS.number(raw["decimals"]) ?? 0), 0), maxLabelDecimals),
    minVisibility: Float(JS.number(raw["minVisibility"]).map { clamped($0, 0, 1, 0.5) } ?? 0.5)
  )
}

/// NaN survives a clamp, and a NaN `minVisibility` should disable the gate rather than clamp to it.
func clamped(_ value: Double, _ low: Double, _ high: Double, _ fallback: Double) -> Double {
  if value.isNaN { return fallback }
  return min(max(value, low), high)
}

/**
 `#RRGGBB` and `#AARRGGBB`, plus the same handful of names Android's `Color.parseColor` accepts.
 The names are here rather than left to iOS so that `color: 'red'` means the same thing on both
 platforms instead of drawing on one and warning on the other.
 */
func parseColor(_ value: Any?) -> PackedColor? {
  guard let text = JS.string(value)?.trimmingCharacters(in: .whitespaces) else { return nil }

  if let named = namedColors[text.lowercased()] {
    return PackedColor(argb: named)
  }

  guard text.hasPrefix("#") else {
    PoseLog.warn(.overlay, "could not parse the color \"\(text)\"")
    return nil
  }

  let digits = String(text.dropFirst())
  guard digits.count == 6 || digits.count == 8, let value = UInt32(digits, radix: 16) else {
    PoseLog.warn(.overlay, "could not parse the color \"\(text)\"")
    return nil
  }
  // Six digits carry no alpha, so it is opaque, which is what Color.parseColor does too.
  return PackedColor(argb: digits.count == 6 ? value | 0xFF00_0000 : value)
}

private let namedColors: [String: UInt32] = [
  "black": 0xFF00_0000, "darkgray": 0xFF44_4444, "darkgrey": 0xFF44_4444,
  "gray": 0xFF88_8888, "grey": 0xFF88_8888, "lightgray": 0xFFCC_CCCC, "lightgrey": 0xFFCC_CCCC,
  "white": 0xFFFF_FFFF, "red": 0xFFFF_0000, "green": 0xFF00_FF00, "blue": 0xFF00_00FF,
  "yellow": 0xFFFF_FF00, "cyan": 0xFF00_FFFF, "magenta": 0xFFFF_00FF, "aqua": 0xFF00_FFFF,
  "fuchsia": 0xFFFF_00FF, "lime": 0xFF00_FF00, "maroon": 0xFF80_0000, "navy": 0xFF00_0080,
  "olive": 0xFF80_8000, "purple": 0xFF80_0080, "silver": 0xFFC0_C0C0, "teal": 0xFF00_8080
]
