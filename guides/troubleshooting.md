# Troubleshooting

## The app dies the moment the camera opens, in a simulator

It is not your code. MediaPipe converts each frame to a tensor through Metal, and on a simulator
that conversion fails inside an `absl` check, which calls `abort()`. The process is gone before
anything can catch it, and because it happens on the first camera frame rather than at setup, every
step before it looks like it worked.

**This package forces the CPU delegate in a simulator**, so it should not reach you. If you see it
anyway, check that `delegate` is not pinned to `'gpu'` by something in your own build, and look for
`the simulator has no usable GPU for MediaPipe` on the `detector` log channel, which is printed
whenever the request is overridden.

Nothing is lost by it: a simulator has no real GPU to measure, so a GPU reading there could never
have told you anything true about a phone.

## "Native module not found" / blank screen in Expo Go

**Expo Go cannot run this package.** It contains native code. Build a development build:

```bash
npx expo prebuild && npx expo run:ios     # or run:android
```

## `MODEL_NOT_FOUND`

The plugin didn't run or prebuild didn't happen.

```bash
npx expo prebuild --clean
```

Bare RN:

```bash
npx react-native-pose-detection fetch-model full
```

Verify it landed:

```text
android/app/src/main/assets/pose_landmarker_*.task
ios/<YourApp>/Resources/pose_landmarker_*.task
```

## `PERMISSION_DENIED`

Expo: set `cameraPermissionText` in the plugin config and re-run prebuild.
Bare: add `NSCameraUsageDescription` (iOS) and `android.permission.CAMERA` (Android) yourself.

## `GPU_UNAVAILABLE` (non-fatal)

Not a bug. The device's GPU delegate failed and it fell back to CPU. Expect lower frame rates.
Check `onReady`'s `delegate` field to confirm which one is running.

## `UnsatisfiedLinkError` on an emulator

This package pins MediaPipe **0.10.35**, which ships all four ABIs including `x86_64`. If you
have overridden the version down to `0.10.21`, that is the cause: 0.10.21 ships `arm64-v8a`,
`armeabi-v7a` and 32-bit `x86` and **no `x86_64`**, so on an Intel host the package manager picks
`x86_64` as the primary ABI and never extracts MediaPipe's library at all. It fails when the
landmarker is constructed. Undo the override, see
[ADR 0007](../docs/adr/0007-pin-mediapipe-0-10-35.md).

The other way to cause it is `abiFilters` on a debug build. Filter release builds only.

On Apple Silicon, use an arm64 emulator image, which is what Android Studio gives you by default.

## iOS build fails

**`Unable to find a specification for ExpoModulesCore`** almost always means the deployment
target, not the dependency. Expo SDK 57 requires iOS 16.4, and autolinking silently skips every
Expo pod in an app that targets lower, so the first thing to fail is the one that resolves this
package. Raise `platform :ios` in the Podfile and `IPHONEOS_DEPLOYMENT_TARGET` in the project to
`16.4`. The podspec itself declares 15.1, which is this package's own floor; Expo raises it during
`pod install` and prints that it did.

**A Swift compile error inside `expo-modules-jsi` or `expo-modules-core`** is a toolchain that is
too old, not anything in this package. Expo SDK 57 ships `ExpoModulesCore` precompiled with Swift
6.3.1, and an older compiler rejects it; the errors it produces while falling back to Expo's
sources (`abs` ambiguous under C++ interop, `sending 'emitter' risks causing data races`) name the
symptom rather than the cause. Xcode 26.6 or newer builds it.

Check which Xcode is actually selected before concluding anything: `xcode-select -p` can point at
an old copy while a current one sits in `/Applications`. `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
overrides it for one command, and `sudo xcode-select -s /Applications/Xcode.app` makes it the default.

**`Unable to find a destination matching the provided destination specifier`** means the iOS
platform is not installed, which is separate from the SDK and is the one thing `xcodebuild
-showsdks` will happily list as present while builds fail. `xcodebuild -downloadPlatform iOS`
installs it, about 8.5 GB.

The MediaPipe pin is settled: `MediaPipeTasksVision 0.10.35`, the same version Android uses, and
it resolves from CocoaPods trunk. See [ADR 0007](../docs/adr/0007-pin-mediapipe-0-10-35.md).

## `minSdkVersion` error on Android

MediaPipe requires **API 24+**. In `android/build.gradle`:

```groovy
minSdkVersion = 24
```

## App size much larger than documented

You're shipping a universal APK. It carries all four MediaPipe ABI slices, 45.9 MB of native
library where a phone loads 10.5 MB of it. Ship an AAB, or set this on the release build only:

```groovy
ndk { abiFilters "arm64-v8a" }
```

## Landmarks mirrored or rotated wrong

- **Mirrored:** front-camera landmark `x` is un-mirrored by default so coordinates match the
  real world, not the preview. The overlay compensates automatically.
- **Rotated on Android:** usually a missed `targetRotation` update. File an issue with your
  device model and orientation config.

## Frame rate lower than expected

Check `await getProfile()` first: `phase` tells you whether calibration has settled, and
`p50InferenceMs` is the cost the rate was derived from. Under `profile="auto"` a low number **is**
the calibrated answer: the governor already runs the highest rate that cost sustains, so a low
rate means expensive inference, not a stuck setting. What you can change:

- the model variant, which is a **build-time** choice and not a prop. Set `"model": "lite"` in
  the plugin config and re-run `npx expo prebuild`, or run
  `npx react-native-pose-detection fetch-model lite` on bare RN. See the
  [config plugin reference](./reference/config-plugin.md)
- `analysisResolution`, which is what the model actually sees
- check `onReady`'s `delegate`: on CPU, a lower frame rate is expected

## Triggers fire twice / not at all

Firing twice per rep usually means `enter` and `exit` thresholds sit too close together: widen
the gap and add `debounceMs`. Never firing usually means the joint the condition reads is not
visible; gate on `{ visibility: joint, above: 0.6 }` to see. The tuning table in
[what you can build](./recipes.md) covers the rest. A malformed config never fails silently: it throws
at validation with the path to the problem.

## Memory grows over time

The usual cause is retained frames. `frame.landmarks` is a view into the buffer a drain
returned, so keeping one frame keeps the whole batch alive. Copy with `.slice()` if you retain,
see [data delivery](./data-delivery.md#retaining-frames).

Otherwise report it. Include `getState()` output, `data.mode`, `maxPoses`, and what your
`onPose` or `onPoseBatch` handler keeps.

## Watching it work: the log channel

The library ships a diagnostic channel that is **completely off by default** and costs nothing
until you turn it on. Entries reach Logcat on Android and `os.Logger` on iOS whatever is
attached, so `adb logcat` and Console.app work with no listener, and are batched to JavaScript
roughly every 250 ms while one is.

```ts
import { setLogLevel, addLogListener } from 'react-native-pose-detection';

setLogLevel('debug');

const sub = addLogListener((entries) => {
  entries.forEach((e) => console.log(`[${e.category}] ${e.message}`));
});

// later
sub.remove();
setLogLevel('off');
```

Or scoped to one camera with the `logLevel` prop and `onLog` callback. An unknown level or
category **throws** `PoseConfigError` rather than doing nothing quietly: a level that silently
failed to apply looks exactly like the bug you were trying to diagnose.

| Level | Shows |
| --- | --- |
| `off` *(default)* | nothing |
| `error` | failures |
| `warn` | degraded but running: GPU fallback, dropped frames |
| `info` | lifecycle: camera opened, model loaded, calibration settled |
| `debug` | state transitions: camera switch phases, trigger phases, thermal steps |
| `trace` | per-frame timings. Very noisy. |

Turn up only what you are investigating, per category:

```ts
setLogLevel({ triggers: 'trace', camera: 'debug', engine: 'off' });
```

Categories: `camera` · `detector` · `engine` · `triggers` · `calibration` · `overlay`.
`LOG_LEVELS` and `LOG_CATEGORIES` are exported if you are building a level picker.

| Problem | Category | Level |
| --- | --- | --- |
| Trigger fires twice, or never | `triggers` | `trace` |
| Frame rate lower than expected | `calibration` | `debug` |
| Crash or freeze on camera switch | `camera` | `debug` |
| Model won't load | `detector` | `info` |
| Overlay misaligned | `overlay` | `debug` |
| Phone gets hot | `calibration` | `debug` |

Entries arrive **batched**, an array every ~250 ms rather than one call per line. If your
listener cannot keep up, the oldest entries are dropped rather than growing memory, and the next
batch opens with a `warn` entry carrying the count. `LogEntry.timestamp` uses the same monotonic
clock as `PoseFrame.timestamp`, so a log line can be matched to the exact frame that produced
it.

In production leave it `off`. While off the cost is a single integer comparison: no strings are
built and nothing crosses to JavaScript.

## Before filing a bug

```ts
setLogLevel('debug');
console.log(cam.current.getState());
console.log(await cam.current.getProfile());
```

Include both outputs, the log entries around the failure, your device model and OS version.
`getProfile()` carries the useful half: the resolved delegate, the rate, the resolutions, and
the measured inference cost the governor derived them from.
