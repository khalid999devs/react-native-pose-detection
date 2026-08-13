# Troubleshooting

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

**A Swift compile error inside `expo-modules-jsi` or `expo-modules-core`** is a toolchain
mismatch rather than anything in this package. Expo SDK 57 does not compile on Xcode 26.3: `abs`
becomes ambiguous under C++ interop in one and `sending 'emitter' risks causing data races` in the
other. Use an Xcode that the SDK supports.

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
`p50InferenceMs` against `1000 / targetFps` tells you whether it has anywhere left to go. What
else you can change:

- the model variant, which is a **build-time** choice and not a prop. Set `"model": "lite"` in
  the plugin config and re-run `npx expo prebuild`, or run
  `npx react-native-pose-detection fetch-model lite` on bare RN. See the
  [config plugin reference](./reference/config-plugin.md)
- `analysisResolution`, which is what the model actually sees
- check `onReady`'s `delegate`: on CPU, a lower frame rate is expected

## Triggers fire twice / not at all

Not at all is expected right now: the native trigger evaluator is not built, so no trigger fires
on any device. Configs are still validated, and a bad one throws with the path to the problem.

Once it lands, see the tuning table in [recipes.md](./recipes/README.md).

## Memory grows over time

The usual cause is retained frames. `frame.landmarks` is a view into the buffer a drain
returned, so keeping one frame keeps the whole batch alive. Copy with `.slice()` if you retain,
see [data delivery](./data-delivery.md#retaining-frames).

Otherwise report it. Include `getState()` output, `data.mode`, `maxPoses`, and what your
`onPose` or `onPoseBatch` handler keeps.
