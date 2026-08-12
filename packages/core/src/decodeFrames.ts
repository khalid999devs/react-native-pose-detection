import type { AngleJointName, JointName } from './types/joints';
import { LANDMARK_STRIDE } from './types/frame';
import type { PoseFrame } from './types/frame';
import {
  FRAME_META_FLOAT64S,
  HEADER_FLOAT64S,
  HEADER_INDEX,
  SCALARS_PER_FRAME,
  WIRE_FLAG_ANGLES,
  WIRE_FLAG_WORLD_LANDMARKS,
} from './wire';

export type DecodeOptions = {
  /** Present when `data.select` narrowed the buffer. The same frozen array on every frame. */
  selection?: readonly JointName[];
  /** The resolved lazy angle set, in `ANGLE_JOINT_NAMES` order. */
  angleJoints: readonly AngleJointName[];
};

export type DecodedBatch = {
  frames: PoseFrame[];
  /** Frames the native ring buffer dropped because this consumer could not keep up. */
  droppedCount: number;
};

/**
 * Turns one drained buffer into frames.
 *
 * `subarray` is a view, not a copy, so a frame's landmarks point straight into the buffer native
 * filled. Nothing is parsed. The only allocation per frame is the small wrapper objects, and the
 * accessors exist so a hot consumer can avoid even those.
 */
export function decodeFrames(buffer: ArrayBuffer, options: DecodeOptions): DecodedBatch {
  if (buffer.byteLength < HEADER_FLOAT64S * Float64Array.BYTES_PER_ELEMENT) {
    return { frames: [], droppedCount: 0 };
  }

  const header = new Float64Array(buffer, 0, HEADER_FLOAT64S);
  const frameCount = header[HEADER_INDEX.frameCount] ?? 0;
  const droppedCount = header[HEADER_INDEX.droppedCount] ?? 0;
  const floatsPerFrame = header[HEADER_INDEX.floatsPerFrame] ?? 0;
  const jointCount = header[HEADER_INDEX.jointCount] ?? 0;
  const flags = header[HEADER_INDEX.flags] ?? 0;

  if (frameCount <= 0 || floatsPerFrame <= 0) return { frames: [], droppedCount };

  const meta = new Float64Array(
    buffer,
    HEADER_FLOAT64S * Float64Array.BYTES_PER_ELEMENT,
    frameCount * FRAME_META_FLOAT64S,
  );

  const bodyOffset =
    (HEADER_FLOAT64S + frameCount * FRAME_META_FLOAT64S) * Float64Array.BYTES_PER_ELEMENT;
  const body = new Float32Array(buffer, bodyOffset, frameCount * floatsPerFrame);

  const hasWorld = (flags & WIRE_FLAG_WORLD_LANDMARKS) !== 0;
  const hasAngles = (flags & WIRE_FLAG_ANGLES) !== 0;
  const landmarkFloats = jointCount * LANDMARK_STRIDE;

  const frames: PoseFrame[] = [];

  for (let index = 0; index < frameCount; index += 1) {
    let cursor = index * floatsPerFrame;

    const landmarks = body.subarray(cursor, cursor + landmarkFloats);
    cursor += landmarkFloats;

    let worldLandmarks: Float32Array | undefined;
    if (hasWorld) {
      worldLandmarks = body.subarray(cursor, cursor + landmarkFloats);
      cursor += landmarkFloats;
    }

    let angles: Partial<Record<AngleJointName, number>> | undefined;
    if (hasAngles && options.angleJoints.length > 0) {
      angles = {};
      for (let angleIndex = 0; angleIndex < options.angleJoints.length; angleIndex += 1) {
        const joint = options.angleJoints[angleIndex];
        if (joint === undefined) continue;
        angles[joint] = body[cursor + angleIndex] ?? 0;
      }
      cursor += options.angleJoints.length;
    }

    const metaBase = index * FRAME_META_FLOAT64S;

    frames.push({
      landmarks,
      ...(options.selection ? { selection: options.selection } : {}),
      ...(worldLandmarks ? { worldLandmarks } : {}),
      ...(angles ? { angles } : {}),
      centerOfMass: { x: body[cursor] ?? 0, y: body[cursor + 1] ?? 0 },
      velocity: { x: body[cursor + 2] ?? 0, y: body[cursor + 3] ?? 0 },
      bodySpan: body[cursor + 4] ?? 0,
      timestamp: meta[metaBase] ?? 0,
      processingMs: meta[metaBase + 1] ?? 0,
    });

    cursor += SCALARS_PER_FRAME;
  }

  return { frames, droppedCount };
}
