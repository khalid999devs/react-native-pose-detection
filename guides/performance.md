# Performance

*Android runs all of this. iOS has no module yet. Every number below is a target the
implementation aims at rather than one measured on hardware, because nothing here has run on a
physical device: see [the development plan](../docs/development-plan.md).*

## Profiles

```tsx
<PoseCamera profile="auto" />   // default
```

| Profile | Behavior |
| --- | --- |
| **`auto`** *(default)* | Probe the device → converge on measurement → cache the result |
| `efficient` | Pinned 15 fps · 480p preview · 360p analysis |
| `balanced` | Pinned 24 fps · 720p · 480p |
| `quality` | Pinned 30 fps · 1080p · 720p |
| `unrestricted` | No calibration, no thermal ladder except `critical` |

Only `auto` self-adjusts. The named profiles are explicit escapes from it.

## Auto-calibration

### Stage 1: static probe (~0 ms)

Core count, memory, GPU family, SoC model, thermal state, low-power mode → a starting tier.

**Deliberately one step conservative.** Ramping up after 2 s is invisible; ramping down after
visible jank is not.

### Stage 2: measured convergence (~60 frames)

```text
p50 inference time + dropped-frame ratio
  < budget × 0.6  → step up   (fps first, then analysis resolution)
  > budget × 1.2  → step down
  settle with hysteresis → onPerformanceChange({ reason: 'calibration' })
```

Static specs lie. A mid-range chip with a good GPU beats a flagship that's already hot.

### Stage 3: cache

The settled configuration is persisted natively, keyed by device model + model variant + OS
version. Second launch starts correct, no re-calibration, no first-run wobble.
Invalidated on OS upgrade or model change.

### Inspecting it

`getProfile()` reads native state, so it is asynchronous. `getState()` is not, because
everything in it arrives on an event JavaScript can mirror.

```ts
await cam.current.getProfile();
// { profile: 'auto', phase: 'settled', source: 'measured', tier: 'medium',
//   resolved: { delegate: 'GPU', targetFps: 24, preview: '720p', analysis: '480p' },
//   p50InferenceMs: 21.4 }
```

## Thermal ladder

Read from the OS and applied above everything else:

| State | Response |
| --- | --- |
| nominal | resolved configuration |
| fair | targetFps −25% |
| serious | targetFps −50%, analysis resolution −1 step |
| critical | **detection paused**, preview continues, event emitted |
| Low Power Mode | clamp to `fair` minimum |
| Backgrounded | full stop: session and detector released |

`thermalPolicy="off"` stops the response but **not** the reporting, `onPerformanceChange`
still fires so your app can decide for itself.

## Precedence

```text
1. profile          sets the baseline
2. explicit props   override per axis
3. calibration      adjusts only axes still 'auto'
4. thermal ladder   overrides everything (unless policy says otherwise)
```

So this does exactly what it reads like:

```tsx
<PoseCamera
  profile="quality"          // high baseline
  targetFps={24}             // pinned: calibration won't touch it
  analysisResolution="auto"  // stays adaptive
/>
```

`quality` on a low-tier device is a **request, not a guarantee**. The thermal ladder still applies.

## Optimizations

| | What it does |
| --- | --- |
| **Pre-warm** | One dummy inference during camera setup, so the user's first real frame is never the slow one |
| **Idle-search** | No person for ~2 s → drop to 8 fps; reappears → full rate within one frame |
| **Lazy angles** | Computes only the angles an `angle` condition, `overlay.angles` or `data.angles` asked for. `data.select` is not one of those: it narrows the buffer, it does not ask for geometry |
| **Analysis ≠ preview** | Model sees a small frame; preview stays sharp |
| **Zero-alloc frame path** | Preallocated arrays, reused overlay paths, fixed ring buffers |
| **Smoothing** | One-Euro filter: removes visible jitter at negligible cost |

## Resource budgets

**Targets, not measurements.** Nothing here is enforced yet: the memory, leak and 10-minute
sustained-run tests need a physical device and land with the Phase 6 device matrix. Until then
these are the numbers the implementation is aiming at, and the numbers a bug report should be
filed against.

| State | Target above app baseline |
| --- | --- |
| Camera on, detection off | < 40 MB |
| `lite` @ 480p analysis | < 120 MB |
| `full` @ 720p analysis | < 180 MB |
| Steady-state allocations per frame | **0**, except the MPImage floor below |
| Return to idle after `stopDetection()` | < 1 s |
| 10-minute sustained run | thermal ≤ fair on mid-tier |

**The zero-allocation claim has one floor, and it is honest to name it.** Handing a frame to
MediaPipe requires an `MPImage`, and building one allocates about seven objects: the builder, the
container, the image, its properties, and a small map inside the image. There is no API that takes
a reusable one. Everything this package controls, the landmark buffers, the geometry, the filter,
the evaluators, the ring buffer, and the overlay's draw path, allocates nothing per frame at the
default configuration.

Two configurations do allocate beyond that floor, both by choice: `data.mode: 'live'` allocates one
direct buffer per drain, which is what carrying frames to JavaScript costs, and an angle overlay
with `decimals` above zero formats a string per label per draw.

## App size

Exactly one model ships, whichever `model` your config selects.

Two things are measured. The model files are 5.5 MB (`lite`), 9.0 MB (`full`) and 29.2 MB
(`heavy`), and MediaPipe's native library is 10.5 MB for `arm64-v8a`, 7.4 MB for `armeabi-v7a`,
15.0 MB for `x86` and 13.0 MB for `x86_64`, taken from an assembled APK on the pinned 0.10.35.

Everything else is an estimate:

| Model | Android install / Play download | iOS |
| --- | --- | --- |
| `lite` | ~19.7 MB / ~10.9 MB | ~26–41 MB |
| `full` | ~23.2 MB / ~14.2 MB | ~29–44 MB |
| `heavy` | ~43.4 MB / ~33.0 MB | ~49–64 MB |

No release archive has been built and weighed yet. Phase 6 replaces this table with numbers from
one, per model and per platform.

**Android requires an AAB.** A universal APK carries all four ABI slices, 45.9 MB of native
library where a phone loads 10.5 MB of it. Set `abiFilters` on your release build if you must
ship an APK, and only there: dropping `x86_64` from a debug build is what breaks the standard
emulator on an Intel host.

Model files are ~93% incompressible (float16 weights), so they cost nearly full price on download.
