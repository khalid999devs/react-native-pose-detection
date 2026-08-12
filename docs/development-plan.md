# Development Plan → v0.1.0

Seven phases. Each ends in a verifiable state. If the exit criteria don't pass, the phase
isn't done.

| Phase | Deliverable | Size |
| --- | --- | --- |
| [0](#phase-0-bootstrap) | Repo, tooling, quality gates | hours |
| [1](#phase-1-contracts) | Contracts: types, errors, wire format | ~3 days |
| [2](#phase-2-model-delivery) | Model delivery: config plugin + CLI | ~4 days |
| [3](#phase-3-android) | Android: camera, detector, overlay | ~2 weeks |
| [4](#phase-4-engine) | Engine: geometry, triggers, calibration | ~1 week |
| [5](#phase-5-ios) | iOS: port to parity | ~1 week |
| [6](#phase-6-hardening) | Hardening: tests, CI, measurement | ~1 week |
| [7](#phase-7-release) | Release | ~2 days |

**Android before iOS.** iOS is a port of code that already runs in production; Android is
greenfield and carries all the risk. Building the risky half first means the schedule is
honest by Phase 4 instead of Phase 6.

**Phases 3 and 4 interleave.** The engine (4) is written against the Android integration (3);
they're listed separately because their exit criteria are independent.

---

## Phase 0: Bootstrap

**Goal:** a clean repo that lints, typechecks, and has a place for everything.

- [x] `git init`; legacy package removed, its Swift preserved for the Phase 5 port
- [x] Documentation split, `guides/` for users, `docs/` for contributors
- [x] Monorepo scaffold: `packages/core`, `example`, root tooling
- [x] TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint, Prettier, `.editorconfig`
- [x] `expo-module.config.json`, **apple + android only**, no `web`
- [x] `files` in `packages/core/package.json` excludes `example/`, `guides/`, `docs/`
- [x] CI: code (on the `engines` floor and on 24), docs, Kotlin lint, Swift lint behind a cheap
      source-detection job, package, security, commits, plus CodeQL in its own workflow. Every
      action pinned to a commit SHA, not a tag its owner can move
- [x] Quality gates: ESLint · Prettier · tsc · `node --test` · knip · markdownlint · cspell ·
      lychee · SwiftLint · ktlint · publint · attw · npm audit · license allowlist · commitlint ·
      CodeQL
- [x] Tarball guard, CI fails if a model file leaks, if a build artifact is missing, or if the
      package exceeds 2 MB. `exports` closes deep imports, `prepack` builds before packing
- [x] husky + lint-staged pre-commit, conventional commits
- [x] Issue and PR templates, CODEOWNERS, Dependabot, LICENSE, CHANGELOG, SECURITY, CODE_OF_CONDUCT

**Exit:** `npm run check` passes on an empty package. See [quality gates](./quality-gates.md).

---

## Phase 1: Contracts

**Goal:** every type the native layer must satisfy, agreed before native code exists.

- [x] `PoseFrame`, `Landmark`, `JointName` (33 constants), `PoseCameraRef`
- [x] `Trigger`, `Condition`, `TriggerEvent`, full schema
- [x] `ReadyEvent`, `ErrorEvent`, `PerformanceEvent`, `CameraState`, `ProfileState`
- [x] Error code enum. The complete list, no ad-hoc strings later
- [x] **Float32Array wire format**: 33 × 4 floats, layout documented, zero-copy JS accessor.
      `select` narrows the buffer, [ADR 0005](./adr/0005-select-narrows-the-buffer.md)
- [x] Skeleton connection table (35 pairs) shared by both platforms
- [x] `AngleOverlay` type, joint, label, radius, color, decimals, minVisibility
- [x] `LogEntry`, `LogLevel`, `LogCategory`; `setLogLevel()` / `addLogListener()` signatures
- [x] JS-side trigger validation with clear messages, catch bad configs before native sees them
- [x] `AngleJointName`: only the 12 joints where two limb segments meet have an angle, so
      `{ angle: 'nose' }` fails at compile time instead of never firing

**Exit:** the public API compiles and is fully typed against a stub native module.
`guides/reference/pose-camera.md` matches the types exactly.

> The wire format is the one thing that's painful to change later. Get it right here.

**Carried into Phase 3:** `src/native/contract.ts` is what both platforms must implement. The
binding in `src/native/index.ts` points at a stub until the Expo module exists, so no call site
changes when it is swapped.

---

## Phase 2: Model delivery

**Goal:** `npx expo prebuild` puts the right model in both native projects. No manual steps.

- [x] Model manifest: URL + SHA-256 + byte size for lite / full / heavy. Values are already
      verified and recorded in [ADR 0004](./adr/0004-pin-model-revision-not-latest.md),
      pin `/float16/1/`, never `latest`
- [x] Downloader: cache at `~/.cache/react-native-pose-detection/`, verify, resume, clear progress output
- [x] Config plugin
  - [x] `withDangerousMod` copy into `android/app/src/main/assets/`
  - [x] iOS resource copy + Xcode project registration
  - [x] `withInfoPlist` camera permission, `withAndroidManifest` permission
  - [x] **Removes the previous model** on variant change, never two at once
- [x] CLI `fetch-model <variant>` for bare RN, plus `doctor` and `clear-cache`
- [x] Offline behavior: cache hit works with no network; miss fails with an actionable message
- [x] Checksum policy: fatal on download, self-healing in the cache,
      [ADR 0006](./adr/0006-checksums-are-fatal-except-in-the-cache.md)

**Exit:** a fresh Expo app installs, prebuilds, and has exactly one `.task` in each native
project. Switching `full` → `lite` and re-prebuilding leaves only `lite`. Second prebuild
hits the cache and makes no network call.

**Verified** against a fresh `create-expo-app` project on SDK 57 / RN 0.86: prebuild installs
one model per platform and registers it in the app target, `full` → `lite` leaves exactly one
file and one Xcode reference, and a cache hit makes zero network calls.

---

## Phase 3: Android

**Goal:** live camera, live detection, native overlay. The highest-risk phase.

- [x] `build.gradle`: `tasks-vision` pinned at 0.10.35, `minSdk 24`
- [x] **MediaPipe version resolved**, [ADR 0007](./adr/0007-pin-mediapipe-0-10-35.md) supersedes
      0003. 0.10.21 ships no `x86_64` library, so it breaks the emulator it was chosen to
      protect. 0.10.35 ships all four ABIs, confirmed in an assembled APK
- [x] `CameraSource`, CameraX `ImageAnalysis`
  - [x] `OUTPUT_IMAGE_FORMAT_RGBA_8888` (hardware YUV→RGB)
  - [x] `STRATEGY_KEEP_ONLY_LATEST`
  - [x] `imageProxy.close()` in `finally`, **always**, one miss stalls the analyzer forever
  - [x] `targetRotation` updated on orientation change **and** on rebind
  - [x] Analysis resolution independent of preview resolution
  - [x] Row-padded analysis buffers handled, or the frame shears diagonally on some devices
- [x] `PoseDetector`, `PoseLandmarker`, LIVE_STREAM, GPU→CPU fallback verified by first inference
- [x] Monotonic timestamps, clamped strictly increasing
- [x] **Camera switch**, see [architecture](./architecture.md); generation counter, single serial
      queue (the main thread, which is the one CameraX requires), no landmarker recreation,
      rollback on failure
- [x] `OverlayRenderer`, Canvas, no per-frame allocation. `drawLines` and `drawPoints` over
      preallocated float arrays, rather than a `Path` rebuilt once a frame
  - [x] **Angle arcs + degree labels**, arc between the two limb segments meeting at the joint,
        `decimals` capped at 3
  - [x] Projected from **rotated** buffer dimensions, so the overlay lines up in every orientation
- [x] `facing: 'auto'` falls back to the other lens on the first bind. An explicit
      `switchCamera()` to a lens the device lacks fails with `CAMERA_SWITCH_FAILED` instead of
      quietly staying put
- [x] Consumer ProGuard rules shipped through `consumerProguardFiles`. MediaPipe reaches its own
      classes from JNI and neither AAR carries keep rules, so R8 in a consumer's release build
      would strip them
- [x] Lifecycle: background → full stop; foreground → resume
- [x] `onTrimMemory` handling
- [x] Expo module: props, ref methods, `onReady` / `onError` / `onCameraChange` wired to the
      Phase 1 contracts

**Exit:** example app shows a live skeleton on a physical device. 100 rapid camera switches
with detection on: no crash, no leak. Backgrounding releases the camera; foregrounding restores it.

**Status: written and building, not run.** A clean `assembleDebug` compiles the module and
packages all four ABIs plus exactly one model, and ktlint is clean. Everything in the exit
criteria needs a physical device, so none of it is verified: no live skeleton, no switch stress
test, no leak numbers. The example app in Phase 6 is what makes those runnable.

Deliberately stubbed here and finished in Phase 4: `targetFps` and `deviceTier` in `onReady` are
placeholders until calibration exists, `maxPoses > 1` uses the first pose rather than the primary
one, and the log channel writes to Logcat only.

---

## Phase 4: Engine

**Goal:** everything between "landmarks arrived" and "something was emitted". Platform-shared logic.

- [x] Geometry: joint angles, center of mass (hip 0.5 / ankle 0.3 / knee 0.2×vis), velocity, body span
  - [x] Angles corrected for the frame's aspect ratio. Normalizing x by width and y by height
        makes the space anisotropic, so an uncorrected angle is wrong on every non-square frame
  - [x] `NaN` where a value is unknown rather than 0, which would read as a measurement: a folded
        joint, a body at the origin, a body standing still
- [x] **Lazy computation**, only the angles an `angle` condition, `overlay.angles` or `data.angles`
      asks for, resolved during render and sent to native as a prop. Naming a joint in
      `data.select`, or as a comparison bound, is a position and does not turn its angle on
- [ ] One-Euro smoothing filter
- [ ] Trigger evaluator: state machine per trigger, debounce, `minDurationMs`, snapshot capture
- [ ] Condition evaluator: `angle`, `landmarkX/Y` (absolute + joint-relative), `velocityX`,
      `velocityY`, `visibility`, `all`, `any`. The whole `Condition` union, so nothing typed and
      validated on the JS side reaches an evaluator that silently ignores it
- [ ] Emission: `off` / `throttled` / `batched` (bounded buffer, drop-oldest + count) / `live`
  - [x] **Delivery mechanism settled**, [ADR 0008](./adr/0008-frames-are-drained-not-pushed.md).
        Events cannot carry an ArrayBuffer through Expo Modules, function returns can, so native
        signals and JavaScript drains. Self-describing buffer, zero-copy `subarray` views
  - [x] JS side: `<PoseCamera>`, the native binding, `decodeFrames`, the shared angle resolution,
        `onFramesDropped` for the ring buffer's drop count, and a malformed buffer reported as a
        non-fatal `DETECTION_FAILED` rather than thrown
  - [x] **Trigger snapshots claimed, not carried**,
        [ADR 0009](./adr/0009-trigger-snapshots-are-claimed.md). A frame cannot ride an event
        either, so native sends a ticket and `<PoseCamera>` redeems it before calling `onTrigger`
  - [x] Native side (Android): the ring buffer, `drainFrames`, `snapshotFrame`. Bounded at 64
        frames, drop-oldest with a count, storage allocated per layout and reused, one direct
        buffer per drain in native byte order. `takeTriggerSnapshot` returns empty until there is
        an evaluator to mint a ticket, which is the contract's unknown-ticket case
- [ ] Calibration
  - [ ] Stage 1 static probe → tier, biased one step conservative
  - [ ] Stage 2 measured convergence, hysteresis + 3 s cooldown
  - [ ] Stage 3 native cache keyed by device + model + OS, invalidated on change
- [ ] Thermal ladder, outranks calibration; `thermalPolicy` respected; always reports even when it doesn't act
- [ ] Pre-warm: one dummy inference during camera setup
- [ ] Idle-search: no pose ~2 s → 8 fps; recover within one frame
- [ ] Profiles + precedence chain
- [ ] `maxPoses` 1–5; primary-pose selection for triggers
- [ ] `detectOnImage` / `detectOnVideo`
- [x] **Camera permission**, `useCameraPermission()` plus the imperative pair. Four states, so an
      app can tell a refusal it may ask about again from one the system will never prompt for
- [ ] **Logging channel**, see [logging](./logging.md)
  - [ ] Atomic level mask, 3 bits × 6 runtime categories, 18 bits; one compare per call site.
        `plugin` is build-time output from Node and is not one of them
  - [ ] Closure-based call sites (`inline` + lambda / `@autoclosure`), **no string built when disabled**
  - [ ] Bounded ring buffer, batched flush every 250 ms, `droppedCount` reported
  - [ ] Mirrored to `os_log` / `Logcat` so native-only debugging works with no JS listener

**Exit:** squat recipe counts correctly on a physical device. Calibration settles within 3 s and
is cached across launches. Zero steady-state allocations in the frame path (profiler-verified)
with logging both `off` and at `error`.

**Status: frames flow on Android.**
`<PoseCamera>` exists and is wired to the native view, frames decode zero-copy, the angle set is
resolved from props during render, triggers are validated before native sees them, and the
delivery question that blocked everything is answered twice over, once for frames and once for
trigger snapshots. `npm test` covers the wire format, the accessors under a narrowed buffer, and
every rejection path in the validator.

What remains is the One-Euro filter, both evaluators, calibration, the thermal ladder, static
input, and the log channel. Until those land no trigger fires and `detectOnImage` /
`detectOnVideo` do not exist. `onPose` and `onPoseBatch` do fire, on Android.

`setProfile` and `getProfile` on the ref throw until calibration lands. They are the only two
public methods that do. Everything else that reaches native returns a promise that resolves
against a view which is not doing the work yet.

---

## Phase 5: iOS

**Goal:** parity. Port from the legacy package, applying every fix.

- [ ] Podspec, `MediaPipeTasksVision 0.10.35` to match Android,
      [ADR 0007](./adr/0007-pin-mediapipe-0-10-35.md). If it fails to link, the fallback is
      0.10.33, never 0.10.21: two evaluators required to agree cannot start from different
      MediaPipe versions
- [ ] Consumer ProGuard rules have no iOS counterpart, but the Swift equivalent is
      `-ObjC`-safe symbol handling; check the archive, not the debug build
- [ ] `CameraSource`, AVFoundation
  - [ ] Capture delegate queue **is** the inference queue, buffers never escape the callback
  - [ ] `alwaysDiscardsLateVideoFrames = true`
  - [ ] Timestamps from `CMSampleBufferGetPresentationTimeStamp`, clamped
  - [ ] Mirroring + rotation applied **inside** `begin/commitConfiguration`
- [ ] `PoseDetector`, port GPU→CPU fallback, add first-inference verification
- [ ] `OverlayRenderer`, port `transformNormalizedPoint`, `getVideoPreviewRect`,
      `CATransaction.setDisableActions(true)`; reuse path objects
  - [ ] Angle arcs + degree labels, pixel-identical to Android
- [ ] Camera switch, same eight rules as Android
- [ ] Memory warnings, thermal state, low-power mode
- [ ] Engine bindings identical to Android

**Exit:** example app behaves identically on both platforms. Same 100-switch stress test passes.
Zero jump-detection code present.

---

## Phase 6: Hardening

**Goal:** the numbers in the docs are measured, and CI stops regressions.

- [ ] **CI matrix**, iOS + Android × Expo + bare × old + new arch, every PR
  - [x] Android × Expo, building the example and asserting all four ABIs and one model
  - [x] Android × bare, building the example through the CLI, plus `doctor`, an autolinking
        assertion, and a check that the CLI leaves the committed Xcode project unchanged
- [ ] Camera-switch stress test, 100 switches, detection on: no crash, no leak, counters preserved
- [ ] Leak test, 100 mount/unmount cycles, memory returns to baseline
- [ ] Memory budget test, 10 min against the table in `guides/performance.md`, all profiles
- [ ] Calibration test, settles < 3 s on low/mid/high devices; cache honored on relaunch
- [ ] Thermal simulation, every ladder step fires and recovers
- [ ] Unit tests on both native sides: trigger evaluator, condition evaluator, geometry, wire
      encoding, driven by shared fixtures. The JavaScript half of this is already done, see
      [testing](./testing.md); what is missing is a JUnit and an XCTest suite
- [ ] **Measure real app size**, release archive with and without the plugin, per model, per
      platform. Replace the iOS estimates in `guides/performance.md` with actual numbers.
- [ ] **Measure FPS** on 3–4 real devices spanning low/mid/high
- [ ] **Example apps**, see [example/README.md](../example/README.md). Two of them:
      `example/expo` through the config plugin, `example/bare` through the CLI. The two
      install paths share almost no code, so a bug in one is invisible in the other
  - [x] `example/expo` builds for Android. It is what first compiled the Kotlin, and it proved
        the config plugin, autolinking, the native link and the packaged model end to end
  - [x] `example/bare`, the only thing that exercises the CLI install path. It proved the
        Xcode writer against a real project, and that the bare install path needs Expo modules
        wired by hand because `install-expo-modules` stops at React Native 0.78
  - [ ] Either app running on a physical device
  - [ ] Screens: Home · Basic · Playground · Triggers · Data modes · Performance · Recipes · Angles · Static input · Console · Scenarios
  - [ ] Playground exposes **every prop** with requested-vs-resolved shown side by side
  - [ ] Scenarios panel: camera-switch ×100, remount ×50, detection toggle ×20, overlay toggle ×50,
        background/foreground, clear calibration cache, force thermal state, simulate memory warning,
        reset counters, reset everything, each reporting pass/fail with before/after memory
  - [ ] Console screen streams the log channel with level and category filters
- [ ] Docs pass, every documented API exists and behaves as written

**Exit:** CI green on all matrix cells. Every number in `guides/performance.md` is measured, not estimated.

---

## Phase 7: Release

- [ ] README: what it is, install, 10-line example, size table, honest limitations
- [ ] CHANGELOG, semantic-release, `LICENSE` (MIT)
- [ ] Issue + PR templates, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- [ ] `npm publish --tag next` → verify install in a clean Expo app **and** a clean bare app
- [ ] Publish `0.1.0`
- [ ] Tag `v0.1.0` on the published commit and cut the GitHub release,
      [release history in git](./release-process.md#release-history-in-git)
- [ ] Announce: Expo Discord, r/reactnative, X

**Exit:** `npm i react-native-pose-detection` in a fresh app, add the plugin, prebuild, run.
skeleton appears. No manual steps.

---

## Definition of done (every phase)

1. TypeScript strict, no `any` in public API
2. Both platforms, or explicitly documented as one-platform-pending
3. Public API matches `guides/reference/pose-camera.md`
4. Comments explain **why**, never what, no bloated doc-comment blocks
5. No dead code, no commented-out code, no TODOs without a linked issue

## Deferred

`0.2.0` worklets · VisionCamera adapter
`0.3.0` formula DSL · `delegate="benchmark"` · segmentation masks
`later` remote model delivery · web · native analyzer protocol

## Scope escape hatch

If Phase 3 or 5 runs long, cut in this order:

1. Thermal ladder → keep only the `critical` pause
2. Calibration Stage 3 cache → recalibrate each launch
3. Triggers → `0.2.0`

Shipping beats completeness.
