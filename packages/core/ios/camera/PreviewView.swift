import AVFoundation
import UIKit

/**
 The camera preview, as a view rather than a layer somebody has to keep in sync.

 Overriding `layerClass` makes the preview layer the view's own backing layer, so UIKit resizes it
 during layout and there is no frame assignment to animate, mistime, or forget on rotation. The
 legacy package added the layer as a sublayer and re-set `frame` by hand inside a
 `CATransaction.setDisableActions(true)` block; this is the same effect with nothing to get wrong.
 */
final class PreviewView: UIView {
  // `layerClass` is UIView's, so it has to stay a class property even though this class is final.
  // swiftlint:disable:next static_over_final_class
  override class var layerClass: AnyClass {
    return AVCaptureVideoPreviewLayer.self
  }

  /// Optional rather than force cast: `layerClass` guarantees the type, but a crash is not a proof.
  var previewLayer: AVCaptureVideoPreviewLayer? {
    return layer as? AVCaptureVideoPreviewLayer
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    // Matches PreviewView.ScaleType.FILL_CENTER on Android: scale to cover, crop evenly.
    previewLayer?.videoGravity = .resizeAspectFill
    backgroundColor = .black
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("PreviewView is created in code, never from a nib")
  }
}
