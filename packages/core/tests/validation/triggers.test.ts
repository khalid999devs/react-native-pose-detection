import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PoseConfigError } from '../../src/errors';
import type { Trigger } from '../../src/types/triggers';
import { assertValidTriggers, validateTriggers } from '../../src/validation/triggers';

function issuesFor(trigger: unknown): string[] {
  return validateTriggers([trigger] as unknown as Trigger[]).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
}

const VALID: Trigger = {
  id: 'squat-bottom',
  emit: 'enter',
  enter: { angle: 'leftKnee', below: 90 },
};

test('a well formed trigger produces no issues', () => {
  assert.deepStrictEqual(validateTriggers([VALID]), []);
});

test('every condition kind is reachable', () => {
  const trigger: Trigger = {
    id: 'everything',
    emit: 'cycle',
    enter: {
      all: [
        { angle: 'leftKnee', between: [80, 100] },
        { landmarkY: 'leftWrist', above: 0.2 },
        { landmarkX: 'leftWrist', below: 'leftShoulder' },
        { velocityY: 'centerOfMass', above: 0.1 },
        { velocityX: 'leftAnkle', below: 2 },
        { any: [{ visibility: 'leftHip', above: 0.6 }] },
      ],
    },
    exit: { angle: 'leftKnee', above: 160 },
  };

  assert.deepStrictEqual(validateTriggers([trigger]), []);
});

test('a joint with no angle is rejected with a message that says why', () => {
  assert.ok(
    issuesFor({ id: 'a', emit: 'enter', enter: { angle: 'nose', below: 90 } }).includes(
      'triggers[0].enter.angle: "nose" has no angle, only joints where two limb segments meet do',
    ),
  );
});

test('a prototype key is not a joint name', () => {
  // `key in object` walks the prototype chain, so this used to pass every guard in the file.
  const issues = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { landmarkY: 'toString', above: 0.5 },
  });

  assert.strictEqual(
    issues.some((issue) => issue.includes('unknown joint')),
    true,
  );
});

test('a condition with no bound can never fire and is rejected', () => {
  assert.ok(
    issuesFor({ id: 'a', emit: 'enter', enter: { angle: 'leftKnee' } }).includes(
      'triggers[0].enter: needs at least one of below, above, between',
    ),
  );
});

test('bounds that exclude each other are rejected on every condition kind', () => {
  const angle = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { angle: 'leftKnee', above: 120, below: 90 },
  });
  const velocity = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { velocityY: 'centerOfMass', above: 5, below: 1 },
  });

  assert.strictEqual(
    angle.some((issue) => issue.includes('can never fire')),
    true,
  );
  assert.strictEqual(
    velocity.some((issue) => issue.includes('can never fire')),
    true,
  );
});

test('between is only accepted where it can be evaluated', () => {
  const issues = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { landmarkY: 'leftWrist', between: [0, 1] },
  });

  assert.ok(
    issues.includes(
      'triggers[0].enter.between: is only valid on an angle condition, use below and above here',
    ),
  );
});

test('an angle outside 0 to 180 is rejected, including inside between', () => {
  const bound = issuesFor({ id: 'a', emit: 'enter', enter: { angle: 'leftKnee', below: 400 } });
  const range = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { angle: 'leftKnee', between: [10, 400] },
  });

  assert.ok(bound.includes('triggers[0].enter.below: angles are 0 to 180 degrees'));
  assert.ok(range.includes('triggers[0].enter.between[1]: angles are 0 to 180 degrees'));
});

test('a misspelled key is reported rather than silently ignored', () => {
  const issues = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { angle: 'leftKnee', below: 90, minVisibility: 0.5 },
  });

  assert.strictEqual(
    issues.some((issue) => issue.includes('unknown key')),
    true,
  );
});

test('an explicitly undefined bound counts as absent, not as present', () => {
  // This is what spreading an optional field produces, and it used to be read as a bound.
  const issues = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { angle: 'leftKnee', below: 90, above: undefined },
  });

  assert.deepStrictEqual(issues, []);
});

test('a cyclic condition is reported, not thrown', () => {
  const cyclic: Record<string, unknown> = { all: [] };
  (cyclic['all'] as unknown[]).push(cyclic);

  const issues = issuesFor({ id: 'a', emit: 'enter', enter: cyclic });

  assert.strictEqual(
    issues.some((issue) => issue.includes('nested deeper than')),
    true,
  );
});

test('a BigInt in a bound is described rather than crashing the validator', () => {
  const issues = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { landmarkY: 'leftWrist', above: 1n },
  });

  assert.ok(issues.length > 0);
});

test('an empty group can never be evaluated', () => {
  assert.ok(
    issuesFor({ id: 'a', emit: 'enter', enter: { all: [] } }).includes(
      'triggers[0].enter.all: is empty, so it can never be evaluated',
    ),
  );
});

test('a condition with two discriminants is rejected', () => {
  const issues = issuesFor({
    id: 'a',
    emit: 'enter',
    enter: { angle: 'leftKnee', below: 90, visibility: 'leftHip' },
  });

  assert.strictEqual(
    issues.some((issue) => issue.includes('takes exactly one')),
    true,
  );
});

test('emit cycle and emit exit both require an exit condition', () => {
  assert.ok(
    issuesFor({ id: 'a', emit: 'cycle', enter: { angle: 'leftKnee', below: 90 } }).includes(
      "triggers[0].exit: is required when emit is 'cycle'",
    ),
  );
  assert.ok(
    issuesFor({ id: 'a', emit: 'exit', enter: { angle: 'leftKnee', below: 90 } }).includes(
      "triggers[0].exit: is required when emit is 'exit'",
    ),
  );
});

test('duplicate ids are rejected because an event could not be attributed', () => {
  const issues = validateTriggers([VALID, { ...VALID }]).map((issue) => issue.message);

  assert.ok(issues.includes("duplicate id 'squat-bottom'"));
});

test('a negative duration is rejected', () => {
  assert.ok(
    issuesFor({ ...VALID, debounceMs: -1 }).includes(
      'triggers[0].debounceMs: must be a non-negative number of milliseconds',
    ),
  );
});

test('assertValidTriggers throws one error carrying every issue', () => {
  try {
    assertValidTriggers([{ id: '', emit: 'nope', enter: { angle: 'nose' } } as unknown as Trigger]);
    assert.fail('should have thrown');
  } catch (cause) {
    assert.ok(cause instanceof PoseConfigError);
    assert.ok((cause as PoseConfigError).issues.length > 2);
  }
});

test('a valid trigger list passes assertValidTriggers', () => {
  assert.doesNotThrow(() => assertValidTriggers([VALID]));
});
