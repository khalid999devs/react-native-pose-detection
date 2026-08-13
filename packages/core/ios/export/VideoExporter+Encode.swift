import AVFoundation
import MediaPipeTasksVision
import UIKit

/**
 The loop: pull a frame, detect on it when a sample is due, paint it, encode it.

 Split from the setup so that file reads as what the pipeline is and this one reads as what runs
 through it. Everything here happens on `PoseExport.queue`, which is serial and below the camera's
 own queue, and nothing here allocates per frame beyond what the encoder's pool hands back.
 */
extension VideoExporter {

  // swiftlint:disable:next function_body_length
  func encode(
    reader: ReadSide,
    writer: WriteSide,
    asset: AVURLAsset,
    geometry: ExportGeometry,
    output: URL
  ) throws -> ExportSummary {
    let detector = try PoseDetector.createForStillInput(
      modelPath: try StaticDetection.requireModel(),
      maxPoses: options.maxPoses,
      minConfidence: options.minConfidence,
      video: true
    )
    let scale = overlayScale(canvas: geometry.canvas)
    let palette = OverlayPalette(options.overlay, scale: scale)

    guard reader.reader.startReading() else {
      throw ExportError(reader.reader.error?.localizedDescription ?? "could not start reading the video")
    }
    guard writer.writer.startWriting() else {
      throw ExportError(writer.writer.error?.localizedDescription ?? "could not start writing the export")
    }

    let durationMs = max(1, StaticDetection.durationMilliseconds(of: asset))
    let stepMs = max(1, 1000 / options.sampleFps)

    // Held between samples and redrawn every frame, exactly as the live overlay holds the last
    // pose between inferences. The renderer takes each buffer by value, and Swift's copy on write
    // makes that a retain rather than 132 floats, so the steady state allocates nothing at all.
    var poses = [[Float]]()
    var nextSampleMs = 0
    var lastTimestampMs = -1
    var frameCount = 0
    var posesFound = 0
    var started = false
    var pendingAudio: CMSampleBuffer?

    while let sample = reader.video.copyNextSampleBuffer() {
      // MPImage, the CGImage over the source and everything MediaPipe allocates behind them are
      // autoreleased. Without a pool per frame they are held until this function returns, which
      // for a long clip is thousands of frames of decoded video, and is the one thing that would
      // turn a bounded export into the memory-pressure kill it exists to avoid.
      try autoreleasepool {
        if isCancelled() { throw ExportCancelled() }
        guard let buffer = CMSampleBufferGetImageBuffer(sample) else { return }

        let presentation = CMSampleBufferGetPresentationTimeStamp(sample)
        if !started {
          writer.writer.startSession(atSourceTime: presentation)
          started = true
        }
        let positionMs = Int(CMTimeGetSeconds(presentation) * 1000)

        if positionMs >= nextSampleMs {
          // VIDEO mode rejects a timestamp that does not move forward, and a variable frame rate
          // clip can hand back two frames on the same millisecond.
          let timestamp = max(positionMs, lastTimestampMs + 1)
          lastTimestampMs = timestamp
          let image = try MPImage(pixelBuffer: buffer, orientation: geometry.orientation)
          let result = try detector.detectVideo(image, timestampMs: timestamp)
          poses = PoseExport.poses(result)
          if !poses.isEmpty { posesFound += 1 }
          nextSampleMs = positionMs + stepMs
        }

        let renderers = poses.map {
          makeRenderer(palette: palette, landmarks: $0, geometry: geometry, scale: scale)
        }

        try paint(
          source: buffer,
          into: writer.adaptor,
          writer: writer.writer,
          at: presentation,
          geometry: geometry,
          renderers: renderers
        )
        frameCount += 1

        try drain(audio: reader, into: writer, upTo: presentation, pending: &pendingAudio)
        report(Float(positionMs) / Float(durationMs))
      }
    }

    if isCancelled() { throw ExportCancelled() }
    try drain(audio: reader, into: writer, upTo: .positiveInfinity, pending: &pendingAudio)

    if reader.reader.status == .failed {
      throw ExportError(reader.reader.error?.localizedDescription ?? "the video could not be decoded")
    }
    try finish(writer: writer)
    report(1)

    return ExportSummary(
      url: output,
      width: Int(geometry.canvas.width),
      height: Int(geometry.canvas.height),
      durationMs: Int(durationMs),
      frameCount: frameCount,
      posesFound: posesFound
    )
  }

  /// Nil when the overlay is switched off, so a frame with no skeleton takes the same path as a
  /// frame with nobody in it rather than a second branch through the loop.
  private func makeRenderer(
    palette: OverlayPalette,
    landmarks: [Float],
    geometry: ExportGeometry,
    scale: CGFloat
  ) -> OverlayRenderer? {
    guard options.drawOverlay else { return nil }
    var renderer = OverlayRenderer(
      config: options.overlay,
      palette: palette,
      landmarks: landmarks,
      projection: geometry.projection,
      // A file is never mirrored: what was picked is what gets painted.
      mirrored: false,
      sourceWidth: Int(geometry.display.width),
      sourceHeight: Int(geometry.display.height)
    )
    renderer.scale = scale
    return renderer
  }

  // MARK: - One frame

  /**
   Draws the decoded frame and the skeleton into a buffer from the encoder's own pool.

   The source is wrapped rather than copied: `CGDataProvider` is handed the locked base address and
   a release callback that does nothing, because the sample buffer owns that memory and outlives
   the draw. The destination comes from `pixelBufferPool`, so across a long video this cycles
   through a handful of buffers instead of allocating one per frame.
   */
  private func paint(
    source: CVPixelBuffer,
    into adaptor: AVAssetWriterInputPixelBufferAdaptor,
    writer: AVAssetWriter,
    at time: CMTime,
    geometry: ExportGeometry,
    renderers: [OverlayRenderer?]
  ) throws {
    let canvas = geometry.canvas
    guard let pool = adaptor.pixelBufferPool else {
      throw ExportError("the encoder gave back no buffer pool")
    }
    var optional: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optional) == kCVReturnSuccess,
          let destination = optional else {
      throw ExportError("could not take a frame buffer from the encoder")
    }

    CVPixelBufferLockBaseAddress(source, .readOnly)
    CVPixelBufferLockBaseAddress(destination, [])
    defer {
      CVPixelBufferUnlockBaseAddress(destination, [])
      CVPixelBufferUnlockBaseAddress(source, .readOnly)
    }

    guard let context = CGContext(
      data: CVPixelBufferGetBaseAddress(destination),
      width: Int(geometry.canvas.width),
      height: Int(geometry.canvas.height),
      bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(destination),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else {
      throw ExportError("could not draw into the encoder's frame buffer")
    }

    // A pixel buffer is stored top row first and Core Graphics counts up from the bottom, so
    // without this every frame encodes upside down. Flipped here rather than in the renderer
    // because after it the context is in UIKit's coordinates, which is what the overlay, the
    // labels and `UIImage.draw(in:)` all expect, and is the same space the live view draws in.
    context.translateBy(x: 0, y: canvas.height)
    context.scaleBy(x: 1, y: -1)
    UIGraphicsPushContext(context)
    defer { UIGraphicsPopContext() }

    context.setFillColor(UIColor.black.cgColor)
    context.fill(CGRect(origin: .zero, size: canvas))
    if let image = VideoExporter.wrap(source) {
      // The orientation rides on the UIImage, so a portrait clip stored landscape is drawn upright
      // and the landmarks, detected against the same orientation, already match it.
      UIImage(cgImage: image, scale: 1, orientation: geometry.orientation).draw(in: geometry.projection.rect)
    }
    for renderer in renderers {
      renderer?.draw(into: context)
    }

    try awaitReady(adaptor.assetWriterInput, writer: writer)
    guard adaptor.append(destination, withPresentationTime: time) else {
      throw ExportError(writer.error?.localizedDescription ?? "the encoder rejected a frame")
    }
  }

  /**
   Waits for the encoder to take more data, and gives up on the two ways that never happens.

   `isReadyForMoreMediaData` stops turning true for good once the writer fails, so a disk that
   fills mid-export would otherwise leave this spinning on a background queue for the life of the
   process. Cancellation is checked here too, because a wait is exactly where a cancel arrives.
   */
  private func awaitReady(_ input: AVAssetWriterInput, writer: AVAssetWriter) throws {
    while !input.isReadyForMoreMediaData {
      guard writer.status == .writing else {
        throw ExportError(writer.error?.localizedDescription ?? "the export stopped being written")
      }
      if isCancelled() { throw ExportCancelled() }
      Thread.sleep(forTimeInterval: VideoExporter.encoderPollSeconds)
    }
  }

  /// A CGImage over the pixel buffer's own memory. Valid only while the buffer stays locked.
  private static func wrap(_ buffer: CVPixelBuffer) -> CGImage? {
    let height = CVPixelBufferGetHeight(buffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    guard let base = CVPixelBufferGetBaseAddress(buffer),
          let provider = CGDataProvider(
            dataInfo: nil,
            data: base,
            size: bytesPerRow * height,
            releaseData: { _, _, _ in }
          ) else { return nil }

    return CGImage(
      width: CVPixelBufferGetWidth(buffer),
      height: height,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: bytesPerRow,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: [.byteOrder32Little, CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue)],
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent
    )
  }

  // MARK: - The other track, and the end

  /**
   Audio up to where the video has reached, so the two stay interleaved in the file.

   One reader feeds both tracks, and a reader whose outputs are drained at very different rates
   stalls the one that is behind. Writing all the video and then all the audio would also leave a
   file whose sound is one long block at the end, which plays but streams badly.
   */
  private func drain(
    audio reader: ReadSide,
    into writer: WriteSide,
    upTo time: CMTime,
    pending: inout CMSampleBuffer?
  ) throws {
    guard let output = reader.audio, let input = writer.audio else { return }
    while true {
      guard let sample = pending ?? output.copyNextSampleBuffer() else { return }
      pending = nil
      if CMSampleBufferGetPresentationTimeStamp(sample) > time {
        pending = sample
        return
      }
      try awaitReady(input, writer: writer.writer)
      // A refused audio sample is not worth failing an export over: the picture is the point, and
      // a file with a gap in its sound beats no file at all.
      if !input.append(sample) {
        PoseLog.warn(.engine, "the export dropped an audio sample")
      }
    }
  }

  private func finish(writer: WriteSide) throws {
    writer.video.markAsFinished()
    writer.audio?.markAsFinished()

    // `finishWriting(completionHandler:)` returns before the file is closed, and the caller is
    // about to hand this path back to JavaScript as a file that exists.
    let done = DispatchSemaphore(value: 0)
    writer.writer.finishWriting { done.signal() }
    done.wait()

    if writer.writer.status != .completed {
      throw ExportError(writer.writer.error?.localizedDescription ?? "the export could not be written")
    }
  }

  /// Throttled, because a frame-by-frame progress event is thirty crossings a second for a number
  /// nobody can read that fast.
  private func report(_ progress: Float) {
    let clamped = min(1, max(0, progress))
    guard clamped >= lastReportedProgress + VideoExporter.progressStep || clamped >= 1 else { return }
    lastReportedProgress = clamped
    onProgress(clamped)
  }

  static func orientation(for transform: CGAffineTransform) -> UIImage.Orientation {
    switch (transform.a, transform.b, transform.c, transform.d) {
    case (0, 1, -1, 0): return .right
    case (0, -1, 1, 0): return .left
    case (-1, 0, 0, -1): return .down
    default: return .up
    }
  }
}
