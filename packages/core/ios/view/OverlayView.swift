import UIKit

/**
 Draws the skeleton over the preview. Nothing here crosses to JavaScript.

 The detector's callback thread writes `incoming`, the main thread draws from `landmarks`, and
 `frameLock` is held only for the copy between them. Without it a draw already in flight can read
 some joints from one frame and the rest from the next, and the skeleton snaps apart.
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
  var landmarks = [Float](repeating: 0, count: Skeleton.landmarkCount * Skeleton.landmarkStride)
  private var hasPose = false
  private var mirrored = false
  var sourceWidth = 0
  var sourceHeight = 0

  /// At most one redraw in flight. UIKit has no `postInvalidateOnAnimation`, so this coalesces.
  private var redrawPending = false

  /// `.fill` matches the camera preview's gravity. `.fit` is what a picked image or video wants,
  /// and it is published through `contentRect()` so the media layer is given the very rect the
  /// skeleton is projected into rather than a second computation that can disagree with it.
  var contentFit: ContentFit = .fill {
    didSet {
      guard contentFit != oldValue else { return }
      setNeedsDisplay()
    }
  }

  /// The source's own size, set for static media where no frame has arrived yet. The camera path
  /// leaves it alone: there the size rides in with the landmarks, see `submit`.
  func setSourceSize(width: Int, height: Int) {
    frameLock.lock()
    incomingWidth = width
    incomingHeight = height
    frameLock.unlock()
    requestRedraw()
  }

  /// Where the source lands inside this view. The media layer is positioned with exactly this, so
  /// the picture and the skeleton cannot disagree.
  func contentRect() -> CGRect {
    frameLock.lock()
    let width = incomingWidth
    let height = incomingHeight
    frameLock.unlock()

    return OverlayProjection(
      source: CGSize(width: width, height: height),
      bounds: bounds,
      fit: contentFit
    ).rect
  }

  var config = OverlayConfig() {
    didSet {
      guard config != oldValue else { return }
      applyConfig()
      setNeedsDisplay()
    }
  }

  var strokeColor = OverlayConfig().color.uiColor.cgColor
  var arcColors = [CGColor]()
  var labelAttributes: [NSAttributedString.Key: Any] = [:]

  // Constant within a draw, so it is built once per frame rather than on each of the hundred-odd
  // projections a frame makes.
  private var projection = OverlayProjection(source: .zero, bounds: .zero, fit: .fill)

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    contentMode = .redraw
    applyConfig()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("OverlayView is created in code, never from a nib")
  }

  private func applyConfig() {
    strokeColor = config.color.uiColor.cgColor
    arcColors = config.angles.map { ($0.color ?? config.color).uiColor.cgColor }
    labelAttributes = [.font: UIFont.systemFont(ofSize: OverlayView.labelFontSize, weight: .semibold)]
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
    updateProjection()

    if config.connections { drawConnections(context) }
    if config.landmarks { drawLandmarks(context) }
    if !config.angles.isEmpty { drawAngles(context) }
  }

  private func isDrawable(_ joint: Int) -> Bool {
    if Geometry.visibility(landmarks, joint: joint) < config.minVisibility { return false }
    guard let only = config.only else { return true }
    return only[joint]
  }

  private func drawLandmarks(_ context: CGContext) {
    let radius = config.pointRadius
    guard radius > 0 else { return }
    context.setFillColor(strokeColor)

    var drawn = false
    for joint in 0..<Skeleton.landmarkCount where isDrawable(joint) {
      let point = project(joint)
      context.addEllipse(in: CGRect(
        x: point.x - radius,
        y: point.y - radius,
        width: radius * 2,
        height: radius * 2
      ))
      drawn = true
    }
    if drawn { context.fillPath() }
  }

  private func drawConnections(_ context: CGContext) {
    context.setStrokeColor(strokeColor)
    context.setLineWidth(config.lineWidth)
    context.setLineCap(.round)

    var drawn = false
    var index = 0
    while index < Skeleton.connections.count {
      let from = Skeleton.connections[index]
      let to = Skeleton.connections[index + 1]
      index += 2

      // A segment with one bad endpoint is a line to a guess, so it is not drawn at all.
      guard isDrawable(from), isDrawable(to) else { continue }
      context.move(to: project(from))
      context.addLine(to: project(to))
      drawn = true
    }
    if drawn { context.strokePath() }
  }

  private func updateProjection() {
    projection = OverlayProjection(
      source: CGSize(width: sourceWidth, height: sourceHeight),
      bounds: bounds,
      fit: contentFit
    )
  }

  /// Normalized frame coordinates to view points, through the projection `updateProjection` built.
  func project(_ joint: Int) -> CGPoint {
    let base = joint * Skeleton.landmarkStride
    return projection.point(
      x: CGFloat(landmarks[base + Skeleton.offsetX]),
      y: CGFloat(landmarks[base + Skeleton.offsetY]),
      mirrored: mirrored
    )
  }
}
