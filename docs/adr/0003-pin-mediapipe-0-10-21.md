# 0003: Pin MediaPipe to 0.10.21

**Status:** superseded by [0007](./0007-pin-mediapipe-0-10-35.md)
**Date:** 2026-08-12

## Context

MediaPipe Tasks Vision releases frequently. Two later versions carry breaking changes:

- **0.10.26+** ships `arm64-v8a` only on Android. The AAR drops from 17 MB to 5.8 MB purely by
  removing `armeabi-v7a` and `x86`. That eliminates 32-bit device support and, more painfully,
  the standard x86 Android emulator that contributors use.
- **0.10.33+** has XCFramework/CocoaPods linking failures
  ([google-ai-edge/mediapipe#6258](https://github.com/google-ai-edge/mediapipe/issues/6258)),
  with 0.10.21 identified as working.

## Decision

Pin `0.10.21` exactly, on both platforms. Document it in troubleshooting so users don't override it.

## Consequences

- Universal APKs are larger, all three ABIs, 40.3 MB of native libraries. Mitigated by
  documenting AAB and `abiFilters`.
- 32-bit Android devices and x86 emulators keep working.
- iOS builds link reliably.
- We carry the upgrade cost later. Revisit when the CocoaPods issue is resolved, and treat
  the ABI drop as a breaking change requiring a major version and a migration note.
