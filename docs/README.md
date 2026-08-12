# Developer documentation

For people working **on** `react-native-pose-detection`.

Using the library in an app? See [guides/](../guides/README.md).

## Start here

New contributor, in order:

| | |
| --- | --- |
| **1.** [Project structure](./project-structure.md) | What lives where, and why |
| **2.** [Architecture](./architecture.md) | Native pipeline, threading, camera-switch rules |
| **3.** [Contributing](./contributing.md) | Setup, **branch / commit / PR conventions**, code style |
| **4.** [Testing](./testing.md) | What must pass before merge |
| **5.** [Quality gates](./quality-gates.md) | Every automated check and why it exists |

## Reference

| | |
| --- | --- |
| [Native modules](./native-modules.md) | How the iOS and Android layers are built, and how to extend them |
| [Logging](./logging.md) | The zero-overhead diagnostic channel and its contract |
| [Example app](../example/README.md) | The reference implementation and manual QA harness |
| [Development plan](./development-plan.md) | The 7 phases to v0.1.0, with exit criteria |
| [Release process](./release-process.md) | Versioning, publishing, what gets checked |
| [ADRs](./adr/README.md) | Why decisions were made: read before proposing a reversal |

## The eight rules

Every one of these exists because its absence caused a production crash. They are not
suggestions, and a PR that breaks one will not be merged.

1. **Sample buffers never leave the capture callback**. The delegate queue *is* the inference queue
2. **Timestamps are monotonic**, clamped strictly increasing
3. **Generation counter** on camera switch; stale results dropped
4. **All session state on one serial queue**, no booleans shared across threads
5. **Never recreate the landmarker** for a camera switch or prop change
6. **`imageProxy.close()` in `finally`** on Android, always
7. **Zero allocations in the steady-state frame path**
8. **No domain logic**. If it needs to know the activity, it's a recipe

Details and rationale in [architecture](./architecture.md#camera-switching).

## Design principles

1. **Primitives, not policy.** If it needs to know the activity, it's a recipe, not library code.
2. **Zero bridge cost by default.** Data crossing to JS is opt-in.
3. **Zero peer dependencies.** No VisionCamera, no Reanimated; old and new architecture.
4. **Auto by default, override anything.** Safe floor, no ceiling.
5. **One model in the app**, selected by config, never bundled in the npm tarball.
6. **Camera, detection, and overlay** are three independent switches.
7. **The engine is camera-agnostic**. The frame source is swappable.
8. **Never act silently.** Every automatic decision emits an event.

## Current status

Pre-release, Phase 0. See [development plan](./development-plan.md) for what's built and what's next.

Documentation follows [Diátaxis](https://diataxis.fr/): `guides/` holds tutorials, how-to guides,
and user-facing reference; `docs/` holds explanation and contributor reference.
