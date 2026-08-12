# CLI

For bare React Native, where there's no config plugin.

```bash
npx react-native-pose-detection <command>
```

It runs on Node 22.22.1 or newer, the same floor the package declares in `engines`. It has no
dependencies of its own, so `npx` fetches nothing beyond the package you already installed.

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
✓ model in the app target     pose_landmarker_full.task is a build resource
– minSdkVersion 24            resolved by the Expo Gradle plugin, not readable from the project
✓ iOS deployment target 15.1  found 16.4
✓ android.permission.CAMERA   AndroidManifest.xml
✗ NSCameraUsageDescription    missing from Info.plist
1 of 9 checks failed
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

`model in the app target` is the second one worth knowing about. A `.task` sitting in
`ios/<App>/Resources` that no target builds is never copied into the bundle, and the app fails at
runtime with `MODEL_NOT_FOUND` even though the file is plainly there. `fetch-model` produces
exactly that state on purpose when `expo/config-plugins` cannot be resolved, so it has to be
checked rather than assumed.

`doctor` takes no flags and no arguments, and says so rather than ignoring one. `doctor
--cache-dir /tmp/x` reads as a request the tool honors, and it never was one.

Run it first when reporting a setup bug.

## `clear-cache`

```bash
npx react-native-pose-detection clear-cache
```

Takes `--cache-dir` too. The next `fetch-model` or prebuild downloads again.

It clears the whole cache, every variant, plus the `.part` and `.lock` sidecars the downloader
leaves. A lock another process is currently holding is left alone, because deleting it would let
a second download start into the same path. It takes no variant argument: `clear-cache full`
reads as clearing one model and it never did that, so it is an error rather than a surprise.
