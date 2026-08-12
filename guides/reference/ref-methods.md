# Ref methods

```tsx
const cam = useRef<PoseCameraRef>(null);
<PoseCamera ref={cam} />
```

```ts
type PoseCameraRef = {
  switchCamera(): Promise<void>;
  setFacing(facing: 'front' | 'back'): Promise<void>;

  pause(): Promise<void>;
  resume(): Promise<void>;
  startDetection(): Promise<void>;
  stopDetection(): Promise<void>;
  setOverlayEnabled(enabled: boolean): Promise<void>;

  setProfile(profile: Profile): void;
  getProfile(): ProfileState;
  getState(): CameraState;

  snapshot(): Promise<PoseFrame | null>;
};
```

Everything except `getState`, `setProfile` and `getProfile` returns a promise, because it reaches
native over the same asynchronous path every other call takes. Ignoring the promise is fine and
common. Awaiting it is how you see a failure instead of losing it.

`getState()` is the exception that stays synchronous: it reads a local mirror of the events that
carry camera state, so it is never a bridge call.

## Camera

| Method | Notes |
| --- | --- |
| `switchCamera()` | Toggles front/back. **Resolves only when the session is stable again**, meaning the new camera has delivered a frame, not when the rebind returns. Detection state and trigger counters are preserved. |
| `setFacing(f)` | Same guarantees, explicit target. No-op if already there. |
| `pause()` / `resume()` | Stops the capture session entirely. Lowest power state short of unmounting. |

A switch to a lens the device does not have fails with `CAMERA_SWITCH_FAILED` and rolls back to
the camera you were on. That is deliberately different from `facing: 'auto'`, which falls back to
the other lens on the first bind: an explicit request that cannot be honored must not report
success.

## Detection

| Method | Notes |
| --- | --- |
| `startDetection()` / `stopDetection()` | Preview keeps running. `stopDetection()` **releases GPU resources**, not just a flag. |
| `setOverlayEnabled(b)` | Drawing only. Inference continues: use when you draw your own UI. |
| `snapshot()` | Current `PoseFrame` on demand, regardless of `data.mode`. Resolves to `null` if no pose is present. **Async**: the landmark buffer comes back over the function-return path, the only one that carries an ArrayBuffer, see [ADR 0008](../../docs/adr/0008-frames-are-drained-not-pushed.md). |

## Introspection

```ts
cam.current?.getState();
// { facing: 'front', active: true, detecting: true, fps: 23.8,
//   delegate: 'GPU', deviceTier: 'medium' }
```

`fps` is measured from the analyzer, so it is what ran rather than what was asked for.

### `getProfile` is async, `getState` is not

```ts
await cam.current?.getProfile();
```

`getProfile()` reads native state. The phase, the source and the measured p50 are on no event, so
JavaScript has nothing to mirror them from, and a synchronous version would have to invent them.
`getState()` stays synchronous because everything in it does arrive on an event.

`getProfile()`'s output belongs in any performance bug report: it says what tier was chosen, how
it was chosen, and what the inference actually cost.
