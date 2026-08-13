# react-native-pose-detection

Real-time human pose detection for React Native and Expo. 33 body landmarks per frame, detected
and drawn entirely in the native layer, powered by MediaPipe.

[![CI](https://github.com/khalid999devs/react-native-pose-detection/actions/workflows/ci.yml/badge.svg)](https://github.com/khalid999devs/react-native-pose-detection/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/react-native-pose-detection)](https://www.npmjs.com/package/react-native-pose-detection)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/khalid999devs/react-native-pose-detection/blob/main/LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-black)

| Live camera | Painting a clip | Painting a photo |
| --- | --- | --- |
| ![Live camera with the skeleton tracking a person](https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/live-camera.png) | ![Studio screen painting an uploaded video](https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/studio-video.png) | ![Studio screen painting an uploaded photo](https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/studio-photo.png) |

![A frame of an exported video with the skeleton painted in](https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/export-frame.png)

## Why this one

- **One component, working defaults.** `<PoseCamera />` opens the camera, finds the body, draws
  the skeleton. Every default can be overridden, none has to be.
- **Zero bridge traffic by default.** Detection, smoothing and drawing all happen natively.
  Landmarks cross to JavaScript only when you ask, in a compact binary form when you do.
- **Tunes itself to the device.** The frame rate is not a preset: the package measures what
  inference actually costs on the phone it is running on, converges on the fastest rate that
  phone sustains, backs off with heat, and remembers the answer for the next launch.
- **Native triggers.** Declare conditions like "left knee above the hip for 300 ms" and get one
  event when they fire, instead of streaming coordinates to JavaScript to poll them yourself.
- **Files, not just cameras.** Detect on a photo or video, or export a copy with the skeleton
  painted in, at full quality, off the UI thread.
- **Zero runtime dependencies.** The peers are `expo`, `react` and `react-native`. No
  VisionCamera, no Reanimated, no worklets.
- **No model files to hunt down.** The config plugin downloads the model you pick, verifies its
  checksum, and installs it into the app bundle at prebuild.

## Install

```bash
npx expo install react-native-pose-detection
```

Add the config plugin and pick a model (`lite`, `full`, or `heavy`):

```json
{
  "expo": {
    "plugins": [["react-native-pose-detection", { "model": "full" }]]
  }
}
```

```bash
npx expo prebuild
```

Bare React Native (no Expo prebuild) installs the model through the CLI instead:

```bash
npm i react-native-pose-detection
npx react-native-pose-detection fetch-model full
```

**Expo Go is not supported.** This package contains native code and needs a development build.

## Quick start

```tsx
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';

export default function App() {
  const permission = useCameraPermission();
  if (!permission.granted) return null;

  return <PoseCamera style={{ flex: 1 }} />;
}
```

That is a live camera with a skeleton drawn natively, tuned to the device, with nothing crossing
the bridge.

## Landmarks in JavaScript, when you want them

```tsx
<PoseCamera
  data={{ mode: 'throttled', throttleMs: 100 }}
  onPose={(frame) => {
    // frame.landmarks: Float32Array of [x, y, z, visibility] per joint
  }}
/>
```

Frames arrive as typed arrays decoded from one shared buffer, not as object trees. `live`,
`throttled` and `batched` modes cover streaming, sampling and periodic flushes.

## Events instead of polling

```tsx
<PoseCamera
  triggers={[
    {
      id: 'hands-up',
      enter: { landmarkY: 'leftWrist', above: 'nose' },
      minDurationMs: 300,
    },
  ]}
  onTrigger={(event) => console.log(event.id, event.phase, event.count)}
/>
```

The condition is evaluated natively on every frame. JavaScript hears about it once, when it
fires.

## Photos, videos, and painted exports

```tsx
import { detectOnImage, exportPose } from 'react-native-pose-detection';

const poses = await detectOnImage(photoUri);

const task = exportPose(videoUri, { onProgress: (p) => console.log(p) });
const painted = await task.result; // a full-quality copy with the skeleton painted in
```

## Performance

The default profile measures the device instead of trusting a spec sheet: it watches what
inference costs, settles on the fastest sustainable rate, steps down when the phone heats up,
and caches the result so the second launch starts already tuned.

```ts
await cameraRef.current.getProfile();
// { profile: 'auto', phase: 'settled', tier: 'high',
//   resolved: { delegate: 'GPU', targetFps: 34, preview: '1080p', analysis: '480p' },
//   p50InferenceMs: 16.2, measuredFps: 33 }
```

Everything is overridable per axis: `profile`, `targetFps`, `resolution`,
`analysisResolution`, `delegate`, and a `thermalPolicy` for apps that want the heat response
off.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/getting-started.md) | Install, first camera, first data |
| [Installation](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/installation.md) | Expo and bare setups, models, troubleshooting installs |
| [Camera control](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/camera-control.md) | Lenses, switching, pausing, lifecycle |
| [Data delivery](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/data-delivery.md) | Modes, throttling, the wire format, decoding |
| [Triggers](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/triggers.md) | Conditions, phases, snapshots |
| [Photos and video files](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/files.md) | Landmarks from a file, and painted copies of one |
| [Performance](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md) | Profiles, the governor, thermal ladder, app size |
| [What you can build](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/recipes.md) | Trigger syntax, feasibility, honest limits |
| [API reference](https://github.com/khalid999devs/react-native-pose-detection/tree/main/guides/reference) | Every prop, event, method, type and error code |
| [Troubleshooting](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/troubleshooting.md) | The problems people actually hit |

## Requirements

| | Minimum |
| --- | --- |
| React Native | 0.74 |
| Expo SDK | 51 |
| iOS | 15.1 |
| Android | API 24 |

## What it costs your app

MediaPipe's native libraries are 10.1 MB for `arm64-v8a`; the model file is 5.5 MB (`lite`),
9 MB (`full`) or 29.2 MB (`heavy`). The JavaScript rounds to nothing: 62.5 KB with zero runtime
dependencies behind it. Ship Android as an AAB so devices download one ABI instead of four. The
numbers and their measurement are in
[the performance guide](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md).

## Example app

The repository ships a full example (live camera, studio, diagnostics) in
[`example/`](https://github.com/khalid999devs/react-native-pose-detection/tree/main/example),
one copy through the Expo config plugin and one through the bare CLI path, so both install
routes stay proven.

## Contributing

Issues and pull requests are welcome. Start with
[contributing](https://github.com/khalid999devs/react-native-pose-detection/blob/main/docs/contributing.md);
the architecture, testing and release docs live beside it.

## License

MIT
