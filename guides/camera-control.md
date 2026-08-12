# Camera control

Camera, detection, and overlay are **three independent switches**. Each has a different cost,
and each can be toggled at runtime without tearing anything down.

| Camera | Detection | Overlay | Use case | Cost |
|---|---|---|---|---|
| on | on | on | live coaching | full |
| on | on | off | custom UI, headless analysis | no draw |
| on | off | off | plain camera preview | ~0 |
| off | — | — | screen backgrounded | 0 |

## Declarative

```tsx
<PoseCamera active={isFocused} detection={isRecording} overlay={showSkeleton} />
```

## Imperative

```tsx
const cam = useRef<PoseCameraRef>(null);

cam.current.pause();             // camera off — lowest power short of unmounting
cam.current.stopDetection();     // preview stays, inference stops, GPU resources released
cam.current.setOverlayEnabled(false);   // drawing stops, inference continues
```

`stopDetection()` genuinely releases GPU resources — it isn't a boolean gate on a still-running
pipeline.

## Drawing angles

The overlay can draw an arc and degree label at any joint:

```tsx
<PoseCamera overlay={{ angles: [{ joint: 'leftElbow' }, { joint: 'leftKnee' }] }} />
```

Rendered natively alongside the skeleton — no data crosses to JavaScript, and the angle is
computed by the same lazy pass that feeds triggers. See
[overlay config](./reference/pose-camera.md#angle-overlay).

## Switching cameras

```tsx
await cam.current.switchCamera();      // resolves when the session is stable
await cam.current.setFacing('back');
```

**Await it.** The promise resolves only after the capture session has been reconfigured and
the first frame from the new camera has been processed. `onCameraChange` fires at the same point.

Preserved across a switch:

- detection on/off state
- calibration results
- trigger counters and phases
- overlay configuration

The detector is never recreated — only the camera input is swapped. Rapid switching is safe;
it's covered by a 100-iteration stress test in CI.

If the new camera can't be opened, the previous one is restored and you get
`onError({ code: 'CAMERA_SWITCH_FAILED', fatal: false })`.

## Lifecycle

Backgrounding stops the session and releases the detector automatically. Foregrounding restores
both, including the previously calibrated configuration.

You don't need to wire `AppState` yourself. Do use `active` to stop the camera when the screen
is merely out of view — a tab you've navigated away from, or a `FlatList` item scrolled offscreen:

```tsx
const isFocused = useIsFocused();
<PoseCamera active={isFocused} />
```

## Mirroring

Front-camera landmark `x` is **un-mirrored** — coordinates describe the real world, not the
preview image. `leftWrist` is the subject's actual left wrist regardless of which camera is used.

The overlay mirrors internally so it still aligns with what's on screen. If you draw your own
overlay from `onPose` data, you must mirror it yourself for the front camera.
