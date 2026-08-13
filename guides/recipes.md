# What you can build

**Nothing here ships in the library.** Pose detection provides primitives; domain logic is
yours. That line is deliberate: anything that needs to know what activity the user is doing
belongs in your app, tuned against your own users and camera placement. This page is a map of
what the primitives can carry, not a set of finished features.

## The shape of a trigger

Every idea below is the same construction: a condition that opens it, optionally one that closes
it, and a choice of when to hear about it.

```ts
{
  id: string,            // yours, unique, carried on every event
  enter: Condition,      // when this becomes true, the trigger is in
  exit?: Condition,      // when this becomes true afterwards, it is out again
  emit: 'enter' | 'exit' | 'while' | 'cycle',
  minDurationMs?: number, // enter must hold this long before it counts
  debounceMs?: number,    // ignore re-entries this soon after the last
  throttleMs?: number,    // for 'while': at most one event per interval
  snapshot?: boolean,     // claim the exact frame the trigger fired on
}
```

A `Condition` reads one signal and compares it. The signals, and what each is good for:

| Signal | Reads | Good for |
| --- | --- | --- |
| `angle` | the unsigned angle at a joint, 0 to 180 | bends and extensions: knees, elbows, hips |
| `landmarkX` / `landmarkY` | a joint's normalized position, or against another joint | above, below, crossed: wrist over shoulder, nose past the hip |
| `visibility` | how confidently a joint is seen, 0 to 1 | gating everything else so it only fires while the body is actually in frame |
| `velocityX` / `velocityY` | how fast a joint or the center of mass is moving | takeoffs, swings, sudden movement |

Conditions compose with `all` and `any`, so "knee bent AND knee visible" is one `enter`.
The full grammar, every property and every validation rule live in the
[trigger schema](./reference/trigger-schema.md); the concepts and the event flow are in
[triggers](./triggers.md).

## What is feasible

Each of these is one or two triggers plus your own numbers. None needs frame data streamed to
JavaScript.

- **Rep counting.** A rep is an enter-and-exit cycle on one angle: bend past a threshold, return
  past another, `emit: 'cycle'` counts once per round trip. `durationMs` on the event is the
  rep's tempo for free. Squats, push-ups, curls, anything with a hinge.
- **Hold and isometric timers.** A position held is `emit: 'while'` with a `throttleMs`: one
  event per second for as long as the body stays inside the window. `minDurationMs` keeps a
  drive-by through the position from starting the clock. Planks, wall sits, balance holds.
- **Jumps and airtime.** Takeoff is upward velocity of the center of mass; the cycle's duration
  is the flight time. Feasible as a relative measure; treat height computed from it as an
  estimate, because it assumes takeoff and landing at the same height and moves with frame rate.
- **Position and posture checks.** Comparing one joint against another needs no numbers at all:
  a wrist above a shoulder, a nose sinking below it. With `minDurationMs` this becomes a posture
  warning that fires once, not thirty times a second.
- **Presence and framing.** `visibility` conditions tell you the joints your logic needs are
  actually seen, and they are the gate every other trigger should stand behind. When you need
  how much of the frame the body fills, `bodySpan` rides on every frame through
  [data delivery](./data-delivery.md) rather than in a condition.
- **Capture on the moment.** `snapshot: true` claims the exact frame a trigger fired on, so "the
  photo at the top of the jump" is the trigger plus one fetch, not a stream you filter yourself.
- **Form deviation.** A second trigger watching the failure shape of the first: the hip angle
  leaving its window mid-plank, a knee collapsing inward past a bound. Feasible as long as the
  deviation reads on one of the signals above.

## What is not feasible

Honest limits, so you do not discover them in production:

- **Anything needing two reliable skeletons at once.** The model tracks one primary subject
  well; a second body is best-effort. Competitive or partner scenarios are the wrong fit.
- **Absolute distances in meters** from screen coordinates alone. Use ratios against `bodySpan`,
  or `worldLandmarks` where metric coordinates matter.
- **Signals the skeleton does not carry**: grip, contact force, ground pressure, equipment.
- **A body the detector cannot anchor**: no torso in frame means no pose, however the
  thresholds are set.

## Tuning whatever you build

| Symptom | Fix |
| --- | --- |
| Fires twice per rep | Widen the gap between the `enter` and `exit` thresholds; add `debounceMs` |
| Misses reps | Loosen thresholds, or check the joint is visible throughout the movement |
| Fires when nobody is there | Gate with a `visibility` condition |
| Works close, fails far away | Compare joints against each other instead of fixed coordinates |
| Erratic at frame edges | Raise the visibility gate; reposition the camera |

Thresholds are yours to find: camera placement, lens, lighting and your users' bodies all move
them, which is exactly why they are not defaults in a library.
