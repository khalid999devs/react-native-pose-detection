export type ValidationIssue = {
  /** Where the problem is, for example `triggers[0].enter.angle`. */
  readonly path: string;
  readonly message: string;
};

/**
 * Thrown for configuration mistakes that JavaScript can catch, so they surface at the call site
 * with a path instead of as a silently ignored trigger or a native error code.
 */
export class PoseConfigError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(
      issues.length === 1 && issues[0]
        ? `${issues[0].path}: ${issues[0].message}`
        : `${issues.length} configuration problems:\n` +
            issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n'),
    );
    this.name = 'PoseConfigError';
    this.issues = issues;
  }
}
