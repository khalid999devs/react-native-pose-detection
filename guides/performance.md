# Performance

*Both platforms implement all of this.*

## Profiles

```tsx
<PoseCamera profile="auto" />   // default
```

| Profile | Behavior |
| --- | --- |
| **`auto`** *(default)* | Measure → converge on the device's own rate → cache it for next launch |
| `efficient` | Pinned 15 fps · 480p preview · 360p analysis |
| `balanced` | Pinned 24 fps · 720p · 480p |
| `quality` | Pinned 30 fps · 1080p · 480p |
| `unrestricted` | Calibrated like `auto`, but no thermal ladder except `critical` |

Only `auto` and `unrestricted` self-adjust. The named profiles are explicit escapes from that:
choosing one is saying you have already decided, so calibration leaves it alone.

Under `auto` the rate is continuous, not one of the three pinned values. A session settles at 34
or 27 rather than a round number because the number is the device's own; two phones that both
count as fast can still differ by ten milliseconds of inference, and quantizing them to one value
either wastes the fast one or overloads the slow one.

One axis stops lower than a spec sheet would suggest, and it is deliberate. **Analysis tops out at
480p.** MediaPipe resizes whatever it is handed to 256 by 256 before the detector sees it, so a
720p analysis buffer is close to a megapixel captured, converted and copied every frame in order
to be discarded inside the graph. A distant subject is the one case a larger buffer helps, and
`analysisResolution` is there to ask for it.

## Auto-calibration

### Stage 1: static probe (~0 ms)

Memory on iOS, cores and memory on Android, low-power mode → a starting tier, which sets the
opening rate and the session geometry.

**Deliberately one step conservative.** Ramping up after 2 s is invisible; ramping down after
visible jank is not.

### Stage 2: the governor (~60 frames, then always on)

Every inference reports what it cost, dispatch to result. Over a rolling two-second window the
p50 of that cost sets two things:

```text
targetFps = 55% of the frame interval ÷ p50, clamped to 10–40
tier      = what the silicon is: p50 ≤ 22 ms high · ≤ 45 ms medium · above low
```

The 55% is the share of each frame inference may occupy; the rest is everything downstream of the
model plus the headroom that keeps a long session off the thermal ladder. The cap is 40 because a
body does not move meaningfully in 25 milliseconds, and the floor is 10 because below that the
skeleton reads as broken and pausing is more honest.

The measured span breathes with load, which is what closes the loop: a rate the device cannot
hold shows up as queue wait long before it shows up as heat, the p50 rises, the governor backs
off, the wait drains. Moves smaller than 2 fps are ignored as noise, and a three-second cooldown
stops a device sitting between two answers from oscillating. Each move fires
`onPerformanceChange({ reason: 'calibration' })`.

Static specs lie. A mid-range chip with a good GPU beats a flagship that's already hot, and the
governor is the part that notices.

### Stage 3: cache

The settled tier and rate are persisted natively, keyed by device model + model variant + OS
version, and read back **before the first bind**, so the second launch opens at the measured
configuration with no re-calibration and no first-run wobble. Invalidated on OS upgrade or model
change.

### Inspecting it

`getProfile()` answers where calibration stands. `measuredFps` in it is the live half: completed
inferences over the last second, zero once results stop, so it is also the number that exposes a
device falling behind its target. `getState().fps` is the same measurement as of the last
`onPerformanceChange`, because that object is mirrored from events rather than read across the
bridge; poll `getProfile()` when the number itself is what you are watching.

```ts
await cam.current.getProfile();
// { profile: 'auto', phase: 'settled', source: 'measured', tier: 'high',
//   resolved: { delegate: 'GPU', targetFps: 34, preview: '1080p', analysis: '480p' },
//   p50InferenceMs: 16.2, measuredFps: 33 }
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
| `full` @ 480p analysis | < 180 MB |
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

Two things are measured, both read out of an assembled APK on the pinned 0.10.35. MediaPipe's
native libraries come to **10.08 MB** for `arm64-v8a`, 7.09 MB for `armeabi-v7a`, 14.31 MB for
`x86` and 12.48 MB for `x86_64`. The model files are 5.5 MB (`lite`), **8.96 MB** (`full`) and
29.2 MB (`heavy`).

The native libraries are already compressed and do not shrink again inside the APK, so what is on
disk is what is downloaded. The model compresses by about a tenth, 8.96 MB down to 8.03 MB for
`full`, because float16 weights are close to incompressible.

The JavaScript is the part that rounds to nothing: **62.5 KB** of built output, and no runtime
dependencies to pull in behind it.

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
