# Events

| Callback | Fires | Rate | Built |
| --- | --- | --- | --- |
| `onReady` | camera + detector up | once | Android |
| `onError` | a failure occurred | rare | Android |
| `onCameraChange` | switch complete and stable | per switch | Android |
| `onPerformanceChange` | calibration settled or thermal adaptation | rare | no |
| `onTrigger` | a trigger transitioned | ~1 per event | no |
| `onPose` | frame delivered | 10/s or 30/s | no |
| `onPoseBatch` | buffer flushed | 2/s | no |
| `onFramesDropped` | the ring buffer dropped frames | per delivery | no |
| `onLog` | a batch of log entries | ~4/s while logging | no |

"Built" is the native half. iOS has none of it yet. The three Android events are the camera and
detector lifecycle; everything below them waits on the engine, so with today's build only
`onReady`, `onError` and `onCameraChange` ever fire.

With the defaults (`data.mode` unset, no triggers) only `onReady` would fire even on a complete
build.

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

`targetFps` and `deviceTier` are placeholders, a flat 30 and `'medium'`, until calibration lands.
Everything else is measured from the session that just came up.

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
| `DETECTION_FAILED` | ❌ | One frame, or one drained batch, failed; the pipeline continues |

`fatal: false` is normal operation, not a bug. Only `fatal: true` means the camera stopped.

`detectOnImage` and `detectOnVideo` do not exist yet, so their two codes are reserved rather than
reachable. The set is closed on purpose: adding them later would be a breaking change for anyone
switching exhaustively.

`DETECTION_FAILED` also covers a frame buffer that could not be decoded. `decodeFrames` never
throws, because it runs inside the drain loop and a throw there would stall the loop permanently.
It returns the problem instead and `<PoseCamera>` reports it here, non-fatally. A batch whose
joint count or angle count disagrees with the current props is dropped rather than relabelled:
attaching the wrong joint names would silently hand you another joint's numbers, and dropping one
drain is self-healing.

`INVALID_CONFIG` should be unreachable from a typed call site. Trigger configs are
[validated in JavaScript](./trigger-schema.md#validation) during render, so reaching native with a
bad one means the config was built dynamically and skipped that check.

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

### How `snapshot` actually arrives

A `PoseFrame` cannot ride an event: an event payload cannot carry an ArrayBuffer through Expo
Modules. So native holds the captured frame and puts a claim ticket on the event instead, and
`<PoseCamera>` redeems it over the function-return path before it calls you. See
[ADR 0009](../../docs/adr/0009-trigger-snapshots-are-claimed.md).

The consequence you can observe: a trigger with `snapshot: true` is delivered at least one
microtask later than a plain one, because the redemption is an awaited call. Snapshot triggers are
therefore not ordered against plain ones, and `timestamp` is what you should sort or compare on,
not arrival order. If the redemption fails, or the ticket was already spent, `onTrigger` still
fires with `snapshot` absent rather than not firing at all.

## `onPose` / `onPoseBatch`

```ts
onPose?: (frame: PoseFrame) => void;
onPoseBatch?: (frames: readonly PoseFrame[]) => void;
```

Mutually exclusive, `data.mode` decides which fires. Passing the wrong one is a no-op and
warns in development.

A frame's `landmarks` is a `subarray` view into the ArrayBuffer that drain returned, not a copy.
Nothing is parsed and nothing is allocated per landmark, which is the point. Two things follow.
Retaining a frame past the callback retains the entire drained buffer, and the values are only
guaranteed stable for as long as that buffer lives. If you keep anything beyond the call, copy it:

```ts
const history: Float32Array[] = [];

function onPose(frame: PoseFrame) {
  history.push(frame.landmarks.slice());   // a copy, safe to keep
}
```

## `onFramesDropped`

```ts
onFramesDropped?: (count: number) => void;
```

Frames the native ring buffer threw away because this consumer could not keep up. The buffer is
bounded and drops oldest-first, which is the right behavior for live pose data, but a drop is
still information and it used to be decoded on every drain and discarded.

It is reported per delivery, not cumulatively. A single spike is normal, for instance a slow first
render. A steady trickle means your `onPose` or `onPoseBatch` handler is doing too much work, and
the fix is to do less in the callback rather than to raise `flushMs`.
