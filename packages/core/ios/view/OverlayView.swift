import UIKit

/**
 Draws the skeleton over the preview. Nothing here crosses to JavaScript.

 The detector's callback thread writes `incoming`, the main thread draws from `landmarks`, and
 `frameLock` is held only for the copy between them. Without it a draw already in flight can read
 some joints from one frame and the rest from the next, and the skeleton snaps apart.
 */
final class OverlayView: UIView {
  private static let labelFontSize: CGFloat = 13
  private static let labelGap: CGFloat = 18
  private static let labelPadding: CGFloat = 5
  private static let degreesPerRadian = CGFloat(180.0 / Double.pi)

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
      applyConfig()
      setNeedsDisplay()
    }
  }

  private var strokeColor = OverlayConfig().color.uiColor.cgColor
  private var arcColors = [CGColor]()
  private var labelAttributes: [NSAttributedString.Key: Any] = [:]

  // The fill scale and offsets are constant within a draw, so they are computed once per frame
  // rather than on each of the hundred-odd projections a frame makes.
  private var fillScaleX: CGFloat = 0
  private var fillScaleY: CGFloat = 0
  private var fillOffsetX: CGFloat = 0
  private var fillOffsetY: CGFloat = 0

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

  private func drawAngles(_ context: CGContext) {
    context.setLineWidth(config.lineWidth * 0.75)

    for (index, spec) in config.angles.enumerated() {
      let vertex = spec.triple[1]
      if Geometry.visibility(landmarks, joint: vertex) < spec.minVisibility { continue }

      let degrees = Geometry.angleDegrees(
        landmarks,
        proximal: spec.triple[0],
        vertex: vertex,
        distal: spec.triple[2],
        frameWidth: sourceWidth,
        frameHeight: sourceHeight
      )
      if degrees.isNaN { continue }

      let proximal = project(spec.triple[0])
      let center = project(vertex)
      let distal = project(spec.triple[2])

      // Taken in screen points, after the mirror and the fill, so the arc opens into the joint on
      // both cameras instead of straddling the limb on the front one.
      let bisector = Geometry.bisectorRadians(
        proximalX: Float(proximal.x),
        proximalY: Float(proximal.y),
        vertexX: Float(center.x),
        vertexY: Float(center.y),
        distalX: Float(distal.x),
        distalY: Float(distal.y)
      )
      if bisector.isNaN { continue }

      let color = index < arcColors.count ? arcColors[index] : strokeColor
      context.setStrokeColor(color)

      // The sweep is the angle itself, centered on the bisector, so the arc sits inside the two limb
      // segments rather than crossing them.
      let sweep = CGFloat(degrees) / OverlayView.degreesPerRadian
      let start = CGFloat(bisector) - sweep / 2
      context.addArc(
        center: center,
        radius: spec.radius,
        startAngle: start,
        endAngle: start + sweep,
        clockwise: false
      )
      context.strokePath()

      if spec.label {
        drawLabel(context, degrees: degrees, spec: spec, center: center, bisector: CGFloat(bisector), color: color)
      }
    }
  }

  private func drawLabel(
    _ context: CGContext,
    degrees: Float,
    spec: AngleOverlaySpec,
    center: CGPoint,
    bisector: CGFloat,
    color: CGColor
  ) {
    let labelRadius = spec.radius + OverlayView.labelGap
    let anchor = CGPoint(x: center.x + cos(bisector) * labelRadius, y: center.y + sin(bisector) * labelRadius)

    var attributes = labelAttributes
    attributes[.foregroundColor] = UIColor(cgColor: color)
    let text = format(degrees: degrees, decimals: spec.decimals) as NSString
    let size = text.size(withAttributes: attributes)
    let padding = OverlayView.labelPadding

    let box = CGRect(
      x: anchor.x - size.width / 2 - padding,
      y: anchor.y - size.height / 2 - padding / 2,
      width: size.width + padding * 2,
      height: size.height + padding
    )
    context.setFillColor(UIColor(white: 0, alpha: 140.0 / 255.0).cgColor)
    UIBezierPath(roundedRect: box, cornerRadius: padding).fill()

    text.draw(at: CGPoint(x: anchor.x - size.width / 2, y: anchor.y - size.height / 2), withAttributes: attributes)
  }

  /**
   Whole degrees take the integer path, which builds a short string and nothing else. Decimals go
   through a format specifier, and only when a consumer opts in. Unlike Android there is no
   reusable character buffer: drawing text on iOS needs an `NSString` either way, so the saving
   would be a string that `draw(at:)` immediately allocates again.
   */
  private func format(degrees: Float, decimals: Int) -> String {
    if decimals <= 0 {
      return "\(max(0, Int(degrees.rounded())))\u{00B0}"
    }
    // A fixed locale, because a de-DE device would otherwise render "90,5" for the same build.
    return String(format: "%.\(decimals)f\u{00B0}", locale: Locale(identifier: "en_US_POSIX"), degrees)
  }

  /// Matches `AVLayerVideoGravity.resizeAspectFill`: scale to cover, crop the overflowing axis evenly.
  private func updateProjection() {
    let sourceAspect = CGFloat(sourceWidth) / CGFloat(sourceHeight)
    let viewAspect = bounds.width / bounds.height

    let scaledWidth: CGFloat
    let scaledHeight: CGFloat
    if sourceAspect > viewAspect {
      scaledHeight = bounds.height
      scaledWidth = scaledHeight * sourceAspect
    } else {
      scaledWidth = bounds.width
      scaledHeight = scaledWidth / sourceAspect
    }

    fillScaleX = scaledWidth
    fillScaleY = scaledHeight
    fillOffsetX = (bounds.width - scaledWidth) / 2
    fillOffsetY = (bounds.height - scaledHeight) / 2
  }

  /// Normalized frame coordinates to view points, using the fill `updateProjection` computed.
  private func project(_ joint: Int) -> CGPoint {
    let base = joint * Skeleton.landmarkStride
    var posX = CGFloat(landmarks[base + Skeleton.offsetX])
    let posY = CGFloat(landmarks[base + Skeleton.offsetY])

    // Landmarks are un-mirrored so they describe the real world. The preview is mirrored on the
    // front camera, so the overlay mirrors here to stay aligned with what is on screen.
    if mirrored { posX = 1 - posX }

    return CGPoint(x: fillOffsetX + posX * fillScaleX, y: fillOffsetY + posY * fillScaleY)
  }
}
