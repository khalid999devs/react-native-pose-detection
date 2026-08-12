import { decodeFrames } from './frames/decodeFrames';
import { getNativeModule } from './native';
import type { AngleJointName, JointName } from './types/joints';
import { ANGLE_JOINT_NAMES } from './types/joints';
import type { PoseFrame } from './types/frame';
import { resolveAngleJoints } from './frames/wire';

export type StaticOptions = {
  /** 1 to 5. Default 1. */
  maxPoses?: number;
  /** `true` computes all twelve. Default `true`, unlike the live path, where the default is none. */
  angles?: boolean | readonly AngleJointName[];
  worldLandmarks?: boolean;
  /** Narrows the landmark buffer, exactly as `data.select` does. */
  select?: readonly JointName[];
};

export type VideoOptions = StaticOptions & {
  /** Sampling rate, not the video's own frame rate. Default 10. */
  fps?: number;
  startMs?: number;
  endMs?: number;
  /** Temporal, so unlike a still image this one means something. Default `true`. */
  smoothing?: boolean;
  /** 0 to 1. Never receives frames. */
  onProgress?: (progress: number) => void;
};

export type VideoTask = {
  /** Resolves with everything decoded, including after `cancel()`. */
  readonly frames: Promise<PoseFrame[]>;
  /** Stops sampling. `frames` then resolves with what was decoded up to that point. */
  cancel(): void;
};

function angleJointsFor(angles: StaticOptions['angles']): readonly AngleJointName[] {
  if (angles === false) return [];
  if (angles === undefined || angles === true) return ANGLE_JOINT_NAMES;
  return resolveAngleJoints(new Set(angles));
}

function nativeOptions(
  options: StaticOptions | VideoOptions | undefined,
  angleJoints: readonly AngleJointName[],
): Record<string, unknown> {
  // onProgress is a JavaScript callback and cannot cross. Progress arrives as an event instead.
  const rest = { ...((options ?? {}) as VideoOptions) };
  delete rest.onProgress;
  return { ...rest, angles: angleJoints.length > 0, angleJoints: [...angleJoints] };
}

function decode(
  buffer: ArrayBuffer,
  angleJoints: readonly AngleJointName[],
  select: readonly JointName[] | undefined,
): PoseFrame[] {
  const { frames, error } = decodeFrames(buffer, {
    angleJoints,
    ...(select && select.length > 0 ? { selection: select } : {}),
  });
  if (error) throw new Error(error);
  return frames;
}

/**
 * The same detector, no camera. One `PoseFrame` per detected pose, so a photo of two people
 * decodes to two.
 */
export async function detectOnImage(uri: string, options?: StaticOptions): Promise<PoseFrame[]> {
  const angleJoints = angleJointsFor(options?.angles);
  const buffer = await getNativeModule().detectOnImage(uri, nativeOptions(options, angleJoints));
  return decode(buffer, angleJoints, options?.select);
}

let nextTaskId = 1;

/**
 * A task rather than a bare promise: a clip can take minutes, and something has to be able to stop
 * it. Cancelling resolves `frames` with what was decoded rather than rejecting, because those
 * frames are real and throwing them away is not what cancel means.
 */
export function detectOnVideo(uri: string, options?: VideoOptions): VideoTask {
  const angleJoints = angleJointsFor(options?.angles);
  const module = getNativeModule();
  const taskId = nextTaskId;
  nextTaskId += 1;

  const { onProgress } = options ?? {};
  const subscription = onProgress
    ? module.addListener('onVideoProgress', (event: { taskId: number; progress: number }) => {
        if (event.taskId === taskId) onProgress(event.progress);
      })
    : null;

  const frames = module
    .detectOnVideo(uri, nativeOptions(options, angleJoints), taskId)
    .then((buffer) => decode(buffer, angleJoints, options?.select))
    .finally(() => subscription?.remove());

  return {
    frames,
    cancel: () => module.cancelDetectOnVideo(taskId),
  };
}
