# Performance

## Profiles

```tsx
<PoseCamera profile="auto" />   // default
```

| Profile | Behavior |
|---|---|
| **`auto`** *(default)* | Probe the device → converge on measurement → cache the result |
| `efficient` | Pinned 15 fps · 480p preview · 360p analysis |
| `balanced` | Pinned 24 fps · 720p · 480p |
| `quality` | Pinned 30 fps · 1080p · 720p |
| `unrestricted` | No calibration, no thermal ladder except `critical` |

Only `auto` self-adjusts. The named profiles are explicit escapes from it.

## Auto-calibration

### Stage 1 — static probe (~0 ms)

Core count, memory, GPU family, SoC model, thermal state, low-power mode → a starting tier.

**Deliberately one step conservative.** Ramping up after 2 s is invisible; ramping down after
visible jank is not.

### Stage 2 — measured convergence (~60 frames)

```text
p50 inference time + dropped-frame ratio
  < budget × 0.6  → step up   (fps first, then analysis resolution)
  > budget × 1.2  → step down
  settle with hysteresis → onPerformanceChange({ reason: 'calibration' })
```

Static specs lie. A mid-range chip with a good GPU beats a flagship that's already hot.

### Stage 3 — cache

The settled configuration is persisted natively, keyed by device model + model variant + OS
version. Second launch starts correct — no re-calibration, no first-run wobble.
Invalidated on OS upgrade or model change.

### Inspecting it

```ts
cam.current.getProfile();
// { profile: 'auto', phase: 'settled', source: 'measured', tier: 'medium',
//   resolved: { delegate: 'GPU', targetFps: 24, preview: '720p', analysis: '480p' },
//   p50InferenceMs: 21.4 }
```

## Thermal ladder

Read from the OS and applied above everything else:

| State | Response |
|---|---|
| nominal | resolved configuration |
| fair | targetFps −25% |
| serious | targetFps −50%, analysis resolution −1 step |
| critical | **detection paused**, preview continues, event emitted |
| Low Power Mode | clamp to `fair` minimum |
| Backgrounded | full stop — session and detector released |

`thermalPolicy="off"` stops the response but **not** the reporting — `onPerformanceChange`
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
  targetFps={24}             // pinned — calibration won't touch it
  analysisResolution="auto"  // stays adaptive
/>
```

`quality` on a low-tier device is a **request, not a guarantee**. The thermal ladder still applies.

## Optimizations

| | What it does |
|---|---|
| **Pre-warm** | One dummy inference during camera setup, so the user's first real frame is never the slow one |
| **Idle-search** | No person for ~2 s → drop to 8 fps; reappears → full rate within one frame |
| **Lazy angles** | Only computes angles referenced by your triggers and `select` |
| **Analysis ≠ preview** | Model sees a small frame; preview stays sharp |
| **Zero-alloc frame path** | Preallocated arrays, reused overlay paths, fixed ring buffers |
| **Smoothing** | One-Euro filter — removes visible jitter at negligible cost |

## Resource budgets

Enforced in CI.

| State | Target above app baseline |
|---|---|
| Camera on, detection off | < 40 MB |
| `lite` @ 480p analysis | < 120 MB |
| `full` @ 720p analysis | < 180 MB |
| Steady-state allocations per frame | **0** |
| Return to idle after `stopDetection()` | < 1 s |
| 10-minute sustained run | thermal ≤ fair on mid-tier |

## App size

Exactly one model ships — whichever `model` your config selects.

| Model | Android install / Play download | iOS |
|---|---|---|
| `lite` | ~19.7 MB / ~10.9 MB | ~26–41 MB* |
| `full` | ~23.2 MB / ~14.2 MB | ~29–44 MB* |
| `heavy` | ~43.4 MB / ~33.0 MB | ~49–64 MB* |

\* iOS estimates pending a verified release archive.

**Android requires an AAB.** A universal APK bundles arm64 + armeabi-v7a + x86 — 40.3 MB of
native libraries instead of 12.4 MB. Set `abiFilters` if you must ship an APK.

Model files are ~93% incompressible (float16 weights), so they cost nearly full price on download.
