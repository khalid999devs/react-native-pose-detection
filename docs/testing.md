# Testing

A physical device is required for anything touching the camera. Simulators have no camera and
MediaPipe's GPU delegate behaves differently on them.

## Layers

| Layer | Runs where | Covers |
| --- | --- | --- |
| Unit (JS) | node | trigger validation, wire-format accessors, type guards |
| Unit (native) | XCTest / JUnit | condition evaluator, geometry, calibration state machine |
| Integration | device | camera lifecycle, switching, model loading |
| Regression | device, CI | memory, leaks, thermal, calibration convergence |

The condition evaluator is implemented twice, Swift and Kotlin. **Both implementations must
produce identical output for identical input.** Shared fixture files drive both test suites;
a divergence is a bug even if each side looks correct on its own.

## Required device tests

These exist because their absence caused production crashes. They are not optional.

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

## CI matrix

| Axis | Values |
| --- | --- |
| Platform | iOS, Android |
| Install | Expo prebuild, bare |
| Architecture | old, new |

All eight cells build the example app on every PR. Device regression tests run on a nightly
schedule against the physical device farm.

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

Include device model, OS version, `getProfile()` output, and whether it reproduces on the other
platform. Performance reports without `getProfile()` can't be acted on.
