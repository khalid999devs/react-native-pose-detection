# Types

## `PoseFrame`

```ts
type PoseFrame = {
  landmarks: Float32Array;            // 33 × [x, y, z, visibility]
  selection?: readonly JointName[];   // set when data.select narrowed the buffer
  worldLandmarks?: Float32Array;      // metric 3D, origin at hip center
  angles?: Partial<Record<AngleJointName, number>>;   // degrees
  centerOfMass: { x: number; y: number };
  velocity: { x: number; y: number };   // normalized units/sec
  bodySpan: number;                     // for scale-independent thresholds
  timestamp: number;
  processingMs: number;
};
```

Only fields enabled in `data` are populated. `angles` is partial because angles are computed
lazily, if your triggers and `select` reference two joints, two angles are computed, not ten.

`timestamp` is milliseconds on a monotonic clock, not wall clock. It is the same clock
`LogEntry.timestamp` uses, so a log line can be matched to the frame that produced it.

### Wire format

Landmarks cross as a `Float32Array` over an ArrayBuffer, not JSON.

| Encoding | Bytes/frame | Parse cost |
| --- | --- | --- |
| JSON objects × 33 | ~3,000 | high |
| `Float32Array` | **528** | ~zero |

Layout is flat: `[x₀, y₀, z₀, v₀, x₁, y₁, z₁, v₁, …]`. The constants are exported, so you never
have to hard-code a stride:

| Constant | Value |
| --- | --- |
| `LANDMARK_COUNT` | `33` |
| `LANDMARK_STRIDE` | `4` |
| `LANDMARK_OFFSET` | `{ x: 0, y: 1, z: 2, visibility: 3 }` |
| `FULL_FRAME_FLOAT_COUNT` | `132` |
| `FULL_FRAME_BYTE_LENGTH` | `528` |

Coordinates are normalized `0…1` relative to the **analysis frame**, origin top-left.
Front-camera `x` is un-mirrored so it matches the real world, not the preview. The overlay
compensates automatically.

`worldLandmarks` uses the same stride and the same `selection`, in meters, with the origin at
the hip midpoint.

### `select` shrinks the buffer

With `data.select`, the buffer carries only the joints you named, in the order you named them,
and `frame.selection` lists them. Three joints is 12 floats, 48 bytes, instead of 528.

The accessors read `selection` for you, so `landmark(frame, 'leftKnee')` works the same either
way. Asking for a joint you did not select throws rather than returning a silent zero.

`frame.selection` is the same frozen array on every frame of a session, it is not rebuilt per
frame, and the accessors cache their lookup against it.

## Accessors

Reading the buffer by hand is easy to get wrong once `select` is in play, so read it with these:

```ts
import { landmark, landmarkInto, createLandmark, isVisible } from 'react-native-pose-detection';

const knee = landmark(frame, 'leftKnee');   // { x, y, z, visibility }
```

| Function | Returns | Allocates |
| --- | --- | --- |
| `landmark(frame, joint)` | `Landmark` | one small object |
| `landmarkInto(frame, joint, out)` | the `out` you passed | nothing |
| `createLandmark()` | a reusable `out` target | once |
| `worldLandmark(frame, joint)` | `Landmark \| null` | one small object |
| `visibilityOf(frame, joint)` | `number`, `0` when absent | nothing |
| `isVisible(frame, joint, min?)` | `boolean`, `min` defaults to `0.5` | nothing |
| `hasLandmark(frame, joint)` | `boolean` | nothing |

Nothing here copies or parses the buffer. On a `live`-mode path where allocation matters, hoist
one target and reuse it:

```ts
const knee = createLandmark();

function handle(frame: PoseFrame) {
  landmarkInto(frame, 'leftKnee', knee);   // zero allocation
}
```

`landmark()` and `landmarkInto()` throw `PoseConfigError` when the joint is not in the frame,
either because `data.landmarks` is off or because `data.select` excluded it. That is a config
mistake, not a runtime condition, so it fails loudly. Use `hasLandmark()` or `visibilityOf()`
when you would rather branch than catch.

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

String constants are exported for all 33. `JointName` is a union of those literals, `JOINT_NAMES`
is the ordered list, and `JOINT_INDEX` maps a name to its position in the buffer.
`isJointName(value)` is a type guard for when a joint name arrives from outside your code.

## `AngleJointName`

An angle needs two limb segments meeting at a vertex. `nose` has none, so only 12 joints have
one:

```text
leftShoulder  rightShoulder   leftElbow  rightElbow   leftWrist  rightWrist
leftHip       rightHip        leftKnee   rightKnee    leftAnkle  rightAnkle
```

`Condition.angle`, `AngleOverlay.joint`, and the keys of `PoseFrame.angles` are all
`AngleJointName` rather than `JointName`. Writing `{ angle: 'nose' }` is a type error, and it is
caught by [validation](#validation) at runtime too, instead of becoming a trigger that never
fires.

`ANGLE_JOINT_NAMES` is the list, `isAngleJointName(value)` is the type guard, and `ANGLE_JOINTS`
gives the triple each angle is measured from as `[proximal, vertex, distal]`. `leftKnee` is
`['leftHip', 'leftKnee', 'leftAnkle']`.

## Skeleton connections

`POSE_CONNECTIONS` is the 35-pair skeleton, as joint-name pairs. `POSE_CONNECTION_INDICES` is the
same list as buffer indices, which is what the native renderers iterate, and `CONNECTION_COUNT`
is `35`. Both platforms draw from this one table, so the two overlays cannot drift apart.

## `Profile` / `ProfileState`

```ts
type Profile = 'auto' | 'efficient' | 'balanced' | 'quality' | 'unrestricted';

type ProfileState = {
  profile: Profile;
  phase: 'calibrating' | 'settled' | 'cached';
  source: 'measured' | 'static' | 'cache';
  tier: 'high' | 'medium' | 'low';
  resolved: { delegate: 'GPU' | 'CPU'; targetFps: number;
              preview: '480p' | '720p' | '1080p';
              analysis: '360p' | '480p' | '720p' };
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

## Validation

Trigger configs are checked in JavaScript before they reach native:

```ts
import { validateTriggers, assertValidTriggers } from 'react-native-pose-detection';

validateTriggers(triggers);        // → ValidationIssue[], empty when the config is fine
assertValidTriggers(triggers);     // → throws PoseConfigError listing every problem
```

```ts
type ValidationIssue = { path: string; message: string };
```

`path` points at the exact field, for example `triggers[0].enter.angle`. `<PoseCamera>` runs
`assertValidTriggers` on mount, so you only need to call these yourself when you build trigger
configs dynamically and want to check one before rendering.

The full rule list is in [trigger schema → validation](./trigger-schema.md#validation).

## Events

See [events](./events.md) for `ReadyEvent`, `ErrorEvent`, `TriggerEvent`, `PerformanceEvent`.
