# Installation

**Android only so far.** The package ships no `ios/` sources and no podspec yet, so the iOS
steps below are what will apply once the iOS module lands, not something to run today. Nothing
about them is guesswork: the deployment target and the permission key are already fixed.

## Requirements

| | |
| --- | --- |
| React Native | 0.74+ |
| Expo SDK | 51+ (dev client or EAS Build) |
| iOS | 15.1+ |
| Android | API 24+ |
| Architecture | old and new both supported |

**Expo Go is not supported** and never will be. This package contains native code.

## Expo

```bash
npm i react-native-pose-detection
```

```json
{
  "expo": {
    "plugins": [
      ["react-native-pose-detection", {
        "model": "full",
        "cameraPermissionText": "We use the camera to analyse your movement."
      }]
    ]
  }
}
```

```bash
npx expo prebuild
npx expo run:ios       # or run:android
```

Full plugin options: [config plugin reference](./reference/config-plugin.md).

## Bare React Native

```bash
npm i react-native-pose-detection
npx react-native-pose-detection fetch-model full
cd ios && pod install   # once iOS ships
```

### iOS

`ios/<App>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>We use the camera to analyse your movement.</string>
```

`ios/Podfile`, deployment target 15.1 or higher:

```ruby
platform :ios, '15.1'
```

### Android

`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

`android/build.gradle`:

```groovy
minSdkVersion = 24
```

## Verify

```bash
npx react-native-pose-detection doctor
```

## EAS Build

Works with no extra configuration, prebuild runs in the build container and the plugin fetches
the model there. Cache `~/.cache/react-native-pose-detection` to skip the download between builds.

## Android release builds

**Ship an AAB.** MediaPipe ships four ABI slices and a universal APK carries all of them:
10.5 MB for `arm64-v8a`, 7.4 MB for `armeabi-v7a`, 15.0 MB for `x86` and 13.0 MB for `x86_64`,
45.9 MB of native library against the 10.5 MB a phone actually loads. Measured from an
assembled APK on the pinned MediaPipe 0.10.35, see
[ADR 0007](../docs/adr/0007-pin-mediapipe-0-10-35.md).

If you must ship an APK, filter it in your **release** build only:

```groovy
android {
  defaultConfig {
    ndk { abiFilters "arm64-v8a" }
  }
}
```

Leave debug builds alone. Dropping `x86_64` there is what breaks the standard Android Studio
emulator on an Intel, Windows or Linux host.
