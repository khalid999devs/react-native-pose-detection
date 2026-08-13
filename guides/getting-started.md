# Getting Started

**Pre-1.0, and not yet run on a device.** Both platforms are written and build, so everything on
this page is implemented on both. What has not happened is a physical device: treat the numbers
as targets rather than measurements.

## Requirements

| | |
| --- | --- |
| React Native | 0.74+ |
| Expo SDK | 51+ (dev client or EAS Build) |
| iOS | 15.1+, and 16.4+ on Expo SDK 57, which is what `ExpoModulesCore` requires |
| Android | API 24+ |
| Architecture | new. React Native 0.82 removed the legacy one, so there is nothing to choose |

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

Then add `NSCameraUsageDescription` to `Info.plist`. Android needs nothing: this package
declares `android.permission.CAMERA` in its own manifest and the merger adds it to your app.

## Choosing a model

| Model | App size added | Best for |
| --- | --- | --- |
| `lite` | ~5.5 MB | budget Android, high frame rates |
| `full` *(default)* | ~9.0 MB | most apps |
| `heavy` | ~29.2 MB | accuracy-critical, flagship devices |

Changing it is one word in `app.json` plus `npx expo prebuild`.

## First camera

Declaring the permission is not the same as being granted it. One hook asks and reports:

```tsx
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';

export default function App() {
  const { granted } = useCameraPermission();
  return granted ? <PoseCamera style={{ flex: 1 }} /> : null;
}
```

That gives you a live camera with a skeleton overlay drawn natively, and **zero data crossing to
JavaScript**.

`useCameraPermission()` prompts on mount. Pass `{ ask: false }` to read the status without
prompting and call `request()` at a moment you choose. It also tells you when a refusal is
permanent, which is the case an "allow" button cannot fix: see
[camera permission](./reference/permissions.md).

## Getting data out

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
