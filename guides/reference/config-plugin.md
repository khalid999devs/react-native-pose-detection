# Config plugin

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

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `model` | `'lite' \| 'full' \| 'heavy'` | `'full'` | exactly one is installed |
| `cameraPermissionText` | `string` | generic | `NSCameraUsageDescription` |
| `cacheDir` | `string` | `~/.cache/react-native-pose-detection` | |
| `skipDownload` | `boolean` | `false` | CI where the model is vendored |

## What it does at prebuild

```text
1. resolve model → URL + SHA-256 from the manifest
2. cache hit?  → use it        cache miss? → download
3. verify SHA-256 (mismatch = hard failure, never a warning)
4. remove any previously installed .task from both native projects
5. copy → android/app/src/main/assets/
   copy → ios/<App>/Resources/  + register in the Xcode project
6. write camera permission into Info.plist and AndroidManifest.xml
```

Step 4 is why switching variants never leaves two models in the build.

## Model sizes

| Model | Adds to app | Best for |
|---|---|---|
| `lite` | ~5.5 MB | budget Android, high frame rates |
| `full` | ~9.0 MB | most apps |
| `heavy` | ~29.2 MB | accuracy-critical, flagships |

## Offline

A cache hit needs no network. A cache miss with no network fails with the URL and cache path
so you can place the file manually.

## CI

Cache `~/.cache/react-native-pose-detection` between runs to skip the download. On EAS,
prebuild runs inside the build container — the download happens there, once per build unless
you cache it.
