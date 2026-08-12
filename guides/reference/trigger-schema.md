# Trigger schema

Conceptual guide: [guides/triggers.md](./../triggers.md).

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
|---|---|
| `enter` | when `enter` becomes true |
| `exit` | when `exit` becomes true |
| `cycle` | once per full `enter` → `exit`, with `durationMs` |
| `while` | repeatedly, throttled, as long as `enter` holds |

## `Condition`

```ts
type Condition =
  | { angle: JointName; below?: number; above?: number; between?: [number, number] }
  | { landmarkX: JointName; below?: number | JointName; above?: number | JointName }
  | { landmarkY: JointName; below?: number | JointName; above?: number | JointName }
  | { velocityX: 'centerOfMass' | JointName; below?: number; above?: number }
  | { velocityY: 'centerOfMass' | JointName; below?: number; above?: number }
  | { visibility: JointName; above: number }
  | { all: Condition[] }
  | { any: Condition[] };
```

| Field | Unit |
|---|---|
| `angle` | degrees, 0–180 |
| `landmarkX` / `landmarkY` | normalized 0–1, origin top-left. A `JointName` compares against that joint |
| `velocityX` / `velocityY` | normalized units per second |
| `visibility` | 0–1 |

Conditions describe **a body**, never an activity — that's what keeps them reusable.

## Evaluation

Per frame, natively, per trigger:

```text
IDLE   + enter matches → ACTIVE  ; emit if 'enter'
ACTIVE + exit  matches → IDLE    ; count++ ; emit if 'cycle' or 'exit'
ACTIVE + still matches → emit if 'while' (throttled)
```

- `debounceMs` suppresses re-entry after a fire
- `minDurationMs` requires the condition to hold before the state change counts
- With `maxPoses > 1`, evaluation runs against the primary pose — largest bounding box, ties
  broken by distance from frame center
- `count` resets on unmount, **not** on camera switch

## Validation

Configs are validated in JS before reaching native. These are errors, not silent failures:

- unknown `JointName`
- `emit: 'cycle'` without `exit`
- `between` where `min >= max`
- duplicate `id`
- empty `all` / `any`
