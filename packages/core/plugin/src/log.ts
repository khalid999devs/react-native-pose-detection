// Build-time output. This is the `plugin` category from docs/logging.md, and it never reaches
// the runtime channel: it is Node writing to a terminal during prebuild.

const CLEAR_LINE = '\u001b[K';

function isInteractive(): boolean {
  return process.stdout.isTTY === true && !process.env['CI'];
}

export function line(message: string): void {
  process.stdout.write(`› ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`› warning: ${message}\n`);
}

/**
 * Overwrites a single line while a download runs. Silent when the output is not a terminal,
 * where a carriage return produces thousands of log lines instead of a progress indicator.
 */
export function progress(message: string): void {
  if (!isInteractive()) return;
  process.stdout.write(`\r› ${message}${CLEAR_LINE}`);
}

export function clearProgress(): void {
  if (!isInteractive()) return;
  process.stdout.write(`\r${CLEAR_LINE}`);
}
