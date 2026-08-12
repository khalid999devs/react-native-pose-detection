# Installation

## Requirements

| | |
|---|---|
| React Native | 0.74+ |
| Expo SDK | 51+ (dev client or EAS Build) |
| iOS | 15.1+ |
| Android | API 24+ |
| Architecture | old and new both supported |

**Expo Go is not supported** and never will be — this package contains native code.

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

Full plugin options: [config plugin reference](.reference/config-plugin.md).

## Bare React Native

```bash
npm i react-native-pose-detection
npx react-native-pose-detection fetch-model full
cd ios && pod install
```

### iOS

`ios/<App>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>We use the camera to analyse your movement.</string>
```

`ios/Podfile` — deployment target 15.1 or higher:

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

Works with no extra configuration — prebuild runs in the build container and the plugin fetches
the model there. Cache `~/.cache/react-native-pose-detection` to skip the download between builds.

## Android release builds

**Ship an AAB.** A universal APK bundles arm64 + armeabi-v7a + x86 — 40.3 MB of native
libraries instead of 12.4 MB. If you must ship an APK:

```groovy
android {
  defaultConfig {
    ndk { abiFilters "arm64-v8a" }
  }
}
```
