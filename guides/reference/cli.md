# CLI

For bare React Native, where there's no config plugin.

```bash
npx react-native-pose-detection <command>
```

## `fetch-model <variant>`

```bash
npx react-native-pose-detection fetch-model full
```

Downloads, verifies, and installs into both native projects. Same steps as the config plugin —
including removing any previously installed model.

| Flag | Notes |
|---|---|
| `--force` | re-download even on a cache hit |
| `--cache-dir <path>` | override the cache location |
| `--ios-only` / `--android-only` | install into one platform |

## `doctor`

```bash
npx react-native-pose-detection doctor
```

Checks the things that actually break:

```text
✓ model installed          android/app/src/main/assets/pose_landmarker_full.task
✓ model installed          ios/MyApp/Resources/pose_landmarker_full.task
✓ SHA-256 matches manifest
✓ minSdkVersion 24
✓ iOS deployment target 15.1
✗ NSCameraUsageDescription missing from Info.plist
```

Run it first when reporting a setup bug.

## `clear-cache`

```bash
npx react-native-pose-detection clear-cache
```
