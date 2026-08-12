# `<PoseCamera>`: props

```tsx
import { PoseCamera, type PoseCameraRef } from 'react-native-pose-detection';

<PoseCamera ref={cam} style={{ flex: 1 }} />
```

## What runs today

iOS is not implemented at all. On Android the props that reach native are `facing`, `delegate`,
`active`, `detection`, `maxPoses`, `resolution`, `analysisResolution` and `overlay`. Everything
else on this page is a typed, validated JavaScript surface waiting on the native engine:
`profile`, `targetFps`, `thermalPolicy`, `smoothing`, `data`, `triggers` and `logLevel` are
accepted and checked, and nothing acts on them yet. Rows below are marked where that applies, so
you can tell a documented default from a working one.

## Configuration

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `profile` | `'auto' \| 'efficient' \| 'balanced' \| 'quality' \| 'unrestricted'` | `'auto'` | **not built yet**, [performance](../performance.md) |
| `facing` | `'auto' \| 'front' \| 'back'` | `'auto'` | auto prefers front, falls back to the other lens on the first bind |
| `delegate` | `'auto' \| 'gpu' \| 'cpu'` | `'auto'` | auto verifies GPU, falls back to CPU |
| `targetFps` | `'auto' \| number` | `'auto'` | **not built yet**, `onReady` reports a placeholder 30 |
| `resolution` | `'auto' \| '480p' \| '720p' \| '1080p'` | `'auto'` | preview |
| `analysisResolution` | `'auto' \| '360p' \| '480p' \| '720p'` | `'auto'` | what the model sees |
| `thermalPolicy` | `'adaptive' \| 'critical-only' \| 'off'` | `'adaptive'` | **not built yet** |
| `maxPoses` | `number` (1 to 5) | `1` | reaches the landmarker; primary-pose selection is **not built yet**, so above 1 the first pose is used |
| `smoothing` | `boolean \| { minCutoff, beta }` | `true` | One-Euro filter, **not built yet** |

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
  lineWidth?: number;        // points, default 3
  pointRadius?: number;      // points, default 4
  minVisibility?: number;    // hide low-confidence joints, default 0.5
  only?: readonly JointName[];          // draw a subset
  angles?: readonly AngleOverlay[];     // draw angle arcs + degree labels
};

type AngleOverlay = {
  joint: AngleJointName;    // vertex of the angle
  label?: boolean;          // show the degree value, default true
  radius?: number;          // arc radius in points, default 40
  color?: string;           // defaults to the overlay color
  decimals?: number;        // 0 to 3, default 0
  minVisibility?: number;   // hide when tracking is poor, default 0.5
};
```

Native clamps every number here rather than trusting it, because an overlay config is the kind of
thing that gets built from app state and skips the type checker. `lineWidth` and `pointRadius`
cannot go below 0, `radius` cannot go below 1, `minVisibility` is clamped to 0 to 1, and
`decimals` is capped at 3: the degree label is formatted into a fixed 16-character buffer on the
draw path, so a larger value would build a longer string every frame only to have it truncated.

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

Drawn natively, nothing crosses to JavaScript. Declaring a joint here is one of the three things
that turn its angle on, along with an `angle` condition in a trigger and naming it in
`data.angles`. Nothing else does: a joint used as a comparison bound, or listed in `data.select`,
is a position, and computing its angle would be work nobody asked for.

`AngleJointName` is the 12 joints where two limb segments meet, see
[types](./types.md#anglejointname). `{ joint: 'nose' }` does not compile.

See [camera control](../camera-control.md) for how the three switches combine.

## Data

**Not built yet.** The whole `data` surface is validated and shaped in JavaScript, and the native
ring buffer that would fill it does not exist, so no frame is delivered on any platform today.

```ts
data?: {
  mode?: 'off' | 'throttled' | 'batched' | 'live';   // default 'off'
  throttleMs?: number;      // 'throttled' only, default 100
  flushMs?: number;         // 'batched' only, default 500
  landmarks?: boolean;
  worldLandmarks?: boolean;
  angles?: boolean | readonly AngleJointName[];
  select?: readonly JointName[];
};
```

`mode` is optional. Leaving `data` off entirely and leaving `data.mode` unset are the same thing,
zero crossings per second.

`angles: true` computes all 12. An array computes only those. Triggers and `overlay.angles` add
to whatever this asks for, so you do not have to repeat a joint you already referenced there.

`select` narrows the landmark buffer to exactly the joints you name, in the order you name them,
and nothing widens it. Angles are computed natively from the full 33 landmarks before the buffer
is narrowed, so asking for an angle on a joint you did not select costs nothing extra and does not
smuggle that joint into the payload. Reading one that `select` left out throws from the accessor.
See [data delivery](../data-delivery.md).

## Triggers

```ts
triggers?: readonly Trigger[];
```

Validated during render, so a bad config throws `PoseConfigError` at the call site rather than
becoming a trigger that silently never fires. The native evaluator is **not built yet**, so no
trigger fires on any platform today. See [trigger schema](./trigger-schema.md).

## Diagnostics

```ts
// LogLevelConfig
logLevel?: LogLevel | Readonly<Partial<Record<LogCategory, LogLevel>>>;   // default 'off'
onLog?: (entries: readonly LogEntry[]) => void;
```

Scoped to this camera. `setLogLevel()` sets it globally instead, and throws `PoseConfigError` on
an unknown level or category rather than doing nothing, because a silently ignored level looks
exactly like a bug in whatever you were trying to diagnose.

`setLogLevel()` does reach native and does set the level, but the batched stream to JavaScript is
**not built yet**: entries go to Logcat only, so `onLog` and `addLogListener()` stay quiet on both
platforms. `addLogListener()` is a multiset rather than a set, so the same function registered
twice needs two `remove()` calls. See [debugging](../debugging.md).

## Callbacks

See [events](./events.md).
