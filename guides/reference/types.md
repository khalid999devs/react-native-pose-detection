# Types

## `PoseFrame`

```ts
type PoseFrame = {
  landmarks: Float32Array;          // 33 × [x, y, z, visibility]
  worldLandmarks?: Float32Array;    // metric 3D, origin at hip center
  angles?: Record<JointName, number>;   // degrees
  centerOfMass: { x: number; y: number };
  velocity: { x: number; y: number };   // normalized units/sec
  bodySpan: number;                     // for scale-independent thresholds
  timestamp: number;
  processingMs: number;
};
```

Only fields enabled in `data` are populated. Angles are computed lazily, if your triggers
and `select` reference two joints, two angles are computed, not ten.

### Wire format

Landmarks cross as a `Float32Array` over an ArrayBuffer, not JSON.

| Encoding | Bytes/frame | Parse cost |
| --- | --- | --- |
| JSON objects × 33 | ~3,000 | high |
| `Float32Array` | **528** | ~zero |

Layout is flat: `[x₀, y₀, z₀, v₀, x₁, y₁, z₁, v₁, …]`. Use the accessor rather than indexing
by hand:

```ts
import { landmark } from 'react-native-pose-detection';

const knee = landmark(frame, 'leftKnee');   // { x, y, z, visibility }: no copy
```

Coordinates are normalized `0…1` relative to the **analysis frame**, origin top-left.
Front-camera `x` is un-mirrored so it matches the real world, not the preview. The overlay
compensates automatically.

## `JointName` / landmark indices

BlazePose, 33 points:

```text
0  nose          11 leftShoulder   23 leftHip     29 leftHeel
2  leftEye       12 rightShoulder  24 rightHip    30 rightHeel
5  rightEye      13 leftElbow      25 leftKnee    31 leftFootIndex
                 14 rightElbow     26 rightKnee   32 rightFootIndex
                 15 leftWrist      27 leftAnkle
                 16 rightWrist     28 rightAnkle
```

String constants are exported for all 33. `JointName` is a union of those literals.

## `Profile` / `ProfileState`

```ts
type Profile = 'auto' | 'efficient' | 'balanced' | 'quality' | 'unrestricted';

type ProfileState = {
  profile: Profile;
  phase: 'calibrating' | 'settled' | 'cached';
  source: 'measured' | 'static' | 'cache';
  tier: 'high' | 'medium' | 'low';
  resolved: { delegate: 'GPU' | 'CPU'; targetFps: number;
              preview: string; analysis: string };
  p50InferenceMs: number;
};
```

## `CameraState`

```ts
type CameraState = {
  facing: 'front' | 'back';
  active: boolean;
  detecting: boolean;
  fps: number;
  delegate: 'GPU' | 'CPU';
  deviceTier: 'high' | 'medium' | 'low';
};
```

## Events

See [events](./events.md) for `ReadyEvent`, `ErrorEvent`, `TriggerEvent`, `PerformanceEvent`.
