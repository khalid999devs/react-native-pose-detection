import AVFoundation
import UIKit

/**
 Interface orientation into the two ways AVFoundation has been told about rotation.

 The buffers are rotated by the capture pipeline rather than by us, so everything downstream, the
 landmarks included, is already display-upright and the detector is always handed `.up`. Android
 does the opposite and passes the rotation to MediaPipe, because CameraX hands over the sensor
 buffer untouched. Both end at the same place: normalized coordinates in the space the preview is
 showing.
 */
enum CaptureRotation {
  /**
   The names are swapped between these two enums (`AVCaptureVideoOrientation.landscapeRight` is
   `UIInterfaceOrientation.landscapeLeft`) but the raw values are not, which is why converting
   through `rawValue` is right and converting by name is the classic way to get a sideways preview.
   This is the conversion Apple's own AVCam sample uses.
   */
  static func videoOrientation(for interface: UIInterfaceOrientation) -> AVCaptureVideoOrientation {
    return AVCaptureVideoOrientation(rawValue: interface.rawValue) ?? .portrait
  }

  /// The equivalence Apple published when `videoOrientation` was deprecated for `videoRotationAngle`.
  static func angle(for orientation: AVCaptureVideoOrientation) -> CGFloat {
    switch orientation {
    case .portrait: return 90
    case .portraitUpsideDown: return 270
    case .landscapeRight: return 0
    case .landscapeLeft: return 180
    @unknown default: return 90
    }
  }

  /// Applies whichever of the two the running OS prefers. A connection that cannot rotate is left alone.
  static func apply(_ orientation: AVCaptureVideoOrientation, to connection: AVCaptureConnection) {
    if #available(iOS 17.0, *) {
      let angle = self.angle(for: orientation)
      if connection.isVideoRotationAngleSupported(angle) {
        connection.videoRotationAngle = angle
      }
      return
    }
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = orientation
    }
  }

  /**
   Mirroring is the preview's business only. Landmarks describe the real world, so the frames the
   detector sees are never mirrored, and the overlay flips at draw time to line up with what is on
   screen. Mirroring the analysis output instead would put every left limb on the right.
   */
  static func mirror(_ mirrored: Bool, on connection: AVCaptureConnection) {
    guard connection.isVideoMirroringSupported else { return }
    connection.automaticallyAdjustsVideoMirroring = false
    connection.isVideoMirrored = mirrored
  }
}
