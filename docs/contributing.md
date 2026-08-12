# Contributing

## Setup

Node **22.22.1 or newer** (`.nvmrc` pins 24). The lint and spell tooling requires it.

```bash
git clone <repo> && cd react-native-pose-detection
npm install
npm run build
npm run check
```

For the Android side, `example/expo` is the loop:

```bash
npm run build
cd example/expo
npx expo prebuild --platform android --clean
cd android && ./gradlew :app:assembleDebug
```

For the CLI install path, `example/bare` is the loop. Its native projects are committed, so
there is no prebuild step:

```bash
cd example/bare
npx react-native-pose-detection fetch-model full
npx react-native-pose-detection doctor
(cd android && ./gradlew :app:assembleDebug)
```

A **physical device is required** for anything touching the camera. Simulators have no camera and
MediaPipe's GPU delegate behaves differently there.

**React Native is pinned to 0.86.2**, the version Expo SDK 57 ships. 0.87 raises the Android
Gradle Plugin to 9.2.1, which requires Gradle 9.4.1, which ships a Kotlin standard library newer
than Expo's own autolinking plugin can read. The Android build does not survive that chain.

## Layout

```text
packages/core/
  src/          TypeScript: API, types, validation
  tests/        Node test runner suites, mirroring src/
  ios/          Swift: CameraSource, PoseDetector, OverlayRenderer   (not written yet)
  android/      Kotlin: same three, CameraX-based
  plugin/       Expo config plugin
  cli/          fetch-model
example/
  expo/         Expo app, the config-plugin install path   (Phase 6)
  bare/         bare React Native app, the CLI install path
docs/           this directory
```

Two example apps rather than one because the two install paths share almost no code. See
[example/README.md](../example/README.md).

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

1. Extend the `Condition` union in `src/types/triggers.ts`
2. Teach `src/validation/triggers.ts` about it, and add the rejection cases to
   `src/validation/triggers.test.ts`. A condition the validator does not know is a condition
   whose typos reach native
3. Implement in both evaluators (Swift + Kotlin), they must agree exactly
4. Unit test both
5. Document in `guides/triggers.md` and `guides/reference/trigger-schema.md`

A condition that is typed and validated but not evaluated is worse than one that does not exist:
it type-checks, it passes validation, and it never fires.

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

There is no branch per released version. A release is an annotated tag on `main`, which is what
every tool in the publish path reads. Version-named branches exist only as `N.x` maintenance
lines, created from a tag when an old major needs a backport. See
[release process](./release-process.md#release-history-in-git).

### Branch protection on main

`main` is protected. Direct pushes are rejected for everyone except the maintainer, and every
change lands through a pull request.

| Rule | Effect |
| --- | --- |
| Pull request required | No direct pushes |
| 1 approving review | From a code owner, so @khalid999devs approves every merge |
| Stale reviews dismissed | New commits invalidate an earlier approval |
| Re-approval after a push | The last push must be approved, not just an earlier state |
| 5 status checks, up to date | Code, Docs, Package, Security, Commits must pass on current main |
| Conversations resolved | No merging over unanswered review comments |
| Linear history | Squash merge only, so the changelog stays readable |
| No force push, no deletion | main cannot be rewritten or removed |
| Release tags locked | `v*` tags cannot be moved or deleted once pushed |

Squash merge is the only method enabled, and head branches delete themselves after merge. The
pull request title becomes the commit subject, which is why it has to follow
[Conventional Commits](#commits).

### Who can do what

| | Contributor | Maintainer |
| --- | --- | --- |
| Open a pull request | yes | yes |
| Approve a pull request | no, review comments only | yes |
| Merge to main | no | yes, after approving |
| Push directly to main | no | yes |
| Bypass a required check | no | yes |

Approval can only come from a code owner, and `CODEOWNERS` assigns every path to the
maintainer. In practice that means every change to `main` is reviewed and merged by
@khalid999devs.

Nobody can approve their own pull request, which GitHub enforces regardless of permissions.
The maintainer's own pull requests are therefore merged using admin bypass rather than a
self-approval.

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
- New props, events, or trigger conditions need a control in `example/expo`, once it exists

### Demo

Anything a user can see or interact with needs a **screen recording or screenshot on both
iOS and Android**. Camera, overlay, triggers, calibration, and example-app changes all
qualify.

This is not decoration. A diff cannot show that the overlay lines up, that a trigger fires
once per rep instead of twice, or that the feature was ever run on the second platform.
Reviewers have no other way to check.

Docs, CI, and internal refactors can delete the section.

### Title

PR titles follow the same Conventional Commits format as commit messages, they become the
squash-merge commit, so they land in the CHANGELOG.

### What CI checks

`code`, `docs`, `kotlin`, `swift` (skipped while there are no Swift sources), `package`,
`security` and `commits`, plus CodeQL in its own workflow. `code` and `package` each run twice,
on Node 22.22.1 and on 24. Run the local half first:

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
- `await cam.current.getProfile()` output. Failing that, send the
  `onReady` and `onPerformanceChange` payloads instead
- `data.mode`, `maxPoses`, model variant
- Expo or bare, old or new architecture
- Minimal reproduction

Performance reports with no resolved configuration in them can't be acted on: the same code runs
at four different resolutions and two delegates.
