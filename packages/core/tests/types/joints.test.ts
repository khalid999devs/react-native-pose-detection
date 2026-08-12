import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANGLE_JOINTS,
  ANGLE_JOINT_NAMES,
  CONNECTION_COUNT,
  JOINT_INDEX,
  JOINT_NAMES,
  LANDMARK_COUNT,
  POSE_CONNECTIONS,
  POSE_CONNECTION_INDICES,
  isAngleJointName,
  isJointName,
} from '../../src/types/joints';

test('the landmark table is the 33 BlazePose emits', () => {
  assert.strictEqual(LANDMARK_COUNT, 33);
  assert.strictEqual(JOINT_NAMES.length, 33);
  assert.strictEqual(new Set(JOINT_NAMES).size, 33);
});

test('every joint index matches its position in the table', () => {
  JOINT_NAMES.forEach((name, index) => {
    assert.strictEqual(JOINT_INDEX[name], index);
  });
});

test('the skeleton has 35 connections and every endpoint is a real joint', () => {
  assert.strictEqual(CONNECTION_COUNT, 35);
  assert.strictEqual(POSE_CONNECTIONS.length, 35);

  for (const [from, to] of POSE_CONNECTIONS) {
    assert.strictEqual(isJointName(from), true);
    assert.strictEqual(isJointName(to), true);
    assert.notStrictEqual(from, to);
  }
});

test('the index pairs agree with the named pairs, in the same order', () => {
  assert.strictEqual(POSE_CONNECTION_INDICES.length, CONNECTION_COUNT);

  POSE_CONNECTIONS.forEach(([from, to], index) => {
    assert.deepStrictEqual(POSE_CONNECTION_INDICES[index], [JOINT_INDEX[from], JOINT_INDEX[to]]);
  });
});

test('no connection is listed twice in either direction', () => {
  const seen = new Set<string>();
  for (const [from, to] of POSE_CONNECTIONS) {
    const key = [from, to].sort().join('-');
    assert.strictEqual(seen.has(key), false);
    seen.add(key);
  }
});

test('12 joints have an angle and each triple is three distinct real joints', () => {
  assert.strictEqual(ANGLE_JOINT_NAMES.length, 12);

  for (const joint of ANGLE_JOINT_NAMES) {
    const [proximal, vertex, distal] = ANGLE_JOINTS[joint];

    assert.strictEqual(vertex, joint);
    assert.strictEqual(isJointName(proximal), true);
    assert.strictEqual(isJointName(distal), true);
    assert.strictEqual(new Set([proximal, vertex, distal]).size, 3);
  }
});

test('each angle triple is two connected limb segments', () => {
  const connected = new Set(POSE_CONNECTIONS.map(([a, b]) => [a, b].sort().join('-')));

  for (const joint of ANGLE_JOINT_NAMES) {
    const [proximal, vertex, distal] = ANGLE_JOINTS[joint];

    assert.strictEqual(connected.has([proximal, vertex].sort().join('-')), true);
    assert.strictEqual(connected.has([vertex, distal].sort().join('-')), true);
  }
});

test('the guards reject inherited Object keys', () => {
  // `value in JOINT_INDEX` walked the prototype chain, so these passed and reached the evaluator.
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.strictEqual(isJointName(key), false);
    assert.strictEqual(isAngleJointName(key), false);
  }
});

test('the guards reject non-strings without throwing', () => {
  for (const value of [null, undefined, 0, {}, [], true, Symbol('x')]) {
    assert.strictEqual(isJointName(value), false);
    assert.strictEqual(isAngleJointName(value), false);
  }
});

test('a joint with no angle is not an angle joint', () => {
  assert.strictEqual(isJointName('nose'), true);
  assert.strictEqual(isAngleJointName('nose'), false);
  assert.strictEqual(isAngleJointName('leftKnee'), true);
});
