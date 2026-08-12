#!/bin/sh
# Runs a native linter if it is installed, and gets out of the way if it is not.
#
# SwiftLint, SwiftFormat, and ktlint come from Homebrew rather than npm, so `npm ci` produces a
# working checkout without them. Failing the pre-commit hook over a missing Homebrew package
# teaches people to pass --no-verify, and a hook that gets bypassed protects nothing.
#
# CI installs all three and runs them without this wrapper, so skipping here is a local
# convenience and not a hole in the gate.

set -e

tool="$1"
shift

if ! command -v "$tool" >/dev/null 2>&1; then
  printf '  skipped %s: not installed. Run `brew install %s` to lint it before pushing.\n' "$tool" "$tool"
  exit 0
fi

exec "$tool" "$@"
