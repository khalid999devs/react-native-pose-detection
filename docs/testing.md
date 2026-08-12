# Testing

Two things are true at once here: the JavaScript half of the package has a real test suite that
runs on every push, and nothing has ever been tested on a phone. Both are stated plainly below,
because a testing document that blurs them is worse than none.

## What runs today

```bash
npm test
```

That is `tsc -p packages/core/tsconfig.test.json && node --test ".test-build/tests/**/*.test.js"`,
and it runs 60 tests. It is part of `npm run check`, and CI runs it on Node 22.22.1 and 24, the floor
declared in `engines` and the version `.nvmrc` pins for development.

**There is no test framework.** Assertions come from `node:assert/strict` and the runner is
`node --test`, both built in. A pose library that ships zero runtime dependencies should not need
a hundred development ones to prove it works, and the runner has been stable since Node 20.

**Tests are compiled rather than run off disk.** The package is `"type": "commonjs"`, so Node's
type stripping loads a `.ts` test as CommonJS and rejects its `import` statements, while the ESM
path would demand a `.ts` suffix on every relative import in the sources. Compiling costs about a
second and has a second payoff: the tests are typechecked with the same strict settings as the
code they exercise, so a test that lies about a type fails before it runs.

Output goes to `.test-build/` at the repository root, outside the package. Test artifacts that
land inside `packages/core` are artifacts that can reach the tarball.

**Tests live in `packages/core/tests/`**, mirroring the layout of `src/`. Keeping them in one
tree means the published `files` list needs no exclusion rule to keep them out of the tarball:
`src` ships, `tests` does not.

## What those 60 tests cover

| Area | File | What is asserted |
| --- | --- | --- |
| Wire format | `tests/wire.test.ts` | The header has a slot for every field the decoder reads, `expectedByteLength` accounts for header, per-frame meta and body, and angles resolve in table order rather than mention order |
| Decoding | `tests/decodeFrames.test.ts` | A round trip through an encoded buffer, plus every rejection path: a bad header, a stride whose blocks do not add up, a truncated buffer, and a joint or angle count that disagrees with the current props |
| Accessors | `tests/accessors.test.ts` | Reading landmarks out of a full buffer and out of one `data.select` narrowed, including that a joint `select` left out throws instead of returning another joint's numbers |
| Trigger validation | `tests/validation/triggers.test.ts` | Every rejection the validator promises: unknown keys, `between` outside an angle condition, out-of-range bounds, contradictions that can never fire, an explicitly `undefined` bound, and a cyclic or BigInt config |
| Joint tables | `tests/types/joints.test.ts` | 33 landmarks, 35 skeleton connections, 12 angle joints, and that the type guards reject `Object.prototype` keys such as `toString` |

The theme is the same throughout: the wire format and the joint tables are shared with native code
that cannot be imported here, so what is testable in JavaScript is the contract, and it is worth
testing precisely because the other side of it is not.

## What is not tested

- **No native unit tests.** There is no JUnit suite for the Kotlin and no XCTest suite, because
  the engine those tests would cover is not written. Android gets ktlint and a compile, nothing
  more.
- **No device tests of any kind.** Nothing in this repository has run on a phone. The Android
  layer compiles and packages correctly, and that is the entire claim.
- **No iOS.** There are no Swift sources yet, which is why the macOS lint job in CI is gated
  behind a detection step.

## Required device tests

These are Phase 6 work and none of them exists yet. They are listed because each one is here for a
crash that already happened once, and the list is what Phase 6 gets measured against.

### Camera-switch stress

100 rapid switches with detection on. Asserts: no crash, no leak, trigger counters preserved,
detection state preserved.

### Mount/unmount leak

100 mount/unmount cycles. Memory returns to baseline ±5 MB.

### Memory budget

10-minute run per profile against the table in [performance](../guides/performance.md).

### Calibration convergence

Settles within 3 s on low, mid, and high tier devices. Cache is honored on relaunch, second
launch reports `source: 'cache'`.

### Thermal ladder

Simulated thermal states. Every step fires and recovers; `onPerformanceChange` reports each one.

### Zero-allocation frame path

Profiler-verified: no allocations in steady state with `data.mode: 'off'`.

A physical device is required for all of them. Simulators have no camera and MediaPipe's GPU
delegate behaves differently on them.

## Two evaluators, one behavior

The condition evaluator and the geometry will exist twice, Swift and Kotlin, and **both
implementations must produce identical output for identical input.** Shared fixture files are
meant to drive both suites, so a divergence is a bug even when each side looks correct on its own.
Neither implementation exists yet, so this is a rule for Phases 4 and 5 rather than something CI
currently enforces.

## CI matrix

| Axis | Values |
| --- | --- |
| Platform | iOS, Android |
| Install | Expo prebuild, bare |
| Architecture | old, new |

**The matrix is not wired yet.** `.github/workflows/ci.yml` ends with a comment reserving it for
Phase 6, and it cannot run before then because the two example apps it would build,
`example/expo` and `example/bare`, do not exist. When it lands, all eight cells build both apps on
every PR, and the device regression tests above run on a schedule rather than per PR, since they
need hardware a runner does not have.

## Writing a native test

Geometry and evaluator tests take fixture landmark sets rather than live camera data:

```text
__fixtures__/
  standing.json      neutral pose
  squat-bottom.json  knee ~85°
  squat-top.json     knee ~170°
  partial.json       lower body occluded
  jump-flight.json   both ankles off ground
```

Add a fixture rather than hand-building landmark arrays in a test, fixtures are shared across
both platforms and keep the two evaluators honest.

## Reporting a failure

Include device model, OS version, `data.mode`, model variant, and whether it reproduces on the
other platform. Once calibration lands, `getProfile()` output is the single most useful thing you
can attach; today it throws, so the resolved values from `onReady` and `onPerformanceChange` are
the substitute.
