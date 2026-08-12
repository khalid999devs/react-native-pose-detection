# Architecture Decision Records

Short records of decisions that were expensive to make and would otherwise get re-litigated.

One file per decision: `NNNN-short-title.md`. Never edit a decision once accepted, supersede
it with a new record and link back.

```md
# NNNN: Title

**Status:** accepted | superseded by NNNN
**Date:** YYYY-MM-DD

## Context
What forced a decision.

## Decision
What we chose.

## Consequences
What this costs us, and what it rules out.
```

| | |
| --- | --- |
| [0001](./0001-own-camera-not-visioncamera.md) | Ship our own camera rather than requiring VisionCamera |
| [0002](./0002-models-fetched-not-bundled.md) | Fetch models at prebuild instead of bundling them |
| [0003](./0003-pin-mediapipe-0-10-21.md) | Pin MediaPipe to 0.10.21 |
| [0004](./0004-pin-model-revision-not-latest.md) | Pin the model revision, not `latest` |
