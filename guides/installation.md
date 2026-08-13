# Installation

**Not published to npm yet.** Both platforms are complete, and the steps below are what
installing it looks like once it is.

## Requirements

| | |
| --- | --- |
| React Native | 0.74+ |
| Expo SDK | 51+ (dev client or EAS Build) |
| iOS | 15.1+, and 16.4+ on Expo SDK 57, which is what `ExpoModulesCore` requires |
| Android | API 24+ |
| Architecture | new. React Native 0.82 removed the legacy one, so there is nothing to choose |

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
npm i react-native-pose-detection expo
npx react-native-pose-detection fetch-model full
cd ios && pod install
```

`expo` is not a typo and it does not turn your app into an Expo app. This package is built with
the Expo Modules API, and that API's autolinking is what finds the native module. You need the
`expo` package for autolinking. You do not need the config plugin, `app.json`, or prebuild.

### Wiring Expo modules into an existing app

The documented tool for this is `npx install-expo-modules@latest`, and on a recent React Native
it will not run: version 0.16.0 knows Expo SDK 53 and React Native 0.78 at the newest, and stops
with `Unable to find compatible Expo SDK version`. Until it catches up, the four edits are below.
A working copy of all of them is [`example/bare`](../example/bare), which CI builds on every push.

`android/settings.gradle`, above `include ':app'`:

```groovy
pluginManagement {
  def expoPluginsPath = new File(
    providers.exec {
      workingDir(rootDir)
      commandLine("node", "--print", "require.resolve('expo-modules-autolinking/package.json', { paths: [require.resolve('expo/package.json')] })")
    }.standardOutput.asText.get().trim(),
    "../android/expo-gradle-plugin"
  ).absolutePath
  includeBuild(expoPluginsPath)
}

plugins { id("expo-autolinking-settings") }

extensions.configure(com.facebook.react.ReactSettingsExtension) { ex ->
  ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)
}
expoAutolinking.useExpoModules()
expoAutolinking.useExpoVersionCatalog()
```

`android/build.gradle`, next to the React Native line:

```groovy
apply plugin: "expo-root-project"
```

`MainApplication.kt`, so Expo modules are registered with the host:

```kotlin
import expo.modules.ExpoReactHostFactory

override val reactHost: ReactHost by lazy {
  ExpoReactHostFactory.getDefaultReactHost(applicationContext, PackageList(this).packages)
}
```

`MainActivity.kt`, so Expo modules see the activity callbacks:

```kotlin
import expo.modules.ReactActivityDelegateWrapper

override fun createReactActivityDelegate(): ReactActivityDelegate =
    ReactActivityDelegateWrapper(
        this,
        BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled),
    )
```

### iOS

`ios/<App>/Info.plist`. There is no manifest merging on iOS, so this key has to be yours:

```xml
<key>NSCameraUsageDescription</key>
<string>We use the camera to analyse your movement.</string>
```

`ios/Podfile`, deployment target 15.1 or higher. On Expo SDK 57 it has to be 16.4, because that
is what `ExpoModulesCore` requires and Expo's autolinking silently skips every one of its pods on
an app that targets lower, which surfaces as CocoaPods failing to find `ExpoModulesCore`:

```ruby
platform :ios, '16.4'
```

A bare app also needs Expo's autolinking in its `Podfile`, the counterpart of
`expo-autolinking-settings` in `settings.gradle`. `install-expo-modules` writes it for you on
React Native 0.78 and below; above that, add it by hand:

```ruby
require File.join(
  File.dirname(`node --print "require.resolve('expo/package.json', { paths: [process.cwd()] })"`),
  "scripts/autolinking"
)

target 'YourApp' do
  use_expo_modules!
  # ...
end
```

### Android

`android/build.gradle`:

```groovy
minSdkVersion = 24
```

The camera permission is **already declared** in this package's manifest and the merger adds it
to your app. Declaring it again is fine, and worth doing so your own manifest tells the truth
about what the app uses:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Granting it at runtime is still yours to do. The native view reports `PERMISSION_DENIED` and
stops rather than prompting, because when to ask is a product decision.

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
