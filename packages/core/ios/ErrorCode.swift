import Foundation

/// The closed set from `src/types/events.ts`. A new code is an addition in both places.
enum ErrorCode: String {
  case permissionDenied = "PERMISSION_DENIED"
  case modelNotFound = "MODEL_NOT_FOUND"
  case modelLoadFailed = "MODEL_LOAD_FAILED"
  case cameraUnavailable = "CAMERA_UNAVAILABLE"
  case cameraStartFailed = "CAMERA_START_FAILED"
  case detectorInitFailed = "DETECTOR_INIT_FAILED"
  case invalidConfig = "INVALID_CONFIG"
  case imageDecodeFailed = "IMAGE_DECODE_FAILED"
  case videoDecodeFailed = "VIDEO_DECODE_FAILED"
  case cameraSwitchFailed = "CAMERA_SWITCH_FAILED"
  case gpuUnavailable = "GPU_UNAVAILABLE"
  case detectionFailed = "DETECTION_FAILED"
  case exportFailed = "EXPORT_FAILED"
  case exportCancelled = "EXPORT_CANCELLED"

  /// Only the first nine stop the camera. The rest are reported and recovered from, and the two
  /// export codes never reach a camera at all: they reject `exportPose`'s promise.
  var fatal: Bool {
    switch self {
    case .cameraSwitchFailed, .gpuUnavailable, .detectionFailed, .exportFailed, .exportCancelled:
      return false
    default:
      return true
    }
  }
}
