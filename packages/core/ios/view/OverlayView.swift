import UIKit

/**
 Draws the skeleton over the preview. Nothing here crosses to JavaScript.

 The detector's callback thread writes `incoming`, the main thread draws from `landmarks`, and
 `frameLock` is held only for the copy between them. Without it a draw already in flight can read
 some joints from one frame and the rest from the next, and the skeleton snaps apart.

 The drawing itself is `OverlayRenderer`, which this view holds no special version of: the
 exporter builds the same renderer against a pixel buffer. This class is the threading and the
 lifecycle around it, not the geometry.
 */
final class OverlayView: UIView {

  private let frameLock = NSLock()
  private var incoming = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  private var incomingHasPose = false
  private var incomingMirrored = false
  private var incomingWidth = 0
  private var incomingHeight = 0

  // Everything below is the snapshot taken under the lock at the top of draw, and is touched only
  // on the main thread from there on. Mirroring and the source size ride in the same snapshot as
  // the landmarks, so a camera switch can never draw new landmarks with the old mirroring.
  private var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  private var hasPose = false
  private var mirrored = false
  private var sourceWidth = 0
  private var sourceHeight = 0

  /// At most one redraw in flight. UIKit has no `postInvalidateOnAnimation`, so this coalesces.
  private var redrawPending = false

  var config = OverlayConfig() {
    didSet {
      guard config != oldValue else { return }
      palette = OverlayPalette(config)
      setNeedsDisplay()
    }
  }

  /// Rebuilt when the config changes, never on the draw path.
  private var palette = OverlayPalette(OverlayConfig())

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    contentMode = .redraw
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("OverlayView is created in code, never from a nib")
  }

  func setMirrored(_ value: Bool) {
    frameLock.lock()
    incomingMirrored = value
    frameLock.unlock()
    requestRedraw()
  }

  /**
   Called from the detector's callback thread; copies into the view's buffer and asks for a redraw.

   The size travels with the landmarks rather than in a call of its own. Two critical sections let
   a draw land between them and use new landmarks with the previous frame size, which is exactly
   the interleaving the snapshot in this class exists to prevent.
   */
  func submit(_ frame: [Float], width: Int, height: Int) {
    frameLock.lock()
    for index in 0..<incoming.count {
      incoming[index] = frame[index]
    }
    incomingWidth = width
    incomingHeight = height
    incomingHasPose = true
    frameLock.unlock()
    requestRedraw()
  }

  func clearPose() {
    frameLock.lock()
    incomingHasPose = false
    frameLock.unlock()
    requestRedraw()
  }

  /// One hop to main per redraw at most, however many frames arrive in between.
  private func requestRedraw() {
    frameLock.lock()
    if redrawPending {
      frameLock.unlock()
      return
    }
    redrawPending = true
    frameLock.unlock()

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.frameLock.lock()
      self.redrawPending = false
      self.frameLock.unlock()
      self.setNeedsDisplay()
    }
  }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }

    // One copy under the lock, then the rest of the draw runs on a frame that cannot change
    // underneath it. The producer waits only for the copy, never for the draw.
    frameLock.lock()
    hasPose = incomingHasPose
    mirrored = incomingMirrored
    sourceWidth = incomingWidth
    sourceHeight = incomingHeight
    if hasPose {
      for index in 0..<landmarks.count {
        landmarks[index] = incoming[index]
      }
    }
    frameLock.unlock()

    guard hasPose, sourceWidth > 0, sourceHeight > 0, bounds.width > 0, bounds.height > 0 else { return }

    OverlayRenderer(
      config: config,
      palette: palette,
      landmarks: landmarks,
      projection: OverlayProjection(
        source: CGSize(width: sourceWidth, height: sourceHeight),
        bounds: bounds,
        // The preview fills, so the skeleton fills with it.
        fit: .fill
      ),
      mirrored: mirrored,
      sourceWidth: sourceWidth,
      sourceHeight: sourceHeight
    ).draw(into: context)
  }
}
