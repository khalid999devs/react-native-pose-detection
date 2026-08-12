# Triggers

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

Thirty reps means **thirty bridge crossings**, not nine hundred.

`snapshot: true` delivers the full landmark set from the moment the trigger fired, the bottom
of the squat. Usually the only frame you cared about, and you got it without streaming any others.

## Schema

```ts
type Trigger = {
  id: string;
  enter: Condition;
  exit?: Condition;          // required for emit: 'cycle'
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
{ angle: 'leftKnee', between: [90, 130] }

{ landmarkY: 'leftWrist', above: 0.4 }            // normalized, 0 = top
{ landmarkY: 'leftWrist', above: 'leftShoulder' } // relative to another joint
{ landmarkX: 'leftWrist', below: 'nose' }

{ velocityY: 'centerOfMass', above: 0.5 }         // normalized units/sec
{ visibility: 'leftAnkle', above: 0.7 }           // gate on tracking quality

{ all: [ {...}, {...} ] }    // AND
{ any: [ {...}, {...} ] }    // OR
```

Conditions describe **a body**, never an activity, that's what keeps them reusable.

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
bounding box, ties broken by distance from frame center.

## When triggers aren't enough

Triggers express threshold state machines. They can't express arbitrary math, pose similarity
scoring, DTW, custom filters.

For that, `data.mode: 'batched'` gives you every frame at 2 crossings/sec today, and worklets
(0.2.0) will run arbitrary JS at frame rate with no crossings at all.

See [recipes.md](./recipes/README.md) for ready-made configurations.
