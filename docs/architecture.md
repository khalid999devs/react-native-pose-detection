# Architecture

## Layers

```text
┌─ JS ───────────────────────────────────────────────┐
│  <PoseCamera>  ·  types  ·  config plugin  ·  CLI   │
└────────────────────────┬───────────────────────────┘
                         │ Expo Modules (old + new arch)
┌─ Native ───────────────┴───────────────────────────┐
│  CameraSource      platform camera + lifecycle      │
│  PoseEngine        detector, geometry, triggers     │
│  OverlayRenderer   native skeleton drawing          │
│  Calibrator        device probe, convergence, cache │
└────────────────────────────────────────────────────┘
```

**`PoseEngine` never imports camera code.** The frame source is an input. This is what makes
the VisionCamera adapter (0.2.0) a ~200-line addition instead of a fork.

## Frame pipeline

```text
CameraX ImageAnalysis (RGBA_8888, KEEP_ONLY_LATEST)   ┐
AVCaptureVideoDataOutput (discardsLateVideoFrames)    ┘
        ↓  zero copy, downscaled to analysisResolution
MediaPipe PoseLandmarker — LIVE_STREAM, verified GPU → CPU fallback
        ↓  async callback, camera thread
  ├─ geometry     angles · centerOfMass · velocity · bodySpan   (lazy: only what's referenced)
  ├─ smoothing    One-Euro filter on landmarks
  ├─ triggers     declarative state machines
  ├─ overlay      drawn natively — never crosses to JS
  └─ emit         ONLY on trigger fire / throttle tick / batch flush
```

### Why analysis resolution is separate from preview

MediaPipe downscales internally — the pose detector runs at 224×224, the landmarker at 256×256.
Feeding 1080p costs memory bandwidth and conversion time for negligible accuracy gain.
A 1080p RGBA buffer is 8.3 MB; 480p is 1.2 MB — and the camera holds a *pool* of them.

Preview stays sharp. Inference runs small.

## Wire format

Landmarks cross as a `Float32Array` over an ArrayBuffer, not JSON objects.

| Encoding | Bytes/frame | Parse cost |
|---|---|---|
| JSON `{x,y,z,visibility}` × 33 | ~3,000 | high |
| `Float32Array` | **528** | ~zero |

Layout: 33 landmarks × 4 floats, `[x, y, z, visibility, …]`. A thin JS accessor wraps it
without copying.

## Threading

| Work | Thread |
|---|---|
| Camera capture + inference | dedicated camera/inference queue (same queue — buffers never hop) |
| Overlay drawing | main / UI |
| Session configuration | one serial `sessionQueue` |
| JS callbacks | JS thread, only when something is emitted |

**All session state lives on `sessionQueue`.** No booleans shared across queues — that was the
root cause of the legacy package's camera-switch crashes.

## Camera switching

Non-negotiable rules. Every one of these exists because its absence caused a crash:

1. The capture delegate queue **is** the inference queue — sample buffers never escape the callback
2. Timestamps come from the buffer's presentation time, clamped strictly increasing
3. A **generation counter** is bumped per switch; results from an old generation are dropped
4. All session state mutates on one serial queue
5. The landmarker is **never recreated** — swap the input, keep the detector
6. Mirroring and rotation are applied **inside** the begin/commit configuration transaction
7. Any failure rolls back to the previous input
8. Android: `imageProxy.close()` in a `finally`, always — one miss stalls the analyzer forever

**Guarantee:** detection state, calibration, and trigger counters survive a switch.

## Model delivery

Nothing ships in the npm tarball but a manifest of URLs and checksums.

```text
app.json plugin config
  → prebuild: cache check → download → SHA-256 verify
  → copy into android/app/src/main/assets/ and iOS resources
  → runtime: baseOptions.modelAssetPath points at that file
```

Switching variants means editing one word and re-running prebuild. The plugin removes the
previous model file, so two are never present at once.
