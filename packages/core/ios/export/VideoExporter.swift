import AVFoundation
import MediaPipeTasksVision
import UIKit

/// The decode half of the pipeline, at file scope so the encode loop can live in its own file.
struct ReadSide {
  let reader: AVAssetReader
  let video: AVAssetReaderTrackOutput
  let audio: AVAssetReaderTrackOutput?
  let audioFormat: CMFormatDescription?
}

/**
 Every size the painting needs, worked out once before the loop.

 One value rather than four parameters, because they are four views of one decision: how the
 source's displayed frame lands on the output canvas. `projection` is the rect the frame is drawn
 into and the rect the skeleton is projected into, which is the same guarantee `OverlayProjection`
 makes for the live preview.
 */
struct ExportGeometry {
  let display: CGSize
  let canvas: CGSize
  let orientation: UIImage.Orientation
  let projection: OverlayProjection
}

/// The encode half.
struct WriteSide {
  let writer: AVAssetWriter
  let video: AVAssetWriterInput
  let audio: AVAssetWriterInput?
  let adaptor: AVAssetWriterInputPixelBufferAdaptor
}

/// Thrown when the caller cancelled. Distinct from a failure, because it is not one.
struct ExportCancelled: Error {}

/**
 One decode pass, one encode pass, one detector.

 Detection runs at `sampleFps` rather than at the video's own frame rate, and every frame in
 between is painted with the pose that was detected most recently. That is what the live overlay
 does between inferences, so a 30 fps clip sampled at 10 costs a third of the inference and looks
 the same. Decoding stays sequential because VIDEO mode rejects a timestamp that goes backwards.

 Rotation is baked into the output rather than carried as a track transform. A phone shoots
 portrait video stored landscape-plus-transform, and players that ignore the transform, which
 includes a good number of web and server side ones, would show the export on its side. Writing it
 upright costs one already-necessary draw per frame and makes the file mean the same thing
 everywhere it is opened, which matters when the point of the file is to be uploaded somewhere.

 Because the frame is drawn upright, the landmarks MediaPipe returns for the upright image are
 already in the space the skeleton is painted in, so there is no second coordinate system here and
 no inverse transform to get wrong.
 */
final class VideoExporter {
  /// Long enough not to spin, short enough that the encoder is never the thing we are waiting on.
  static let encoderPollSeconds: TimeInterval = 0.002
  static let progressStep: Float = 0.02

  let source: URL
  let options: ExportOptions
  let isCancelled: () -> Bool
  let onProgress: (Float) -> Void

  var lastReportedProgress: Float = -1

  init(
    source: URL,
    options: ExportOptions,
    isCancelled: @escaping () -> Bool,
    onProgress: @escaping (Float) -> Void
  ) {
    self.source = source
    self.options = options
    self.isCancelled = isCancelled
    self.onProgress = onProgress
  }

  func run() throws -> ExportSummary {
    let asset = AVURLAsset(url: source)
    guard let track = AssetCompat.tracks(asset, of: .video).first else {
      throw ExportError("no video track in \(source.lastPathComponent)")
    }

    let transform = AssetCompat.preferredTransform(track)
    let natural = AssetCompat.naturalSize(track)
    let display = CGSize(
      width: abs(natural.width * transform.a + natural.height * transform.c),
      height: abs(natural.width * transform.b + natural.height * transform.d)
    )
    let canvas = exportCanvasSize(display: display, maxSize: options.maxSize)
    let output = options.directory.appendingPathComponent("\(options.fileName).mp4")
    try? FileManager.default.removeItem(at: output)

    let reader = try makeReader(asset: asset, track: track)
    let writer = try makeWriter(output: output, canvas: canvas, audioFormat: reader.audioFormat)

    // Every exit from here on removes a half-written file and tears the pipeline down, so a
    // cancel, a decode failure and a clean finish all leave the same state behind.
    var finished = false
    defer {
      if !finished {
        reader.reader.cancelReading()
        writer.writer.cancelWriting()
        try? FileManager.default.removeItem(at: output)
      }
    }

    let summary = try encode(
      reader: reader,
      writer: writer,
      asset: asset,
      geometry: ExportGeometry(
        display: display,
        canvas: canvas,
        orientation: VideoExporter.orientation(for: transform),
        // Fit, not fill: cropping a file the user picked would cut away part of the very thing
        // they asked to have painted.
        projection: OverlayProjection(
          source: display,
          bounds: CGRect(origin: .zero, size: canvas),
          fit: .fit
        )
      ),
      output: output
    )
    finished = true
    return summary
  }

  // MARK: - Pipeline

  func makeReader(asset: AVURLAsset, track: AVAssetTrack) throws -> ReadSide {
    let reader = try AVAssetReader(asset: asset)
    let video = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    // The frame is drawn into the encoder's buffer and then dropped, so there is nothing to be
    // gained from a copy the decoder would have to make on every frame.
    video.alwaysCopiesSampleData = false
    guard reader.canAdd(video) else { throw ExportError("could not read frames from the video") }
    reader.add(video)

    // Audio rides through compressed. Re-encoding it would cost time and a generation of quality
    // for a track this feature does not touch.
    var audio: AVAssetReaderTrackOutput?
    var audioFormat: CMFormatDescription?
    if let audioTrack = AssetCompat.tracks(asset, of: .audio).first,
       let format = AssetCompat.formatDescription(audioTrack) {
      let output = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
      output.alwaysCopiesSampleData = false
      if reader.canAdd(output) {
        reader.add(output)
        audio = output
        audioFormat = format
      }
    }
    return ReadSide(reader: reader, video: video, audio: audio, audioFormat: audioFormat)
  }

  func makeWriter(output: URL, canvas: CGSize, audioFormat: CMFormatDescription?) throws -> WriteSide {
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(canvas.width),
      AVVideoHeightKey: Int(canvas.height),
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: Int(canvas.width * canvas.height * 8),
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
      ]
    ])
    // False, and deliberately: this is a file job, so the writer should apply back pressure rather
    // than drop what it cannot keep up with.
    video.expectsMediaDataInRealTime = false
    guard writer.canAdd(video) else { throw ExportError("could not write video to the export") }
    writer.add(video)

    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: video,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: Int(canvas.width),
        kCVPixelBufferHeightKey as String: Int(canvas.height),
        kCVPixelBufferIOSurfacePropertiesKey as String: [:]
      ]
    )

    var audio: AVAssetWriterInput?
    if let audioFormat = audioFormat {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: audioFormat)
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audio = input
      }
    }
    return WriteSide(writer: writer, video: video, audio: audio, adaptor: adaptor)
  }
}
