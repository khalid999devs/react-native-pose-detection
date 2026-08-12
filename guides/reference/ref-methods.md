# Ref methods

```tsx
const cam = useRef<PoseCameraRef>(null);
<PoseCamera ref={cam} />
```

```ts
type PoseCameraRef = {
  switchCamera(): Promise<void>;
  setFacing(f: 'front' | 'back'): Promise<void>;

  pause(): void;
  resume(): void;
  startDetection(): void;
  stopDetection(): void;
  setOverlayEnabled(enabled: boolean): void;

  setProfile(p: Profile): void;
  getProfile(): ProfileState;
  getState(): CameraState;

  snapshot(): PoseFrame | null;
};
```

## Camera

| Method | Notes |
| --- | --- |
| `switchCamera()` | Toggles front/back. **Resolves only when the session is stable again**: await it rather than guessing. Detection state, calibration, and trigger counters are preserved. |
| `setFacing(f)` | Same guarantees, explicit target. No-op if already there. |
| `pause()` / `resume()` | Stops the capture session entirely. Lowest power state short of unmounting. |

## Detection

| Method | Notes |
| --- | --- |
| `startDetection()` / `stopDetection()` | Preview keeps running. `stopDetection()` **releases GPU resources**, not just a flag. |
| `setOverlayEnabled(b)` | Drawing only. Inference continues: use when you draw your own UI. |
| `snapshot()` | Current `PoseFrame` on demand, regardless of `data.mode`. Returns `null` if no pose is present. |

## Introspection

```ts
cam.current.getProfile();
// { profile: 'auto', phase: 'settled', source: 'measured', tier: 'medium',
//   resolved: { delegate: 'GPU', targetFps: 24, preview: '720p', analysis: '480p' },
//   p50InferenceMs: 21.4 }

cam.current.getState();
// { facing: 'front', active: true, detecting: true, fps: 23.8,
//   delegate: 'GPU', deviceTier: 'medium' }
```

Include `getProfile()` output in any performance bug report.
