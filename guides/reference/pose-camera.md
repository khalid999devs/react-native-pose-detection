# `<PoseCamera>`: props

```tsx
import { PoseCamera, type PoseCameraRef } from 'react-native-pose-detection';

<PoseCamera ref={cam} style={{ flex: 1 }} />
```

## Configuration

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `profile` | `'auto' \| 'efficient' \| 'balanced' \| 'quality' \| 'unrestricted'` | `'auto'` | [performance](../performance.md) |
| `facing` | `'auto' \| 'front' \| 'back'` | `'auto'` | auto → front, falls back to back |
| `delegate` | `'auto' \| 'gpu' \| 'cpu'` | `'auto'` | auto verifies GPU, falls back to CPU |
| `targetFps` | `'auto' \| number` | `'auto'` | |
| `resolution` | `'auto' \| '480p' \| '720p' \| '1080p'` | `'auto'` | preview |
| `analysisResolution` | `'auto' \| '360p' \| '480p' \| '720p'` | `'auto'` | what the model sees |
| `thermalPolicy` | `'adaptive' \| 'critical-only' \| 'off'` | `'adaptive'` | |
| `maxPoses` | `number` (1–5) | `1` | triggers use the primary pose |
| `smoothing` | `boolean \| { minCutoff, beta }` | `true` | One-Euro filter |

Any explicit value pins that axis. The rest stay automatic.

## Switches

| Prop | Type | Default |
| --- | --- | --- |
| `active` | `boolean` | `true`: camera on/off |
| `detection` | `boolean` | `true`: inference on/off |
| `overlay` | `boolean \| OverlayConfig` | `true` |

```ts
type OverlayConfig = {
  landmarks?: boolean;
  connections?: boolean;
  color?: string;
  lineWidth?: number;
  pointRadius?: number;
  minVisibility?: number;   // hide low-confidence joints
  only?: JointName[];       // draw a subset
  angles?: AngleOverlay[];  // draw angle arcs + degree labels
};

type AngleOverlay = {
  joint: AngleJointName;    // vertex of the angle
  label?: boolean;          // show the degree value, default true
  radius?: number;          // arc radius in px, default 40
  color?: string;           // defaults to the overlay color
  decimals?: number;        // default 0
  minVisibility?: number;   // hide when tracking is poor, default 0.5
};
```

### Angle overlay

```tsx
<PoseCamera
  overlay={{
    angles: [
      { joint: 'leftElbow' },                    // arc + "46°"
      { joint: 'leftKnee', label: false },       // arc only
      { joint: 'rightKnee', color: '#ff5252' },
    ],
  }}
/>
```

Drawn natively, nothing crosses to JavaScript. Declaring a joint here also marks its angle
as needed, so it is computed by the lazy geometry pass whether or not a trigger references it.

`AngleJointName` is the 12 joints where two limb segments meet, see
[types](./types.md#anglejointname). `{ joint: 'nose' }` does not compile.

See [camera control](../camera-control.md) for how the three combine.

## Data

```ts
data?: {
  mode: 'off' | 'throttled' | 'batched' | 'live';   // default 'off'
  throttleMs?: number;    // default 100
  flushMs?: number;       // default 500
  landmarks?: boolean;
  worldLandmarks?: boolean;
  angles?: boolean;
  select?: JointName[];
};
```

See [data delivery](../data-delivery.md).

## Triggers

```ts
triggers?: Trigger[];
```

See [trigger schema](./trigger-schema.md).

## Diagnostics

```ts
logLevel?: LogLevel | Partial<Record<LogCategory, LogLevel>>;   // default 'off'
onLog?: (entries: LogEntry[]) => void;
```

Scoped to this camera. `setLogLevel()` sets it globally instead.
See [debugging](../debugging.md).

## Callbacks

See [events](./events.md).
