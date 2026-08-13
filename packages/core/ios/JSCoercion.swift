import Foundation

/**
 Untyped JavaScript values into Swift ones.

 Everything crossing the bridge arrives as `Any`, and a number can be an `Int`, a `Double` or an
 `NSNumber` depending on how it was written on the other side. Reading it as one of those and
 ignoring the rest is how a valid config silently becomes a default.

 `Bool` bridges to `NSNumber` as 0 or 1, so it has to be rejected before the numeric cast rather
 than after: `{ smoothing: true }` read as a number is `minCutoff: 1`.
 */
enum JS {
  /// JavaScript `null` crosses as `NSNull`, which is not nil and is not any of the types below.
  static func isNull(_ value: Any?) -> Bool {
    return value == nil || value is NSNull
  }

  static func number(_ value: Any?) -> Double? {
    if value is Bool { return nil }
    if let double = value as? Double { return double }
    if let int = value as? Int { return Double(int) }
    if let number = value as? NSNumber { return number.doubleValue }
    return nil
  }

  static func bool(_ value: Any?) -> Bool? {
    return value as? Bool
  }

  static func string(_ value: Any?) -> String? {
    return value as? String
  }

  static func array(_ value: Any?) -> [Any]? {
    return value as? [Any]
  }

  static func dictionary(_ value: Any?) -> [String: Any]? {
    return value as? [String: Any]
  }

  /// The element at `index`, or nil when the array is shorter or was never an array.
  static func at(_ value: [Any]?, _ index: Int) -> Any? {
    guard let value = value, index >= 0, index < value.count else { return nil }
    return value[index]
  }

  static func strings(_ value: Any?) -> [String]? {
    guard let raw = array(value) else { return nil }
    return raw.compactMap { $0 as? String }
  }
}
