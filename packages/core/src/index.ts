// The only public surface. Anything not exported here can change without a major version.

export * from './types';

export { PoseCamera } from './PoseCamera';

export {
  createLandmark,
  hasLandmark,
  isVisible,
  landmark,
  landmarkInto,
  visibilityOf,
  worldLandmark,
} from './accessors';

export { PoseConfigError } from './errors';
export type { ValidationIssue } from './errors';

export { assertValidTriggers, validateTriggers } from './validation';

export { addLogListener, setLogLevel } from './logging';

export { getCameraPermission, requestCameraPermission } from './permissions';
export type { CameraPermission, CameraPermissionStatus } from './permissions';
export { useCameraPermission } from './useCameraPermission';
export type { UseCameraPermission } from './useCameraPermission';

export type { NativePoseCameraView, NativePoseModule } from './native';
