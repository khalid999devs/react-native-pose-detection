# Contributing

## Setup

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
  src/          TypeScript — API, types, validation
  ios/          Swift — CameraSource, PoseDetector, OverlayRenderer
  android/      Kotlin — same three, CameraX-based
  plugin/       Expo config plugin
  cli/          fetch-model
example/        one app exercising everything
docs/           this directory
```

`PoseEngine` must never import camera code. The frame source is an input — that's what keeps
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
pass. `isSquatting` does not — that's a recipe.

1. Extend `Condition` in `src/types.ts`
2. Implement in both evaluators (Swift + Kotlin) — they must agree exactly
3. Unit test both
4. Document in `guides/triggers.md`

## Pull requests

- One concern per PR
- Tested on a physical device, both platforms (say so if you couldn't)
- Include device model + OS version for anything performance-related
- Public API changes need docs in the same PR

## Reporting bugs

Include:

- Device model and OS version
- `cam.current.getProfile()` output
- `data.mode`, `maxPoses`, model variant
- Expo or bare, old or new architecture
- Minimal reproduction

Performance reports without `getProfile()` output can't be acted on.
