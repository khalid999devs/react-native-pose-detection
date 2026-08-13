# Example apps

**Both apps exist and build for Android, and the Expo app has every screen below.** It is what
first compiled the Kotlin and produced an APK; the bare app is what first ran the Xcode project
writer against a real `project.pbxproj`. Nothing here has run on a physical device, which is the
one thing the Scenarios screen exists to make worth doing.

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

The CI matrix in [testing](../docs/testing.md#ci-matrix) builds both, on both platforms: four
cells, `android-expo`, `android-bare`, `ios-expo` and `ios-bare`. The architecture axis it was
drawn for collapsed on its own, because React Native 0.82 removed the legacy architecture.

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

**`expo/` is the one with all the screens.** The bare app is deliberately small: the camera, an
install readout, and two teardown loops. Duplicating twelve screens across two apps would mean
every UI change lands twice, and the second copy would rot. What the bare app has to prove is
that install and teardown work, not that the UI does, so it runs the switch and remount loops
and leaves the other nine to `expo/`.

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
| **Overlay** | Colors, line width, joint subset, and angle arcs, on their own |
| **Console** | Live log stream with level and category filters |
| **Scenarios** | The stress and reset panel: see below |

## Playground controls

Every prop, live, with the resolved value shown next to the requested one:

| Group | Controls |
| --- | --- |
| Model | variant (read-only: build time), `maxPoses` |
| Performance | `profile`, `delegate`, `targetFps`, `resolution`, `analysisResolution`, `thermalPolicy` |
| Camera | `facing`, `active`, switch button |
| Detection | `detection`, `smoothing` (+ `minCutoff`/`beta` steppers) |
| Overlay | `overlay` on/off, landmarks, connections, color, `lineWidth`, `pointRadius`, `minVisibility`, `only[]`, `angles[]` |
| Data | `mode`, `throttleMs`, `flushMs`, `landmarks`, `worldLandmarks`, `angles`, `select[]` |
| Logging | `logLevel`. Per-category levels are on Console, next to the stream they filter |

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
| Pause / resume ×30 | The session releases and restores without a full teardown |
| Soak 10 minutes | The memory budget in `guides/performance.md`, and that FPS holds |
| Reset trigger counters | Counters restart without remounting |
| Reset everything | Full state reset in one tap |

Every run is awaited on a real signal rather than a timer: `switchCamera()` resolves once the
session is stable again, and a remount waits for the next `onReady`. That is what makes a
hundred switches a stress test rather than a hundred sleeps.

Counters restart by changing the trigger's `id`, because counts are keyed by id and survive a
props update deliberately. There is no reset call, and adding one would undermine the guarantee.

### Driven from outside

Four of the original ten are not buttons, because no process can put itself into a thermal state,
send itself a memory warning, or clear its own preferences for the next launch. The panel prints
the host command for the platform it is running on and then watches for what it should have
caused.

| Action | Android | iOS |
| --- | --- | --- |
| Force thermal state | `adb shell cmd thermalservice override-status 3` | Xcode · Devices and Simulators |
| Simulate memory warning | `adb shell am send-trim-memory <pkg> RUNNING_CRITICAL` | Simulator · Features |
| Clear calibration cache | `adb shell pm clear <pkg>` | Delete and reinstall |
| Background / foreground | Home, wait 10 s, reopen | Home, wait 10 s, reopen |

### On the memory columns

Each report shows the JavaScript heap before and after, and that is **not** where a leak in this
package would be. The camera's buffers, MediaPipe's arena and the overlay's layers are all
native. Run these with Android Studio's profiler or Instruments attached; the iteration counts
are chosen to make a per-cycle leak visible on that graph, not to be self-reporting.

## Structure

```text
example/
├── expo/
│   ├── App.tsx
│   ├── app.json              plugin configured with model: "full"
│   └── src/
│       ├── screens/          one file per screen above
│       ├── components/       controls: steppers, toggles, pickers, chips, stat tiles
│       ├── scenarios/        stress runners, each returning a pass/fail report
│       ├── theme.ts          colors and the monospace family, in one place
│       ├── useSession.ts     what the camera resolved, merged from two events and one poll
│       ├── lastSession.ts    so Home can show a device summary without mounting a camera
│       └── memory.ts         the JS heap when the runtime offers it, and null when it does not
├── bare/
│   ├── App.tsx               one file: camera, controls, teardown loops, install readout
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
cd ios && pod install && cd ..
npx react-native run-android      # or run-ios
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
