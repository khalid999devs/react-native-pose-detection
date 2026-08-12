# Data delivery

Nothing crosses to JavaScript until you ask for it. Choosing *how* it crosses is the single
biggest performance decision you'll make.

## Modes

| Mode | Crossings/sec | Data loss | Fires |
| --- | --- | --- | --- |
| `off` *(default)* | **0** | n/a | nothing |
| `batched` | **2** | none | `onPoseBatch` |
| `throttled` | 10 | intermediate frames dropped | `onPose` |
| `live` | 30 | none | `onPose` |

Triggers are not a mode. They fire on their own schedule, roughly once per event, and they keep
working at `mode: 'off'`. That combination, no frames crossing and triggers still firing, is the
default and the cheapest thing this library does.

```tsx
<PoseCamera data={{ mode: 'batched', flushMs: 500 }} onPoseBatch={handle} />
```

### Which to use

**Business logic → triggers.** A rep counter needs to tell JS something once per rep, not thirty
times a second. See [triggers](./triggers.md).

**Recording or offline analysis → `batched`.** Every frame, no loss, 15× fewer crossings than
`live`. This is the mode most people reaching for `live` actually want.

**Driving React state → `throttled`.** 10 Hz is more than enough for anything a human reads.

**`live` is for debugging.** If you're using it in production, `batched` or a trigger almost
certainly does the job for a fraction of the cost.

## Trimming the payload

Frequency is only half of it. What you carry matters just as much:

```tsx
data={{
  mode: 'throttled',
  landmarks: false,                          // skip raw landmarks entirely
  angles: true,
  select: ['leftKnee', 'rightKnee', 'leftHip'],
}}
```

A full frame is 33 landmarks × 4 floats = 528 bytes. Three joints is 48 bytes. `select` also
drives **lazy angle computation**: only the joints you name are computed natively, so trimming
the payload also reduces per-frame CPU.

The narrowed buffer holds those joints in the order you listed them, and `frame.selection` names
them. The accessors handle that for you, so nothing in your code changes when you add or drop a
joint. Reading one you did not select throws instead of returning a zero, see
[wire format](./reference/types.md#select-shrinks-the-buffer).

## Reading a frame

```ts
import { landmark } from 'react-native-pose-detection';

function handle(frame: PoseFrame) {
  const knee = landmark(frame, 'leftKnee');   // no copy, no parse
  const angle = frame.angles?.leftKnee;       // partial: only referenced joints are computed
  if (knee.visibility > 0.6 && angle !== undefined && angle < 90) { /* … */ }
}
```

`frame.landmarks` is a `Float32Array`, not an array of objects, see
[types](./reference/types.md#wire-format). On a `live`-mode path, `landmarkInto()` reads the same
four floats without allocating, see [accessors](./reference/types.md#accessors).

## Batch consumers

`onPoseBatch` hands you an array that is **reused between flushes**. Copy anything you intend
to retain:

```ts
onPoseBatch={(frames) => {
  recorder.push(frames.map(cloneFrame));   // retaining `frames` directly is a bug
}}
```

The native buffer is bounded. If a consumer stalls, the oldest frames are dropped and counted
rather than allowed to grow, memory is never traded for throughput.
