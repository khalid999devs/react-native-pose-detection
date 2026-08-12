// BlazePose emits 33 landmarks in a fixed order. That order is the wire format, the native
// overlay's index space, and the trigger evaluator's lookup table, so it is defined once here
// and everything else derives from it.

const NAMES = [
  'nose',
  'leftEyeInner',
  'leftEye',
  'leftEyeOuter',
  'rightEyeInner',
  'rightEye',
  'rightEyeOuter',
  'leftEar',
  'rightEar',
  'mouthLeft',
  'mouthRight',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftPinky',
  'rightPinky',
  'leftIndex',
  'rightIndex',
  'leftThumb',
  'rightThumb',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
  'leftHeel',
  'rightHeel',
  'leftFootIndex',
  'rightFootIndex',
] as const;

export type JointName = (typeof NAMES)[number];

export const JOINT_NAMES: readonly JointName[] = NAMES;

/** Annotated as `33` so adding or removing a name fails the build rather than the wire format. */
export const LANDMARK_COUNT: 33 = NAMES.length;

export const JOINT_INDEX = Object.fromEntries(
  NAMES.map((name, index) => [name, index]),
) as Readonly<Record<JointName, number>>;

export function isJointName(value: unknown): value is JointName {
  return typeof value === 'string' && value in JOINT_INDEX;
}

const CONNECTIONS = [
  ['nose', 'leftEyeInner'],
  ['leftEyeInner', 'leftEye'],
  ['leftEye', 'leftEyeOuter'],
  ['leftEyeOuter', 'leftEar'],
  ['nose', 'rightEyeInner'],
  ['rightEyeInner', 'rightEye'],
  ['rightEye', 'rightEyeOuter'],
  ['rightEyeOuter', 'rightEar'],
  ['mouthLeft', 'mouthRight'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['leftWrist', 'leftPinky'],
  ['leftWrist', 'leftIndex'],
  ['leftWrist', 'leftThumb'],
  ['leftPinky', 'leftIndex'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['rightWrist', 'rightPinky'],
  ['rightWrist', 'rightIndex'],
  ['rightWrist', 'rightThumb'],
  ['rightPinky', 'rightIndex'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['rightHip', 'rightKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightKnee', 'rightAnkle'],
  ['leftAnkle', 'leftHeel'],
  ['rightAnkle', 'rightHeel'],
  ['leftHeel', 'leftFootIndex'],
  ['rightHeel', 'rightFootIndex'],
  ['leftAnkle', 'leftFootIndex'],
  ['rightAnkle', 'rightFootIndex'],
] as const satisfies readonly (readonly [JointName, JointName])[];

/** The skeleton both native renderers draw. Same pairs, same order, on both platforms. */
export const POSE_CONNECTIONS: readonly (readonly [JointName, JointName])[] = CONNECTIONS;

export const CONNECTION_COUNT: 35 = CONNECTIONS.length;

/** What the native renderers actually iterate: pair lookup without a string hash per segment. */
export const POSE_CONNECTION_INDICES: readonly (readonly [number, number])[] = CONNECTIONS.map(
  ([from, to]) => [JOINT_INDEX[from], JOINT_INDEX[to]] as const,
);

const ANGLE_NAMES = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const satisfies readonly JointName[];

/**
 * Only joints where two limb segments meet have an angle. `nose` does not, so accepting every
 * `JointName` in `Condition.angle` would push a class of config errors into the native evaluator
 * where they can only fail silently.
 */
export type AngleJointName = (typeof ANGLE_NAMES)[number];

export const ANGLE_JOINT_NAMES: readonly AngleJointName[] = ANGLE_NAMES;

/** `[proximal, vertex, distal]`. The angle is measured at the vertex, between the two segments. */
export const ANGLE_JOINTS = {
  leftShoulder: ['leftHip', 'leftShoulder', 'leftElbow'],
  rightShoulder: ['rightHip', 'rightShoulder', 'rightElbow'],
  leftElbow: ['leftShoulder', 'leftElbow', 'leftWrist'],
  rightElbow: ['rightShoulder', 'rightElbow', 'rightWrist'],
  leftWrist: ['leftElbow', 'leftWrist', 'leftIndex'],
  rightWrist: ['rightElbow', 'rightWrist', 'rightIndex'],
  leftHip: ['leftShoulder', 'leftHip', 'leftKnee'],
  rightHip: ['rightShoulder', 'rightHip', 'rightKnee'],
  leftKnee: ['leftHip', 'leftKnee', 'leftAnkle'],
  rightKnee: ['rightHip', 'rightKnee', 'rightAnkle'],
  leftAnkle: ['leftKnee', 'leftAnkle', 'leftFootIndex'],
  rightAnkle: ['rightKnee', 'rightAnkle', 'rightFootIndex'],
} as const satisfies Readonly<Record<AngleJointName, readonly [JointName, JointName, JointName]>>;

export function isAngleJointName(value: unknown): value is AngleJointName {
  return typeof value === 'string' && value in ANGLE_JOINTS;
}
