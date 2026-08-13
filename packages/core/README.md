<div align="center">

# react-native-pose-detection

**Real-time human pose detection for React Native and Expo.**

33 body landmarks per frame, detected and drawn entirely in the native layer, powered by
MediaPipe. Works in Expo and bare React Native projects alike. Nothing crosses the bridge
until you ask.

[![CI](https://github.com/khalid999devs/react-native-pose-detection/actions/workflows/ci.yml/badge.svg)](https://github.com/khalid999devs/react-native-pose-detection/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/react-native-pose-detection)](https://www.npmjs.com/package/react-native-pose-detection)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/khalid999devs/react-native-pose-detection/blob/main/LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-black)

[Installation](#installation) · [Quick start](#quick-start) · [Do more](#do-more) · [Full surface](#the-whole-surface-at-a-glance) · [Example](https://github.com/khalid999devs/react-native-pose-detection/tree/main/example) · [Docs](#documentation)

![A frame of an exported video with the skeleton painted in](https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/export-frame.png)

<img alt="Live camera with the skeleton tracking a person" src="https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/live-camera.png" width="30%" /> <img alt="Studio screen painting an uploaded video" src="https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/studio-video.png" width="30%" /> <img alt="Studio screen painting an uploaded photo" src="https://raw.githubusercontent.com/khalid999devs/react-native-pose-detection/main/ss/studio-photo.png" width="30%" />

*Snaps from [the example app](https://github.com/khalid999devs/react-native-pose-detection/tree/main/example)*

</div>

## Why this one

- **One component.** `<PoseCamera />` opens the camera, finds the body, draws the skeleton.
  Every default overridable, none required.
- **Both install paths, first class.** The Expo config plugin and a CLI for bare React Native
  do the same job; both are built and tested in CI on every commit.
- **Zero bridge traffic by default.** Detection, smoothing, drawing and trigger logic run
  natively. Landmarks cross to JavaScript only when you opt in, as one zero-copy buffer.
- **Tunes itself to the phone.** Measures inference cost, converges on the fastest sustainable
  frame rate, backs off with heat, remembers the answer for the next launch.
- **Native triggers.** Declare "knee bent past 90 degrees for 300 ms", get one event when it
  happens. Thirty reps is thirty bridge crossings, not nine hundred.
- **Files too.** Landmarks from any photo or video on disk, or a full-quality painted copy,
  without slowing the live camera.
- **Zero runtime dependencies.** Peers are `expo`, `react`, `react-native`. No VisionCamera,
  no Reanimated, no worklets.
- **Models handled for you.** Downloaded, checksum-verified and installed at build time. A
  mismatch fails the build, never warns.

## Installation

One package, two setups. Both end in the same place: the model inside your native projects and
the camera permission declared.

### Expo

```bash
npx expo install react-native-pose-detection
```

In **`app.json`**, add the config plugin:

```jsonc
{
  "expo": {
    "plugins": [
      [
        "react-native-pose-detection",
        {
          "model": "full", // 'lite' | 'full' | 'heavy'
          "cameraPermissionText": "We use the camera to analyze your movement."
        }
      ]
    ]
  }
}
```

```bash
npx expo prebuild
```

The plugin installs the model into both native projects and writes the camera permission into
`Info.plist` and `AndroidManifest.xml` for you. Nothing downloads at runtime.

Expo Go is not supported: this package contains native code, so use a development build.

### Bare React Native

```bash
npm i react-native-pose-detection
npx react-native-pose-detection fetch-model full
```

The CLI installs the model into both native projects. Declare the camera permission yourself,
in **`ios/<YourApp>/Info.plist`**:

```xml
<key>NSCameraUsageDescription</key>
<string>We use the camera to analyze your movement.</string>
```

and in **`android/app/src/main/AndroidManifest.xml`**:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Either setup can be verified with `npx react-native-pose-detection doctor`, which checks the
install and names anything missing. Full detail, including EAS and release builds:
[installation guide](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/installation.md).

### Choosing a model

Exactly one ships, whichever you pick. Changing it is one word in the config plus a rebuild.

| Model | Best for |
| --- | --- |
| `lite` | budget devices, the highest frame rates |
| `full` *(default)* | most apps: the accuracy and cost balance |
| `heavy` | accuracy-critical work on flagship hardware |

Sizes and the full trade-off table: [app size](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md#app-size).

## Quick start

**`App.tsx`**

```tsx
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';

export default function App() {
  const permission = useCameraPermission();
  if (!permission.granted) return null;

  return <PoseCamera style={{ flex: 1 }} />;
}
```

That is a live camera with a tracked skeleton, tuned to the device, zero bridge traffic.

## Do more

**Count reps without streaming a single coordinate.** The condition runs on the camera thread;
you hear about it once per rep:

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

**Read landmarks when you actually want them**, as typed arrays from one shared buffer:

```tsx
<PoseCamera
  data={{ mode: 'throttled', throttleMs: 100, angles: ['leftKnee'] }}
  onPose={(frame) => {
    // frame.landmarks is a Float32Array of [x, y, z, visibility] per joint
    setKneeAngle(frame.angles?.leftKnee);
  }}
/>
```

**Paint a photo or video** into a full-quality copy, without slowing the live camera:

```ts
import { exportPose } from 'react-native-pose-detection';

const { uri } = await exportPose(videoUri, { directory: 'documents' }).result;
```

## It tunes itself

No frame-rate table to maintain. The package measures what inference costs on each phone,
converges on the fastest rate that phone sustains, steps down with heat, and caches the answer:

```ts
await cam.current.getProfile();
// { phase: 'settled', tier: 'high',
//   resolved: { delegate: 'GPU', targetFps: 34, preview: '1080p', analysis: '480p' },
//   p50InferenceMs: 16.2, measuredFps: 33 }
```

Every axis is still yours: `profile`, `targetFps`, `resolution`, `analysisResolution`,
`delegate`, `thermalPolicy`.

## The whole surface at a glance

Every prop on one component. All of them optional; an explicit value pins that axis and the
rest stay automatic.

```tsx
<PoseCamera
  ref={cam}
  style={{ flex: 1 }}
  // camera
  facing="front"                    // 'auto' | 'front' | 'back'
  active={isFocused}                // the whole session on/off
  detection={true}                  // inference on/off; false frees the model
  resolution="auto"                 // preview: '480p' | '720p' | '1080p'
  // detection
  maxPoses={1}                      // 1 to 5
  minConfidence={0.6}               // what counts as a body
  smoothing={{ minCutoff: 1, beta: 4 }}
  // performance
  profile="auto"                    // 'efficient' | 'balanced' | 'quality' | 'unrestricted'
  targetFps="auto"                  // a number pins the rate
  analysisResolution="auto"         // what the model sees: '360p' | '480p' | '720p'
  delegate="auto"                   // 'gpu' | 'cpu'
  thermalPolicy="adaptive"          // 'critical-only' | 'off'
  // drawing, all native
  overlay={{
    color: '#00E5FF',
    lineWidth: 3,
    pointRadius: 4,
    angles: [{ joint: 'leftKnee' }, { joint: 'rightKnee' }],
  }}
  // data out, off unless asked
  data={{ mode: 'throttled', throttleMs: 100, select: ['leftKnee', 'rightKnee'] }}
  triggers={[squatTrigger]}
  logLevel="off"
  // events
  onReady={(e) => console.log(e.delegate, e.targetFps)}
  onError={(e) => console.warn(e.code, e.message)}
  onCameraChange={(e) => setFacing(e.facing)}
  onPerformanceChange={(e) => console.log(e.reason, e.targetFps)}
  onTrigger={(e) => setReps(e.count)}
  onPose={(frame) => setFrame(frame)}
  onLog={(entries) => entries.forEach((e) => console.log(e.message))}
/>
```

| Prop | Default | What it does |
| --- | --- | --- |
| `style` | none | View style; `{ flex: 1 }` is the usual answer |
| `facing` | `'auto'` | Which lens, `'front'` or `'back'`; auto prefers front |
| `active` | `true` | Camera session on/off |
| `detection` | `true` | Inference on/off; `false` frees GPU memory |
| `overlay` | `true` | The skeleton; boolean or a config object |
| `smoothing` | `true` | One-Euro filter; boolean or `{ minCutoff, beta }` |
| `maxPoses` | `1` | Detection ceiling, `1` to `5` |
| `minConfidence` | unset = auto | What counts as a body, `0.1` to `1`; unset follows `maxPoses`: 0.6 for one person, 0.3 above |
| `profile` | `'auto'` | Performance envelope: `'efficient'` `'balanced'` `'quality'` `'unrestricted'` |
| `targetFps` | `'auto'` | Inference rate; a number pins it |
| `resolution` | `'auto'` | Preview: `'480p'` `'720p'` `'1080p'` |
| `analysisResolution` | `'auto'` | What the model sees: `'360p'` `'480p'` `'720p'` |
| `delegate` | `'auto'` | Inference engine, `'gpu'` or `'cpu'`; auto probes and falls back |
| `thermalPolicy` | `'adaptive'` | Heat response: `'critical-only'` or `'off'`; off never stops reporting |
| `data` | `{ mode: 'off' }` | What crosses to JavaScript: `'throttled'` `'batched'` `'live'` |
| `triggers` | `[]` | Native conditions, validated at render |
| `logLevel` | `'off'` | Diagnostics, `'error'` through `'trace'`, global or per category |
| `onReady` … `onLog` | none | Callbacks: lifecycle, errors, performance, triggers, frames, logs |

Exact types, clamping rules and edge behavior: [`<PoseCamera>` reference](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/reference/pose-camera.md).

## Requirements

| | Minimum |
| --- | --- |
| React Native | 0.74 |
| Expo SDK | 51 |
| iOS | 15.1 |
| Android | API 24 |

Expo Go cannot run native code, so use a development build. The JavaScript itself is 62.5 KB
with zero runtime dependencies.

## Documentation

| Guide | Covers |
| --- | --- |
| [Getting started](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/getting-started.md) | Install, first camera, first data |
| [Installation](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/installation.md) | Expo, bare RN, EAS, release builds |
| [Camera control](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/camera-control.md) | Lenses, switching, pausing, lifecycle |
| [Data delivery](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/data-delivery.md) | Modes, the wire format, retention |
| [Triggers](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/triggers.md) | Conditions, phases, snapshots |
| [Photos and video files](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/files.md) | Landmarks from files, painted copies |
| [Performance](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/performance.md) | Profiles, the governor, thermal, app size |
| [What you can build](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/recipes.md) | Trigger syntax, feasibility, limits |
| [API reference](https://github.com/khalid999devs/react-native-pose-detection/tree/main/guides/reference) | Every prop, method, event, type, error code |
| [Troubleshooting](https://github.com/khalid999devs/react-native-pose-detection/blob/main/guides/troubleshooting.md) | Real problems, and the log channel |

The [example app](https://github.com/khalid999devs/react-native-pose-detection/tree/main/example) shows all of it running: a live camera with every prop on a
panel, a studio that paints picked files, and a diagnostics screen with stress scenarios. It
exists twice, once per install path, so both stay proven end to end.

## Contributing

Issues and PRs are welcome, especially device reports from hardware we have not measured. Start
with [contributing](https://github.com/khalid999devs/react-native-pose-detection/blob/main/docs/contributing.md).

## License

MIT © [khalid999devs](https://github.com/khalid999devs)
