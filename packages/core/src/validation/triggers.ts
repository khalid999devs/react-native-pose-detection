import type { ValidationIssue } from '../errors';
import { PoseConfigError } from '../errors';
import { isAngleJointName, isJointName } from '../types/joints';
import type { Trigger, TriggerEmit } from '../types/triggers';

// Deep enough for any real condition, shallow enough that a cyclic or generated config fails
// here with a path rather than as a stack overflow inside the native evaluator.
const MAX_CONDITION_DEPTH = 8;

const CONDITION_KEYS = [
  'angle',
  'landmarkX',
  'landmarkY',
  'velocityX',
  'velocityY',
  'visibility',
  'all',
  'any',
] as const;

const EMIT_VALUES: readonly TriggerEmit[] = ['enter', 'exit', 'cycle', 'while'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkDuration(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    issues.push({ path, message: 'must be a non-negative number of milliseconds' });
  }
}

function checkNumericBound(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path, message: 'must be a finite number' });
  }
}

function checkJointOrNumericBound(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (typeof value === 'number') {
    checkNumericBound(value, path, issues);
    return;
  }
  if (!isJointName(value)) {
    issues.push({
      path,
      message: `must be a number or a joint name, received ${JSON.stringify(value)}`,
    });
  }
}

function checkHasBound(
  condition: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (
    condition['below'] === undefined &&
    condition['above'] === undefined &&
    condition['between'] === undefined
  ) {
    issues.push({ path, message: 'needs at least one of below, above, or between' });
  }
}

function checkAngleCondition(
  condition: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isAngleJointName(condition['angle'])) {
    const received = JSON.stringify(condition['angle']);
    issues.push({
      path: `${path}.angle`,
      message: isJointName(condition['angle'])
        ? `${received} has no angle, only joints where two limb segments meet do`
        : `unknown joint ${received}`,
    });
  }

  checkHasBound(condition, path, issues);
  checkNumericBound(condition['below'], `${path}.below`, issues);
  checkNumericBound(condition['above'], `${path}.above`, issues);

  const between = condition['between'];
  if (between !== undefined) {
    if (!Array.isArray(between) || between.length !== 2) {
      issues.push({ path: `${path}.between`, message: 'must be a [min, max] pair' });
    } else {
      const [min, max] = between as [unknown, unknown];
      checkNumericBound(min, `${path}.between[0]`, issues);
      checkNumericBound(max, `${path}.between[1]`, issues);
      if (typeof min === 'number' && typeof max === 'number' && min >= max) {
        issues.push({
          path: `${path}.between`,
          message: `min (${min}) must be below max (${max})`,
        });
      }
    }
  }

  const below = condition['below'];
  const above = condition['above'];
  if (typeof below === 'number' && typeof above === 'number' && above >= below) {
    issues.push({
      path,
      message: `no angle is both above ${above} and below ${below}, this can never fire`,
    });
  }

  for (const key of ['below', 'above'] as const) {
    const value = condition[key];
    if (typeof value === 'number' && (value < 0 || value > 180)) {
      issues.push({ path: `${path}.${key}`, message: 'angles are 0 to 180 degrees' });
    }
  }
}

function checkLandmarkCondition(
  condition: Record<string, unknown>,
  key: 'landmarkX' | 'landmarkY',
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isJointName(condition[key])) {
    issues.push({
      path: `${path}.${key}`,
      message: `unknown joint ${JSON.stringify(condition[key])}`,
    });
  }
  checkHasBound(condition, path, issues);
  checkJointOrNumericBound(condition['below'], `${path}.below`, issues);
  checkJointOrNumericBound(condition['above'], `${path}.above`, issues);
}

function checkVelocityCondition(
  condition: Record<string, unknown>,
  key: 'velocityX' | 'velocityY',
  path: string,
  issues: ValidationIssue[],
): void {
  const subject = condition[key];
  if (subject !== 'centerOfMass' && !isJointName(subject)) {
    issues.push({
      path: `${path}.${key}`,
      message: `must be 'centerOfMass' or a joint name, received ${JSON.stringify(subject)}`,
    });
  }
  checkHasBound(condition, path, issues);
  checkNumericBound(condition['below'], `${path}.below`, issues);
  checkNumericBound(condition['above'], `${path}.above`, issues);
}

function checkVisibilityCondition(
  condition: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isJointName(condition['visibility'])) {
    issues.push({
      path: `${path}.visibility`,
      message: `unknown joint ${JSON.stringify(condition['visibility'])}`,
    });
  }

  const above = condition['above'];
  if (above === undefined) {
    issues.push({ path: `${path}.above`, message: 'is required' });
  } else if (typeof above !== 'number' || !Number.isFinite(above) || above < 0 || above > 1) {
    issues.push({ path: `${path}.above`, message: 'visibility is 0 to 1' });
  }
}

function checkGroup(
  condition: Record<string, unknown>,
  key: 'all' | 'any',
  path: string,
  depth: number,
  issues: ValidationIssue[],
): void {
  const members = condition[key];
  if (!Array.isArray(members)) {
    issues.push({ path: `${path}.${key}`, message: 'must be an array of conditions' });
    return;
  }
  if (members.length === 0) {
    issues.push({ path: `${path}.${key}`, message: 'is empty, so it can never be evaluated' });
    return;
  }
  members.forEach((member, index) => {
    checkCondition(member, `${path}.${key}[${index}]`, depth + 1, issues);
  });
}

function checkCondition(
  condition: unknown,
  path: string,
  depth: number,
  issues: ValidationIssue[],
): void {
  if (depth > MAX_CONDITION_DEPTH) {
    issues.push({ path, message: `nested deeper than ${MAX_CONDITION_DEPTH} levels` });
    return;
  }

  if (!isRecord(condition)) {
    issues.push({ path, message: 'must be a condition object' });
    return;
  }

  const present = CONDITION_KEYS.filter((key) => key in condition);
  if (present.length === 0) {
    issues.push({ path, message: `must have one of: ${CONDITION_KEYS.join(', ')}` });
    return;
  }
  if (present.length > 1) {
    issues.push({ path, message: `has ${present.join(' and ')}, a condition takes exactly one` });
    return;
  }

  const [kind] = present;
  switch (kind) {
    case 'angle':
      checkAngleCondition(condition, path, issues);
      break;
    case 'landmarkX':
    case 'landmarkY':
      checkLandmarkCondition(condition, kind, path, issues);
      break;
    case 'velocityX':
    case 'velocityY':
      checkVelocityCondition(condition, kind, path, issues);
      break;
    case 'visibility':
      checkVisibilityCondition(condition, path, issues);
      break;
    case 'all':
    case 'any':
      checkGroup(condition, kind, path, depth, issues);
      break;
    default:
      break;
  }
}

/**
 * Collects everything wrong with a trigger list. Runs in JavaScript so a bad config fails at the
 * call site with a path, rather than reaching native and becoming a trigger that never fires.
 */
export function validateTriggers(triggers: readonly Trigger[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Array.isArray(triggers)) {
    return [{ path: 'triggers', message: 'must be an array' }];
  }

  const seen = new Set<string>();

  triggers.forEach((trigger, index) => {
    const path = `triggers[${index}]`;

    if (!isRecord(trigger)) {
      issues.push({ path, message: 'must be a trigger object' });
      return;
    }

    const id = trigger['id'];
    if (typeof id !== 'string' || id.trim() === '') {
      issues.push({ path: `${path}.id`, message: 'must be a non-empty string' });
    } else if (seen.has(id)) {
      issues.push({ path: `${path}.id`, message: `duplicate id '${id}'` });
    } else {
      seen.add(id);
    }

    const emit = trigger['emit'];
    if (typeof emit !== 'string' || !EMIT_VALUES.includes(emit as TriggerEmit)) {
      issues.push({
        path: `${path}.emit`,
        message: `must be one of: ${EMIT_VALUES.join(', ')}`,
      });
    }

    if (trigger['enter'] === undefined) {
      issues.push({ path: `${path}.enter`, message: 'is required' });
    } else {
      checkCondition(trigger['enter'], `${path}.enter`, 1, issues);
    }

    if (trigger['exit'] !== undefined) {
      checkCondition(trigger['exit'], `${path}.exit`, 1, issues);
    } else if (emit === 'cycle' || emit === 'exit') {
      issues.push({ path: `${path}.exit`, message: `is required when emit is '${emit}'` });
    }

    checkDuration(trigger['debounceMs'], `${path}.debounceMs`, issues);
    checkDuration(trigger['minDurationMs'], `${path}.minDurationMs`, issues);
    checkDuration(trigger['throttleMs'], `${path}.throttleMs`, issues);

    if (trigger['snapshot'] !== undefined && typeof trigger['snapshot'] !== 'boolean') {
      issues.push({ path: `${path}.snapshot`, message: 'must be a boolean' });
    }
  });

  return issues;
}

/** Same checks, thrown as one `PoseConfigError` listing every problem found. */
export function assertValidTriggers(triggers: readonly Trigger[]): void {
  const issues = validateTriggers(triggers);
  if (issues.length > 0) throw new PoseConfigError(issues);
}
