import AVFoundation

/**
 `canAskAgain` is the field that matters. Without it an app cannot tell a refusal it may ask about
 again from one the system will never prompt for, and it shows a button that does nothing.

 On iOS the answer is exact rather than approximated. The system prompts once and never again, so
 `notDetermined` is the only state that can still be asked, and a refusal is always what
 `src/permissions/permissions.ts` reports as `blocked`. Android has a third state in between.
 */
func permissionResult(_ status: AVAuthorizationStatus) -> [String: Any] {
  switch status {
  case .authorized:
    return ["status": "granted", "canAskAgain": false]
  case .notDetermined:
    return ["status": "undetermined", "canAskAgain": true]
  default:
    // .denied and .restricted both mean no dialog will ever appear again. Settings is the only way.
    return ["status": "denied", "canAskAgain": false]
  }
}

func currentCameraPermission() -> [String: Any] {
  return permissionResult(AVCaptureDevice.authorizationStatus(for: .video))
}
