# Release process

## Versioning

Semantic versioning. The public surface is whatever `src/index.ts` exports, nothing else.

| Change | Bump |
| --- | --- |
| New prop, event, or method | minor |
| Removing or renaming public API | major |
| MediaPipe version bump changing ABI or platform support | major |
| Default behavior change users can observe | major |
| Bug fix, internal refactor, docs | patch |

Dropping an ABI (`armeabi-v7a`, `x86`) is a **major**. It silently breaks devices that
previously worked. See [ADR 0003](./adr/0003-pin-mediapipe-0-10-21.md).

## Release history in git

Every published version is recorded as an annotated tag on the exact commit that was published.

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

The tag is the version footprint. `git tag --sort=-v:refname` lists every version ever shipped,
`git show v0.1.0` gives the tree that went to npm, and `git log v0.1.0..v0.2.0` is the honest
diff between two published versions. GitHub attaches the release notes to the tag, and npm
provenance signs the tag, so it is also the link from a published tarball back to a commit.

We do not create a branch per version. A branch is a moving pointer meant for work in progress,
so it can be reset, force pushed, or deleted, and it carries no promise about what was
published. A tag is a fixed pointer to one commit, which is exactly the record a release needs.
Forty releases means forty tags, which is fine, or forty branches, which turns the branch picker
into a landfill and gives every one of them a protection rule to think about.

Every tool in the release path already keys off tags: `npm version` writes one, GitHub releases
attach to one, provenance attests to one, and semantic-release creates one. A branch named
`package/1.0.9` is invisible to all of it.

Tags matching `v*` are protected: they cannot be deleted or moved once pushed, so the release
history is append-only. The maintainer can bypass this to correct a tag pushed by mistake, the
same exception that applies on `main`.

### Maintenance branches

There is one case where a version-named branch earns its keep: a fix has to ship for an older
major while `main` has already moved past it. Create it then, from the tag, not before.

```bash
git switch -c 1.x v1.4.2
git cherry-pick <fix-commit>
```

Name it `N.x` or `N.N.x`. Tag the patch on that branch and publish it under its own dist-tag
rather than `latest`. React Native (`0.74-stable`) and Reanimated (`4.3-stable`) both work this
way, and `N.x` is the shape release tooling recognizes by default.

A maintenance branch created ahead of time is just a stale copy of `main`, so leave it until
someone actually needs the backport.

## Before a release

- [ ] CI green on all matrix cells, iOS + Android × Expo + bare × old + new arch
- [ ] Device regression suite passes: camera-switch stress, leak, memory budget, calibration, thermal
- [ ] `guides/reference/` matches the exported types exactly
- [ ] App-size table in `guides/performance.md` re-measured if native deps changed
- [ ] CHANGELOG entry written for humans, not generated from commit subjects
- [ ] Verified in a clean Expo app **and** a clean bare app, not just `example/`

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

- **No `.task` files.** Models are fetched, never bundled, [ADR 0002](./adr/0002-models-fetched-not-bundled.md)
- No `node_modules`, no `Pods`, no build output
- Total size in the tens of KB, not MB

A tarball that grows by megabytes means something leaked into `files`.

## After a release

- [ ] Tag the published commit, `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
- [ ] Cut the GitHub release from that tag, body is the CHANGELOG section
- [ ] Update the version support table in `guides/installation.md` if minimums moved
- [ ] Post breaking changes to Discussions before the release, not after
