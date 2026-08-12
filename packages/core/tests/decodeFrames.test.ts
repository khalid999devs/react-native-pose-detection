import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeFrames } from '../src/decodeFrames';
import { LANDMARK_COUNT } from '../src/types/joints';
import type { AngleJointName, JointName } from '../src/types/joints';
import {
  FRAME_META_FLOAT64S,
  HEADER_FLOAT64S,
  HEADER_INDEX,
  SCALARS_PER_FRAME,
  WIRE_FLAG_ANGLES,
  WIRE_FLAG_WORLD_LANDMARKS,
} from '../src/wire';

type EncodedFrame = {
  landmarks: number[];
  worldLandmarks?: number[];
  angles?: number[];
  centerOfMass: [number, number];
  velocity: [number, number];
  bodySpan: number;
  timestamp: number;
  processingMs: number;
};

/**
 * The encoder native will implement, written against the same header the decoder reads. Keeping
 * it here means a change to one side that the other does not follow fails a test rather than
 * showing up as plausible but wrong numbers on a device.
 */
function encode(
  frames: EncodedFrame[],
  options: { jointCount: number; angleCount: number; droppedCount?: number; world?: boolean },
): ArrayBuffer {
  const { jointCount, angleCount, world = false } = options;
  const floatsPerFrame = jointCount * 4 * (world ? 2 : 1) + angleCount + SCALARS_PER_FRAME;

  const bytes =
    (HEADER_FLOAT64S + frames.length * FRAME_META_FLOAT64S) * 8 +
    frames.length * floatsPerFrame * 4;
  const buffer = new ArrayBuffer(bytes);

  const header = new Float64Array(buffer, 0, HEADER_FLOAT64S);
  header[HEADER_INDEX.frameCount] = frames.length;
  header[HEADER_INDEX.droppedCount] = options.droppedCount ?? 0;
  header[HEADER_INDEX.floatsPerFrame] = floatsPerFrame;
  header[HEADER_INDEX.jointCount] = jointCount;
  header[HEADER_INDEX.angleCount] = angleCount;
  header[HEADER_INDEX.flags] =
    (world ? WIRE_FLAG_WORLD_LANDMARKS : 0) | (angleCount > 0 ? WIRE_FLAG_ANGLES : 0);

  const meta = new Float64Array(buffer, HEADER_FLOAT64S * 8, frames.length * FRAME_META_FLOAT64S);
  const body = new Float32Array(
    buffer,
    (HEADER_FLOAT64S + frames.length * FRAME_META_FLOAT64S) * 8,
    frames.length * floatsPerFrame,
  );

  frames.forEach((frame, index) => {
    meta[index * FRAME_META_FLOAT64S] = frame.timestamp;
    meta[index * FRAME_META_FLOAT64S + 1] = frame.processingMs;

    const values = [
      ...frame.landmarks,
      ...(world ? frame.worldLandmarks ?? [] : []),
      ...(frame.angles ?? []),
      ...frame.centerOfMass,
      ...frame.velocity,
      frame.bodySpan,
    ];
    body.set(values, index * floatsPerFrame);
  });

  return buffer;
}

function landmarksFor(count: number, seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count * 4; i += 1) out.push((seed + i) / 256);
  return out;
}

function frame(seed: number, count: number, angles: number[] = []): EncodedFrame {
  return {
    landmarks: landmarksFor(count, seed),
    angles,
    centerOfMass: [0.5, 0.25],
    velocity: [0.125, -0.25],
    bodySpan: 0.75,
    timestamp: 1_700_000_000_000 + seed,
    processingMs: 12.5,
  };
}

const NO_ANGLES: readonly AngleJointName[] = [];

test('an empty drain is not an error', () => {
  const buffer = encode([], { jointCount: LANDMARK_COUNT, angleCount: 0 });
  const result = decodeFrames(buffer, { angleJoints: NO_ANGLES });

  assert.strictEqual(result.frames.length, 0);
  assert.strictEqual(result.error, undefined);
});

test('a buffer shorter than the header decodes as empty rather than throwing', () => {
  const result = decodeFrames(new ArrayBuffer(8), { angleJoints: NO_ANGLES });

  assert.strictEqual(result.frames.length, 0);
  assert.strictEqual(result.error, undefined);
});

test('a full frame round-trips field for field', () => {
  const buffer = encode([frame(1, LANDMARK_COUNT)], {
    jointCount: LANDMARK_COUNT,
    angleCount: 0,
  });
  const { frames, droppedCount, error } = decodeFrames(buffer, { angleJoints: NO_ANGLES });

  assert.strictEqual(error, undefined);
  assert.strictEqual(droppedCount, 0);
  assert.strictEqual(frames.length, 1);

  const decoded = frames[0]!;
  assert.strictEqual(decoded.landmarks.length, LANDMARK_COUNT * 4);
  assert.strictEqual(decoded.centerOfMass.x, 0.5);
  assert.strictEqual(decoded.centerOfMass.y, 0.25);
  assert.strictEqual(decoded.velocity.x, 0.125);
  assert.strictEqual(decoded.velocity.y, -0.25);
  assert.strictEqual(decoded.bodySpan, 0.75);
  assert.strictEqual(decoded.timestamp, 1_700_000_000_001);
  assert.strictEqual(decoded.processingMs, 12.5);
  assert.strictEqual(decoded.angles, undefined);
  assert.strictEqual(decoded.worldLandmarks, undefined);
});

test('landmarks are a view into the drained buffer, not a copy', () => {
  const buffer = encode([frame(1, LANDMARK_COUNT)], { jointCount: LANDMARK_COUNT, angleCount: 0 });
  const { frames } = decodeFrames(buffer, { angleJoints: NO_ANGLES });

  assert.strictEqual(frames[0]!.landmarks.buffer, buffer);
});

test('several frames in one drain keep their own scalars', () => {
  const buffer = encode([frame(1, LANDMARK_COUNT), frame(2, LANDMARK_COUNT)], {
    jointCount: LANDMARK_COUNT,
    angleCount: 0,
    droppedCount: 7,
  });
  const { frames, droppedCount } = decodeFrames(buffer, { angleJoints: NO_ANGLES });

  assert.strictEqual(droppedCount, 7);
  assert.strictEqual(frames.length, 2);
  assert.strictEqual(frames[0]!.timestamp, 1_700_000_000_001);
  assert.strictEqual(frames[1]!.timestamp, 1_700_000_000_002);
  assert.notStrictEqual(frames[0]!.landmarks[0], frames[1]!.landmarks[0]);
});

test('angles are named in the configured order and the scalars behind them stay aligned', () => {
  const angleJoints: readonly AngleJointName[] = ['leftKnee', 'rightKnee'];
  const buffer = encode([frame(1, LANDMARK_COUNT, [91.5, 88.25])], {
    jointCount: LANDMARK_COUNT,
    angleCount: 2,
  });
  const { frames, error } = decodeFrames(buffer, { angleJoints });

  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(frames[0]!.angles, { leftKnee: 91.5, rightKnee: 88.25 });
  // The regression this guards: reading the angle block with the wrong length shifts every
  // scalar behind it, and centerOfMass silently becomes an angle in degrees.
  assert.strictEqual(frames[0]!.centerOfMass.x, 0.5);
  assert.strictEqual(frames[0]!.bodySpan, 0.75);
});

test('world landmarks sit between the landmark block and the angles', () => {
  const encoded = frame(1, LANDMARK_COUNT, [45]);
  encoded.worldLandmarks = landmarksFor(LANDMARK_COUNT, 200);

  const buffer = encode([encoded], { jointCount: LANDMARK_COUNT, angleCount: 1, world: true });
  const { frames, error } = decodeFrames(buffer, { angleJoints: ['leftKnee'] });

  assert.strictEqual(error, undefined);
  assert.strictEqual(frames[0]!.worldLandmarks?.length, LANDMARK_COUNT * 4);
  assert.deepStrictEqual(frames[0]!.angles, { leftKnee: 45 });
  assert.strictEqual(frames[0]!.bodySpan, 0.75);
});

test('a narrowed buffer keeps the selection instance it was given', () => {
  const selection: readonly JointName[] = Object.freeze(['leftKnee', 'leftHip', 'leftAnkle']);
  const buffer = encode([frame(1, 3)], { jointCount: 3, angleCount: 0 });
  const { frames } = decodeFrames(buffer, { angleJoints: NO_ANGLES, selection });

  assert.strictEqual(frames[0]!.landmarks.length, 12);
  assert.strictEqual(frames[0]!.selection, selection);
});

test('a truncated body is rejected instead of throwing a RangeError', () => {
  const full = encode([frame(1, LANDMARK_COUNT)], { jointCount: LANDMARK_COUNT, angleCount: 0 });
  const truncated = full.slice(0, full.byteLength - 16);

  const { frames, error } = decodeFrames(truncated, { angleJoints: NO_ANGLES });

  assert.strictEqual(frames.length, 0);
  assert.match(error ?? '', /bytes, expected/);
});

test('a header whose blocks do not add up is rejected', () => {
  const buffer = encode([frame(1, LANDMARK_COUNT)], { jointCount: LANDMARK_COUNT, angleCount: 0 });
  const header = new Float64Array(buffer, 0, HEADER_FLOAT64S);
  header[HEADER_INDEX.jointCount] = LANDMARK_COUNT - 1;

  const { frames, error } = decodeFrames(buffer, { angleJoints: NO_ANGLES });

  assert.strictEqual(frames.length, 0);
  assert.match(error ?? '', /blocks add up/);
});

test('a header carrying a non-integral count is rejected', () => {
  const buffer = encode([frame(1, LANDMARK_COUNT)], { jointCount: LANDMARK_COUNT, angleCount: 0 });
  const header = new Float64Array(buffer, 0, HEADER_FLOAT64S);
  header[HEADER_INDEX.frameCount] = 1.5;

  const { frames, error } = decodeFrames(buffer, { angleJoints: NO_ANGLES });

  assert.strictEqual(frames.length, 0);
  assert.match(error ?? '', /not a set of counts/);
});

test('frames encoded under a different selection are dropped, not relabelled', () => {
  const buffer = encode([frame(1, 3)], { jointCount: 3, angleCount: 0 });
  const selection: readonly JointName[] = Object.freeze(['leftKnee', 'leftHip']);

  const { frames, error } = decodeFrames(buffer, { angleJoints: NO_ANGLES, selection });

  assert.strictEqual(frames.length, 0);
  assert.match(error ?? '', /holds 3 joints, expected 2/);
});

test('frames encoded under a different angle set are dropped, not misread', () => {
  const buffer = encode([frame(1, LANDMARK_COUNT, [10, 20])], {
    jointCount: LANDMARK_COUNT,
    angleCount: 2,
  });

  const { frames, error } = decodeFrames(buffer, { angleJoints: ['leftKnee'] });

  assert.strictEqual(frames.length, 0);
  assert.match(error ?? '', /holds 2 angles, expected 1/);
});

test('dropped frames are reported even when the batch is rejected', () => {
  const buffer = encode([frame(1, 3)], { jointCount: 3, angleCount: 0, droppedCount: 4 });
  const { droppedCount } = decodeFrames(buffer, {
    angleJoints: NO_ANGLES,
    selection: Object.freeze(['leftKnee']),
  });

  assert.strictEqual(droppedCount, 4);
});
