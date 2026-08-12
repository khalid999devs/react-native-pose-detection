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
| --- | --- | --- | --- |
| `model` | `'lite' \| 'full' \| 'heavy'` | `'full'` | exactly one is installed |
| `cameraPermissionText` | `string` | generic | `NSCameraUsageDescription` |
| `cacheDir` | `string` | `~/.cache/react-native-pose-detection` | |
| `skipDownload` | `boolean` | `false` | CI where the model is vendored |

## What it does at prebuild

```text
1. resolve model → URL + SHA-256 from the manifest
2. cache hit?  → verify it        cache miss? → download
3. verify SHA-256 (mismatch = hard failure, never a warning)
4. remove any previously installed .task from both native projects
5. copy → android/app/src/main/assets/
   copy → ios/<App>/Resources/  + register in the Xcode project
6. write camera permission into Info.plist and AndroidManifest.xml
```

Step 4 is why switching variants never leaves two models in the build. It removes **every**
model file it finds, not just the variant you were using before, so a rename or a hand-copied
file gets cleaned up too. On iOS that includes unregistering the old file from the app target.

The Android and iOS passes run in the same process and share one download, so a cold cache
fetches the file once, not twice.

### Downloading

Downloads land in a `.part` file next to the target and are only renamed into place after the
checksum matches. An interrupted prebuild leaves a partial file rather than a short one that
looks complete, and the next run resumes it with a range request instead of starting over.

A cached file is re-verified on every prebuild, not trusted because it exists. That costs a few
milliseconds and catches a cache damaged by a full disk or an interrupted copy. If a cached file
fails, it is deleted and fetched again; the fresh copy still has to verify or the build fails.
See [ADR 0006](../../docs/adr/0006-checksums-are-fatal-except-in-the-cache.md).

## Model sizes

| Model | Adds to app | Best for |
| --- | --- | --- |
| `lite` | ~5.5 MB | budget Android, high frame rates |
| `full` | ~9.0 MB | most apps |
| `heavy` | ~29.2 MB | accuracy-critical, flagships |

## Offline

A cache hit needs no network. A cache miss with no network fails with the URL and cache path
so you can place the file manually.

`skipDownload: true` never touches the network at all. On a cache hit it installs as usual; on
a cache miss it prints a warning and leaves both native projects exactly as they were, so a
vendored model already committed to your repo is not deleted by a build that cannot reach the
CDN.

## CI

Cache `~/.cache/react-native-pose-detection` between runs to skip the download. On EAS,
prebuild runs inside the build container. The download happens there, once per build unless
you cache it.

Progress output is suppressed when `CI` is set or stdout is not a terminal, so a build log gets
three lines instead of a few thousand carriage returns.
