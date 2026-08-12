import { getNativeModule } from './native';
import type { NativeCameraPermission } from './native';

/**
 * `denied` can be asked again. `blocked` cannot: the system will not show a dialog, and the only
 * way forward is the app's page in Settings. An app that treats them the same shows an "allow"
 * button that does nothing, which is the usual way camera permission goes wrong.
 */
export type CameraPermissionStatus = 'granted' | 'denied' | 'blocked' | 'undetermined';

export type CameraPermission = {
  readonly status: CameraPermissionStatus;
  readonly granted: boolean;
  /** False once the system will not prompt again. Send the user to `Linking.openSettings()`. */
  readonly canAskAgain: boolean;
};

function toPermission(native: NativeCameraPermission): CameraPermission {
  const { canAskAgain } = native;

  if (native.status === 'granted') return { status: 'granted', granted: true, canAskAgain: false };
  if (native.status === 'undetermined') {
    return { status: 'undetermined', granted: false, canAskAgain: true };
  }
  return { status: canAskAgain ? 'denied' : 'blocked', granted: false, canAskAgain };
}

/** Reads the current status. Never prompts, so it is safe to call during render effects. */
export async function getCameraPermission(): Promise<CameraPermission> {
  return toPermission(await getNativeModule().getCameraPermission());
}

/**
 * Prompts if the system still will. Resolves with the outcome either way, and resolves without a
 * dialog when the status is already `granted` or `blocked`.
 */
export async function requestCameraPermission(): Promise<CameraPermission> {
  return toPermission(await getNativeModule().requestCameraPermission());
}
