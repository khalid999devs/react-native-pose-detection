import AVFoundation
import MediaPipeTasksVision
import UIKit

/**
 Paints the skeleton into a copy of a picked image or video and writes it into the app's sandbox.

 **Nothing here is allowed to slow the live camera down.** That is the whole shape of this file,
 not a footnote to it, and it is bought four ways:

 1. **Its own detector.** Never the camera's landmarker. Built here, used here, released here.
 2. **CPU inference, always.** `createForStillInput` asks for the CPU delegate, so an export cannot
    contend with the camera for the GPU that its own inference is running on. Slower per frame, and
    entirely out of the way, which is the trade this package wants: an export has no deadline and
    a preview has one thirty times a second.
 3. **A `.utility` serial queue.** Below the camera's `.userInitiated` analysis queue, so under load
    the scheduler starves the export rather than sharing evenly. Serial, so two exports queue up
    behind each other instead of ganging up on the camera.
 4. **Bounded memory.** One frame decoded at a time, one pooled buffer encoded at a time, nothing
    accumulated across frames. A long video costs the same as a short one, which is what keeps an
    export from ending as a memory-pressure kill of the camera it was running beside.

 Every path releases on the way out through `defer`, so a throw, a cancel and a clean finish all
 unwind the same way.
 */
enum PoseExport {
  private static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "3gp", "avi", "mkv", "webm"]

  /// Serial and below the camera. See the note above; this is rule 3 and rule 3 is why it is here.
  static let queue = DispatchQueue(label: "com.posedetection.export", qos: .utility)

  private static let running = CancelRegistry()

  static func cancel(taskId: Int) {
    running.cancel(taskId)
  }

  static func isVideo(uri: String) -> Bool {
    let ext = (URL(string: uri) ?? URL(fileURLWithPath: uri)).pathExtension.lowercased()
    return videoExtensions.contains(ext)
  }

  static func resolve(uri: String) throws -> URL {
    guard let url = URL(string: uri) ?? URL(string: "file://\(uri)") else {
      throw ExportError("could not read a file from \(uri)")
    }
    return url
  }

  static func run(
    uri: String,
    raw: [String: Any]?,
    taskId: Int,
    onProgress: @escaping (Float) -> Void
  ) throws -> ExportSummary {
    let source = try resolve(uri: uri)
    let options = try ExportOptions.parse(raw, sourceName: source.deletingPathExtension().lastPathComponent)
    // The two values that decide who gets painted, and the pair most worth seeing when an export
    // finds fewer bodies than expected: `minConfidence` follows `maxPoses` unless the caller set it,
    // and the resolved number is not visible from JavaScript otherwise.
    PoseLog.info(.engine, "export maxPoses=\(options.maxPoses) minConfidence=\(options.minConfidence)")

    running.begin(taskId)
    // Suspension is the one failure the cleanup blocks cannot see: the threads freeze mid-write,
    // and if the system then terminates the app nothing unwinds. The background task buys the
    // minutes an export actually needs, and its expiry cancels this task so the pipeline leaves
    // through the same cleanup as every other failure.
    let background = UIApplication.shared.beginBackgroundTask(withName: "pose-export") {
      running.cancel(taskId)
    }
    defer {
      running.end(taskId)
      if background != .invalid {
        UIApplication.shared.endBackgroundTask(background)
      }
    }

    if isVideo(uri: uri) {
      let exporter = VideoExporter(
        source: source,
        options: options,
        isCancelled: { running.isCancelled(taskId) },
        onProgress: onProgress
      )
      return try exporter.run()
    }
    return try exportImage(source: source, options: options, onProgress: onProgress)
  }

  // MARK: - Stills

  private static func exportImage(
    source: URL,
    options: ExportOptions,
    onProgress: @escaping (Float) -> Void
  ) throws -> ExportSummary {
    guard let image = StaticDetection.loadImage(uri: source.absoluteString) else {
      throw ExportError("could not read an image from \(source.lastPathComponent)")
    }

    let detector = try PoseDetector.createForStillInput(
      modelPath: try StaticDetection.requireModel(),
      maxPoses: options.maxPoses,
      minConfidence: options.minConfidence,
      video: false
    )
    let result = try detector.detectImage(try MPImage(uiImage: image))
    onProgress(0.6)

    let display = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    let canvas = exportCanvasSize(display: display, maxSize: options.maxSize)
    // Fit, not fill: cropping a picture the user picked would cut away part of the very thing they
    // asked to have painted.
    let projection = OverlayProjection(
      source: display,
      bounds: CGRect(origin: .zero, size: canvas),
      fit: .fit
    )

    let painted = paint(
      image,
      result: result,
      options: options,
      projection: projection,
      geometry: (display: display, canvas: canvas)
    )

    let url = options.directory.appendingPathComponent("\(options.fileName).jpg")
    guard let data = painted.jpegData(compressionQuality: options.quality) else {
      throw ExportError("could not encode the painted image")
    }
    try data.write(to: url, options: .atomic)
    onProgress(1)

    return ExportSummary(
      url: url,
      width: Int(canvas.width),
      height: Int(canvas.height),
      durationMs: 0,
      frameCount: 1,
      posesFound: result.landmarks.count
    )
  }

  /// The picture with every detected skeleton on top of it.
  private static func paint(
    _ image: UIImage,
    result: PoseLandmarkerResult,
    options: ExportOptions,
    projection: OverlayProjection,
    geometry: (display: CGSize, canvas: CGSize)
  ) -> UIImage {
    let canvas = geometry.canvas
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let scale = overlayScale(canvas: canvas)
    let palette = OverlayPalette(options.overlay, scale: scale)

    // Safe off the main thread, unlike the UIGraphicsBeginImageContext family it replaced, which is
    // the reason an export can render at all without hopping onto the thread the camera draws on.
    return UIGraphicsImageRenderer(size: canvas, format: format).image { context in
      image.draw(in: projection.rect)
      guard options.drawOverlay else { return }
      for landmarks in poses(result) {
        var renderer = OverlayRenderer(
          config: options.overlay,
          palette: palette,
          landmarks: landmarks,
          projection: projection,
          // A file is never mirrored: what was picked is what gets painted.
          mirrored: false,
          sourceWidth: Int(geometry.display.width),
          sourceHeight: Int(geometry.display.height)
        )
        renderer.scale = scale
        renderer.draw(into: context.cgContext)
      }
    }
  }

  /**
   Every pose in the frame as flat buffers the renderer reads, empty when nobody was in it.

   All of them, not the front one: `maxPoses` is an export option, and painting one skeleton onto a
   frame the caller asked to have five detected in would silently ignore what they asked for.
   */
  static func poses(_ result: PoseLandmarkerResult) -> [[Float]] {
    return result.landmarks.map { pose in
      var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
      for index in 0..<min(Skeleton.landmarkCount, pose.count) {
        let point = pose[index]
        let base = index * Skeleton.landmarkStride
        landmarks[base + Skeleton.offsetX] = point.x
        landmarks[base + Skeleton.offsetY] = point.y
        landmarks[base + Skeleton.offsetZ] = point.z
        landmarks[base + Skeleton.offsetVisibility] = point.visibility?.floatValue ?? 0
      }
      return landmarks
    }
  }
}
