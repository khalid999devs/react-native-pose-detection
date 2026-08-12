# Project structure

```text
react-native-pose-detection/
├── README.md                  user-facing entry point
├── guides/                    user documentation
├── docs/                      this directory — contributor documentation
├── packages/
│   └── core/                  the published package
│       ├── src/               TypeScript — public API, types, validation
│       ├── ios/               Swift
│       ├── android/           Kotlin
│       ├── plugin/            Expo config plugin
│       └── cli/               fetch-model, doctor
└── example/                   one app exercising everything
```

## `packages/core/src`

```text
src/
├── index.ts               single export point — nothing else is public
├── PoseCamera.tsx         the view component
├── types/                 PoseFrame, Trigger, events, JointName constants
├── validation/            trigger config validation, runs before native sees it
├── accessors.ts           zero-copy Float32Array readers
└── native/                Expo module bindings
```

`index.ts` is the only public surface. If it isn't exported there, it isn't API, and it can
change without a major version.

## Native layout

Both platforms mirror the same four responsibilities:

| Component | iOS | Android | Responsibility |
|---|---|---|---|
| `CameraSource` | AVFoundation | CameraX | capture, lifecycle, switching |
| `PoseDetector` | MediaPipe Tasks | MediaPipe Tasks | inference, delegate fallback |
| `PoseEngine` | Swift | Kotlin | geometry, triggers, emission |
| `OverlayRenderer` | CAShapeLayer | Canvas | native skeleton drawing |
| `Calibrator` | Swift | Kotlin | device probe, convergence, cache |

**`PoseEngine` must never import camera code.** The frame source is an input. This is the
single structural rule that keeps alternative frame sources — VisionCamera, static images,
video files — cheap to add rather than requiring a fork. See [ADR 0001](./adr/0001-own-camera-not-visioncamera.md).

## Where to add things

| Adding | Goes in |
|---|---|
| A new prop | `src/types/`, both native modules, [`guides/reference/pose-camera.md`](../guides/reference/pose-camera.md) |
| A new trigger condition | `src/types/`, **both** evaluators, both test suites, `guides/reference/trigger-schema.md` |
| A new derived value (angle, ratio) | `PoseEngine` on both platforms, `PoseFrame` type |
| Sport-specific logic | **Nowhere.** It's a recipe — `guides/recipes/` |
| A build-time behavior change | `plugin/`, and `guides/reference/config-plugin.md` |
| A decision worth remembering | [`docs/adr/`](./adr/README.md) |

## Two implementations, one behavior

The condition evaluator and geometry exist twice — Swift and Kotlin. They must produce
identical output for identical input. Shared JSON fixtures drive both test suites; a
divergence is a bug even when each side looks correct alone. See [testing](./testing.md).

## What is deliberately absent

| | Why |
|---|---|
| Domain logic (reps, jumps, form) | Primitives, not policy |
| A web implementation | Declared platforms are `apple` and `android` only — no stubs |
| Bundled model files | [ADR 0002](./adr/0002-models-fetched-not-bundled.md) |
| VisionCamera dependency | [ADR 0001](./adr/0001-own-camera-not-visioncamera.md) — adapter arrives in 0.2.0 |
