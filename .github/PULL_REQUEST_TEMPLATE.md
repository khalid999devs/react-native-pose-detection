<!--
Title must follow Conventional Commits — it becomes the squash-merge commit.
    feat(triggers): add velocityY condition
Rules: docs/contributing.md#commits
-->

## What

<!-- One or two sentences. What does this change do? -->

## Why

<!-- Link the issue (Closes #123), or explain the problem being solved. -->

Closes #

## Type

<!-- Tick one. Must match the title prefix. -->

- [ ] `feat` — new capability
- [ ] `fix` — bug fix
- [ ] `perf` — performance, no API change
- [ ] `refactor` — no behavior change
- [ ] `docs` — documentation only
- [ ] `build` / `ci` / `chore`
- [ ] **Breaking** — title has `!` and the body has a `BREAKING CHANGE:` footer

## Testing

A **physical device is required** for anything touching the camera. Simulators have no camera
and the GPU delegate behaves differently there.

| Device | OS | Platform | Result |
| ------ | -- | -------- | ------ |
|        |    | iOS      |        |
|        |    | Android  |        |

<!-- If you could only test one platform, say so. That's fine — say it, don't hide it. -->

## Checklist

### Always

- [ ] `npm run check` passes locally
- [ ] One concern per PR
- [ ] Branch named `type/scope-description` (see [branches](../docs/contributing.md#branches))

### If you changed the public API

- [ ] `guides/reference/` updated in this PR
- [ ] A control added to `example/` so the change can be exercised
- [ ] Types exported from `src/index.ts`

### If you touched native code

- [ ] Implemented on **both** platforms, or documented as one-platform-pending
- [ ] None of the [eight rules](../docs/README.md#the-eight-rules) broken
- [ ] No allocations added to the steady-state frame path
- [ ] Swift and Kotlin evaluators still agree (shared fixtures pass)

### If you added a trigger condition

- [ ] Describes a **body**, not an activity ([litmus test](../docs/project-structure.md#where-to-add-things))
- [ ] Implemented in both evaluators, tested in both suites
- [ ] Documented in `guides/reference/trigger-schema.md`

## Screenshots / video

<!-- Required for overlay, camera, or example-app changes. A short screen recording is best. -->

## Performance impact

<!-- For anything in the frame path: before/after FPS, p50 inference, or memory.
     Include the getProfile() output and the device it came from. -->

## Notes for reviewers

<!-- Anything non-obvious: a tradeoff you made, an alternative you rejected, a part you're unsure of. -->
