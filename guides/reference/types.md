# Types

Everything on this page is exported from the package root, and the root is the only entry point.
The `exports` map blocks deep imports like `react-native-pose-detection/build/wire`, so anything
not re-exported from the root is internal and can change without a major version.

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

**Both platforms produce these**, from one wire format written three times and guarded by a test
that reads all three. `onPose` and `onPoseBatch` fire as soon as `data.mode` is anything but
`off`.

Every field is `readonly` in the real declaration, dropped above for readability. The same is true
of the event types in [events](./events.md).

Only fields enabled in `data` are populated. `angles` is partial because only referenced angles
are computed, and exactly three things reference one: an `angle` condition in a trigger, an entry
in `overlay.angles`, and `data.angles`. Nothing else does. Naming a joint as a comparison bound
(`below: 'leftShoulder'`) or in `data.select` asks for its position, not its angle.

`timestamp` is milliseconds on a monotonic clock, not wall clock. It is the same clock
`LogEntry.timestamp` uses, so a log line can be matched to the frame that produced it. It marks
when the pose became known, not when the sensor exposed the frame.

**`NaN` means unknown, and it is never a substitute for a real value.** An angle whose three
points are collinear, a `centerOfMass` with nothing visible enough to weigh, and `velocity` on the
first frame of a pose are all `NaN`, because `0` would read as a measurement: a folded joint, a
body at the origin, a body standing still. Comparisons against `NaN` are false, so a trigger built
on one simply does not fire, which is the behavior you want from a value nobody measured. Guard
with `Number.isNaN` if you display it.

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

`frame.landmarks` is a `subarray` view into the buffer the drain returned, never a copy. Retaining
a frame retains that whole buffer, and the numbers are only stable while it lives, so copy with
`.slice()` if you keep anything past the callback.

Coordinates are normalized `0…1` relative to the **analysis frame**, origin top-left.
Front-camera `x` is un-mirrored so it matches the real world, not the preview. The overlay
compensates automatically.

Normalizing `x` by the frame width and `y` by the height independently makes the space
anisotropic, so one unit of `x` is not one unit of `y` on anything but a square frame. That does
not matter for a threshold on a single axis, which is what `landmarkX` and `landmarkY` are. It
matters enormously for anything angular, which is why angles are computed natively with an aspect
correction rather than read off these coordinates.

`worldLandmarks` uses the same stride and the same `selection`, in meters, with the origin at
the hip midpoint.

### `select` shrinks the buffer

With `data.select`, the buffer carries only the joints you named, in the order you named them,
and `frame.selection` lists them. Three joints is 12 floats, 48 bytes, instead of 528.

It is exactly those joints and nothing else. Angles are computed natively from the full 33
landmarks before the buffer is narrowed, so referencing an angle never widens the payload and
never adds a joint you did not ask for. A `PoseFrame` handed to you as a trigger snapshot is
narrowed the same way.

The accessors read `selection` for you, so `landmark(frame, 'leftKnee')` works the same either
way. Asking for a joint you did not select throws rather than returning a silent zero.

`frame.selection` is one frozen array instance, held for as long as the joint list is unchanged,
and the accessors cache their name-to-position map against that identity in a `WeakMap`. It is
held by content, not by prop identity, so passing `data` as an inline object literal (which every
example here does, and which produces a new array on every render) does not churn it. Changing
which joints you select does, and it should: it is a different buffer shape.

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

`landmark()`, `landmarkInto()` and `worldLandmark()` throw `PoseConfigError` when the joint is not
in the frame, either because `data.landmarks` is off or because `data.select` excluded it. That is
a config mistake, not a runtime condition, so it fails loudly with the joint name in the message.
`worldLandmark()` returns `null` for the different case of `data.worldLandmarks` being off, which
is a whole missing block rather than a joint you forgot to select. Use `hasLandmark()` or
`visibilityOf()` when you would rather branch than catch.

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
`isJointName(value)` is a type guard for when a joint name arrives from outside your code. It
matches against a `Set`, not the `in` operator, so `'toString'` and `'constructor'` are rejected
like any other unknown string.

## `AngleJointName`

An angle needs two limb segments meeting at a vertex. `nose` has none, so only 12 joints have
one:

```text
leftShoulder  rightShoulder   leftElbow  rightElbow   leftWrist  rightWrist
leftHip       rightHip        leftKnee   rightKnee    leftAnkle  rightAnkle
```

`Condition.angle`, `AngleOverlay.joint`, the elements of `data.angles`, and the keys of
`PoseFrame.angles` are all `AngleJointName` rather than `JointName`. Writing `{ angle: 'nose' }`
is a type error, and it is caught by [validation](#validation) at runtime too, instead of becoming
a trigger that never fires.

`ANGLE_JOINT_NAMES` is the list and `isAngleJointName(value)` is the type guard, with the same
prototype-key handling as `isJointName`. `ANGLE_JOINTS` gives the triple each angle is measured
from as `[proximal, vertex, distal]`, so `leftKnee` is `['leftHip', 'leftKnee', 'leftAnkle']`.

Angles are degrees, 0 to 180, always. They come out of an `acos`, so 180 is the ceiling and a
bound above it can never be met.

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

Nothing returns a `ProfileState` yet. `getProfile()` throws until calibration lands, see
[ref methods](./ref-methods.md#setprofile-and-getprofile-throw).

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
`assertValidTriggers` during render, not in an effect, so a bad config fails at the call site
before anything walks the conditions. You only need to call these yourself when you build trigger
configs dynamically and want to check one before rendering.

`PoseConfigError` carries every problem it found on `.issues`, not just the first, so a generated
config can be fixed in one pass. `setLogLevel()` throws the same error type for an unknown level
or category.

The full rule list is in [trigger schema → validation](./trigger-schema.md#validation).

## Events

See [events](./events.md) for `ReadyEvent`, `ErrorEvent`, `TriggerEvent`, `PerformanceEvent`.
