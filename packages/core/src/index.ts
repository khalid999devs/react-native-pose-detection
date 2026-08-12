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
} from './frames/accessors';

export { PoseConfigError } from './errors';
export type { ValidationIssue } from './errors';

export { assertValidTriggers, validateTriggers } from './validation';

export { addLogListener, setLogLevel } from './logging';

export { detectOnImage, detectOnVideo } from './staticInput';
export type { StaticOptions, VideoOptions, VideoTask } from './staticInput';

export { getCameraPermission, requestCameraPermission } from './permissions/permissions';
export type { CameraPermission, CameraPermissionStatus } from './permissions/permissions';
export { useCameraPermission } from './permissions/useCameraPermission';
export type { UseCameraPermission } from './permissions/useCameraPermission';

export type { NativePoseCameraView, NativePoseModule } from './native';
