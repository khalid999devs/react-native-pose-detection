# 0007: Pin MediaPipe to 0.10.35

**Status:** accepted
**Date:** 2026-08-12
**Supersedes:** [0003](./0003-pin-mediapipe-0-10-21.md)

## Context

[0003](./0003-pin-mediapipe-0-10-21.md) pinned `0.10.21` on two grounds. Building Android against
it showed both were wrong in ways that mattered.

**"0.10.26+ drops `armeabi-v7a` and `x86`."** That was true of 0.10.26 and 0.10.26.1 only, and it
was reverted in 0.10.28. Every version from 0.10.28 on ships all four ABIs. The record read as a
permanent property of the 0.10.2x line, and it was a two-release regression.

**"0.10.21 keeps the x86 emulator working."** It does the opposite. 0.10.21 ships `arm64-v8a`,
`armeabi-v7a`, and `x86`, and **no `x86_64`**. A React Native app ships an `x86_64` slice, so on
an Intel host the package manager picks `x86_64` as the primary ABI and never extracts MediaPipe's
32-bit `x86` library. The result is an `UnsatisfiedLinkError` when the landmarker is constructed.
Android Studio stopped shipping 32-bit `x86` system images after API 30, so the emulator the pin
was meant to protect is exactly the one it breaks. Contributors on Apple Silicon run `arm64-v8a`
images and never see it, which is the worst way for a defect like this to be distributed.

The iOS half of 0003 pointed at
[google-ai-edge/mediapipe#6258](https://github.com/google-ai-edge/mediapipe/issues/6258),
CocoaPods linking failures in 0.10.33+. That issue was closed on 2026-04-22 by
`google-ml-butler[bot]` after four "me too" comments, with no fix from Google in the thread. A bot
closing an issue is not the same as the issue being fixed, so this is not evidence that 0.10.35
links, only that 0.10.21 is not obviously still the safest choice.

## Decision

Pin `0.10.35` on Android now. Verified by building, not by reading a table:

| Check | Result |
| --- | --- |
| `tasks-vision:0.10.35` resolves | pulls `tasks-core:0.10.35` transitively |
| ABIs in the assembled APK | `arm64-v8a`, `armeabi-v7a`, `x86`, **`x86_64`** |
| Native library size | 10.5 / 7.4 / 15.0 / 13.0 MB per ABI |
| Model in the APK | exactly one, 9,398,198 bytes |

From 0.10.33 on, `tasks-vision` is a 227 KB facade and the native code lives in `tasks-core`. A
version bump has to check both artifacts, not just the one named in the dependency line.

`armeabi-v7a` stays. Play has required 64-bit binaries since 2019 and Pixel 7 onward are 64-bit
only, so the 32-bit slice protects very few devices, but it costs 7.4 MB in an AAB split that
almost nobody downloads. That is not worth a version pin in either direction.

**iOS is not settled by this record.** 0.10.35 is published to CocoaPods, unlike most of the
0.10.2x line, and it raises the iOS floor to 15.0, which is free because React Native 0.87 already
requires 15.1. Whether it actually links is a Phase 5 question, answered by building.

## Consequences

- The standard `x86_64` emulator works on Intel, Windows, and Linux hosts. That is the whole
  point: contributors on Apple Silicon cannot discover this defect, so the pin has to be right
  without them.
- Bumping MediaPipe now means checking `tasks-core` as well as `tasks-vision`.
- If 0.10.35 fails to link on iOS in Phase 5, the fallback is not 0.10.21. It is finding a version
  that both links on iOS and ships `x86_64` on Android, and 0.10.33 is the only other candidate
  published to CocoaPods.
- 0003's `abiFilters` guidance is no longer a workaround for a missing ABI. It stays in
  `guides/performance.md` as an APK size measure only.
