# Data delivery

*Android only. The ring buffer, the wire encoder and all four modes are built and running there.
iOS has no module yet, so nothing on this page fires on iOS.*

Nothing crosses to JavaScript until you ask for it. Choosing *how* it crosses is the single
biggest performance decision you'll make.

## Modes

| Mode | Crossings/sec | Data loss | Fires |
| --- | --- | --- | --- |
| `off` *(default)* | **0** | n/a | nothing |
| `batched` | **4** | none | `onPoseBatch` |
| `throttled` | 20 | intermediate frames dropped | `onPose` |
| `live` | 60 | none | `onPose` |

`mode` is optional and defaults to `'off'`, so a `data` object that only sets `select` or
`angles` still costs nothing per frame.

Two crossings per emission, not one: native signals that frames are ready and the library answers
by pulling them in a single zero-copy buffer. Events cannot carry an ArrayBuffer, function returns
can, and the whole point of the wire format is that landmarks never get boxed. See
[ADR 0008](../docs/adr/0008-frames-are-drained-not-pushed.md). The pull is handled for you.

The ratio is what matters anyway: `batched` is 15 times cheaper than `live`, whichever way you
count.

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
  angles: ['leftKnee'],                      // one angle, not all twelve
  select: ['leftKnee', 'rightKnee', 'leftHip'],
}}
```

A full frame is 33 landmarks × 4 floats = 528 bytes. Three joints is 48 bytes.

`select` narrows the landmark buffer and does nothing else. It holds **exactly** the joints you
named, in the order you named them, and `frame.selection` lists them. Angles are computed
natively from all 33 landmarks before the buffer is narrowed, so asking for an angle never
widens the payload, and naming a joint in `select` never turns its angle on. The accessors
resolve positions for you, so nothing in your code changes when you add or drop a joint. Reading
one you did not select throws instead of returning a zero, see
[wire format](./reference/types.md#select-shrinks-the-buffer).

### Angles

`data.angles` is `boolean | readonly AngleJointName[]`. `true` computes all twelve, an array
computes only the ones you list. Triggers with an `angle` condition and every arc in
`overlay.angles` add to that set, so leaving `angles` unset still gets you the angles they need.

Nothing else adds to it. A joint named as a comparison bound, the `'leftShoulder'` in
`{ landmarkY: 'leftWrist', above: 'leftShoulder' }`, is a position. Computing its angle would be
work nobody asked for, and `data.select` is about the payload, not about geometry.

Each angle costs one float per frame in the buffer and a little trigonometry natively. Twelve of
them is 48 bytes.

## Reading a frame

```ts
import { landmark } from 'react-native-pose-detection';

function handle(frame: PoseFrame) {
  const knee = landmark(frame, 'leftKnee');   // no copy, no parse
  const angle = frame.angles?.leftKnee;       // partial: only requested joints are computed
  if (knee.visibility > 0.6 && angle !== undefined && angle < 90) { /* … */ }
}
```

`frame.landmarks` is a `Float32Array`, not an array of objects, see
[types](./reference/types.md#wire-format). On a `live`-mode path, `landmarkInto()` reads the same
four floats without allocating, see [accessors](./reference/types.md#accessors).

## Retaining frames

A frame's `landmarks` is a `subarray` **view** into the buffer that drain returned, not a copy.
That is what makes delivery free, and it has two consequences worth knowing before you keep a
frame past the callback that handed it to you:

- holding one frame holds the whole drained buffer, every other frame in that batch included
- the numbers are only meaningful while that buffer is alive

So copy what you retain:

```ts
onPoseBatch={(frames) => {
  recorder.push(
    frames.map((frame) => ({ ...frame, landmarks: frame.landmarks.slice() })),
  );
}}
```

`.slice()` on a `Float32Array` allocates a real copy, 528 bytes for a full frame. `.subarray()`
does not, and is what you already have.

The array `onPoseBatch` receives is built fresh per flush; it is the landmarks inside it that are
views.

## Dropped frames

The native buffer is bounded. If a consumer stalls, the oldest frames are dropped and counted
rather than allowed to grow, memory is never traded for throughput. The count reaches you:

```tsx
<PoseCamera
  data={{ mode: 'batched' }}
  onPoseBatch={handle}
  onFramesDropped={(count) => console.warn(`${count} frames dropped`)}
/>
```

It is reported per delivery, so an occasional one is normal on a busy frame and a steady trickle
means the callback is doing too much work. There is no other way to see this: the drop count
rides in the buffer header and would otherwise be decoded and thrown away.

## When a batch can't be trusted

Decoding never throws. A buffer whose blocks do not add up comes back as an error and reaches
you as `onError({ code: 'DETECTION_FAILED', fatal: false })` with no frames.

A batch is also dropped whole when its joint count or angle count disagrees with your current
props, which happens for one drain after you change `select` or `angles` while frames are already
buffered. Dropping it is deliberate: the alternative is attaching your new joint names to a
buffer encoded under the old ones, which silently hands you another joint's numbers. Losing one
drain is self-healing, mislabelling it is not.
