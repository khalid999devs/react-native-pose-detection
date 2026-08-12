import { PoseConfigError } from './errors';
import type { ValidationIssue } from './errors';
import { getNativeModule } from './native';
import { LOG_CATEGORIES, LOG_LEVELS } from './types/logging';
import type {
  LogEntry,
  LogListener,
  LogLevel,
  LogLevelConfig,
  Subscription,
} from './types/logging';

// A multiset: two callers may pass the same handler, and identity dedupe would make one
// remove() unsubscribe both.
const listeners: LogListener[] = [];

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

function validate(config: LogLevelConfig): ValidationIssue[] {
  if (isLogLevel(config)) return [];

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [
      { path: 'logLevel', message: `must be a level or a map of categories to levels` },
      { path: 'logLevel', message: `levels are: ${LOG_LEVELS.join(', ')}` },
    ];
  }

  const issues: ValidationIssue[] = [];
  for (const [category, level] of Object.entries(config)) {
    if (!(LOG_CATEGORIES as readonly string[]).includes(category)) {
      issues.push({
        path: `logLevel.${category}`,
        message: `unknown category, expected one of: ${LOG_CATEGORIES.join(', ')}`,
      });
      continue;
    }
    if (!isLogLevel(level)) {
      issues.push({
        path: `logLevel.${category}`,
        message: `must be one of: ${LOG_LEVELS.join(', ')}`,
      });
    }
  }
  return issues;
}

/**
 * Sets the diagnostic level for every camera. Writes one integer natively, re-initializes nothing.
 * Throws on an unknown level or category rather than silently ignoring it.
 */
export function setLogLevel(config: LogLevelConfig): void {
  const issues = validate(config);
  if (issues.length > 0) throw new PoseConfigError(issues);

  getNativeModule().setLogLevel(config);
}

/** Entries arrive batched. The native stream runs only while a listener is attached. */
export function addLogListener(listener: LogListener): Subscription {
  listeners.push(listener);
  if (listeners.length === 1) getNativeModule().startLogStream();

  let removed = false;
  return {
    remove() {
      if (removed) return;
      removed = true;

      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
      if (listeners.length === 0) getNativeModule().stopLogStream();
    },
  };
}

/** Iterates a copy so unsubscribing during delivery cannot skip the next listener. */
export function emitLogEntries(entries: readonly LogEntry[]): void {
  for (const listener of [...listeners]) listener(entries);
}
