import AVFoundation
import MediaPipeTasksVision
import UIKit

/**
 A picked image or video shown in place of the camera preview.

 Detection runs **once, up front**, and playback then looks the pose up by time. The alternative,
 detecting each frame as it is displayed, races the decoder and loses; and driving the overlay off
 a timer instead of off the picture is what makes a skeleton lag the body. Here the surface and the
 skeleton are updated from the same callback, so they cannot drift.

 The results are handed to the view's ordinary detector callback, so everything downstream, the
 smoothing, the geometry, the triggers, the ring buffer and the overlay, is the camera's path
 unchanged. Only the producer differs.
 */
final class MediaPlayback {
  enum Kind {
    case image
    case video
  }

  private static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "3gp", "avi", "mkv", "webm"]

  let kind: Kind
  /// The source's own pixel size, after orientation. What the overlay projects against.
  private(set) var size: CaptureSize = CaptureSize(width: 0, height: 0)

  /// Sorted by timestamp. Playback walks it rather than searching, because time moves forward.
  private var poses: [(ms: Int, result: PoseLandmarkerResult)] = []
  private var cursor = 0

  private let url: URL
  private var imageView: UIImageView?
  private var player: AVPlayer?
  private var playerLayer: AVPlayerLayer?
  private var displayLink: CADisplayLink?
  private var endObserver: NSObjectProtocol?

  /// Called on the main thread with the pose that belongs to what is on screen right now.
  var onPose: ((PoseLandmarkerResult, Int) -> Void)?
  var onPoseLost: (() -> Void)?
  var onFailed: ((String) -> Void)?
  var onProgress: ((Float) -> Void)?

  init?(uri: String) {
    guard let url = URL(string: uri) ?? URL(string: "file://\(uri)") else { return nil }
    self.url = url
    self.kind = MediaPlayback.videoExtensions.contains(url.pathExtension.lowercased()) ? .video : .image
  }

  // MARK: - Surface

  /// Adds the surface below `below`, which is the overlay, so the skeleton draws on top of it.
  func attach(to container: UIView, below overlay: UIView) {
    switch kind {
    case .image:
      let view = UIImageView()
      // Not `.scaleAspectFit`: the frame is set to the projection's rect, so the picture already
      // fills it exactly and any content mode of its own would be a second opinion about the fit.
      view.contentMode = .scaleToFill
      view.clipsToBounds = true
      container.insertSubview(view, belowSubview: overlay)
      imageView = view

    case .video:
      let player = AVPlayer(url: url)
      player.actionAtItemEnd = .pause
      let layer = AVPlayerLayer(player: player)
      layer.videoGravity = .resize
      container.layer.insertSublayer(layer, at: 0)
      self.player = player
      self.playerLayer = layer
    }
  }

  /// The rect the overlay projects into, so the picture lands under the skeleton exactly.
  func setContentRect(_ rect: CGRect) {
    imageView?.frame = rect
    // Position changes on a layer animate by default, and an animating video frame under a
    // non-animating overlay is a visible slip on every rotation.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer?.frame = rect
    CATransaction.commit()
  }

  func setPaused(_ paused: Bool) {
    guard let player = player else { return }
    if paused {
      player.pause()
    } else {
      if player.currentTime() >= (player.currentItem?.duration ?? .zero) {
        player.seek(to: .zero)
        cursor = 0
      }
      player.play()
    }
  }

  // MARK: - Detection

  /**
   Decodes and detects on `queue`, then displays on the main thread.

   Sampled at `sampleFps` rather than at the video's own rate, for the same reason `detectOnVideo`
   does: a 30 fps clip sampled at 10 is every third frame and a third of the work, and the overlay
   holds the last pose in between, which is what it does live between inferences anyway.
   */
  func load(modelPath: String, maxPoses: Int, sampleFps: Int, on queue: DispatchQueue) {
    queue.async { [weak self] in
      guard let self = self else { return }
      do {
        switch self.kind {
        case .image:
          try self.loadImage(modelPath: modelPath, maxPoses: maxPoses)
        case .video:
          try self.loadVideo(modelPath: modelPath, maxPoses: maxPoses, sampleFps: sampleFps)
        }
      } catch {
        DispatchQueue.main.async { self.onFailed?(error.localizedDescription) }
      }
    }
  }

  private func loadImage(modelPath: String, maxPoses: Int) throws {
    guard let image = StaticDetection.loadImage(uri: url.absoluteString) else {
      throw StaticDetectionError("could not read an image from \(url.lastPathComponent)")
    }

    let detector = try PoseDetector.createForStillInput(modelPath: modelPath, maxPoses: maxPoses, video: false)
    let result = try detector.detectImage(try MPImage(uiImage: image))
    let size = CaptureSize(width: Int(image.size.width * image.scale), height: Int(image.size.height * image.scale))

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.size = size
      self.imageView?.image = image
      self.poses = result.landmarks.isEmpty ? [] : [(ms: 0, result: result)]
      self.onProgress?(1)
      if result.landmarks.isEmpty {
        self.onPoseLost?()
      } else {
        self.onPose?(result, 0)
      }
    }
  }

  private func loadVideo(modelPath: String, maxPoses: Int, sampleFps: Int) throws {
    let asset = AVURLAsset(url: url)
    let durationMs = StaticDetection.durationMilliseconds(of: asset)
    guard durationMs > 0 else { throw StaticDetectionError("the video reports no duration") }

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    let detector = try PoseDetector.createForStillInput(modelPath: modelPath, maxPoses: maxPoses, video: true)
    let stepMs = max(1, 1000 / max(1, sampleFps))

    var collected: [(ms: Int, result: PoseLandmarkerResult)] = []
    var size = CaptureSize(width: 0, height: 0)
    var positionMs: Int64 = 0

    while positionMs < durationMs {
      let time = CMTime(value: positionMs, timescale: 1000)
      guard let cgImage = StaticDetection.copyFrame(from: generator, at: time) else {
        positionMs += Int64(stepMs)
        continue
      }

      let image = UIImage(cgImage: cgImage)
      if size.width == 0 {
        size = CaptureSize(width: cgImage.width, height: cgImage.height)
      }

      // VIDEO mode rejects a timestamp that goes backwards, which is why this is sequential.
      let result = try detector.detectVideo(try MPImage(uiImage: image), timestampMs: Int(positionMs))
      if !result.landmarks.isEmpty {
        collected.append((ms: Int(positionMs), result: result))
      }

      let progress = Float(positionMs) / Float(durationMs)
      DispatchQueue.main.async { [weak self] in self?.onProgress?(progress) }
      positionMs += Int64(stepMs)
    }

    let poses = collected
    let finalSize = size
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.size = finalSize
      self.poses = poses
      self.cursor = 0
      self.onProgress?(1)
      self.startFollowingPlayback()
    }
  }

  // MARK: - Playback

  /**
   The overlay follows the player's own clock, read once per displayed frame.

   A `CADisplayLink` fires in step with the screen, and `currentTime()` is where the player
   actually is rather than where a timer thinks it should be. Drawing from a JavaScript timer
   against a separately playing video is the documented way to get a skeleton that drifts out of
   sync with the picture; this cannot, because both come from the same tick.
   */
  private func startFollowingPlayback() {
    let link = CADisplayLink(target: self, selector: #selector(onDisplayLink))
    link.add(to: .main, forMode: .common)
    displayLink = link

    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: player?.currentItem,
      queue: .main
    ) { [weak self] _ in
      self?.cursor = 0
    }
  }

  @objc private func onDisplayLink() {
    guard let player = player, !poses.isEmpty else { return }
    let nowMs = Int(CMTimeGetSeconds(player.currentTime()) * 1000)

    // Walking, not searching: playback moves forward, so this is one comparison per frame in the
    // common case. A seek backwards resets the cursor and the walk starts again.
    if cursor > 0 && poses[cursor].ms > nowMs {
      cursor = 0
    }
    while cursor + 1 < poses.count && poses[cursor + 1].ms <= nowMs {
      cursor += 1
    }

    let pose = poses[cursor]
    onPose?(pose.result, pose.ms)
  }

  func tearDown() {
    displayLink?.invalidate()
    displayLink = nil
    if let observer = endObserver {
      NotificationCenter.default.removeObserver(observer)
      endObserver = nil
    }
    player?.pause()
    player = nil
    playerLayer?.removeFromSuperlayer()
    playerLayer = nil
    imageView?.removeFromSuperview()
    imageView = nil
    poses = []
  }

  deinit {
    displayLink?.invalidate()
    if let observer = endObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }
}
