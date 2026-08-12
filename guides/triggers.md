# Triggers

*Not built yet: the schema, the validator and the event plumbing are done, the native
evaluator that runs the state machine is not. Configs you write today are checked but never
fire.*

Business logic that runs natively, at frame rate, and crosses the bridge only when something
actually happens.

## The idea

Pose logic is almost always **cheap math every frame, a decision that fires rarely**.
A squat counter evaluates a knee angle 30×/sec but only needs to tell JS something once per rep.

Triggers split that in two:

| Half | Example | Runs | Rate |
| --- | --- | --- | --- |
| Detection: *did it happen?* | knee < 90° then > 160° | native | 30/sec, free |
| Reaction: *what do I do?* | increment, save, buzz | your JS in `onTrigger` | 1/rep |

You declare the detection half as data. You write the reaction half as ordinary React.

## Example: squat counter

```tsx
function SquatCounter() {
  const [reps, setReps] = useState(0);

  return (
    <PoseCamera
      style={{ flex: 1 }}
      overlay
      triggers={[
        {
          id: 'rep',
          enter: { angle: 'leftKnee', below: 90 },
          exit:  { angle: 'leftKnee', above: 160 },
          emit: 'cycle',
          debounceMs: 300,
          snapshot: true,
        },
      ]}
      onTrigger={(e) => {
        setReps(e.count);
        Haptics.impact();
        api.saveRep(e.timestamp, e.snapshot);
      }}
    />
  );
}
```

Thirty reps means **thirty bridge crossings**, not nine hundred. Sixty in this example, because
`snapshot: true` pays a second crossing to fetch the frame.

`snapshot: true` delivers the landmark set from the moment the trigger fired, the bottom of the
squat. Usually the only frame you cared about, and you got it without streaming any others.

The frame does not ride the event. It cannot: an Expo Modules event has no way to carry an
ArrayBuffer, so native holds the frame, puts a claim ticket on the event, and `<PoseCamera>`
redeems it before calling you. See
[ADR 0009](../docs/adr/0009-trigger-snapshots-are-claimed.md). Three things follow:

- a `snapshot: true` trigger reaches `onTrigger` one microtask later than a plain one, so two
  triggers firing on the same frame can arrive in the other order when only one has a snapshot
- if the redemption fails for any reason the event still arrives, with `snapshot` absent. Never
  branch on the snapshot to decide whether the trigger happened
- `data.select` narrows the snapshot like any other frame, so reading a joint you did not select
  throws from the accessor

## Schema

```ts
type Trigger = {
  id: string;                // unique within one camera
  enter: Condition;
  exit?: Condition;          // required for emit: 'cycle' and emit: 'exit'
  emit: 'enter' | 'exit' | 'cycle' | 'while';
  debounceMs?: number;       // suppress re-fire, default 0
  minDurationMs?: number;    // must hold before firing
  snapshot?: boolean;        // attach the PoseFrame
  throttleMs?: number;       // 'while' only, default 250
};
```

| `emit` | Fires |
| --- | --- |
| `enter` | when `enter` becomes true |
| `exit` | when `exit` becomes true |
| `cycle` | once per full `enter` → `exit`, with `durationMs` |
| `while` | repeatedly, throttled, as long as `enter` holds |

## Conditions

```ts
{ angle: 'leftKnee', below: 90 }
{ angle: 'leftKnee', above: 160 }
{ angle: 'leftKnee', between: [90, 130] }         // angle only, and 0 to 180

{ landmarkY: 'leftWrist', above: 0.4 }            // normalized, 0 = top
{ landmarkY: 'leftWrist', above: 'leftShoulder' } // relative to another joint
{ landmarkX: 'leftWrist', below: 'nose' }

{ velocityY: 'centerOfMass', above: 0.5 }         // normalized units/sec
{ velocityX: 'leftWrist', above: 1.2 }            // any joint, or centerOfMass
{ visibility: 'leftAnkle', above: 0.7 }           // gate on tracking quality

{ all: [ {...}, {...} ] }    // AND
{ any: [ {...}, {...} ] }    // OR
```

Conditions describe **a body**, never an activity, that's what keeps them reusable.

An `angle` condition is one of the three things that turn an angle on natively, together with
`overlay.angles` and `data.angles`. Naming a joint as a bound, `above: 'leftShoulder'`, does not:
that reads a position.

## Validation

Trigger configs are checked in JavaScript during render, before anything reaches native, and a
bad one throws `PoseConfigError` listing every problem with the path to it. A trigger that
reaches native and silently never fires is the failure mode this exists to prevent, so the
checks are deliberately picky:

- unknown keys are rejected, on a trigger and on a condition, so a typo is not silently ignored
- a condition takes exactly one of `angle`, `landmarkX`, `landmarkY`, `velocityX`, `velocityY`,
  `visibility`, `all`, `any`
- `between` is angle-only and its bounds are 0 to 180, as are `below` and `above` on an angle
- bounds that exclude each other, `{ above: 160, below: 90 }`, are reported as never able to fire
- a bound written as `undefined` counts as absent, so a condition spread from optional fields
  fails the same way a missing bound does
- ids must be unique within one camera, and `exit` is required by `emit: 'cycle'` and
  `emit: 'exit'`

Call [`validateTriggers`](./reference/trigger-schema.md#validation) yourself if you build configs
at runtime and would rather collect the issues than throw.

## Notes

**Hysteresis is your job.** Use distinct `enter` and `exit` thresholds (90 / 160, not 90 / 91),
or noise will fire the trigger repeatedly at the boundary.

**Gate on visibility** when a joint may leave frame:

```ts
enter: { all: [
  { visibility: 'leftKnee', above: 0.6 },
  { angle: 'leftKnee', below: 90 },
]}
```

**Use `bodySpan` for distance independence.** Absolute normalized distances change as the
subject moves toward or away from the camera; ratios against `bodySpan` don't.

**`count` resets on unmount**, not on camera switch. Switching cameras preserves trigger state.

**Multi-person:** with `maxPoses > 1`, triggers evaluate against the primary pose, largest
bounding box, ties broken by distance from frame center. Primary-pose selection ships with the
evaluator; the current Android build takes the first pose MediaPipe returns.

## When triggers aren't enough

Triggers express threshold state machines. They can't express arbitrary math, pose similarity
scoring, DTW, custom filters.

For that, `data.mode: 'batched'` gives you every frame at 4 crossings/sec, and worklets (0.2.0)
will run arbitrary JS at frame rate with no crossings at all.

See [recipes.md](./recipes/README.md) for ready-made configurations.
