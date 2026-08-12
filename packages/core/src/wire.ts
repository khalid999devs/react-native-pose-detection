import type { AngleJointName } from './types/joints';
import { ANGLE_JOINT_NAMES } from './types/joints';

/**
 * Layout of the buffer `drainFrames()` returns. See
 * [ADR 0008](../../../docs/adr/0008-frames-are-drained-not-pushed.md).
 *
 * ```text
 * Float64  [0, HEADER_FLOAT64S)          header
 * Float64  2 per frame                   timestamp, processingMs
 * Float32  frameCount * floatsPerFrame   body
 * ```
 *
 * Every block length is derivable from the header alone, so a drain arriving after the props that
 * shaped it changed is decoded correctly or rejected, never misread. Timestamps are Float64: a
 * Float32 mantissa runs out after about 4.6 hours of monotonic uptime.
 */
export const HEADER_FLOAT64S = 6;

export const HEADER_INDEX = {
  frameCount: 0,
  droppedCount: 1,
  floatsPerFrame: 2,
  jointCount: 3,
  angleCount: 4,
  flags: 5,
} as const;

export const FRAME_META_FLOAT64S = 2;

export const WIRE_FLAG_WORLD_LANDMARKS = 1 << 0;
export const WIRE_FLAG_ANGLES = 1 << 1;

/** com.x, com.y, velocity.x, velocity.y, bodySpan. */
export const SCALARS_PER_FRAME = 5;

export function expectedByteLength(frameCount: number, floatsPerFrame: number): number {
  return (
    (HEADER_FLOAT64S + frameCount * FRAME_META_FLOAT64S) * Float64Array.BYTES_PER_ELEMENT +
    frameCount * floatsPerFrame * Float32Array.BYTES_PER_ELEMENT
  );
}

/**
 * Angles a frame carries, in `ANGLE_JOINT_NAMES` order. Both sides apply this rule to the same
 * inputs, so the order agrees without crossing the bridge to say so.
 */
export function resolveAngleJoints(referenced: ReadonlySet<string>): AngleJointName[] {
  return ANGLE_JOINT_NAMES.filter((joint) => referenced.has(joint));
}
