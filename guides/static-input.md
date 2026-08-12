# Images and video files

*Android only. iOS has no module yet.*

Same detector, no camera.

```ts
import { detectOnImage, detectOnVideo } from 'react-native-pose-detection';
```

## Images

```ts
const poses = await detectOnImage(uri, { maxPoses: 1 });
// → PoseFrame[]   (one entry per detected pose)
```

| Option | Default | Notes |
| --- | --- | --- |
| `maxPoses` | `1` | 1–5 |
| `angles` | `true` | |
| `worldLandmarks` | `false` | |
| `smoothing` | `false` | meaningless for a single frame |

Accepts a local file URI, a `content://` URI on Android, or a bundled asset.

## Video

A video job can run for minutes, so it is not a bare promise. `detectOnVideo` returns a task you
can cancel, and the frames arrive on the task's promise:

```ts
const task = detectOnVideo(uri, {
  fps: 10,
  onProgress: (p) => setProgress(p),   // 0…1, on the JS thread, throttled
});

const frames = await task.frames;      // PoseFrame[]
task.cancel();                         // resolves task.frames with what was decoded so far
```

| Option | Default | Notes |
| --- | --- | --- |
| `fps` | `10` | sampling rate, not the video's own frame rate |
| `maxPoses` | `1` | |
| `startMs` / `endMs` | full clip | trim a range |
| `smoothing` | `true` | temporal, so it applies here |
| `onProgress` | n/a | `(progress: number) => void`, never frames |

Runs `VIDEO` mode with monotonic timestamps, so temporal tracking and smoothing behave the
same as they do live.

## Notes

**Memory.** The task holds every frame it has decoded so it can resolve with them, so a long clip
at a high `fps` holds a lot: 10 minutes at 30 fps is 18,000 `PoseFrame`s. Prefer a low `fps` and
trim with `startMs`/`endMs`.

**No calibration.** Static input runs at full quality. There is no live frame budget to hit,
so the profile and thermal systems don't apply. Long video jobs still respect the thermal
ladder's `critical` state.
