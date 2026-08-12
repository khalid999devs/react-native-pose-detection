# 0004: Pin the model revision, not `latest`

**Status:** accepted
**Date:** 2026-08-12

## Context

Google publishes the pose landmarker under two paths that both resolve today:

```text
.../pose_landmarker_full/float16/1/pose_landmarker_full.task
.../pose_landmarker_full/float16/latest/pose_landmarker_full.task
```

Revision `1` is the only revision that has ever been published. There is no `2`, and float16
is the only data type, so `latest` and `1` are the same weights.

They are not the same bytes. The `full` bundle differs between the two paths in exactly four
bytes, all of them zip timestamp fields written two seconds apart when the objects were
uploaded. Unpacked, the two `.tflite` files inside are byte identical.

```text
full  /1/       sha256 5134a3aa…9011b1
full  /latest/  sha256 4eaa5eb7…cec4ad
```

That is enough to break a checksum. `lite` and `heavy` happen to match across both paths, so
the problem would have shown up on one variant only, on whichever machine hit the wrong path
first, which is the worst way to find it.

Beyond the byte drift, `latest` is a mutable alias by design. If Google ever ships revision 2,
every consumer's next prebuild silently swaps the model under them, and ADR 0002 makes the
checksum a hard failure, so the build breaks rather than degrades.

## Decision

The manifest pins `/float16/1/` and records the SHA-256 of that exact object.

| Variant | Bytes | SHA-256 |
| --- | --- | --- |
| `lite` | 5,777,746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `full` | 9,398,198 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| `heavy` | 30,664,242 | `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` |

All three carry a 224x224 detector and a 256x256 landmark model, so analysis resolution does
not change with the variant. Only the landmark model's weight count does.

Moving to a future revision is a manifest change with its own release note, never an ambient
one.

## Consequences

- A checksum failure now means a corrupted or intercepted download, which is what we want it
  to mean.
- Two consumers building the same app version get the same model, on any machine, on any day.
- We have to notice revision 2 ourselves. The upgrade check belongs with the MediaPipe version
  review in [0003](./0003-pin-mediapipe-0-10-21.md), not on a bot, since a model swap is a
  behavior change and needs an accuracy pass before it ships.
- Supersedes nothing. It fills in the manifest half of
  [0002](./0002-models-fetched-not-bundled.md).
