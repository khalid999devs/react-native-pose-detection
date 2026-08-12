import type { AngleJointName, JointName } from '../types/joints';
import { LANDMARK_STRIDE } from '../types/frame';
import { LANDMARK_COUNT } from '../types/joints';
import type { PoseFrame } from '../types/frame';
import {
  FRAME_META_FLOAT64S,
  HEADER_FLOAT64S,
  HEADER_INDEX,
  SCALARS_PER_FRAME,
  WIRE_FLAG_ANGLES,
  WIRE_FLAG_WORLD_LANDMARKS,
  expectedByteLength,
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
  /** Set when the buffer could not be trusted. No frames are returned. */
  error?: string;
};

const EMPTY: DecodedBatch = { frames: [], droppedCount: 0 };

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Turns one drained buffer into frames. Landmarks are `subarray` views, so nothing is copied or
 * parsed.
 *
 * A malformed buffer returns an `error` rather than throwing: this runs inside the tick handler,
 * where a throw would stall the drain loop permanently.
 */
export function decodeFrames(buffer: ArrayBuffer, options: DecodeOptions): DecodedBatch {
  if (buffer.byteLength < HEADER_FLOAT64S * Float64Array.BYTES_PER_ELEMENT) {
    // The empty drain is the common case, not an error: native returns a bare header when the
    // ring buffer had nothing in it.
    return EMPTY;
  }

  const header = new Float64Array(buffer, 0, HEADER_FLOAT64S);
  const frameCount = header[HEADER_INDEX.frameCount] ?? 0;
  const droppedCount = header[HEADER_INDEX.droppedCount] ?? 0;
  const floatsPerFrame = header[HEADER_INDEX.floatsPerFrame] ?? 0;
  const jointCount = header[HEADER_INDEX.jointCount] ?? 0;
  const angleCount = header[HEADER_INDEX.angleCount] ?? 0;
  const flags = header[HEADER_INDEX.flags] ?? 0;

  if (!isCount(frameCount) || !isCount(floatsPerFrame) || !isCount(jointCount)) {
    return { frames: [], droppedCount: 0, error: 'frame buffer header is not a set of counts' };
  }
  if (!isCount(angleCount) || !isCount(droppedCount)) {
    return { frames: [], droppedCount: 0, error: 'frame buffer header is not a set of counts' };
  }
  if (frameCount === 0 || floatsPerFrame === 0) return { frames: [], droppedCount };

  const hasWorld = (flags & WIRE_FLAG_WORLD_LANDMARKS) !== 0;
  const hasAngles = (flags & WIRE_FLAG_ANGLES) !== 0;
  const landmarkFloats = jointCount * LANDMARK_STRIDE;
  const blocks =
    landmarkFloats * (hasWorld ? 2 : 1) + (hasAngles ? angleCount : 0) + SCALARS_PER_FRAME;

  if (blocks !== floatsPerFrame) {
    return {
      frames: [],
      droppedCount,
      error: `frame stride is ${floatsPerFrame} floats but its blocks add up to ${blocks}`,
    };
  }
  if (buffer.byteLength !== expectedByteLength(frameCount, floatsPerFrame)) {
    return {
      frames: [],
      droppedCount,
      error: `frame buffer is ${buffer.byteLength} bytes, expected ${expectedByteLength(
        frameCount,
        floatsPerFrame,
      )}`,
    };
  }

  // A prop can change while frames sit in the ring buffer. Dropping one drain is self-healing,
  // attaching the wrong joint or angle names is not.
  const { selection } = options;
  const expectedJoints = selection ? selection.length : LANDMARK_COUNT;
  if (jointCount !== 0 && jointCount !== expectedJoints) {
    return {
      frames: [],
      droppedCount,
      error: `frame buffer holds ${jointCount} joints, expected ${expectedJoints}`,
    };
  }
  if (hasAngles && angleCount !== options.angleJoints.length) {
    return {
      frames: [],
      droppedCount,
      error: `frame buffer holds ${angleCount} angles, expected ${options.angleJoints.length}`,
    };
  }

  const meta = new Float64Array(
    buffer,
    HEADER_FLOAT64S * Float64Array.BYTES_PER_ELEMENT,
    frameCount * FRAME_META_FLOAT64S,
  );
  const bodyOffset =
    (HEADER_FLOAT64S + frameCount * FRAME_META_FLOAT64S) * Float64Array.BYTES_PER_ELEMENT;
  const body = new Float32Array(buffer, bodyOffset, frameCount * floatsPerFrame);

  const nameAngles = hasAngles && angleCount > 0;
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
    if (nameAngles) {
      angles = {};
      for (let angleIndex = 0; angleIndex < angleCount; angleIndex += 1) {
        const joint = options.angleJoints[angleIndex];
        if (joint !== undefined) angles[joint] = body[cursor + angleIndex] ?? 0;
      }
    }
    if (hasAngles) cursor += angleCount;

    const metaBase = index * FRAME_META_FLOAT64S;

    frames.push({
      landmarks,
      ...(selection ? { selection } : {}),
      ...(worldLandmarks ? { worldLandmarks } : {}),
      ...(angles ? { angles } : {}),
      centerOfMass: { x: body[cursor] ?? 0, y: body[cursor + 1] ?? 0 },
      velocity: { x: body[cursor + 2] ?? 0, y: body[cursor + 3] ?? 0 },
      bodySpan: body[cursor + 4] ?? 0,
      timestamp: meta[metaBase] ?? 0,
      processingMs: meta[metaBase + 1] ?? 0,
    });
  }

  return { frames, droppedCount };
}
