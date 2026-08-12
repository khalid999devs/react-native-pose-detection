# Getting Started

**Android only so far, and pre-1.0.** The camera, the native overlay and camera switching run
today. Triggers, frame delivery to JavaScript, calibration and the thermal ladder are typed and
decoded in JavaScript but have no Kotlin behind them yet, so the sections below marked *not
built yet* describe what you will be able to call, not what fires today. iOS has not started.

## Requirements

| | |
| --- | --- |
| React Native | 0.74+ |
| Expo SDK | 51+ (dev client or EAS Build) |
| iOS | 15.1+ |
| Android | API 24+ |
| Architecture | old and new both supported |

**Expo Go is not supported** and never will be. This package contains native code.
Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

## Install

```bash
npm i react-native-pose-detection
```

### Expo

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
```

The plugin downloads the selected model, verifies its checksum, caches it, and copies it into
both native projects. Nothing is committed to your repo.

```text
› model "full" not in cache
› downloading pose_landmarker_full.task (9.0 MB)…
› sha256 ✓
› copied → android/app/src/main/assets/
› copied → ios/YourApp/Resources/
```

### Bare React Native

```bash
npx react-native-pose-detection fetch-model full
cd ios && pod install
```

Then add camera permissions manually, `NSCameraUsageDescription` in `Info.plist`,
`android.permission.CAMERA` in `AndroidManifest.xml`.

## Choosing a model

| Model | App size added | Best for |
| --- | --- | --- |
| `lite` | ~5.5 MB | budget Android, high frame rates |
| `full` *(default)* | ~9.0 MB | most apps |
| `heavy` | ~29.2 MB | accuracy-critical, flagship devices |

Changing it is one word in `app.json` plus `npx expo prebuild`.

## First camera

```tsx
import { PoseCamera } from 'react-native-pose-detection';

export default function App() {
  return <PoseCamera style={{ flex: 1 }} />;
}
```

That gives you a live camera with a skeleton overlay drawn natively, and **zero data crossing to
JavaScript**.

## Getting data out

*Not built yet: the native engine that evaluates triggers and fills the frame buffer is the
next thing being built. The props and callbacks below are final, nothing fires from them.*

Nothing crosses the bridge until you ask. Three ways, cheapest first:

```tsx
// 1. Triggers: fires when something happens (~1 crossing per event)
<PoseCamera
  triggers={[{ id: 'rep',
               enter: { angle: 'leftKnee', below: 90 },
               exit:  { angle: 'leftKnee', above: 160 },
               emit: 'cycle' }]}
  onTrigger={(e) => setReps(e.count)}
/>

// 2. Batched: every frame, 4 crossings/sec
<PoseCamera data={{ mode: 'batched', flushMs: 500 }} onPoseBatch={handle} />

// 3. Throttled: latest frame at 10 Hz, 20 crossings/sec
<PoseCamera data={{ mode: 'throttled', throttleMs: 100 }} onPose={handle} />
```

Two crossings per emission rather than one, because native signals and JavaScript pulls. See
[data delivery](./data-delivery.md#modes) for why.

Prefer triggers. See [triggers.md](./triggers.md) and [recipes.md](./recipes/README.md).

## Next

- [api-reference.md](./reference/pose-camera.md), every prop and event
- [performance.md](./performance.md), profiles, calibration, app size
- [troubleshooting.md](./troubleshooting.md), when something doesn't work
