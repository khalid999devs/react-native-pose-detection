import Foundation
import UIKit

/// What `exportPose` was asked for. Defaults from guides/export.md.
struct ExportOptions {
  /// The same config the camera's `overlay` prop takes, so a painted file and a live preview are
  /// configured with one vocabulary rather than two.
  let overlay: OverlayConfig
  let drawOverlay: Bool
  let maxPoses: Int
  /**
   How sure the model has to be before it calls something a body.

   Left out, it follows `maxPoses`, because the two are one decision: 0.5 for a single subject,
   which is MediaPipe's own, and 0.3 above that, which is where a second person actually appears
   rather than the first person twice. A number overrides it, and what the right number is for a
   given piece of footage is the caller's to know.
   */
  let minConfidence: Float
  /// Detection samples a second. Between samples the last pose is held, exactly as the live
  /// overlay holds one between inferences.
  let sampleFps: Int
  /// Long edge of the output, or 0 for the source's own size.
  let maxSize: Int
  let directory: URL
  let fileName: String
  /// Still images only.
  let quality: CGFloat

  static let defaultMaxSize = 1920
  static let defaultSampleFps = 10

  static func parse(_ raw: [String: Any]?, sourceName: String) throws -> ExportOptions {
    let maxPoses = clampedCount(raw?["maxPoses"], fallback: 1, limit: 5)
    var drawOverlay = true
    var overlay = OverlayConfig()
    if let value = JS.bool(raw?["overlay"]) {
      drawOverlay = value
    } else if let map = JS.dictionary(raw?["overlay"]) {
      overlay = parseOverlay(map)
    }

    return ExportOptions(
      overlay: overlay,
      drawOverlay: drawOverlay,
      maxPoses: maxPoses,
      minConfidence: minConfidence(raw?["minConfidence"], maxPoses: maxPoses),
      sampleFps: clampedCount(raw?["fps"], fallback: defaultSampleFps, limit: 60),
      maxSize: maxSize(raw?["maxSize"]),
      directory: try directory(JS.string(raw?["directory"])),
      fileName: fileName(JS.string(raw?["fileName"]), sourceName: sourceName),
      quality: CGFloat(clamped(JS.number(raw?["quality"]) ?? 0.9, 0.1, 1, 0.9))
    )
  }

  private static func minConfidence(_ raw: Any?, maxPoses: Int) -> Float {
    let auto = Double(PoseDetector.stillConfidence(forMaxPoses: maxPoses))
    return Float(clamped(JS.number(raw) ?? auto, 0.1, 0.9, auto))
  }

  /**
   Where the file lands, created if it is not there yet.

   The default is the app's caches directory: an export is derived data, and a package that wrote
   into Documents by default would put files the user never asked for into their iCloud backup.
   Apps that want it kept pass a directory of their own, which is also how the file ends up
   somewhere they can upload or move it from.
   */
  private static func directory(_ raw: String?) throws -> URL {
    let base: URL
    switch raw {
    case nil, "cache":
      base = try FileManager.default.url(
        for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    case "documents":
      base = try FileManager.default.url(
        for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    case let value?:
      guard let url = URL(string: value), url.isFileURL else {
        guard value.hasPrefix("/") else {
          throw ExportError("directory must be 'cache', 'documents' or a file:// URI, got \(value)")
        }
        base = URL(fileURLWithPath: value)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
      }
      base = url
    }
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  /// Sanitized rather than trusted: this reaches the filesystem, and a name with a slash in it
  /// would write outside the directory the caller chose.
  private static func fileName(_ raw: String?, sourceName: String) -> String {
    let candidate = raw.flatMap { $0.isEmpty ? nil : $0 } ?? "\(sourceName)-pose"
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ ."))
    let cleaned = candidate.unicodeScalars.filter { allowed.contains($0) }.map(String.init).joined()
    let trimmed = cleaned.trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? "pose-export" : trimmed
  }

  private static func maxSize(_ value: Any?) -> Int {
    guard let number = JS.number(value) else { return defaultMaxSize }
    let size = Int(number)
    return size <= 0 ? 0 : max(120, size)
  }

  private static func clampedCount(_ value: Any?, fallback: Int, limit: Int) -> Int {
    guard let number = JS.number(value) else { return fallback }
    return min(max(1, Int(number)), limit)
  }
}

struct ExportError: LocalizedError {
  let message: String

  init(_ message: String) {
    self.message = message
  }

  var errorDescription: String? {
    return message
  }
}

/// What came back, for the JavaScript side to turn into an `ExportResult`.
struct ExportSummary {
  let url: URL
  let width: Int
  let height: Int
  let durationMs: Int
  let frameCount: Int
  let posesFound: Int

  var payload: [String: Any] {
    return [
      "uri": url.absoluteString,
      "width": width,
      "height": height,
      "durationMs": durationMs,
      "frameCount": frameCount,
      "posesFound": posesFound
    ]
  }
}
