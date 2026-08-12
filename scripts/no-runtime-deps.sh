#!/bin/sh
# Asserts the published package installs nothing.
#
# `npm audit --omit=dev` and license-checker both walk the whole workspace, which since the
# example apps exist includes Expo's build tooling. That tooling is not something a consumer
# installs, so auditing it under a consumer-facing gate reports risk nobody carries. What a
# consumer actually gets is whatever `react-native-pose-detection` lists in `dependencies`, and
# the design commitment is that this stays empty.

set -e

manifest="packages/core/package.json"
count=$(node -p "Object.keys(require('./$manifest').dependencies || {}).length")

if [ "$count" -ne 0 ]; then
  echo "The package now declares $count runtime dependencies." >&2
  echo "Audit and license-check them explicitly, then update this gate." >&2
  node -p "Object.keys(require('./$manifest').dependencies).join('\n')" >&2
  exit 1
fi

printf 'react-native-pose-detection declares no runtime dependencies, so a consumer installs none.\n'
