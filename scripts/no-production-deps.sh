#!/bin/sh
# Succeeds when the production dependency tree is empty, so the license gate can say so out loud
# instead of pretending it scanned something.
#
# license-checker prints "An error has occurred: No packages found in this path..." and still
# exits 0 on an empty tree, which makes `npm run audit:license` a gate that can never fail. This
# package has zero runtime dependencies by design, so empty is the expected state today and has
# to be proven here rather than inferred from an error message.

set -e

# Workspace packages are symlinked into node_modules, so they drop out here. What is left is
# every third-party package a consumer would actually install.
# Captured first: `set -e` does not fire on a failed command substitution inside a `for` word
# list, so iterating the command directly would silently scan nothing and report success.
tree=$(npm ls --omit=dev --all --parseable)
if [ -z "$tree" ]; then
  echo 'audit:license: npm ls produced no output, refusing to claim the tree is empty.' >&2
  exit 1
fi

installed=0
for path in $tree; do
  case "$path" in
  */node_modules/*)
    if [ ! -L "$path" ]; then
      installed=$((installed + 1))
    fi
    ;;
  esac
done

if [ "$installed" -gt 0 ]; then
  exit 1
fi

printf 'audit:license: the production dependency tree is empty, so there is no license to check.\n'
