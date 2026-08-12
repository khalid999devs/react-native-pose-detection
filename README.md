# react-native-pose-detection

Real-time pose detection for React Native and Expo. 33 body landmarks, iOS and Android,
powered by MediaPipe.

> **Pre-release, not yet published.** Android has the camera, the detector and the native
> overlay, written but not yet run on a device. The engine that evaluates triggers, computes
> geometry and calibrates is not built, and iOS has not started. What follows is the shape of
> `0.1.0`, not what you can install today. Progress: [development plan](./docs/development-plan.md).

```bash
npm i react-native-pose-detection
```

```json
{ "plugins": [["react-native-pose-detection", { "model": "full" }]] }
```

```tsx
import { PoseCamera } from 'react-native-pose-detection';

export default function App() {
  return <PoseCamera style={{ flex: 1 }} />;
}
```

That's a live camera with a skeleton drawn natively, tuned to the device it's running on,
with **zero data crossing to JavaScript**.

---

## Why this one

| | |
| --- | --- |
| **No model files to hunt down** | The config plugin fetches, verifies, and installs the model. Other libraries make you download a `.task` by hand and place it in two native folders. |
| **Zero runtime dependencies** | Nothing is installed alongside it. The peers are `expo`, `react` and `react-native`, which you already have: no VisionCamera, no Reanimated. Works on both old and new architecture. |
| **Zero bridge cost by default** | Landmarks stay native. Data crossing to JS is something you opt into. |
| **Logic runs natively** | Declare thresholds; the state machine runs on the camera thread and calls you ~once per event, not 30× per second. |
| **Tunes itself** | Measures the device, settles on the fastest configuration it can sustain, and remembers it. Backs off when the phone gets hot. |
| **Honest numbers** | The Android app-size figures come from an assembled build. Anything still estimated says so where it is printed. |

## Requirements

| | |
| --- | --- |
| React Native | 0.74+ |
| Expo SDK | 51+ (development build or EAS) |
| iOS | 15.1+ |
| Android | API 24+ |

**Expo Go is not supported**. This package contains native code. Use a
[development build](https://docs.expo.dev/develop/development-builds/introduction/).

Full setup, including bare React Native: [installation guide](./guides/installation.md).

## Counting reps in 20 lines

Logic is declared, evaluated natively, and reported once per rep:

```tsx
<PoseCamera
  style={{ flex: 1 }}
  triggers={[
    {
      id: 'squat',
      enter: { angle: 'leftKnee', below: 90 },
      exit:  { angle: 'leftKnee', above: 160 },
      emit: 'cycle',
      debounceMs: 300,
    },
  ]}
  onTrigger={(e) => setReps(e.count)}
/>
```

Thirty reps means thirty bridge crossings, not nine hundred. A trigger that asks for
`snapshot: true` pays one more crossing to fetch the frame, and arrives a microtask later than a
plain one, because a landmark buffer cannot ride an event
([ADR 0009](./docs/adr/0009-trigger-snapshots-are-claimed.md)).
More: [triggers](./guides/triggers.md) · [recipes](./guides/recipes/README.md).

## Reading landmarks directly

Nothing crosses until you ask. Pick the cheapest mode that does the job:

```tsx
<PoseCamera data={{ mode: 'batched', flushMs: 500 }} onPoseBatch={handle} />
```

| Mode | Crossings/sec | Data loss |
| --- | --- | --- |
| `off` *(default)* | 0 | n/a |
| `batched` | 4 | none |
| `throttled` | 20 | intermediate frames |
| `live` | 60 | none |

Two crossings per emission rather than one: an event cannot carry an ArrayBuffer, so native
signals that frames are ready and the library pulls them in a single zero-copy buffer
([ADR 0008](./docs/adr/0008-frames-are-drained-not-pushed.md)). The pull is handled for you, and
the ratio is what drives the choice: `batched` is 15 times cheaper than `live`.

[Data delivery guide](./guides/data-delivery.md).

## Choosing a model

One model ships, whichever you select.

| Model | Android installed | Best for |
| --- | --- | --- |
| `lite` | ~19.7 MB | budget Android, high frame rates |
| `full` *(default)* | ~23.2 MB | most apps |
| `heavy` | ~43.4 MB | accuracy-critical, flagships |

Changing it is one word in `app.json` plus `npx expo prebuild`.
[Full size breakdown](./guides/performance.md#app-size).

## Documentation

**[📘 Guides →](./guides/README.md)**, everything for using the library

| | |
| --- | --- |
| [Getting started](./guides/getting-started.md) | Install → live skeleton |
| [Installation](./guides/installation.md) | Expo, bare RN, EAS, release builds |
| [Camera control](./guides/camera-control.md) | Switching, pausing, the three toggles |
| [Data delivery](./guides/data-delivery.md) | Getting landmarks out efficiently |
| [Triggers](./guides/triggers.md) | Native business logic |
| [Performance](./guides/performance.md) | Profiles, calibration, app size, memory |
| [Static input](./guides/static-input.md) | Images and video files |
| [Recipes](./guides/recipes/README.md) | Squat, push-up, jump, plank |
| [Debugging](./guides/debugging.md) | Live log streaming, off by default |
| [Troubleshooting](./guides/troubleshooting.md) | When something breaks |
| [API reference](./guides/README.md#api-reference) | Props, methods, events, types |

## Getting the best performance

Four decisions are yours; the rest is automatic.

1. **Keep `data.mode: 'off'` and use triggers**, the single biggest lever
2. **Pick `lite` if you target budget Android**, 3.5 MB smaller installed and noticeably faster
3. **Use `select`** so only the joints you name cross to JavaScript
4. **Set `active={isFocused}`** so the camera stops when the screen isn't visible

Details in the [performance guide](./guides/performance.md).

## Contributing

Contributions are welcome, especially device testing on hardware we don't have.

**[🛠 Developer documentation →](./docs/README.md)**

The flow, and the one naming convention that runs through all of it:

```text
branch      feat/triggers-velocity-condition
commit      feat(triggers): add velocityY condition
PR title    feat(triggers): add velocityY condition
```

Same type, same scope, everywhere, enforced by commitlint and CI.

| | |
| --- | --- |
| [Branches & workflow](./docs/contributing.md#workflow) | naming, rebasing, protected `main` |
| [Commit rules](./docs/contributing.md#commits) | types, scopes, breaking changes |
| [Pull requests](./docs/contributing.md#pull-requests) | title format, checklists, what CI runs |
| [Quality gates](./docs/quality-gates.md) | `npm run check` before you push |
| [Project structure](./docs/project-structure.md) | where things go |
| [Architecture](./docs/architecture.md) | the native pipeline |
| [ADRs](./docs/adr/README.md) | why decisions were made: read before proposing a reversal |

## License

MIT
