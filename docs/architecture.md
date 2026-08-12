# Architecture

This is the target design, and about half of it is built. Android has `CameraSource`,
`PoseDetector` and `OverlayRenderer`; `PoseEngine` and `Calibrator` do not exist on either
platform, and neither does iOS. Where the present tense below describes native behavior, read it
as the contract the code is being written against. The
[development plan](./development-plan.md) has the current checkboxes.

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
MediaPipe PoseLandmarker: LIVE_STREAM, verified GPU → CPU fallback
        ↓  async callback, camera thread
  ├─ geometry     angles · centerOfMass · velocity · bodySpan   (angles: only those asked for)
  ├─ smoothing    One-Euro filter on landmarks
  ├─ triggers     declarative state machines
  ├─ overlay      drawn natively: never crosses to JS
  └─ emit         ONLY on trigger fire / throttle tick / batch flush
```

### Why analysis resolution is separate from preview

MediaPipe downscales internally. The pose detector runs at 224×224, the landmarker at 256×256.
Feeding 1080p costs memory bandwidth and conversion time for negligible accuracy gain.
A 1080p RGBA buffer is 8.3 MB; 480p is 1.2 MB. And the camera holds a *pool* of them.

Preview stays sharp. Inference runs small.

### Which angles get computed

Three things turn an angle on: an `angle` condition inside a trigger, an entry in
`overlay.angles`, and `data.angles`. `data.angles: true` asks for all 12, an array asks for those.
Nothing else counts. Naming a joint as a comparison bound (`below: 'leftShoulder'`) or listing it
in `data.select` asks for a *position*, and computing its angle would be work nobody requested.

JavaScript resolves that set during render and sends it to native as a prop, so both sides agree
on how many angle floats a frame carries without negotiating it.

## Wire format

Landmarks cross as a `Float32Array` over an ArrayBuffer, not JSON objects.

| Encoding | Bytes/frame | Parse cost |
| --- | --- | --- |
| JSON `{x,y,z,visibility}` × 33 | ~3,000 | high |
| `Float32Array` | **528** | ~zero |

Layout: 33 landmarks × 4 floats, `[x, y, z, visibility, …]`. A thin JS accessor wraps it
without copying.

**Frames are pulled, not pushed.** An Expo Modules event cannot carry an ArrayBuffer and a
function return can, so native fills a ring buffer and emits an empty `onFrames` tick, and
`<PoseCamera>` answers by calling `drainFrames()`. One emission therefore costs two crossings,
which is what the numbers in the data-delivery guide reflect. See
[ADR 0008](./adr/0008-frames-are-drained-not-pushed.md).

```text
Float64  header, 6 slots      frameCount · droppedCount · floatsPerFrame ·
                              jointCount · angleCount · flags
Float64  2 per frame          timestamp, processingMs
Float32  the body             frameCount × floatsPerFrame
```

**The buffer describes itself.** Every block length comes out of the header, never out of the
current props, which is what makes a drain that arrives after a prop change decodable rather than
plausible-looking garbage. A batch whose joint or angle count disagrees with what JavaScript
expects is dropped and reported as a non-fatal `DETECTION_FAILED`, because relabelling it would
hand back another joint's numbers under the right name.

Frames come out as `subarray` views rather than copies, so a retained frame retains the entire
drained buffer, and its numbers are only stable while that buffer is alive. Anything kept past the
callback has to be copied with `.slice()`. This is the cost of not parsing, and it is worth being
explicit about in a callback that fires 60 times a second.

`data.select` narrows the buffer to exactly the joints named, in `PoseFrame.selection` order, and
reading a joint outside that set throws from the accessor. Angles are computed natively from the
full 33 landmarks before the narrowing, so asking for an angle never widens the payload
([ADR 0005](./adr/0005-select-narrows-the-buffer.md)).

A `snapshot: true` trigger hits the same wall: the frame cannot ride the `onTrigger` event either.
Native holds it and sends a claim ticket, `<PoseCamera>` redeems it with `takeTriggerSnapshot(id)`
before calling the app's handler, and the event therefore arrives one microtask later than a
plain trigger's ([ADR 0009](./adr/0009-trigger-snapshots-are-claimed.md)).

## Threading

| Work | Thread |
| --- | --- |
| Camera capture + inference | dedicated camera/inference queue (same queue: buffers never hop) |
| Overlay drawing | main / UI |
| Session configuration | one serial `sessionQueue` |
| JS callbacks | JS thread, only when something is emitted |

**All session state lives on `sessionQueue`.** No booleans shared across queues, that was the
root cause of the legacy package's camera-switch crashes.

## Camera switching

Non-negotiable rules. Every one of these exists because its absence caused a crash:

1. The capture delegate queue **is** the inference queue, sample buffers never escape the callback
2. Timestamps come from the buffer's presentation time, clamped strictly increasing
3. A **generation counter** is bumped per switch; results from an old generation are dropped
4. All session state mutates on one serial queue
5. The landmarker is **never recreated**, swap the input, keep the detector
6. Mirroring and rotation are applied **inside** the begin/commit configuration transaction
7. Any failure rolls back to the previous input
8. Android: `imageProxy.close()` in a `finally`, always, one miss stalls the analyzer forever

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
