import UIKit

/**
 The angle arcs and their labels, split out of `OverlayView` so each file stays one concern: the
 other one is the skeleton and the frame handoff, this one is the only part that reads
 `config.angles`.

 Same aspect correction as `Geometry`, and for the same reason: landmarks are normalized by
 dividing x by width and y by height, so one unit of x is not one unit of y on any non-square
 frame. An arc drawn without putting both axes back in a common unit sits off the joint it belongs
 to on every standard 4:3 or 16:9 frame.
 */
extension OverlayView {
  static let labelFontSize: CGFloat = 13
  static let labelGap: CGFloat = 18
  static let labelPadding: CGFloat = 5
  static let degreesPerRadian = CGFloat(180.0 / Double.pi)

  func drawAngles(_ context: CGContext) {
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
}
