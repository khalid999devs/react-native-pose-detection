# Testing

Two things are true at once here: the JavaScript half of the package has a real test suite that
runs on every push, and nothing has ever been tested on a phone. Both are stated plainly below,
because a testing document that blurs them is worse than none.

## What runs today

```bash
npm test
```

That is `tsc -p packages/core/tsconfig.test.json && node --test ".test-build/tests/**/*.test.js"`,
and it runs 73 tests. It is part of `npm run check`, and CI runs it on Node 22.22.1 and 24, the floor
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

## What those 73 tests cover

| Area | File | What is asserted |
| --- | --- | --- |
| Wire format | `tests/wire.test.ts` | The header has a slot for every field the decoder reads, `expectedByteLength` accounts for header, per-frame meta and body, and angles resolve in table order rather than mention order |
| Decoding | `tests/decodeFrames.test.ts` | A round trip through an encoded buffer, plus every rejection path: a bad header, a stride whose blocks do not add up, a truncated buffer, and a joint or angle count that disagrees with the current props |
| Accessors | `tests/accessors.test.ts` | Reading landmarks out of a full buffer and out of one `data.select` narrowed, including that a joint `select` left out throws instead of returning another joint's numbers |
| Trigger validation | `tests/validation/triggers.test.ts` | Every rejection the validator promises: unknown keys, `between` outside an angle condition, out-of-range bounds, contradictions that can never fire, an explicitly `undefined` bound, and a cyclic or BigInt config |
| Joint tables | `tests/types/joints.test.ts` | 33 landmarks, 35 skeleton connections, 12 angle joints, and that the type guards reject `Object.prototype` keys such as `toString` |
| Wire parity | `tests/frames/wireParity.test.ts` | That the Kotlin and the Swift agree with `wire.ts` on every header slot, every flag, the landmark count and stride, and that all three declare the twelve angles in the same order and between the same three joints |
| Reference parity | `tests/docs/referenceParity.test.ts` | That every prop and ref method the types declare appears in `guides/reference/`, that the events table lists exactly the callbacks the props declare, and that the `ErrorCode` union and its documented table are the same set |

The theme is the same throughout: the wire format and the joint tables are shared with native code
that cannot be imported here, so what is testable in JavaScript is the contract, and it is worth
testing precisely because the other side of it is not. The two parity tests extend that idea past
the code: the Kotlin, the Swift and the reference guides are all restatements of the same
contract, and none of them fails on its own when it drifts.

## What is not tested

- **No device tests of any kind.** Nothing in this repository has run on a phone. Both native
  layers compile, their unit suites pass, and that is the entire claim.
- **The native suites cover the half with no platform in it.** JUnit and XCTest both run the
  engine, the wire format and the performance resolver. Neither covers `CameraSource`,
  `PoseDetector` or the overlay, because those need a camera, a model and a screen; those are
  what the device tests below are for.

## Required device tests

**Written, never run.** The Scenarios screen in `example/expo` drives every one of them, and the
bare app runs the two that are about teardown. Each is here for a crash that already happened
once. What is missing is a phone and, for the memory ones, a profiler attached to it.

### Camera-switch stress

100 rapid switches with detection on. Asserts: no crash, no leak, trigger counters preserved,
detection state preserved. Each switch is awaited on `switchCamera()`'s own promise, which
resolves when the session is stable again, so the next one starts the instant that happens rather
than after a sleep long enough to hide the race.

### Mount/unmount leak

50 mount/unmount cycles in each app, each awaited to the next `onReady`. Memory returns to
baseline ±5 MB.

### Memory budget

10-minute soak per profile against the table in [performance](../guides/performance.md).

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

The condition evaluator and the geometry exist twice, Swift and Kotlin, and **both
implementations must produce identical output for identical input.** 54 JUnit tests and 58
XCTests assert the same behavior on each side, and the wire parity test reads all three languages'
constant tables and fails when they disagree. That last one is the only part CI enforces
mechanically; the rest is two suites written against one specification.

## CI matrix

| Axis | Values |
| --- | --- |
| Platform | iOS, Android |
| Install | Expo prebuild, bare |

**All four cells are wired**, and there are four rather than the eight this was drawn for: React
Native 0.82 removed the legacy architecture, so the architecture axis has one value and is gone
from the table rather than pinned at one.

| Cell | Builds | Also asserts |
| --- | --- | --- |
| `android-expo` | Debug APK after `expo prebuild` | four ABIs, exactly one model, the camera permission in the merged manifest |
| `android-bare` | Debug APK after the CLI install | `doctor`, the committed Xcode project unchanged, the module autolinked, and the JUnit suite |
| `ios-expo` | Simulator Debug after `pod install` | the model registered in the target, and exactly one in the app bundle |
| `ios-bare` | Simulator **Release** after `pod install` | `Podfile.lock` unchanged, the pod autolinked, and `PoseDetectionModule` still in the binary after dead-stripping |

Only `ios-bare` builds Release, and it is the one that answers the iOS half of the ProGuard
question: Android ships consumer keep rules because R8 can strip a class reached only from JNI,
and the Swift equivalent is a symbol reached only from Expo's generated module registry. Release
is where the linker's dead-stripping runs, so a Debug build would never have shown it.

The device regression tests above will run on a schedule rather than per PR, since they need
hardware a runner does not have.

## Running the native tests

The library has no Gradle build of its own, so its JVM tests run through an example app's:

```bash
npm run test:kotlin
```

`FrameRingBuffer` and the wire encoder are deliberately free of JNI, which is what lets them run
on a plain JVM. A byte-order or block-offset mistake is cheap to find there and expensive to find
on a device.

The other half of that guard is `wireParity.test.ts`, which runs in `npm test` and reads the
Kotlin. The wire format is written twice, once per language, and nothing at runtime compares them:
a buffer encoded against a stale constant decodes into plausible wrong numbers rather than
failing. That test asserts the header slots, the flags, the landmark count and stride, and the
angle table's order and contents still agree.

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
