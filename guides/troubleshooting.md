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

## Crash or freeze on x86 emulator

MediaPipe `0.10.26+` ships **arm64-v8a only**. This package pins `0.10.21`, which includes
x86 — if you've overridden the version, that's why. Use an arm64 emulator image on Apple Silicon.

## iOS build fails linking MediaPipe

MediaPipe `0.10.33+` has [XCFramework/CocoaPods linking issues](https://github.com/google-ai-edge/mediapipe/issues/6258).
This package pins `0.10.21`. Don't override it.

If you use `use_frameworks!`, add:

```ruby
pod 'ReactNativePoseDetection', :modular_headers => true
```

## `minSdkVersion` error on Android

MediaPipe requires **API 24+**. In `android/build.gradle`:

```groovy
minSdkVersion = 24
```

## App size much larger than documented

You're shipping a universal APK. It bundles all three ABIs — 40.3 MB of native libraries
instead of 12.4 MB. Ship an AAB, or set:

```groovy
ndk { abiFilters "arm64-v8a" }
```

## Landmarks mirrored or rotated wrong

- **Mirrored:** front-camera landmark `x` is un-mirrored by default so coordinates match the
  real world, not the preview. The overlay compensates automatically.
- **Rotated on Android:** usually a missed `targetRotation` update. File an issue with your
  device model and orientation config.

## Frame rate lower than expected

Check what calibration actually settled on:

```ts
cam.current.getProfile();
```

If `tier` is `low` or the thermal state is elevated, that's the ladder working. Try
`model: 'lite'`, or pin `profile="quality"` to override — subject to the thermal ladder.

## Triggers fire twice / not at all

See the tuning table in [recipes.md](./recipes/README.md).

## Memory grows over time

Should not happen — report it. Include `getProfile()` output, `data.mode`, `maxPoses`,
and whether `onPoseBatch` consumers might be retaining frames.
