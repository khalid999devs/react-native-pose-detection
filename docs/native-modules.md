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

### ABI coverage by version

Measured from the published AARs, not from release notes. The ABI set moved around a lot in
the 0.10.2x line, and native code moved from `tasks-vision` to `tasks-core` at 0.10.33.

| Version | ABIs | Native AAR total | On CocoaPods |
| --- | --- | --- | --- |
| 0.10.21 | arm64-v8a, armeabi-v7a, x86 | 18.3 MB | yes |
| 0.10.26 | arm64-v8a | 6.7 MB | no |
| 0.10.26.1 | arm64-v8a, armeabi-v7a | 10.8 MB | no |
| 0.10.28 | all four | 73.2 MB | no |
| 0.10.29 | all four | 18.8 MB | no |
| 0.10.32 | all four | 19.9 MB | no |
| 0.10.33 | all four | 20.9 MB | yes |
| 0.10.35 | all four | 20.6 MB | yes |

Two things to know before touching the pin:

- **0.10.21 has no `x86_64`**, which is why it is not the pin. A React Native app ships `x86_64`,
  so the package manager picks `x86_64` as the primary ABI and never extracts MediaPipe's 32-bit
  `x86` library, surfacing as `UnsatisfiedLinkError` at landmarker construction. Resolved in
  [ADR 0007](./adr/0007-pin-mediapipe-0-10-35.md) by pinning 0.10.35, which ships all four.
- The one-ABI regression was 0.10.26 and 0.10.26.1 only. It was reverted by 0.10.28.

Measured from an assembled debug APK on the 0.10.35 pin, not from the AAR:

| ABI | `libmediapipe_tasks_jni.so` |
| --- | --- |
| `arm64-v8a` | 10.5 MB |
| `armeabi-v7a` | 7.4 MB |
| `x86` | 15.0 MB |
| `x86_64` | 13.0 MB |

Google does not publish every version to CocoaPods, so iOS choices are narrower than Android's.

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
