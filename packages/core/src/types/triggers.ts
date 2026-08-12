import type { PoseFrame } from './frame';
import type { AngleJointName, JointName } from './joints';

/** Degrees, 0 to 180, at a joint where two limb segments meet. */
export type AngleCondition = {
  angle: AngleJointName;
  below?: number;
  above?: number;
  /** `[min, max]`, inclusive. `min` must be less than `max`. */
  between?: readonly [number, number];
};

/**
 * Normalized 0 to 1, origin top-left. A `JointName` bound compares against that joint's position
 * in the same frame, which stays correct as the subject moves toward or away from the camera.
 */
export type LandmarkXCondition = {
  landmarkX: JointName;
  below?: number | JointName;
  above?: number | JointName;
};

export type LandmarkYCondition = {
  landmarkY: JointName;
  below?: number | JointName;
  above?: number | JointName;
};

/** Normalized units per second. */
export type VelocityXCondition = {
  velocityX: 'centerOfMass' | JointName;
  below?: number;
  above?: number;
};

export type VelocityYCondition = {
  velocityY: 'centerOfMass' | JointName;
  below?: number;
  above?: number;
};

/** Gate the rest of a condition on tracking quality before trusting a coordinate. */
export type VisibilityCondition = {
  visibility: JointName;
  above: number;
};

export type AllCondition = { all: readonly Condition[] };
export type AnyCondition = { any: readonly Condition[] };

/**
 * Conditions describe a body, never an activity. That is what keeps them reusable across sports
 * and what keeps domain logic out of this package.
 */
export type Condition =
  | AngleCondition
  | LandmarkXCondition
  | LandmarkYCondition
  | VelocityXCondition
  | VelocityYCondition
  | VisibilityCondition
  | AllCondition
  | AnyCondition;

export type TriggerEmit = 'enter' | 'exit' | 'cycle' | 'while';

export type Trigger = {
  /** Unique within one camera. Comes back on every `TriggerEvent`. */
  id: string;
  enter: Condition;
  /** Required for `emit: 'cycle'` and `emit: 'exit'`. */
  exit?: Condition;
  emit: TriggerEmit;
  /** Suppress re-entry for this long after a fire. Default 0. */
  debounceMs?: number;
  /** The condition must hold this long before the state change counts. Default 0. */
  minDurationMs?: number;
  /** Attach the `PoseFrame` from the moment the trigger fired. */
  snapshot?: boolean;
  /** `emit: 'while'` only. Default 250. */
  throttleMs?: number;
};

export type TriggerEvent = {
  readonly id: string;
  readonly phase: 'enter' | 'exit' | 'cycle';
  /** Completed cycles since mount. Survives a camera switch, resets on unmount. */
  readonly count: number;
  /** Same monotonic clock as `PoseFrame.timestamp`. */
  readonly timestamp: number;
  /** Enter to exit, on `'cycle'` only. */
  readonly durationMs?: number;
  readonly snapshot?: PoseFrame;
};
