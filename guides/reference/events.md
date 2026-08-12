# Events

| Callback | Fires | Rate |
| --- | --- | --- |
| `onReady` | camera + detector up | once |
| `onError` | a failure occurred | rare |
| `onCameraChange` | switch complete and stable | per switch |
| `onPerformanceChange` | calibration settled or thermal adaptation | rare |
| `onTrigger` | a trigger transitioned | ~1 per event |
| `onPose` | frame delivered | 10/s or 30/s |
| `onPoseBatch` | buffer flushed | 2/s |

With the defaults (`data.mode: 'off'`, no triggers) only `onReady` ever fires.

## `onReady`

```ts
type ReadyEvent = {
  model: 'lite' | 'full' | 'heavy';
  delegate: 'GPU' | 'CPU';              // what was actually used
  delegateRequested: 'auto' | 'gpu' | 'cpu';
  targetFps: number;
  deviceTier: 'high' | 'medium' | 'low';
  resolution: { width: number; height: number };
  analysisResolution: { width: number; height: number };
  facing: 'front' | 'back';
};
```

## `onError`

```ts
type ErrorEvent = {
  code: ErrorCode;
  message: string;
  fatal: boolean;
};
```

This is the complete list. Native emits nothing outside it, so a `switch` on `code` can be
exhaustive and a new failure mode has to be added here rather than appearing as a new string.
`ERROR_CODES` is exported if you need to iterate them.

| Code | Fatal | Meaning |
| --- | --- | --- |
| `PERMISSION_DENIED` | ✅ | Camera permission refused |
| `MODEL_NOT_FOUND` | ✅ | Plugin didn't run, or prebuild was skipped |
| `MODEL_LOAD_FAILED` | ✅ | The model file is present but could not be read |
| `CAMERA_UNAVAILABLE` | ✅ | No camera for the requested facing |
| `CAMERA_START_FAILED` | ✅ | The capture session could not be started |
| `DETECTOR_INIT_FAILED` | ✅ | Landmarker could not be created on either delegate |
| `INVALID_CONFIG` | ✅ | Native rejected a prop or trigger config |
| `IMAGE_DECODE_FAILED` | ✅ | `detectOnImage` could not read the source |
| `VIDEO_DECODE_FAILED` | ✅ | `detectOnVideo` could not read the source |
| `CAMERA_SWITCH_FAILED` | ❌ | Rolled back to the previous camera |
| `GPU_UNAVAILABLE` | ❌ | Fell back to CPU: expect lower frame rates |
| `DETECTION_FAILED` | ❌ | A single frame failed; the pipeline continues |

`fatal: false` is normal operation, not a bug. Only `fatal: true` means the camera stopped.

`INVALID_CONFIG` should be unreachable from a typed call site. Trigger configs are
[validated in JS](./trigger-schema.md#validation) first, so reaching native with a bad one means
the config was built dynamically and skipped that check.

## `onCameraChange`

```ts
type CameraChangeEvent = { facing: 'front' | 'back' };
```

Fires **after** the session is stable, not when the switch begins.

## `onPerformanceChange`

```ts
type PerformanceEvent = {
  reason: 'calibration' | 'thermal' | 'load' | 'headroom' | 'gpu_fallback';
  delegate: 'GPU' | 'CPU';
  targetFps: number;
  analysisResolution: { width: number; height: number };
  actualFps: number;
};
```

Fires on every automatic adjustment. Still fires under `thermalPolicy="off"`, the library
stops acting, never stops reporting.

## `onTrigger`

```ts
type TriggerEvent = {
  id: string;
  phase: 'enter' | 'exit' | 'cycle';
  count: number;          // completed cycles since mount
  timestamp: number;      // ms, monotonic
  durationMs?: number;    // enter → exit, on 'cycle'
  snapshot?: PoseFrame;   // if the trigger set snapshot: true
};
```

## `onPose` / `onPoseBatch`

```ts
onPose?: (frame: PoseFrame) => void;
onPoseBatch?: (frames: PoseFrame[]) => void;
```

Mutually exclusive, `data.mode` decides which fires. Passing the wrong one is a no-op and
warns in development.
