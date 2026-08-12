# Contributing

## Setup

Node **22.22.1 or newer** (`.nvmrc` pins 24). The lint and spell tooling requires it.

```bash
git clone <repo> && cd react-native-pose-detection
npm install
npm run build
cd example && npx expo prebuild
npx expo run:ios      # or run:android
```

A **physical device is required.** Simulators have no camera and MediaPipe's GPU delegate
behaves differently there.

## Layout

```text
packages/core/
  src/          TypeScript: API, types, validation
  ios/          Swift: CameraSource, PoseDetector, OverlayRenderer
  android/      Kotlin: same three, CameraX-based
  plugin/       Expo config plugin
  cli/          fetch-model
example/        one app exercising everything
docs/           this directory
```

`PoseEngine` must never import camera code. The frame source is an input, that's what keeps
alternative frame sources (VisionCamera, static images) cheap to add.

## Code style

**Comments explain why, not what.** Never restate the code.

```swift
// Bad
// Increment the frame counter
frameCount += 1

// Good
// PTS can repeat within a millisecond at high frame rates; MediaPipe rejects
// non-increasing timestamps, so clamp rather than trust the source.
if ms <= lastTs { ms = lastTs + 1 }
```

No file-header blocks, no doc-comment walls, no ASCII banners. Prose documentation belongs
in `docs/`. If a function needs a paragraph to explain, it probably needs splitting.

- TypeScript strict; no `any` in the public API
- Swift: `swift-format` defaults · Kotlin: `ktlint`
- Public API changes require a matching `guides/reference/pose-camera.md` update in the same PR

## Non-negotiable rules

Each of these exists because its absence caused a production crash.

1. **Sample buffers never leave the capture callback.** The delegate queue *is* the inference queue.
2. **Timestamps are monotonic**, clamped strictly increasing.
3. **Generation counter** on camera switch; stale results dropped.
4. **All session state on one serial queue.** No booleans shared across threads.
5. **Never recreate the landmarker** for a camera switch or prop change.
6. **`imageProxy.close()` in `finally`** on Android. Always.
7. **Zero allocations in the steady-state frame path.**
8. **No domain logic.** If it needs to know the activity, it's a recipe.

## Adding a trigger condition

New conditions must describe **a body**, not an activity. `angle`, `visibility`, `velocityY`
pass. `isSquatting` does not, that's a recipe.

1. Extend `Condition` in `src/types.ts`
2. Implement in both evaluators (Swift + Kotlin), they must agree exactly
3. Unit test both
4. Document in `guides/triggers.md`

## Workflow

```text
main  (protected: no direct pushes)
  │
  └─ branch    feat/triggers-velocity-condition
       │
       ├─ commit    feat(triggers): add velocityY condition
       ├─ verify    npm run check
       ├─ PR title  feat(triggers): add velocityY condition
       │
       └─ squash merge → main → CHANGELOG entry
```

One naming convention runs through all three: **branch, commits, and PR title use the same
type and scope.** If you know the commit type, you know the branch name.

## Branches

```text
<type>/<scope>-<short-description>
```

| Example | For |
| --- | --- |
| `feat/triggers-velocity-condition` | new capability |
| `fix/camera-switch-crash` | bug fix |
| `perf/engine-lazy-angles` | performance |
| `docs/guides-plank-recipe` | documentation |
| `refactor/android-camera-source` | restructuring |
| `build/deps-bump-typescript` | dependencies |

Rules:

- **Types and scopes are the same lists as [commits](#commits)**: nothing extra to memorize
- Lowercase, hyphen-separated, exactly one `/`
- Short: three or four words after the scope, not a sentence
- Branch from an up-to-date `main`
- Rebase on `main` rather than merging it in, keeps history linear for the changelog
- Delete the branch after merge

```bash
git switch main && git pull
git switch -c feat/triggers-velocity-condition
```

`main` is protected. Everything lands through a pull request, including your own.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). This is
enforced by a `commit-msg` hook locally and by CI on every PR.

```text
type(scope): subject

[optional body]

[optional footer]
```

```text
feat(triggers): add velocityY condition
fix(camera): drop stale frames after switch using generation counter
perf(engine): compute only angles referenced by triggers
docs(guides): add plank hold recipe
```

It isn't ceremony. The type drives the release. `feat` produces a minor bump, `fix` a patch,
and a `BREAKING CHANGE:` footer a major, which is how the CHANGELOG and version numbers are
generated.

### Types

| Type | Use for | Release |
| --- | --- | --- |
| `feat` | new capability | minor |
| `fix` | bug fix | patch |
| `perf` | performance with no API change | patch |
| `refactor` | restructuring, no behavior change | none |
| `docs` | documentation only | none |
| `test` | tests only | none |
| `build` | build system, dependencies | none |
| `ci` | CI configuration | none |
| `chore` | everything else | none |

### Scopes

Optional, but validated when present. Kept in sync with `commitlint.config.mjs`.

| Group | Scopes |
| --- | --- |
| Package | `core` `ios` `android` `engine` `camera` `triggers` `calibration` `overlay` `logging` `plugin` `cli` |
| Repository | `repo` `example` `docs` `guides` `ci` `deps` `release` |

Adding a scope means editing `commitlint.config.mjs` and this table in the same commit.

### Breaking changes

```text
feat(core)!: rename data.mode 'stream' to 'live'

BREAKING CHANGE: `data.mode: 'stream'` is now `'live'`. Update any component
passing 'stream'.
```

Both the `!` and the footer are required. The footer text goes into the CHANGELOG verbatim, so
write it for someone upgrading, not for yourself.

### When a commit is rejected

```text
✖ subject may not be empty [subject-empty]
✖ type may not be empty [type-empty]
```

That means the message had no `type:` prefix. Amend it:

```bash
git commit --amend
```

Don't bypass with `--no-verify`. A message that skips the hook still fails the `commits` job in
CI, and it breaks changelog generation for the release it lands in.

## Pull requests

- One concern per PR
- Tested on a physical device, both platforms (say so if you couldn't)
- Include device model + OS version for anything performance-related
- Public API changes need docs in the same PR
- New props, events, or trigger conditions need a control in `example/`

### Title

PR titles follow the same Conventional Commits format as commit messages, they become the
squash-merge commit, so they land in the CHANGELOG.

### What CI checks

Six jobs run on every PR: code, docs, native, package, security, and commits. Run them locally
first:

```bash
npm run check       # everything that needs no native toolchain
npm run check:all   # adds Swift/Kotlin lint, audit, licenses
```

Full list and rationale: [quality gates](./quality-gates.md).

### Review

Expect questions about the [eight rules](./README.md#the-eight-rules) and about whether a change
belongs in the library at all, see the litmus test in
[project structure](./project-structure.md#where-to-add-things). Neither is personal; both have
cost real crashes and real scope creep in the past.

## Reporting bugs

Include:

- Device model and OS version
- `cam.current.getProfile()` output
- `data.mode`, `maxPoses`, model variant
- Expo or bare, old or new architecture
- Minimal reproduction

Performance reports without `getProfile()` output can't be acted on.
