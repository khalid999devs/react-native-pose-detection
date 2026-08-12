# Trigger schema

Conceptual guide: [guides/triggers.md](../triggers.md).

## `Trigger`

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

## `Condition`

```ts
type Condition =
  | { angle: AngleJointName; below?: number; above?: number; between?: [number, number] }
  | { landmarkX: JointName; below?: number | JointName; above?: number | JointName }
  | { landmarkY: JointName; below?: number | JointName; above?: number | JointName }
  | { velocityX: 'centerOfMass' | JointName; below?: number; above?: number }
  | { velocityY: 'centerOfMass' | JointName; below?: number; above?: number }
  | { visibility: JointName; above: number }
  | { all: Condition[] }
  | { any: Condition[] };
```

A condition carries exactly one of those keys. Mixing two, `{ angle: 'leftKnee', landmarkY: 'nose' }`,
is a validation error rather than one of them being silently ignored.

| Field | Unit |
| --- | --- |
| `angle` | degrees, 0–180. Vertex must be an [`AngleJointName`](./types.md#anglejointname) |
| `landmarkX` / `landmarkY` | normalized 0–1, origin top-left. A `JointName` compares against that joint |
| `velocityX` / `velocityY` | normalized units per second |
| `visibility` | 0–1 |

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

Configs are validated in JS before reaching native. These are errors, not silent failures:

- unknown `JointName`
- an `angle` on a joint that has none, `nose` for instance
- missing or empty `id`, or a duplicate `id`
- unknown `emit`
- `emit: 'cycle'` or `emit: 'exit'` without `exit`
- a condition with no key, or with more than one
- a condition with no bound at all, no `below`, `above`, or `between`
- `between` where `min >= max`
- an angle bound outside 0–180
- `{ below: 90, above: 160 }`, which no angle can satisfy, so it would never fire
- `visibility` without `above`, or `above` outside 0–1
- a negative `debounceMs`, `minDurationMs`, or `throttleMs`
- empty `all` / `any`, or nesting deeper than 8 levels

Each issue reports the path that caused it:

```text
2 configuration problems:
  triggers[0].enter.angle: "nose" has no angle, only joints where two limb segments meet do
  triggers[0].exit: is required when emit is 'cycle'
```

`<PoseCamera>` runs these on mount. You can run them yourself with `validateTriggers()`, see
[types → validation](./types.md#validation).
