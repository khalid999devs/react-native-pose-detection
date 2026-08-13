import AVFoundation

/**
 The size arithmetic behind a capture session, kept apart from the session that uses it.

 None of this touches AVFoundation state: it maps the three preset names the public API takes
 onto concrete dimensions, and works out what the analysis buffer may be given what the preview
 carries. That makes it the part worth reading on its own, and the part a test can reach without
 a camera. `CameraSource` owns the session; this owns the numbers it is configured with.
 */
extension CameraSource {
  /// The same three steps Android names, mapped onto the presets AVFoundation guarantees.
  static func previewSize(for preset: String) -> CaptureSize {
    switch preset {
    case "480p": return CaptureSize(width: 640, height: 480)
    case "1080p": return CaptureSize(width: 1920, height: 1080)
    default: return CaptureSize(width: 1280, height: 720)
    }
  }

  static func preset(for size: CaptureSize) -> AVCaptureSession.Preset {
    switch size.longestSide {
    case ...640: return .vga640x480
    case ...1280: return .hd1280x720
    default: return .hd1920x1080
    }
  }

  /**
   The analysis buffer is the data output scaled down, not a second capture: one session has one
   preset, so the preview's aspect is the only aspect available and the ladder step picks the short
   side. Asking for more than the preview carries would be an upscale of pixels the sensor never
   produced, so it is clamped to it.
   */
  static func analysisSize(for preset: String, preview: CaptureSize) -> CaptureSize {
    let requested: Int
    switch preset {
    case "360p": requested = 360
    case "720p": requested = 720
    default: requested = 480
    }

    let previewShort = min(preview.width, preview.height)
    let shortSide = min(requested, previewShort)
    if shortSide < requested {
      PoseLog.debug(.camera, "analysis \(preset) clamped to the preview's \(shortSide)p")
    }

    let aspect = Double(max(preview.width, preview.height)) / Double(previewShort)
    // Even, because an odd width is not expressible in the chroma planes of a subsampled format.
    let longSide = Int((Double(shortSide) * aspect / 2).rounded()) * 2
    return preview.width >= preview.height
      ? CaptureSize(width: longSide, height: shortSide)
      : CaptureSize(width: shortSide, height: longSide)
  }
}

struct CameraError: LocalizedError {
  let message: String

  init(_ message: String) {
    self.message = message
  }

  var errorDescription: String? {
    return message
  }
}
