# Release process

## Versioning

Semantic versioning. The public surface is whatever `src/index.ts` exports — nothing else.

| Change | Bump |
|---|---|
| New prop, event, or method | minor |
| Removing or renaming public API | major |
| MediaPipe version bump changing ABI or platform support | major |
| Default behavior change users can observe | major |
| Bug fix, internal refactor, docs | patch |

Dropping an ABI (`armeabi-v7a`, `x86`) is a **major** — it silently breaks devices that
previously worked. See [ADR 0003](./adr/0003-pin-mediapipe-0-10-21.md).

## Before a release

- [ ] CI green on all matrix cells — iOS + Android × Expo + bare × old + new arch
- [ ] Device regression suite passes: camera-switch stress, leak, memory budget, calibration, thermal
- [ ] `guides/reference/` matches the exported types exactly
- [ ] App-size table in `guides/performance.md` re-measured if native deps changed
- [ ] CHANGELOG entry written for humans, not generated from commit subjects
- [ ] Verified in a clean Expo app **and** a clean bare app — not just `example/`

## Publishing

```bash
npm publish --tag next     # verify in clean apps first
npm dist-tag add react-native-pose-detection@x.y.z latest
```

Never publish straight to `latest`. The install path is the thing most likely to break, and
it can't be tested from inside this repo.

## Verifying the tarball

```bash
npm pack --dry-run
```

Confirm:

- **No `.task` files.** Models are fetched, never bundled — [ADR 0002](./adr/0002-models-fetched-not-bundled.md)
- No `node_modules`, no `Pods`, no build output
- Total size in the tens of KB, not MB

A tarball that grows by megabytes means something leaked into `files`.

## After a release

- [ ] Tag and GitHub release with the CHANGELOG section
- [ ] Update the version support table in `guides/installation.md` if minimums moved
- [ ] Post breaking changes to Discussions before the release, not after
