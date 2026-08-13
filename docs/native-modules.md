# Native modules

Both platforms are Expo Modules, which is what keeps the JS-facing surface declared once per
platform instead of once per architecture. That mattered more when there were two: React Native
0.82 removed the legacy architecture, so there is one left.

Both exist. `packages/core/android` is Kotlin on CameraX, `packages/core/ios` is Swift on
AVFoundation, and the rules below are what each has to satisfy. Where they differ, the difference
is named rather than left for somebody to find.

## Module definition

The JS-facing surface is declared once per platform and must stay in lockstep with
`src/types/`. Props, events, and ref methods are the contract, if they drift, the
TypeScript is lying.

```text
Name("PoseDetection")

Function("setLogLevel") · Function("startLogStream") · Function("stopLogStream")

View(PoseCameraView) {
  Prop("profile") · Prop("facing") · Prop("delegate") · …
  Prop("angleJoints") · Prop("selection")
  Events("onReady", "onError", "onCameraChange", "onPerformanceChange",
         "onTrigger", "onFrames", "onLog")
  AsyncFunction("switchCamera") · AsyncFunction("drainFrames")
  AsyncFunction("snapshotFrame") · AsyncFunction("takeTriggerSnapshot") · …
}
```

`src/native/contract.ts` is the authoritative list; that sketch is a shape, not a copy of it.

Three things in it are easy to get wrong:

- **`onPose`, `onPoseBatch` and `onFramesDropped` are not native events.** They are JavaScript
  callbacks that `<PoseCamera>` invokes after a drain. Native emits `onFrames`, which carries no
  payload at all, and JavaScript answers it by calling `drainFrames()`. An event cannot carry an
  ArrayBuffer, a function return can. See
  [ADR 0008](./adr/0008-frames-are-drained-not-pushed.md).
- **`onTrigger` carries a `snapshotId`, not a snapshot.** A `PoseFrame` is the same ArrayBuffer
  problem, so native holds the captured frame and puts a claim ticket on the event.
  `<PoseCamera>` redeems it with `takeTriggerSnapshot(id)` and only then calls the user's
  `onTrigger`, which makes a snapshot trigger arrive one microtask later than a plain one.
  Redeeming an unknown or already-redeemed ticket must return an empty buffer rather than
  failing, and native must bound how many unclaimed frames it holds. See
  [ADR 0009](./adr/0009-trigger-snapshots-are-claimed.md).
- **`angleJoints` and `selection` are props, not something native derives.** JavaScript resolves
  which angles to compute and which joints the buffer holds, and passes both down, so the two
  sides cannot disagree about the shape of a frame.

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
      └→ ring buffer + onFrames tick JS thread, only when an emission is due
          ↓ JavaScript answers with drainFrames()
      → one self-describing ArrayBuffer, decoded as subarray views
```

The buffer's header carries the frame count, the dropped count, the floats per frame, the joint
count, the **angle count**, and a flag word. Every variable-length block's length is derivable
from that header alone. The angle count is there because taking the angle block's length from the
current props meant a prop change while frames sat in the ring buffer shifted `centerOfMass`,
`velocity` and `bodySpan` into the angle floats. Both sides encode angles in `ANGLE_JOINT_NAMES`
order, never in mention order.

A batch whose joint count or angle count disagrees with what JavaScript currently expects is
**dropped**, not relabelled. Attaching the wrong joint names to a buffer silently returns another
joint's numbers, and dropping one drain is self-healing.

The ring buffer is bounded at 64 frames and drops the oldest, counting what it dropped so the
next drain's header reports it. Its storage is allocated once per layout and reused, so the frame
path copies and never allocates; a drain allocates exactly one direct buffer, in **native byte
order** rather than Java's big-endian default, because JavaScript reads that memory through typed
arrays in the same process and cannot be told to read it any other way.

The latest frame is recorded whatever `data.mode` says, because `snapshotFrame()` is documented to
answer at `mode: 'off'`. The mode decides two things only: whether a frame is also buffered, and
whether to tick.

The capture delegate is registered **on the inference queue**, so buffers never hop threads.
This is rule 1 and it is not negotiable, see [architecture](./architecture.md#camera-switching).

## Adding a prop

1. Add to `src/types/` and the `PoseCameraProps` type
2. Declare `Prop(...)` in **both** module definitions
3. Implement in both native views
4. Document in [`guides/reference/pose-camera.md`](../guides/reference/pose-camera.md)
5. Exercise it in the example app

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

## Where the two differ

Everything above is the same on both. These are the places the platforms genuinely diverge, and
each one is a decision rather than an oversight.

| | Android | iOS |
| --- | --- | --- |
| Session queue | the main thread, because CameraX requires `bindToLifecycle` there | a serial `sessionQueue`, because `startRunning` blocks |
| Rotation | left on the buffer, passed to MediaPipe as `ImageProcessingOptions` | applied by the capture connection, so MediaPipe is always handed `.up` |
| Buffer conversion | `FrameConverter` copies the `ImageProxy` into a reused bitmap | none: `MPImage(sampleBuffer:)` takes the `CMSampleBuffer` directly |
| Teardown | four registrations and an explicit destroy hook | `deinit`, plus notification tokens removed on detach |
| Drain queue | off the main queue, deliberately | on it: ExpoModulesCore puts every view function there and offers no opt-out |
| Permission states | `denied` and `blocked` are distinguishable | a refusal is always `blocked`; iOS prompts once |
| Device probe | cores and memory | memory only, because Apple has shipped six cores since the A11 |
| Volatile reads | `@Volatile` | a lock, through `Guarded<T>`, since Swift has no equivalent below iOS 18 |

## Android notes

- **Coordinates are anisotropic.** Landmarks are normalized by dividing x by width and y by
  height, so one unit of x is not one unit of y on any non-square frame. Angles are computed with
  an aspect correction that puts both axes back in a common unit; without it every angle on a
  standard 4:3 or 16:9 frame is wrong. The overlay arcs need the same correction, or the arc sits
  outside the joint it belongs to.
- **The overlay is projected from rotated buffer dimensions**, not from the sensor's. Using the
  raw sensor dimensions lines the skeleton up in portrait and skews it everywhere else.
- **ProGuard rules ship with the library**, through `consumerProguardFiles`. MediaPipe reaches its
  own classes from JNI and neither AAR carries keep rules, so R8 in a consumer's release build is
  free to strip or rename them. That failure only appears in a release build, which is after the
  developer has shipped.

## MediaPipe notes

- **Pinned to `0.10.35`**: [ADR 0007](./adr/0007-pin-mediapipe-0-10-35.md), which supersedes ADR
  0003 and its 0.10.21 pin. Do not bump casually, and do not "restore" the older pin.

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

## iOS notes

- **Rotation is applied by the capture connection**, inside `beginConfiguration`/
  `commitConfiguration`, so buffers arrive display-upright and `MPImage` is always constructed
  with `.up`. `AVCaptureVideoOrientation` and `UIInterfaceOrientation` have opposite names for the
  same two landscape cases but matching raw values, so `CaptureRotation` converts through
  `rawValue`. Converting by name is the classic way to get a sideways preview.
- **Mirroring is the preview's alone.** The video data output connection is never mirrored, so
  landmarks describe the real world; the overlay flips at draw time. Mirroring the analysis output
  instead puts every left limb on the right.
- **The preview is a view, not a layer somebody keeps in sync.** `PreviewView` overrides
  `layerClass`, so UIKit resizes the preview layer during layout and there is no frame assignment
  to mistime on rotation.
- **Six AVFoundation reads are deprecated in iOS 16** and every replacement is async and 16-only.
  This package supports 15.1, the floor React Native 0.74 sets, so the old calls are still the ones
  that run and each one warns. They live in `AssetCompat` and nowhere else, so one comment explains
  all of them rather than a warning appearing wherever a track or a frame is read. Raising the floor
  to 16 is the fix, and it is a compatibility decision rather than a cleanup.
- **Three view functions warn under Swift 6 strict concurrency.** `drainFrames`, `snapshotFrame`
  and `takeTriggerSnapshot` use `PoseCameraView`'s `AnyArgument` conformance, which `ExpoView`
  isolates to the main actor, from the nonisolated closure `AsyncFunction` takes. Both halves are
  Expo's, so there is nothing to change here: marking the closure `@MainActor` adds a second warning
  about losing that isolation instead of removing the first. They are warnings under the Swift 5
  language mode this package builds in, and the fix is upstream.
- **Expo SDK 57 requires iOS 16.4**, so an app that targets lower gets every Expo pod silently
  skipped by autolinking, and this package fails to resolve `ExpoModulesCore`. `example/bare`
  pins 16.4 for exactly that reason. The podspec itself declares 15.1, which is this package's own
  floor; Expo raises it to match `ExpoModulesCore` during `pod install`.

## MediaPipe on both platforms

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
| Frozen preview, iOS | a sample buffer retained past `captureOutput` |
| Overlay misaligned | the projection in `OverlayView`, and the frame size it was handed |
| Landmarks sideways or upside down, iOS | the connection's rotation, set in `CaptureRotation` |
| Memory climbing | allocations in the frame path: profile it |
