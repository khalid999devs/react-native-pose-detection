# CLI

For bare React Native, where there's no config plugin.

```bash
npx react-native-pose-detection <command>
```

## `fetch-model <variant>`

```bash
npx react-native-pose-detection fetch-model full
```

Downloads, verifies, and installs into both native projects. Same steps as the config plugin,
including removing any previously installed model.

| Flag | Notes |
| --- | --- |
| `--force` | re-download even on a cache hit |
| `--cache-dir <path>` | override the cache location |
| `--ios-only` / `--android-only` | install into one platform |

```text
› model "full" not in cache
› downloading pose_landmarker_full.task (9.0 MB)…
› sha256 ✓
› copied → android/app/src/main/assets/pose_landmarker_full.task
› copied → ios/MyApp/Resources/pose_landmarker_full.task
› registered → ios/MyApp.xcodeproj/project.pbxproj
```

On iOS the file is also added to your app target, so it ends up in the bundle without a trip
through Xcode. Switching variants unregisters the old one in the same pass.

That step needs `expo` to be resolvable, which it is in any project using this package, since
Expo Modules are how the native code is linked. If it somehow isn't, the file is still copied
and you get a one-line instruction instead.

## `doctor`

```bash
npx react-native-pose-detection doctor
```

Checks the things that actually break:

```text
✓ model installed             android/app/src/main/assets/pose_landmarker_full.task
✓ SHA-256 matches manifest    pose_landmarker_full.task
✓ model installed             ios/MyApp/Resources/pose_landmarker_full.task
✓ SHA-256 matches manifest    pose_landmarker_full.task
– minSdkVersion 24            resolved by the Expo Gradle plugin, not readable from the project
✓ iOS deployment target 15.1  found 16.4
✓ android.permission.CAMERA   AndroidManifest.xml
✗ NSCameraUsageDescription    missing from Info.plist
```

| Mark | Meaning |
| --- | --- |
| `✓` | checked and correct |
| `✗` | checked and wrong. Exits `1` |
| `–` | could not be checked. **Not** a failure |

The `–` state matters. An Expo prebuild resolves `minSdkVersion` inside a Gradle plugin, so no
file in the project holds the number. Reporting that as a failure would train you to ignore the
output, which is worse than not checking it. Bare React Native writes the value into
`android/build.gradle`, and it gets checked there.

Two models in one directory is a `✗`. That's the failure this command exists to catch, because
which one wins at load time is not something your app gets to decide.

Run it first when reporting a setup bug.

## `clear-cache`

```bash
npx react-native-pose-detection clear-cache
```

Takes `--cache-dir` too. The next `fetch-model` or prebuild downloads again.
