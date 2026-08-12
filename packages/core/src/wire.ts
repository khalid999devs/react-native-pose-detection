import type { AngleJointName, JointName } from './types/joints';
import { ANGLE_JOINT_NAMES, ANGLE_JOINTS } from './types/joints';

/**
 * The layout of the buffer `drainFrames()` returns.
 *
 * Events cannot carry an ArrayBuffer through Expo Modules, function returns can. So native fills
 * a buffer, emits a tick, and JavaScript drains it. See
 * docs/adr/0008-frames-are-drained-not-pushed.md.
 *
 * The buffer describes itself. Nothing about it is agreed out of band, so a drain that races
 * ahead of its tick, or arrives after two ticks, still decodes correctly.
 *
 * ```text
 * Float64  [0..HEADER_FLOAT64S)                header
 * Float64  [HEADER..HEADER + 2 * frameCount)   timestamp, processingMs per frame
 * Float32  the rest                            frameCount * floatsPerFrame
 * ```
 *
 * Timestamps are Float64 because a Float32 mantissa runs out after about 4.6 hours of device
 * uptime, and the clock is monotonic since boot.
 */
export const HEADER_FLOAT64S = 5;

export const HEADER_INDEX = {
  frameCount: 0,
  droppedCount: 1,
  floatsPerFrame: 2,
  jointCount: 3,
  flags: 4,
} as const;

export const FRAME_META_FLOAT64S = 2;

export const WIRE_FLAG_WORLD_LANDMARKS = 1 << 0;
export const WIRE_FLAG_ANGLES = 1 << 1;

/** Scalars carried per frame after the landmark block: com.x, com.y, velocity.x, velocity.y, bodySpan. */
export const SCALARS_PER_FRAME = 5;

/**
 * Which angles a frame carries, derived from the props rather than transmitted.
 *
 * Both native evaluators and this function apply the same rule to the same inputs, so the order
 * agrees without anything crossing the bridge to say so. The order is `ANGLE_JOINT_NAMES`, never
 * the order the joints happened to be mentioned in.
 */
export function resolveAngleJoints(referenced: Iterable<string>): AngleJointName[] {
  const wanted = new Set(referenced);
  return ANGLE_JOINT_NAMES.filter((joint) => wanted.has(joint));
}

/** Every joint a condition, a selection, or an overlay arc mentions. */
export function collectReferencedJoints(
  sources: readonly (readonly string[] | undefined)[],
): Set<string> {
  const referenced = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const name of source) referenced.add(name);
  }
  return referenced;
}

/** An angle needs its three landmarks, so referencing one implies selecting them. */
export function jointsRequiredForAngles(angles: readonly AngleJointName[]): JointName[] {
  const required = new Set<JointName>();
  for (const angle of angles) {
    for (const joint of ANGLE_JOINTS[angle]) required.add(joint);
  }
  return [...required];
}
