<!-- Title must follow Conventional Commits, it becomes the merge commit.
     e.g. feat(triggers): add velocityY condition -->

## What & why

<!-- A sentence or two. Link the issue if there is one. -->

Closes #

## Demo

> **Required for anything a user can see or interact with.** Camera, overlay, triggers,
> calibration, the example app. Attach a **screen recording** where you can, a screenshot
> where you cannot.
>
> **Show both platforms.** A feature that works on one and was never run on the other is
> not done, and reviewers cannot tell the difference from a diff.

| Platform | Demo |
| --- | --- |
| **iOS** | <!-- drag a video or image here --> |
| **Android** | <!-- drag a video or image here --> |

<!-- Not user-visible (docs, CI, refactor)? Delete this section. -->

## Testing & checklist

A **physical device is required** for anything touching the camera. Simulators have no
camera and the GPU delegate behaves differently on them.

| Device | OS | Result |
| ------ | -- | ------ |
|        |    |        |
|        |    |        |

<!-- Tested only one platform? Say so here. That is fine, hiding it is not. -->

### Everyone

- [ ] `npm run check` passes
- [ ] Ran the example app and exercised the change by hand
- [ ] No unrelated changes in the diff

### If the public API changed

- [ ] `guides/reference/` updated in this PR
- [ ] A control added to `example/` so the change can be exercised
- [ ] Exported from `packages/core/src/index.ts`

### If native code changed

- [ ] Implemented on both iOS and Android, or noted above as one-platform-pending
- [ ] None of the [eight rules](../docs/README.md#the-eight-rules) broken
- [ ] No allocations added to the steady-state frame path
- [ ] Camera switch still works: switch back and forth ~20 times with detection on

### If a trigger condition was added

- [ ] Describes a body, not an activity ([litmus test](../docs/project-structure.md#where-to-add-things))
- [ ] Same behavior from the Swift and Kotlin evaluators
