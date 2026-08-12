import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANGLE_JOINT_NAMES } from '../src/types/joints';
import {
  FRAME_META_FLOAT64S,
  HEADER_FLOAT64S,
  HEADER_INDEX,
  expectedByteLength,
} from '../src/wire';
import { resolveAngleJoints } from '../src/wire';

test('the header has a slot for every field the decoder reads', () => {
  const slots = Object.values(HEADER_INDEX);

  assert.strictEqual(slots.length, HEADER_FLOAT64S);
  assert.strictEqual(new Set(slots).size, HEADER_FLOAT64S);
  assert.strictEqual(Math.max(...slots), HEADER_FLOAT64S - 1);
});

test('the expected length accounts for the header, the per-frame meta, and the body', () => {
  assert.strictEqual(expectedByteLength(0, 0), HEADER_FLOAT64S * 8);
  assert.strictEqual(
    expectedByteLength(2, 10),
    (HEADER_FLOAT64S + 2 * FRAME_META_FLOAT64S) * 8 + 2 * 10 * 4,
  );
});

test('angles come back in table order, never in the order they were mentioned', () => {
  // Both sides resolve the set independently, so the order has to come from the table rather
  // than from whichever prop happened to name a joint first.
  assert.deepStrictEqual(resolveAngleJoints(new Set(['rightKnee', 'leftElbow', 'leftKnee'])), [
    'leftElbow',
    'leftKnee',
    'rightKnee',
  ]);
});

test('a joint that has no angle is not resolved into the set', () => {
  assert.deepStrictEqual(resolveAngleJoints(new Set(['nose', 'leftEar', 'leftKnee'])), [
    'leftKnee',
  ]);
});

test('an empty reference set resolves to no angles', () => {
  assert.deepStrictEqual(resolveAngleJoints(new Set()), []);
});

test('referencing everything resolves to the full table, in order', () => {
  assert.deepStrictEqual(resolveAngleJoints(new Set(ANGLE_JOINT_NAMES)), [...ANGLE_JOINT_NAMES]);
});
