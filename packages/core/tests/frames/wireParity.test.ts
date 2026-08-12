import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  FRAME_META_FLOAT64S,
  HEADER_FLOAT64S,
  HEADER_INDEX,
  SCALARS_PER_FRAME,
  WIRE_FLAG_ANGLES,
  WIRE_FLAG_WORLD_LANDMARKS,
} from '../../src/frames/wire';
import { ANGLE_JOINTS, ANGLE_JOINT_NAMES, LANDMARK_COUNT } from '../../src/types/joints';
import { LANDMARK_STRIDE } from '../../src/types/frame';

/**
 * The wire format is written twice, in TypeScript and in Kotlin, and nothing at runtime compares
 * them: a buffer encoded against a stale constant decodes into plausible wrong numbers rather than
 * failing. These read the Kotlin and assert it still agrees.
 *
 * Compiled under `.test-build/`, and the Kotlin is found by name rather than by path: this guard
 * should survive the sources being reorganized and fail only when they stop agreeing.
 */
const ANDROID = resolve(__dirname, '../../..', 'packages/core/android/src/main/java');

function find(fileName: string, from: string = ANDROID): string | null {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const path = resolve(from, entry.name);
    if (entry.isDirectory()) {
      const found = find(fileName, path);
      if (found) return found;
    } else if (entry.name === fileName) {
      return path;
    }
  }
  return null;
}

function read(fileName: string): string {
  const path = find(fileName);
  assert.ok(
    path !== null,
    `${fileName} is not under ${ANDROID}. If it was renamed, update this test.`,
  );
  return readFileSync(path, 'utf8');
}

function constant(source: string, name: string): number {
  const found = new RegExp(`const val ${name} = ([^\\n]+)`).exec(source)?.[1];
  assert.ok(found !== undefined, `${name} is not declared in the Kotlin`);

  const shifted = /^(\d+) shl (\d+)$/.exec(found.trim());
  if (shifted) return Number(shifted[1]) << Number(shifted[2]);

  const value = Number(found.trim().replace(/_/g, ''));
  assert.ok(!Number.isNaN(value), `${name} is ${found.trim()}, which is not a number`);
  return value;
}

test('the Kotlin header layout matches wire.ts', () => {
  const source = read('FrameWire.kt');

  assert.equal(constant(source, 'HEADER_FLOAT64S'), HEADER_FLOAT64S);
  assert.equal(constant(source, 'FRAME_META_FLOAT64S'), FRAME_META_FLOAT64S);
  assert.equal(constant(source, 'SCALARS_PER_FRAME'), SCALARS_PER_FRAME);
  assert.equal(constant(source, 'FLAG_WORLD_LANDMARKS'), WIRE_FLAG_WORLD_LANDMARKS);
  assert.equal(constant(source, 'FLAG_ANGLES'), WIRE_FLAG_ANGLES);
});

test('every header slot sits at the same index on both sides', () => {
  const source = read('FrameWire.kt');

  assert.equal(constant(source, 'INDEX_FRAME_COUNT'), HEADER_INDEX.frameCount);
  assert.equal(constant(source, 'INDEX_DROPPED_COUNT'), HEADER_INDEX.droppedCount);
  assert.equal(constant(source, 'INDEX_FLOATS_PER_FRAME'), HEADER_INDEX.floatsPerFrame);
  assert.equal(constant(source, 'INDEX_JOINT_COUNT'), HEADER_INDEX.jointCount);
  assert.equal(constant(source, 'INDEX_ANGLE_COUNT'), HEADER_INDEX.angleCount);
  assert.equal(constant(source, 'INDEX_FLAGS'), HEADER_INDEX.flags);

  // A slot count that no longer covers every named slot would silently truncate the header.
  assert.equal(Object.keys(HEADER_INDEX).length, HEADER_FLOAT64S);
});

test('the Kotlin skeleton is the same size and stride', () => {
  const source = read('Skeleton.kt');

  assert.equal(constant(source, 'LANDMARK_COUNT'), LANDMARK_COUNT);
  assert.equal(constant(source, 'LANDMARK_STRIDE'), LANDMARK_STRIDE);
});

test('angles are declared in the same order on both sides', () => {
  const source = read('Skeleton.kt');
  const table = /ANGLE_TRIPLES: Map<String, IntArray> =\s*mapOf\(([\s\S]*?)\n {8}\)/.exec(
    source,
  )?.[1];
  assert.ok(table !== undefined, 'could not find ANGLE_TRIPLES in the Kotlin');

  const joints = [...table.matchAll(/"(\w+)" to intArrayOf/g)].map((match) => match[1]);

  // Order is the contract: the angle block carries no names, only floats in this sequence.
  assert.deepEqual(joints, [...ANGLE_JOINT_NAMES]);
});

test('each angle is measured between the same three joints on both sides', () => {
  const source = read('Skeleton.kt');

  // Kotlin names landmarks in SCREAMING_SNAKE_CASE; TypeScript in camelCase.
  const toKotlin = (joint: string): string =>
    joint.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();

  for (const [joint, triple] of Object.entries(ANGLE_JOINTS)) {
    const found = new RegExp(`"${joint}" to intArrayOf\\(([^)]+)\\)`).exec(source)?.[1];
    assert.ok(found !== undefined, `${joint} has no triple in the Kotlin`);

    const kotlinTriple = found.split(',').map((name) => name.trim());
    assert.deepEqual(kotlinTriple, triple.map(toKotlin), `${joint} is measured differently`);

    // And each of those names is a real landmark index, not a typo that happens to compile.
    for (const name of kotlinTriple) {
      assert.match(source, new RegExp(`const val ${name} = \\d+`), `${name} is not a landmark`);
    }
  }
});
