import CoreGraphics

/**
 The size an export writes at: the source's displayed frame, capped to a long edge.

 Capping is the single biggest lever on how long an export takes and how large the file is, and
 1920 is the default because a painted copy is something to review or share rather than a master.
 The aspect ratio is never changed, so the skeleton drawn against the source's proportions still
 lands on the body.

 Both axes come back even. H.264 encodes in macroblocks, and an odd dimension is rejected outright
 by the encoder on some devices and silently rounded on others, which is the worse of the two
 because it moves every pixel half a step away from where the skeleton was projected.
 */
func exportCanvasSize(display: CGSize, maxSize: Int) -> CGSize {
  let longEdge = max(display.width, display.height)
  guard longEdge > 0, display.width > 0, display.height > 0 else {
    return CGSize(width: 2, height: 2)
  }

  // Only ever down. Painting a 480p clip at 1920 would cost four times the encode for four times
  // the pixels of the same picture.
  let scale = maxSize > 0 ? min(1, CGFloat(maxSize) / longEdge) : 1
  return CGSize(
    width: even(display.width * scale),
    height: even(display.height * scale)
  )
}

private func even(_ value: CGFloat) -> CGFloat {
  let rounded = max(2, value.rounded())
  return rounded - rounded.truncatingRemainder(dividingBy: 2)
}
