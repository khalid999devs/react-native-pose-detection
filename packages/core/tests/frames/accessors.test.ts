import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createLandmark,
  hasLandmark,
  isVisible,
  landmark,
  landmarkInto,
  visibilityOf,
  worldLandmark,
} from '../../src/frames/accessors';
import { PoseConfigError } from '../../src/errors';
import type { PoseFrame } from '../../src/types/frame';
import { LANDMARK_STRIDE } from '../../src/types/frame';
import type { JointName } from '../../src/types/joints';
import { JOINT_INDEX, LANDMARK_COUNT } from '../../src/types/joints';

// Float32 representable, so a round trip through the buffer is exact and a failure means the
// indexing is wrong rather than that the assertion was.
const X = 0.25;
const Y = 0.75;
const Z = -0.125;
const VIS = 0.5;

function fullFrame(): PoseFrame {
  const landmarks = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  const base = JOINT_INDEX['leftKnee'] * LANDMARK_STRIDE;
  landmarks.set([X, Y, Z, VIS], base);

  return {
    landmarks,
    centerOfMass: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    bodySpan: 1,
    timestamp: 0,
    processingMs: 0,
  };
}

function narrowedFrame(): PoseFrame {
  const selection: readonly JointName[] = Object.freeze(['leftHip', 'leftKnee', 'leftAnkle']);
  const landmarks = new Float32Array(selection.length * LANDMARK_STRIDE);
  landmarks.set([X, Y, Z, VIS], 1 * LANDMARK_STRIDE);

  return {
    landmarks,
    selection,
    centerOfMass: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    bodySpan: 1,
    timestamp: 0,
    processingMs: 0,
  };
}

test('a joint reads back exactly what was written to a full buffer', () => {
  assert.deepStrictEqual(landmark(fullFrame(), 'leftKnee'), { x: X, y: Y, z: Z, visibility: VIS });
});

test('a narrowed buffer is indexed by selection position, not by joint index', () => {
  // leftKnee is index 25 in the full table and position 1 here. Indexing by 25 would read past
  // the end of a three-joint buffer and quietly return zeros.
  assert.deepStrictEqual(landmark(narrowedFrame(), 'leftKnee'), {
    x: X,
    y: Y,
    z: Z,
    visibility: VIS,
  });
});

test('landmarkInto fills the target and allocates nothing new', () => {
  const out = createLandmark();
  const returned = landmarkInto(fullFrame(), 'leftKnee', out);

  assert.strictEqual(returned, out);
  assert.deepStrictEqual(out, { x: X, y: Y, z: Z, visibility: VIS });
});

test('reading a joint the selection left out throws rather than returning zeros', () => {
  assert.throws(() => landmark(narrowedFrame(), 'rightKnee'), PoseConfigError);
});

test('hasLandmark reports what the buffer actually holds', () => {
  const narrowed = narrowedFrame();

  assert.strictEqual(hasLandmark(narrowed, 'leftKnee'), true);
  assert.strictEqual(hasLandmark(narrowed, 'rightKnee'), false);
  assert.strictEqual(hasLandmark(fullFrame(), 'rightKnee'), true);
});

test('visibilityOf returns zero for an absent joint instead of throwing', () => {
  assert.strictEqual(visibilityOf(narrowedFrame(), 'leftKnee'), VIS);
  assert.strictEqual(visibilityOf(narrowedFrame(), 'rightKnee'), 0);
});

test('isVisible compares against the threshold, inclusively', () => {
  const frame = fullFrame();

  assert.strictEqual(isVisible(frame, 'leftKnee', 0.5), true);
  assert.strictEqual(isVisible(frame, 'leftKnee', 0.51), false);
  assert.strictEqual(isVisible(frame, 'rightKnee'), false);
});

test('an empty landmark buffer throws a message about the buffer, not the joint', () => {
  const frame: PoseFrame = { ...fullFrame(), landmarks: new Float32Array(0) };

  assert.throws(() => landmark(frame, 'leftKnee'), /carries no landmarks/);
});

test('worldLandmark is null unless the frame carries world landmarks', () => {
  assert.strictEqual(worldLandmark(fullFrame(), 'leftKnee'), null);
});

test('worldLandmark uses the same selection as the landmark buffer', () => {
  const narrowed = narrowedFrame();
  const worldLandmarks = new Float32Array(3 * LANDMARK_STRIDE);
  worldLandmarks.set([1.5, -2.25, 0.5, VIS], 1 * LANDMARK_STRIDE);

  const frame: PoseFrame = { ...narrowed, worldLandmarks };

  assert.deepStrictEqual(worldLandmark(frame, 'leftKnee'), {
    x: 1.5,
    y: -2.25,
    z: 0.5,
    visibility: VIS,
  });
});

test('the selection lookup is cached on the array instance across frames', () => {
  const first = narrowedFrame();
  const second: PoseFrame = { ...narrowedFrame(), selection: first.selection ?? [] };

  assert.strictEqual(second.selection, first.selection);
  assert.deepStrictEqual(landmark(second, 'leftKnee'), landmark(first, 'leftKnee'));
});
