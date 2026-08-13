import UIKit

/**
 Colors and text attributes derived from a config, built once and reused across draws.

 Separate from `OverlayRenderer` because a renderer is built per frame and this is not: converting
 a packed color and building a font on every frame would be allocation on the draw path, which is
 the one place this package does not allocate.
 */
struct OverlayPalette {
  let stroke: CGColor
  let arcs: [CGColor]
  let labelAttributes: [NSAttributedString.Key: Any]

  init(_ config: OverlayConfig) {
    stroke = config.color.uiColor.cgColor
    arcs = config.angles.map { ($0.color ?? config.color).uiColor.cgColor }
    labelAttributes = [.font: UIFont.systemFont(ofSize: OverlayRenderer.labelFontSize, weight: .semibold)]
  }
}

/**
 The skeleton, drawn into any `CGContext`.

 This is the only place the overlay is drawn. `OverlayView` builds one of these per redraw and
 hands it the screen's context; the exporter builds one per video frame and hands it a context
 over the pixel buffer it is about to encode. Neither knows how the other works, and because the
 geometry lives here rather than in either of them, a painted export and a live preview of the
 same pose cannot disagree about where a joint goes. `OverlayProjection` makes the same guarantee
 one level down, for the rect the pose is projected into.

 A value type with no reference to a view, so it is safe to build and draw on the export queue.
 */
struct OverlayRenderer {
  static let labelFontSize: CGFloat = 13
  static let labelGap: CGFloat = 18
  static let labelPadding: CGFloat = 5
  static let degreesPerRadian = CGFloat(180.0 / Double.pi)

  let config: OverlayConfig
  let palette: OverlayPalette
  let landmarks: [Float]
  let projection: OverlayProjection
  let mirrored: Bool
  let sourceWidth: Int
  let sourceHeight: Int

  func draw(into context: CGContext) {
    guard sourceWidth > 0, sourceHeight > 0 else { return }
    if config.connections { drawConnections(context) }
    if config.landmarks { drawLandmarks(context) }
    if !config.angles.isEmpty { drawAngles(context) }
  }

  /// Normalized frame coordinates to context points, through the projection this was built with.
  func project(_ joint: Int) -> CGPoint {
    let base = joint * Skeleton.landmarkStride
    return projection.point(
      x: CGFloat(landmarks[base + Skeleton.offsetX]),
      y: CGFloat(landmarks[base + Skeleton.offsetY]),
      mirrored: mirrored
    )
  }

  private func isDrawable(_ joint: Int) -> Bool {
    if Geometry.visibility(landmarks, joint: joint) < config.minVisibility { return false }
    guard let only = config.only else { return true }
    return only[joint]
  }

  private func drawLandmarks(_ context: CGContext) {
    let radius = config.pointRadius
    guard radius > 0 else { return }
    context.setFillColor(palette.stroke)

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
    context.setStrokeColor(palette.stroke)
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
}
