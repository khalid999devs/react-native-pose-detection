# Project structure

```text
react-native-pose-detection/
├── README.md                  user-facing entry point
├── guides/                    user documentation
├── docs/                      this directory: contributor documentation
├── packages/
│   └── core/                  the published package
│       ├── src/               TypeScript: public API, types, validation
│       ├── ios/               Swift                     (not written yet)
│       ├── android/           Kotlin
│       ├── plugin/            Expo config plugin, model manifest, downloader
│       └── cli/               bin shim, the implementation lives in plugin/
└── example/
    ├── expo/                  Expo app: every screen, installed via the config plugin
    └── bare/                  bare React Native app: install path only, via the CLI
```

`packages/core/ios` is Phase 5 work, so the tree above is where it goes rather than what is
checked in. Both example apps exist and build for Android.

`example/bare` commits its `android/` and `ios/` directories; `example/expo` does not. That is
the difference between the two install paths, not an inconsistency: an Expo app regenerates its
native projects with prebuild, and a bare app has no prebuild to regenerate them with. The model
is gitignored in both, so a fresh clone fetches it.

## `packages/core/src`

```text
src/
├── index.ts               single export point: nothing else is public
├── PoseCamera.tsx         the view component
├── staticInput.ts         detectOnImage, detectOnVideo
├── errors.ts              PoseConfigError, ValidationIssue
├── logging.ts             setLogLevel, addLogListener
├── frames/                the wire format and everything that reads it
│   ├── wire.ts            the buffer header layout, shared with both native encoders
│   ├── decodeFrames.ts    one drained buffer into frames, as views rather than copies
│   └── accessors.ts       zero-copy Float32Array readers
├── permissions/           the camera permission, imperative and as a hook
├── types/                 PoseFrame, Trigger, events, JointName constants
├── validation/            trigger config validation, runs before native sees it
└── native/                Expo module bindings, and the contract they must satisfy
```

## Grouping convention

A directory earns its existence by holding **more than one file that changes together**. A single
file that is its own concern stays at the top level rather than becoming a folder of one:
`errors.ts` and `logging.ts` are not `errors/errors.ts`.

Tests mirror the source tree exactly, so `src/frames/wire.ts` is tested by
`tests/frames/wire.test.ts` and Kotlin's `engine/Triggers.kt` by `engine/TriggerRuntimeTest.kt`.
One tree keeps tests out of the tarball without an exclusion rule. See [testing](./testing.md).

## `packages/core/android`

```text
java/com/posedetection/
├── PoseDetectionModule.kt   the Expo module definition: props, events, functions
├── Skeleton.kt              the landmark, connection and angle tables everything reads
├── PoseLog.kt               the level mask, the ring buffer, the Logcat mirror
├── ErrorCode.kt
├── Permissions.kt
├── view/                    PoseCameraView, OverlayView, and the overlay's prop parsing
├── camera/                  CameraSource, FrameConverter: the capture pipeline
├── detector/                PoseDetector, StaticDetection: what runs the model
├── engine/                  landmarks in, something emitted out
│   ├── Geometry.kt          angles, centre of mass, body span
│   ├── OneEuroFilter.kt     smoothing
│   ├── Conditions.kt        the Condition union, evaluated
│   ├── Triggers.kt          the state machine per trigger
│   ├── FrameWire.kt         the wire layout, the ring buffer, snapshot tickets
│   └── *Parsing.kt          building the above from what JavaScript sent
└── performance/             Calibrator, the thermal monitor, the precedence chain
```

The four packages match the vocabulary in [architecture](./architecture.md): capture, detect,
engine, present. Parsing lives beside what it builds rather than in the module file, so a new
condition is one file rather than two.

## `packages/core/plugin`

```text
plugin/src/
├── index.ts               the config plugin: withPoseDetection
├── manifest.ts            pinned URLs, checksums, byte sizes
├── download.ts            cache, resume, verify
├── install.ts             copy in, remove what was there
├── pbxproj.ts             Xcode target registration
├── cli.ts                 fetch-model, doctor, clear-cache
├── withAndroidModel.ts    assets copy + CAMERA permission
└── withIosModel.ts        Resources copy + Xcode + NSCameraUsageDescription
```

The plugin and the CLI are one implementation. `cli/index.js` is a shim that calls into
`plugin/build`, so `npx expo prebuild` and `npx react-native-pose-detection fetch-model` cannot
drift apart in what they install or how they verify it.

Nothing here imports from `src/`. The plugin runs in Node at build time on a developer's
machine; the runtime code runs on a phone. The `ModelVariant` union is spelled out in both,
which is the one duplication that buys that separation.

`native/contract.ts` is the interface both platforms implement. It exists so the public API can
compile and be reviewed before either native project does, and so a native change that breaks the
JS surface fails at typecheck rather than on a device.

`index.ts` is the only public surface. If it isn't exported there, it isn't API, and it can
change without a major version. The `exports` map in `package.json` enforces that from the
outside: a consumer cannot reach `react-native-pose-detection/build/wire`, so no internal file
becomes public by accident.

## Native layout

Both platforms mirror the same four responsibilities:

| Component | iOS | Android | Responsibility |
| --- | --- | --- | --- |
| `CameraSource` | AVFoundation | CameraX | capture, lifecycle, switching |
| `PoseDetector` | MediaPipe Tasks | MediaPipe Tasks | inference, delegate fallback |
| `PoseEngine` | Swift | Kotlin | geometry, triggers, emission |
| `OverlayRenderer` | CAShapeLayer | Canvas | native skeleton drawing |
| `Calibrator` | Swift | Kotlin | device probe, convergence, cache |

**`PoseEngine` must never import camera code.** The frame source is an input. This is the
single structural rule that keeps alternative frame sources, VisionCamera, static images,
video files, cheap to add rather than requiring a fork. See [ADR 0001](./adr/0001-own-camera-not-visioncamera.md).

## Where to add things

| Adding | Goes in |
| --- | --- |
| A new prop | `src/types/`, both native modules, [`guides/reference/pose-camera.md`](../guides/reference/pose-camera.md) |
| A new trigger condition | `src/types/triggers.ts`, `src/validation/triggers.ts` and its test, **both** evaluators, both native test suites, `guides/reference/trigger-schema.md` |
| A new derived value (angle, ratio) | `PoseEngine` on both platforms, `PoseFrame` type |
| Sport-specific logic | **Nowhere.** It's a recipe: `guides/recipes/` |
| A build-time behavior change | `plugin/`, and `guides/reference/config-plugin.md` |
| A decision worth remembering | [`docs/adr/`](./adr/README.md) |

## Two implementations, one behavior

The condition evaluator and geometry will exist twice, Swift and Kotlin. They must produce
identical output for identical input. Shared JSON fixtures are meant to drive both test suites; a
divergence is a bug even when each side looks correct alone. Neither exists yet, so this is a rule
for Phases 4 and 5 rather than something enforced today. See [testing](./testing.md).

## What is deliberately absent

| | Why |
| --- | --- |
| Domain logic (reps, jumps, form) | Primitives, not policy |
| A web implementation | Declared platforms are `apple` and `android` only: no stubs |
| Bundled model files | [ADR 0002](./adr/0002-models-fetched-not-bundled.md) |
| VisionCamera dependency | [ADR 0001](./adr/0001-own-camera-not-visioncamera.md): adapter arrives in 0.2.0 |
