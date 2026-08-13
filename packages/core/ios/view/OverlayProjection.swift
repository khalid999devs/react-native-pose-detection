import CoreGraphics

/// How the source is fitted into the view. The camera preview covers the view; static media is
/// fitted so that none of the picture is cropped away.
enum ContentFit {
  case fill
  case fit
}

/**
 Where the source lands inside the view, and where one normalized landmark lands inside that.

 This is a type of its own rather than a pair of methods on `OverlayView` for one reason: the
 picture and the skeleton have to agree to the pixel, and the only way to be sure of that is for
 both to come from a single computation that is tested on its own. `OverlayView` projects through
 it; the image and video layers are positioned with `rect` from it. Two implementations of the
 same arithmetic is how a skeleton ends up slightly off the body on one aspect ratio and nobody
 notices until a user does.
 */
struct OverlayProjection: Equatable {
  let rect: CGRect

  /// `.fill` matches `AVLayerVideoGravity.resizeAspectFill`, `.fit` matches `resizeAspect`.
  init(source: CGSize, bounds: CGRect, fit: ContentFit) {
    guard source.width > 0, source.height > 0, bounds.width > 0, bounds.height > 0 else {
      self.rect = bounds
      return
    }

    let sourceAspect = source.width / source.height
    let viewAspect = bounds.width / bounds.height
    // Fill takes the larger scale so the view is covered; fit takes the smaller so the source is
    // whole. The comparison is the only thing that differs between them.
    let heightLeads = fit == .fill ? sourceAspect > viewAspect : sourceAspect < viewAspect

    let width: CGFloat
    let height: CGFloat
    if heightLeads {
      height = bounds.height
      width = height * sourceAspect
    } else {
      width = bounds.width
      height = width / sourceAspect
    }

    self.rect = CGRect(
      x: bounds.minX + (bounds.width - width) / 2,
      y: bounds.minY + (bounds.height - height) / 2,
      width: width,
      height: height
    )
  }

  /**
   One normalized point to view coordinates.

   Landmarks are un-mirrored so they describe the real world. The front camera preview is
   mirrored, so the overlay mirrors here to stay aligned with what is on screen. Static media is
   never mirrored, which is why this is a parameter rather than something the projection assumes.
   */
  func point(x: CGFloat, y: CGFloat, mirrored: Bool) -> CGPoint {
    let posX = mirrored ? 1 - x : x
    return CGPoint(x: rect.minX + posX * rect.width, y: rect.minY + y * rect.height)
  }
}
