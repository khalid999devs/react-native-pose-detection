# Example apps

**Both apps exist and build for Android.** The Expo app is what first compiled the Kotlin and
produced an APK; the bare app is what first ran the Xcode project writer against a real
`project.pbxproj`. Both are short of the specification below, because most of the screens need an
engine that is not written yet. Nothing here has run on a physical device.

Real applications, not smoke tests. They are the **reference implementation**, the manual QA
harness, and the demo. And they are never published to npm.

Excluded from the tarball via `files` in `packages/core/package.json`, so they can be as large
and as well built as they need to be.

## Two apps, not one

```text
example/
├── expo/    Expo app, installed through the config plugin
└── bare/    bare React Native app, installed through the CLI
```

**Both are required.** They exercise the two install paths, and those paths share almost no
code. The Expo app proves `npx expo prebuild` puts the model in place, writes the permissions,
and registers the resource in the Xcode target. The bare app proves
`npx react-native-pose-detection fetch-model` does the same thing without any of Expo's config
machinery, and that autolinking finds the module without a plugin.

A bug that only appears in one of them is the common case, not the rare one: the plugin runs at
prebuild and the CLI runs on a project that already exists, so they touch the native projects at
different moments and in different states.

The CI matrix in [testing](../docs/testing.md#ci-matrix) is what will build both, on both
platforms and both architectures. It is reserved by a comment at the end of
`.github/workflows/ci.yml` and cannot be wired up before these two apps exist, because they are
what it would build.

### What the bare app found

Two things, both invisible from the Expo side:

1. **A bare app needs Expo modules wired in by hand.** This package is an Expo module, so the
   `expo` package has to be installed and its Gradle autolinking hooked up, and the tool that is
   supposed to do that (`npx install-expo-modules`) supports React Native 0.78 at the newest.
   The [installation guide](../guides/installation.md#bare-react-native) now carries the four
   edits, and this app is the working copy of them.
2. **`doctor` failed a project that was correct.** It reported the camera permission as missing
   from the app manifest, when this package declares that permission itself and the Android
   manifest merger adds it. It now says where the permission came from instead of failing.

**`expo/` is the one with all the screens.** The bare app is deliberately small: the basic
camera, the scenarios panel, and a doctor readout. Duplicating eleven screens across two apps
would mean every UI change lands twice, and the second copy would rot. What the bare app has to
prove is that install and teardown work, not that the UI does.

## Goals

1. **Show every capability** with real UI, not a wall of debug text
2. **Exercise every prop** so regressions surface manually before CI catches them
3. **Reproduce hard scenarios on demand**, camera switching, thermal, memory, remount
4. **Be worth screenshotting**. This is what people see before they install

## Screens

| Screen | Purpose |
| --- | --- |
| **Home** | Navigation, device summary, resolved profile at a glance |
| **Basic** | The 5-line example from the README, nothing else. Proves the happy path. |
| **Playground** | Every prop with a live control. Change anything without a rebuild. |
| **Triggers** | Build and edit triggers live; fired events stream into a list |
| **Data modes** | Switch `off`/`throttled`/`batched`/`live`; shows measured crossings/sec |
| **Performance** | Live FPS, p50 inference, delegate, tier, thermal state, calibration phase, memory |
| **Recipes** | Squat, push-up, jump, plank running for real with rep counts |
| **Angles** | Angle overlay demo: pick joints, see arcs and degree labels |
| **Static input** | Pick an image or video from the library and run detection on it |
| **Console** | Live log stream with level and category filters |
| **Scenarios** | The stress and reset panel: see below |

## Playground controls

Every prop, live, with the resolved value shown next to the requested one:

| Group | Controls |
| --- | --- |
| Model | variant (read-only: build time), `maxPoses` |
| Performance | `profile`, `delegate`, `targetFps`, `resolution`, `analysisResolution`, `thermalPolicy` |
| Camera | `facing`, `active`, switch button |
| Detection | `detection`, `smoothing` (+ `minCutoff`/`beta` sliders) |
| Overlay | `overlay` on/off, landmarks, connections, color, `lineWidth`, `pointRadius`, `minVisibility`, `only[]`, `angles[]` |
| Data | `mode`, `throttleMs`, `flushMs`, `landmarks`, `worldLandmarks`, `angles`, `select[]` |
| Logging | level per category |

Showing **requested vs resolved** side by side is the point. It makes auto-calibration and
the thermal ladder visible instead of mysterious.

## Scenarios panel

The reset and stress toggles. Each one reproduces a failure mode that has actually happened.

| Action | Verifies |
| --- | --- |
| Switch camera ×100 rapidly | No crash, no leak, trigger counters preserved |
| Remount component ×50 | Memory returns to baseline |
| Stop / start detection ×20 | GPU resources released and reacquired |
| Toggle overlay ×50 | No layer leaks |
| Background / foreground | Session released and restored, calibration retained |
| Clear calibration cache | Next launch re-probes from scratch |
| Force thermal state | Each ladder step fires and recovers |
| Simulate memory warning | Cleanup path runs without tearing down the detector |
| Reset trigger counters | Counters zero without remounting |
| Reset everything | Full state reset in one tap |

Each stress action reports pass/fail with before/after memory, so a regression is obvious on
a device without attaching a profiler.

## Structure

```text
example/
├── expo/
│   ├── App.tsx
│   ├── app.json              plugin configured with model: "full"
│   └── src/
│       ├── screens/          one file per screen above
│       ├── components/       controls: sliders, toggles, pickers, stat tiles
│       ├── scenarios/        stress runners, each returning a pass/fail report
│       └── theme/            shared UI so screens stay short
├── bare/
│   ├── App.tsx               one file: camera, controls, and how the model got installed
│   └── ios/ · android/       committed, because a bare app has no prebuild step
└── README.md
```

Keep the pose-related code in each screen short and obvious, someone reading `Basic.tsx`
should see the library's API, not the app's UI framework.

`bare/ios` and `bare/android` are committed. That is the point of a bare app: there is no
prebuild to regenerate them, so the CLI has to work against native projects that already exist,
which is exactly the case the config plugin never sees.

## Running

```bash
npm install
npm run build                 # build the package first
```

Expo:

```bash
cd example/expo
npx expo prebuild
npx expo run:ios              # or run:android
```

Bare React Native:

```bash
cd example/bare
npx react-native-pose-detection fetch-model full
npx react-native-pose-detection doctor
cd ios && pod install && cd ..   # once iOS ships
npx react-native run-android
```

The model is gitignored, so `fetch-model` is the first step on a fresh clone. `doctor` should
print nine ticks; anything else is a bug in the CLI or in this app, and both are ours.

A **physical device is required** for both. Simulators have no camera and the GPU delegate
behaves differently on them.

## When to update it

Adding a prop, event, or trigger condition means adding a control for it in `expo/` in the same
PR. A feature with no way to exercise it in the example app is a feature nobody will find.

`bare/` only changes when the install path does: a new CLI flag, a change to what gets copied
where, a new native permission. Feature work does not touch it.
