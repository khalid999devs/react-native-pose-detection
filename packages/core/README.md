# react-native-pose-detection

Real-time human pose detection for React Native and Expo. 33 body landmarks per frame, detected
and drawn entirely in the native layer, powered by MediaPipe.

[![CI](https://github.com/khalid999devs/react-native-pose-detection/actions/workflows/ci.yml/badge.svg)](https://github.com/khalid999devs/react-native-pose-detection/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/react-native-pose-detection)](https://www.npmjs.com/package/react-native-pose-detection)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/khalid999devs/react-native-pose-detection/blob/main/LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-black)

![A frame of an exported video with the skeleton painted in](https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/export-frame.png)

<p align="center">
  <img alt="Live camera with the skeleton tracking a person" src="https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/live-camera.png" width="30%" />
  <img alt="Studio screen painting an uploaded video" src="https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/studio-video.png" width="30%" />
  <img alt="Studio screen painting an uploaded photo" src="https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/studio-photo.png" width="30%" />
</p>

One component opens the camera, finds the body, draws the skeleton, and tunes itself to the
phone it is running on. Landmarks, events and painted files are there when you ask; nothing
crosses the bridge until you do.

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [The live camera](#the-live-camera)
- [Landmarks in JavaScript](#landmarks-in-javascript)
- [Native triggers](#native-triggers)
- [Photos and video files](#photos-and-video-files)
- [Ref methods](#ref-methods)
- [Events](#events)
- [Performance and self-tuning](#performance-and-self-tuning)
- [App size](#app-size)
- [Example app](#example-app)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- **One component, working defaults.** `<PoseCamera />` is a live camera with a tracked
  skeleton. Every default can be overridden per axis; none has to be.
- **Zero bridge traffic by default.** Detection, smoothing, drawing and trigger evaluation all
  happen natively. Data crosses to JavaScript only when you opt in, as one zero-copy binary
  buffer when you do.
- **Self-tuning performance.** The frame rate is not a preset: the package measures what
  inference costs on the device, converges on the fastest sustainable rate, steps down with
  heat, and caches the answer so the next launch starts already tuned.
- **Native triggers.** Declare conditions like "left knee bent past 90 degrees for 300 ms" and
  receive one event when they fire, instead of streaming coordinates to poll yourself.
- **Files, not just cameras.** Landmarks from a photo or video on disk, or a full-quality copy
  with the skeleton painted in, produced without slowing a live camera down.
- **Crash-safe camera switching.** A switch resolves when the new lens delivers a frame, rolls
  back on failure, and preserves detection state and trigger counters.
- **Zero runtime dependencies.** The peers are `expo`, `react` and `react-native`. No
  VisionCamera, no Reanimated, no worklets.
- **No model files to hunt down.** The config plugin downloads the model you pick, verifies its
  SHA-256, and installs it into both native projects at prebuild. A checksum mismatch fails the
  build, never warns.

## How it works

The pipeline is native end to end. Camera frames go from the sensor to MediaPipe Tasks Vision
(0.10.35, pinned on both platforms) on a dedicated analysis thread: CameraX feeding hardware
RGBA buffers on Android, AVFoundation feeding scaled BGRA buffers on iOS. Inference runs on the
GPU where a probe proves it works, CPU otherwise. Results flow through One-Euro smoothing, the
trigger evaluator and the overlay renderer without ever leaving native code, and the skeleton is
drawn directly over the preview.

JavaScript sees exactly what you subscribe to: events for lifecycle and triggers, and frames as
typed arrays decoded from a single shared buffer when a data mode is on. A performance governor
watches the measured cost of every inference and continuously resolves the target frame rate,
resolutions and thermal response, with every axis overridable by props.

## Requirements

| | Minimum |
| --- | --- |
| React Native | 0.74 |
| Expo SDK | 51 (SDK 57 raises the iOS deployment target to 16.4) |
| iOS | 15.1 |
| Android | API 24 |

**Expo Go is not supported.** This package contains native code and needs a development build.

## Installation

### Expo

Install the package:

```bash
npx expo install react-native-pose-detection
```

In **`app.json`** (or `app.config.js`), add the config plugin, pick a model, and set the camera
permission text:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-pose-detection",
        {
          "model": "full",
          "cameraPermissionText": "We use the camera to analyze your movement."
        }
      ]
    ]
  }
}
```

`model` is `lite`, `full` or `heavy`; exactly one ships in the app. Then generate the native
projects:

```bash
npx expo prebuild
```

The plugin downloads the model, verifies its checksum, installs it into
`android/app/src/main/assets/` and `ios/<YourApp>/Resources/`, and writes the camera permission
into `Info.plist` and `AndroidManifest.xml`. Nothing is fetched at runtime.

### Bare React Native

```bash
npm i react-native-pose-detection
npx react-native-pose-detection fetch-model full
```

The CLI installs the model into both native projects. Two things it cannot write for you:

In **`ios/<YourApp>/Info.plist`**, add the camera permission text:

```xml
<key>NSCameraUsageDescription</key>
<string>We use the camera to analyze your movement.</string>
```

In **`android/app/src/main/AndroidManifest.xml`**, add the permission:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

`npx react-native-pose-detection doctor` checks the whole install and names anything missing.

## Quick start

In **`App.tsx`**:

```tsx
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';

export default function App() {
  const permission = useCameraPermission();
  if (!permission.granted) return null;

  return <PoseCamera style={{ flex: 1 }} />;
}
```

That is a live camera with a skeleton drawn natively, tuned to the device, with nothing crossing
the bridge. `useCameraPermission` asks on first mount and re-checks on foreground;
`getCameraPermission()` and `requestCameraPermission()` are there for apps that manage the flow
themselves.

## The live camera

Every prop is optional. Any explicit value pins that axis; the rest stay automatic.

| Prop | Default | What it controls |
| --- | --- | --- |
| `facing` | `'auto'` | `'front'` or `'back'`; auto prefers front and falls back on the first bind |
| `active` | `true` | The whole camera session. Set it to `isFocused` so leaving the screen releases the camera |
| `detection` | `true` | Inference only. `false` keeps the preview and releases the model's GPU memory |
| `overlay` | `true` | The skeleton. Also takes a config object, below |
| `smoothing` | `true` | One-Euro filter over x, y and z. Also takes `{ minCutoff, beta }` |
| `maxPoses` | `1` | 1 to 5. A ceiling, not a promise; pair it with `minConfidence` |
| `minConfidence` | from `maxPoses` | How sure the model must be before something counts as a body |
| `profile` | `'auto'` | The performance envelope, see [performance](#performance-and-self-tuning) |
| `targetFps` | `'auto'` | Pinning a number stops the governor moving it |
| `resolution` | `'auto'` | Preview: `'480p'` `'720p'` `'1080p'` |
| `analysisResolution` | `'auto'` | What the model sees: `'360p'` `'480p'` `'720p'` |
| `delegate` | `'auto'` | `'gpu'` or `'cpu'`; auto probes the GPU and falls back |
| `thermalPolicy` | `'adaptive'` | `'critical-only'` or `'off'`; off stops the response, never the reporting |

The overlay is configurable down to individual joints, in the same shape `exportPose` takes:

```tsx
<PoseCamera
  overlay={{
    color: '#00E5FF',
    lineWidth: 3,
    pointRadius: 4,
    minVisibility: 0.5,
    angles: [{ joint: 'leftKnee' }, { joint: 'rightKnee' }],
  }}
/>
```

Full tables, including layout behavior and the overlay schema: [`<PoseCamera>`
reference](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/reference/pose-camera.md).

## Landmarks in JavaScript

Nothing crosses until you choose a mode:

```tsx
<PoseCamera
  data={{ mode: 'throttled', throttleMs: 100, select: ['leftKnee', 'rightKnee'] }}
  onPose={(frame) => {
    // frame.landmarks: Float32Array of [x, y, z, visibility] per selected joint
    // frame.angles, frame.centerOfMass, frame.velocity, frame.bodySpan ride along
  }}
/>
```

| `data.mode` | Crossings/sec | Loses frames? |
| --- | --- | --- |
| `'off'` *(default)* | 0 | n/a |
| `'batched'` | ~4 (`flushMs`, default 500) | none |
| `'throttled'` | ~10 (`throttleMs`, default 100) | intermediate ones |
| `'live'` | every frame | none |

Frames arrive as typed arrays decoded from one shared buffer, not object trees, and `select`
narrows the payload to the joints you name. The wire format and the retention rules are in
[data delivery](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/data-delivery.md).

## Native triggers

Conditions are evaluated on the camera thread, once per frame; JavaScript hears about it when
something fires:

```tsx
<PoseCamera
  triggers={[
    {
      id: 'squat',
      enter: { angle: 'leftKnee', below: 90 },
      exit: { angle: 'leftKnee', above: 160 },
      emit: 'cycle',
      debounceMs: 300,
    },
  ]}
  onTrigger={(e) => setReps(e.count)}
/>
```

Thirty reps is thirty bridge crossings, not nine hundred. Conditions read angles, positions,
velocities and visibility, compose with `all`/`any`, and a trigger can claim the exact frame it
fired on with `snapshot: true`. The grammar is in the
[trigger schema](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/reference/trigger-schema.md), and
[what you can build](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/recipes.md) maps the feasibility, from rep counters to
posture checks.

## Photos and video files

The same detector, no camera. Numbers out of a file:

```ts
import { detectOnImage, detectOnVideo } from 'react-native-pose-detection';

const poses = await detectOnImage(photoUri, { maxPoses: 1 });

const job = detectOnVideo(videoUri, { fps: 10, onProgress: setProgress });
const frames = await job.frames; // cancellable with job.cancel()
```

Or a painted copy, written into your app's sandbox at full quality:

```ts
import { exportPose } from 'react-native-pose-detection';

const task = exportPose(videoUri, {
  overlay: { color: '#00E5FF', lineWidth: 3 },
  directory: 'documents',
  onProgress: setProgress,
});
const { uri, posesFound } = await task.result;
```

Exports run on their own detector, on CPU, below the camera's priority, so a live preview keeps
its frame rate while one runs. The file is staged and renamed on completion, so nothing that
dies mid-write leaves behind something that looks finished. Options, costs and multi-person
behavior: [photos and video files](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/files.md).

## Ref methods

```tsx
const cam = useRef<PoseCameraRef>(null);
<PoseCamera ref={cam} />;
```

| Method | What it does |
| --- | --- |
| `switchCamera()` / `setFacing(f)` | Switches lens; resolves when the new camera delivers a frame |
| `pause()` / `resume()` | Stops and restarts the capture session |
| `startDetection()` / `stopDetection()` | Inference on/off; stopping releases GPU memory |
| `setOverlayEnabled(on)` | Shows or hides the skeleton |
| `snapshot()` | The current frame on demand, `null` when nobody is there |
| `getState()` | Facing, active, detecting, fps, delegate, tier, synchronously |
| `getProfile()` | Where calibration stands, with the live measured rate |
| `setProfile(p)` | Switches the performance profile now, not at the next render |

Details and failure modes: [ref methods](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/reference/ref-methods.md).

## Events

| Event | Fires |
| --- | --- |
| `onReady` | Once the camera and model are up, with the resolved delegate, rate and resolutions |
| `onError` | Every failure, with a stable `code` and a `fatal` flag |
| `onCameraChange` | After a lens switch lands |
| `onPerformanceChange` | Every governor or thermal adjustment, with the reason |
| `onTrigger` | Once per trigger firing, with id, phase, count and duration |
| `onPose` / `onPoseBatch` | Frames, per the `data` mode |
| `onLog` | Batched log entries, when the log channel is on |

Payloads and error codes: [events reference](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/reference/events.md).

## Performance and self-tuning

The default profile measures the device instead of trusting a spec sheet. Every inference
reports its cost; the rolling median sets the target rate at 55% utilization, clamped to 10 to
40 fps, and classifies the device tier that drives the resolutions. Heat steps the whole thing
down, and the settled answer is cached so the next launch opens already tuned.

| `profile` | Behavior |
| --- | --- |
| `'auto'` *(default)* | Measure, converge on the device's own rate, cache it |
| `'efficient'` | Pinned 15 fps, 480p preview, 360p analysis |
| `'balanced'` | Pinned 24 fps, 720p, 480p |
| `'quality'` | Pinned 30 fps, 1080p, 480p |
| `'unrestricted'` | Calibrated like auto, no thermal ladder except `critical` |

```ts
await cam.current.getProfile();
// { profile: 'auto', phase: 'settled', source: 'measured', tier: 'high',
//   resolved: { delegate: 'GPU', targetFps: 34, preview: '1080p', analysis: '480p' },
//   p50InferenceMs: 16.2, measuredFps: 33 }
```

The ladder, the precedence rules and the honest resource budgets are in
[the performance guide](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md).

## App size

MediaPipe's native libraries are 10.1 MB for `arm64-v8a`; the model adds 5.5 MB (`lite`), 9 MB
(`full`) or 29.2 MB (`heavy`); the JavaScript is 62.5 KB with zero runtime dependencies behind
it. Ship Android as an AAB so devices download one ABI instead of four.

| Model | Android installed | Best for |
| --- | --- | --- |
| `lite` | ~19.7 MB | budget Android, high frame rates |
| `full` *(default)* | ~23.2 MB | most apps |
| `heavy` | ~43.4 MB | accuracy-critical, flagships |

Changing it is one word in **`app.json`** plus `npx expo prebuild`. Measured numbers and
methodology: [app size](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md#app-size).

## Example app

The repository ships a full example in [`example/`](https://github.com/khalid999devs/react-native-pose-detection/tree/main/example): a live camera screen
with every prop on a panel, a studio that paints picked photos and clips, and a diagnostics
screen with stress scenarios. It exists twice, once through the Expo config plugin and once
through the bare CLI path, so both install routes stay proven end to end.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/getting-started.md) | Install, first camera, first data |
| [Installation](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/installation.md) | Expo, bare RN, EAS, release builds |
| [Camera control](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/camera-control.md) | Lenses, switching, pausing, lifecycle |
| [Data delivery](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/data-delivery.md) | Modes, the wire format, retention |
| [Triggers](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/triggers.md) | Conditions, phases, snapshots |
| [Photos and video files](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/files.md) | Landmarks from a file, painted copies |
| [Performance](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md) | Profiles, the governor, thermal ladder, size |
| [What you can build](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/recipes.md) | Trigger syntax, feasibility, honest limits |
| [API reference](https://github.com/khalid999devs/react-native-pose-detection/tree/main/guides/reference) | Every prop, method, event, type and error code |
| [Troubleshooting](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/troubleshooting.md) | Problems people hit, and the log channel |

## Troubleshooting

The quick hits:

- **Blank screen or "native module not found" in Expo Go**: Expo Go cannot run native code.
  Build a development build: `npx expo prebuild && npx expo run:ios` (or `run:android`).
- **`MODEL_NOT_FOUND`**: the plugin did not run. `npx expo prebuild --clean`, or on bare RN
  `npx react-native-pose-detection fetch-model full`.
- **`GPU_UNAVAILABLE`**: not a bug; that device's GPU delegate failed and it fell back to CPU.
- **Lower frame rate than expected**: `await cam.current.getProfile()` shows the measured
  inference cost the rate was derived from; a low rate means expensive inference, not a stuck
  setting.

The full list, including build failures and their exact error strings:
[troubleshooting](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/troubleshooting.md).

## Contributing

Issues and pull requests are welcome, especially device reports from hardware we have not
measured. Start with [contributing](https://github.com/khalid999devs/react-native-pose-detection/blob/main/docs/contributing.md); the architecture, testing
and release docs live beside it.

## License

MIT
