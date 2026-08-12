# Native modules

Both platforms are Expo Modules, which gives old- and new-architecture support without a
per-architecture code path.

## Module definition

The JS-facing surface is declared once per platform and must stay in lockstep with
`src/types/`. Props, events, and ref methods are the contract, if they drift, the
TypeScript is lying.

```text
Name("PoseDetection")

View(PoseCameraView) {
  Prop("profile") · Prop("facing") · Prop("delegate") · …
  Events("onReady", "onError", "onCameraChange", "onPerformanceChange",
         "onTrigger", "onPose", "onPoseBatch")
  AsyncFunction("switchCamera") · Function("snapshot") · …
}
```

Ref methods are view functions, not module functions taking a view tag. The legacy package
used `switchCamera(viewTag)`; that pattern is not used here.

## Frame path

```text
capture callback (camera/inference queue)
  → downscale to analysisResolution
  → PoseDetector.detectAsync(buffer, timestamp)
      ↓ async, MediaPipe callback thread
  → PoseEngine.process(landmarks)
      ├→ geometry (lazy: only referenced joints)
      ├→ smoothing
      ├→ triggers
      ├→ OverlayRenderer.draw()      main/UI thread
      └→ emit if warranted           JS thread
```

The capture delegate is registered **on the inference queue**, so buffers never hop threads.
This is rule 1 and it is not negotiable, see [architecture](./architecture.md#camera-switching).

## Adding a prop

1. Add to `src/types/` and the `PoseCameraProps` type
2. Declare `Prop(...)` in **both** module definitions
3. Implement in both native views
4. Document in [`guides/reference/pose-camera.md`](../guides/reference/pose-camera.md)
5. Exercise it in `example/`

A prop implemented on one platform only must be documented as such, or not merged.

## Adding an event

1. Add the payload type to `src/types/`
2. Declare in `Events(...)` on both platforms
3. Emit from the same logical point on both, not "whenever convenient"
4. Document in [`guides/reference/events.md`](../guides/reference/events.md)

Events crossing per frame need a strong justification. Default to emitting on state change.

## Threading

| Work | Thread |
| --- | --- |
| Capture + inference | dedicated camera/inference queue |
| Overlay drawing | main / UI |
| Session configuration | one serial `sessionQueue` |
| JS callbacks | JS thread, only on emission |

All session state mutates on `sessionQueue`. Reading it from another thread requires an
immutable snapshot captured at frame time, never a shared mutable flag. Unsynchronized
booleans across queues were the root cause of the legacy package's camera-switch crashes.

## MediaPipe notes

- **Pinned to `0.10.21`**: [ADR 0003](./adr/0003-pin-mediapipe-0-10-21.md). Do not bump casually.
- `LIVE_STREAM` mode rejects non-increasing timestamps. Clamp, never trust the source.
- Landmarker construction is expensive, first inference can stall for seconds. It is created
  once per process and pre-warmed during camera setup.
- GPU delegate success is verified by a successful first inference, not by construction alone.

## Debugging

| Symptom | Look at |
| --- | --- |
| Frozen preview, Android | a missed `imageProxy.close()` |
| MediaPipe timestamp error | clamping logic, or an async hop reordering frames |
| Crash on rapid camera switch | generation counter, or state read off `sessionQueue` |
| Overlay misaligned | `transformNormalizedPoint` and the preview-rect calculation |
| Memory climbing | allocations in the frame path: profile it |
