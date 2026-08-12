import { PoseConfigError } from '../errors';
import type { Landmark, MutableLandmark, PoseFrame } from '../types/frame';
import { LANDMARK_OFFSET, LANDMARK_STRIDE } from '../types/frame';
import type { JointName } from '../types/joints';
import { JOINT_INDEX } from '../types/joints';

// `PoseFrame.selection` is the same frozen array on every frame of a session, so the position
// lookup is built once per selection rather than scanned per access.
const selectionIndexCache = new WeakMap<readonly JointName[], Partial<Record<JointName, number>>>();

function positionOf(frame: PoseFrame, joint: JointName): number {
  const { selection } = frame;
  if (!selection) return JOINT_INDEX[joint];

  let index = selectionIndexCache.get(selection);
  if (!index) {
    const built: Partial<Record<JointName, number>> = {};
    selection.forEach((name, position) => {
      built[name] = position;
    });
    selectionIndexCache.set(selection, built);
    index = built;
  }
  return index[joint] ?? -1;
}

function floatOffset(frame: PoseFrame, buffer: Float32Array, joint: JointName): number {
  if (buffer.length === 0) {
    throw new PoseConfigError([
      { path: `landmark('${joint}')`, message: 'the frame carries no landmarks for this buffer' },
    ]);
  }

  const position = positionOf(frame, joint);
  if (position < 0) {
    throw new PoseConfigError([
      { path: `landmark('${joint}')`, message: `'${joint}' is not in data.select` },
    ]);
  }
  return position * LANDMARK_STRIDE;
}

function read(buffer: Float32Array, offset: number): number {
  return buffer[offset] ?? 0;
}

/** True when the joint is present in this frame's buffer, which `data.select` decides. */
export function hasLandmark(frame: PoseFrame, joint: JointName): boolean {
  return frame.landmarks.length > 0 && positionOf(frame, joint) >= 0;
}

/**
 * Reads four floats out of the frame buffer. Nothing is parsed and the buffer is never copied,
 * but the returned object is an allocation. Use `landmarkInto()` on the per-frame path.
 */
export function landmark(frame: PoseFrame, joint: JointName): Landmark {
  const base = floatOffset(frame, frame.landmarks, joint);
  const { landmarks } = frame;
  return {
    x: read(landmarks, base + LANDMARK_OFFSET.x),
    y: read(landmarks, base + LANDMARK_OFFSET.y),
    z: read(landmarks, base + LANDMARK_OFFSET.z),
    visibility: read(landmarks, base + LANDMARK_OFFSET.visibility),
  };
}

/** Allocation-free variant: fills and returns `out`. Pair it with `createLandmark()`. */
export function landmarkInto(
  frame: PoseFrame,
  joint: JointName,
  out: MutableLandmark,
): MutableLandmark {
  const base = floatOffset(frame, frame.landmarks, joint);
  const { landmarks } = frame;
  out.x = read(landmarks, base + LANDMARK_OFFSET.x);
  out.y = read(landmarks, base + LANDMARK_OFFSET.y);
  out.z = read(landmarks, base + LANDMARK_OFFSET.z);
  out.visibility = read(landmarks, base + LANDMARK_OFFSET.visibility);
  return out;
}

/** A reusable target for `landmarkInto()`. */
export function createLandmark(): MutableLandmark {
  return { x: 0, y: 0, z: 0, visibility: 0 };
}

/** Metric 3D in meters, hip-centered. `null` unless `data.worldLandmarks` was enabled. */
export function worldLandmark(frame: PoseFrame, joint: JointName): Landmark | null {
  const world = frame.worldLandmarks;
  if (!world || world.length === 0) return null;

  const base = floatOffset(frame, world, joint);
  return {
    x: read(world, base + LANDMARK_OFFSET.x),
    y: read(world, base + LANDMARK_OFFSET.y),
    z: read(world, base + LANDMARK_OFFSET.z),
    visibility: read(world, base + LANDMARK_OFFSET.visibility),
  };
}

/** One float, no allocation. `0` when the joint is absent, rather than throwing. */
export function visibilityOf(frame: PoseFrame, joint: JointName): number {
  if (frame.landmarks.length === 0) return 0;
  const position = positionOf(frame, joint);
  if (position < 0) return 0;
  return read(frame.landmarks, position * LANDMARK_STRIDE + LANDMARK_OFFSET.visibility);
}

/** Gate on this before trusting a coordinate from a joint that can leave frame. */
export function isVisible(frame: PoseFrame, joint: JointName, minVisibility = 0.5): boolean {
  return visibilityOf(frame, joint) >= minVisibility;
}
