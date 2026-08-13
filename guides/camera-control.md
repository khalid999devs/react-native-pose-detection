# Camera control

Camera, detection, and overlay are **three independent switches**. Each has a different cost,
and each can be toggled at runtime without tearing anything down.

| Camera | Detection | Overlay | Use case | Cost |
| --- | --- | --- | --- | --- |
| on | on | on | live coaching | full |
| on | on | off | custom UI, headless analysis | no draw |
| on | off | off | plain camera preview | ~0 |
| off | n/a | n/a | screen backgrounded | 0 |

## Declarative

```tsx
<PoseCamera active={isFocused} detection={isRecording} overlay={showSkeleton} />
```

## Imperative

```tsx
const cam = useRef<PoseCameraRef>(null);

await cam.current.pause();                    // camera off: lowest power short of unmounting
await cam.current.stopDetection();            // preview stays, inference stops, GPU released
await cam.current.setOverlayEnabled(false);   // drawing stops, inference continues
```

`pause`, `resume`, `startDetection`, `stopDetection` and `setOverlayEnabled` all return
`Promise<void>`, because they reach native over the same asynchronous path as everything else.
Ignoring the promise is fine and common. Awaiting it is the only way to see a failure, and the
only way to know the camera is really down before you do something that assumes it.
`getState()` is the exception: it reads state JavaScript already mirrors from the events, so it
stays synchronous.

`stopDetection()` genuinely releases GPU resources. It isn't a boolean gate on a still-running
pipeline.

## Drawing angles

The overlay can draw an arc and degree label at any joint:

```tsx
<PoseCamera overlay={{ angles: [{ joint: 'leftElbow' }, { joint: 'leftKnee' }] }} />
```

Rendered natively alongside the skeleton, so no data crosses to JavaScript. Each arc adds its
joint to the set of angles computed per frame, exactly as an `angle` condition in a trigger or a
name in `data.angles` does. Nothing else turns an angle on. See
[overlay config](./reference/pose-camera.md#angle-overlay).

`decimals` on a label is capped at 3. The label is built into a fixed buffer on the draw path,
so a larger value would only build a longer string to truncate it again.

## Switching cameras

```tsx
await cam.current.switchCamera();      // resolves when the session is stable
await cam.current.setFacing('back');
```

**Await it.** The promise resolves only after the capture session has been reconfigured and the
first frame from the new camera has been processed. `onCameraChange` fires at the same point. A
failed switch rejects the promise as well as raising `onError`.

Preserved across a switch, because only the camera input is swapped and the detector is never
recreated:

- detection on/off state
- overlay configuration
- once the engine lands, calibration results and trigger counters and phases

Rapid switching is safe by design: a switch is reported only once the new lens delivers a
frame, a second request mid-switch is refused rather than queued, and the path rolls back to the
previous lens on a failed bind. The 100-switch stress scenario in the example app is the way to
hold it to that on your own hardware.

If the new camera can't be opened, the previous one is restored and you get
`onError({ code: 'CAMERA_SWITCH_FAILED', fatal: false })` plus a rejected promise. This is also
what you get from `switchCamera()` on a device with only one lens: `facing: 'auto'` falls back to
the other lens on the first bind, but an explicit switch to a lens that isn't there fails rather
than quietly succeeding on the lens already running.

## Lifecycle

Backgrounding stops the session and releases the detector automatically. Foregrounding restores
both. Once calibration lands it will restore the settled configuration with them, so a
foreground is never a re-probe.

You don't need to wire `AppState` yourself. Do use `active` to stop the camera when the screen
is merely out of view. A tab you've navigated away from, or a `FlatList` item scrolled offscreen:

```tsx
const isFocused = useIsFocused();
<PoseCamera active={isFocused} />
```

## Mirroring

Front-camera landmark `x` is **un-mirrored**, coordinates describe the real world, not the
preview image. `leftWrist` is the subject's actual left wrist regardless of which camera is used.

The overlay mirrors internally so it still aligns with what's on screen. If you draw your own
overlay from `onPose` data, you must mirror it yourself for the front camera.
