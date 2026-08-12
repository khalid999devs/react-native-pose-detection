# Trigger schema

Conceptual guide: [guides/triggers.md](../triggers.md).

The schema and its validator are done. The native evaluator is **not built yet** on either
platform, so a trigger you pass today is type-checked, validated and handed to the view, and it
never fires. Everything on this page describes the contract both halves are written against.

## `Trigger`

```ts
type Trigger = {
  id: string;
  enter: Condition;
  exit?: Condition;          // required for emit: 'cycle' and emit: 'exit'
  emit: 'enter' | 'exit' | 'cycle' | 'while';
  debounceMs?: number;       // suppress re-fire, default 0
  minDurationMs?: number;    // must hold before firing, default 0
  snapshot?: boolean;        // attach the PoseFrame from the moment it fired
  throttleMs?: number;       // 'while' only, default 250
};
```

| `emit` | Fires |
| --- | --- |
| `enter` | when `enter` becomes true |
| `exit` | when `exit` becomes true |
| `cycle` | once per full `enter` → `exit`, with `durationMs` |
| `while` | repeatedly, throttled, as long as `enter` holds |

`snapshot: true` costs you a microtask: the frame cannot ride the event, so native holds it and
sends a ticket that `<PoseCamera>` redeems before calling `onTrigger`. The frame you get back is
narrowed by `data.select` like any other. See
[events → how `snapshot` actually arrives](./events.md#how-snapshot-actually-arrives).

## `Condition`

```ts
type Condition =
  | { angle: AngleJointName; below?: number; above?: number; between?: readonly [number, number] }
  | { landmarkX: JointName; below?: number | JointName; above?: number | JointName }
  | { landmarkY: JointName; below?: number | JointName; above?: number | JointName }
  | { velocityX: 'centerOfMass' | JointName; below?: number; above?: number }
  | { velocityY: 'centerOfMass' | JointName; below?: number; above?: number }
  | { visibility: JointName; above: number }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] };
```

A condition carries exactly one of those keys. Mixing two, `{ angle: 'leftKnee', landmarkY: 'nose' }`,
is a validation error rather than one of them being silently ignored.

| Field | Unit |
| --- | --- |
| `angle` | degrees, 0 to 180. Vertex must be an [`AngleJointName`](./types.md#anglejointname) |
| `landmarkX` / `landmarkY` | normalized 0 to 1, origin top-left. A `JointName` compares against that joint |
| `velocityX` / `velocityY` | normalized units per second |
| `visibility` | 0 to 1 |

`between` is angle-only. On a landmark or velocity condition it is rejected rather than ignored,
because those are unbounded scales where a range is better written as `below` plus `above` and a
silently dropped key is worse than a message.

An `angle` condition is what turns that joint's angle on. A joint used as a comparison bound,
`{ landmarkY: 'leftWrist', below: 'leftShoulder' }`, is a position: it does not cause an angle to
be computed. Neither does listing a joint in `data.select`.

Conditions describe **a body**, never an activity, that's what keeps them reusable.

## Evaluation

Per frame, natively, per trigger:

```text
IDLE   + enter matches → ACTIVE  ; emit if 'enter'
ACTIVE + exit  matches → IDLE    ; count++ ; emit if 'cycle' or 'exit'
ACTIVE + still matches → emit if 'while' (throttled)
```

- `debounceMs` suppresses re-entry after a fire
- `minDurationMs` requires the condition to hold before the state change counts
- With `maxPoses > 1`, evaluation runs against the primary pose, largest bounding box, ties
  broken by distance from frame center
- `count` resets on unmount, **not** on camera switch

## Validation

Configs are validated in JavaScript before reaching native. These are errors, not silent failures:

- an unknown key anywhere on a trigger or a condition
- unknown `JointName`
- an `angle` on a joint that has none, `nose` for instance
- missing or empty `id`, or a duplicate `id`
- unknown `emit`
- `emit: 'cycle'` or `emit: 'exit'` without `exit`
- a condition with no key, or with more than one
- a condition with no bound at all, no `below`, `above`, or `between`
- `between` on a landmark or velocity condition, where it does not belong
- `between` that is not a `[min, max]` pair, or where `min >= max`
- any angle bound outside 0 to 180, including both ends of a `between`
- `{ below: 90, above: 160 }`, which nothing can satisfy, on any of the three bounded condition
  kinds, not just angles
- `visibility` without `above`, or `above` outside 0 to 1
- a `debounceMs`, `minDurationMs`, or `throttleMs` that is negative or not finite
- a non-boolean `snapshot`
- empty `all` / `any`, or nesting deeper than 8 levels

A bound that is present but explicitly `undefined` counts as absent, so a condition assembled by
spreading optional fields is judged by what it actually has rather than by which keys exist.

A cyclic or `BigInt`-carrying config is reported as an issue, not thrown from inside the
validator. Building the error message must not itself be the thing that fails while reporting
someone else's mistake, and the depth limit is what makes the walk terminate.

Each issue reports the path that caused it:

```text
2 configuration problems:
  triggers[0].enter.angle: "nose" has no angle, only joints where two limb segments meet do
  triggers[0].exit: is required when emit is 'cycle'
```

`<PoseCamera>` runs these during render, not in an effect, so the throw lands at the call site
before any other code walks the config. You can run them yourself with `validateTriggers()`, see
[types → validation](./types.md#validation).
