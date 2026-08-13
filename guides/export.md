# Export

`exportPose()` paints the skeleton into a copy of an image or a video and writes it into your
app's sandbox. It comes back as an ordinary file path, so everything you already do with files
works on it unchanged: upload it, move it, hand it to a share sheet, delete it.

```tsx
import { exportPose } from 'react-native-pose-detection';

const task = exportPose(pickedUri, {
  overlay: { color: '#4da3ff', lineWidth: 4 },
  directory: 'documents',
  onProgress: setProgress,
});

const { uri, width, height, posesFound } = await task.result;
```

The painting is the same native renderer the live camera uses. There is no JavaScript drawing
layer and nothing for your app to implement: you pass the colors and thicknesses you would pass to
`<PoseCamera overlay>`, and the skeleton lands in the same place it would land live.

## It will not slow the camera down

This is the constraint the whole feature was built around. The live camera is the main thing this
package does, and an export is something extra that must never cost it frames. Four things buy
that, and all four are structural rather than best effort:

| | What | Why |
| --- | --- | --- |
| 1 | Its own detector | An export never touches the camera's landmarker. It builds one, uses it, releases it |
| 2 | **CPU inference, always** | The camera owns the GPU. Two MediaPipe graphs contending for it is exactly how a preview starts stuttering, so an export never asks for it |
| 3 | A `utility` background queue | Below the camera's analysis queue, so under load the scheduler starves the export rather than sharing evenly. Serial, so two exports queue rather than gang up |
| 4 | Bounded memory | One frame decoded at a time, one pooled buffer encoded at a time, nothing accumulated. A ten minute video costs what a ten second one costs |

One honest caveat to rule 2: on Android the **pixels** of a video export do go through the GPU,
because decoder to GL to encoder is the only path the platform offers and the alternative,
converting every frame in Kotlin, would take far more CPU from the camera than that takes GPU. The
part that matters is unchanged: **inference never touches the GPU on either platform**, and
inference is the heavy, sustained load that would actually cost the preview its frame rate.

An export is therefore slower than it could be, on purpose. You can run one while the camera is
live and the preview keeps its frame rate.

## What it costs

A 30 second 1080p clip takes roughly 10 to 30 seconds on a recent phone, most of it inference.
The levers, in the order they matter:

- **`fps`** (default 10) is how often detection runs, not the output's frame rate. Every frame in
  between is painted with the most recent pose, which is what the live overlay does between
  inferences. Halving it roughly halves the time.
- **`maxSize`** (default 1920) caps the long edge. A 4K source painted at 1920 encodes a quarter
  of the pixels.
- The output is re-encoded H.264, so it is a second copy on disk and one generation of quality
  down from the source. Nothing about the original is changed.

## Where the file goes

`directory` decides, and the default is the app's caches directory because an export is derived
data. A package that wrote into Documents by default would be putting files the user never asked
for into their iCloud backup.

| `directory` | Where |
| --- | --- |
| `'cache'` (default) | Caches. The system may reclaim it under pressure |
| `'documents'` | Documents. Kept until you delete it |
| any path or `file://` URI | Exactly there, created if missing |

```ts
// Somewhere your app owns, which is how the example app does it.
const dir = `${FileSystem.documentDirectory}exported`;
const { uri } = await exportPose(pickedUri, { directory: dir }).result;
```

Nothing is written to the photo library, and no permission is asked for. Saving to the camera roll
is one call in `expo-media-library` on a path you already have, and it is your app's decision
rather than this package's.

## Cancelling

```ts
const task = exportPose(uri, { onProgress: setProgress });
// ...
task.cancel();
```

`result` then rejects with `EXPORT_CANCELLED`, and the partial file is deleted rather than left
behind as something that looks like a finished export. A failure rejects with `EXPORT_FAILED` and
cleans up the same way.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `overlay` | `true` | The same shape `<PoseCamera overlay>` takes. `false` writes an unpainted, size-capped copy |
| `maxPoses` | `1` | Only the first is painted. The rest are counted in `posesFound` |
| `fps` | `10` | Detection samples a second, not output frame rate |
| `maxSize` | `1920` | Long edge cap. `0` keeps the source's size |
| `directory` | `'cache'` | See above |
| `fileName` | source name + `-pose` | No extension; sanitized before it reaches the filesystem |
| `quality` | `0.9` | JPEG quality. Images only |
| `onProgress` | none | 0 to 1, throttled to about every two percent |

## What comes back

```ts
type ExportResult = {
  uri: string;         // file:// inside your sandbox
  width: number;
  height: number;
  durationMs: number;  // 0 for a still
  frameCount: number;  // 1 for a still
  posesFound: number;  // frames a pose was found in; 0 means nothing was painted
};
```

`posesFound: 0` is worth handling. It means the export succeeded and painted nothing, which is a
different thing from a failure and usually means the body was out of frame or too small.

Images are written as JPEG and videos as H.264 in an MP4, with the original audio copied through
rather than re-encoded. Rotation is baked into the output rather than carried as a track transform,
so a clip shot in portrait plays upright everywhere, including in the players and server side
transcoders that ignore the transform.

An audio codec an MP4 cannot hold, which a few source containers allow, is dropped with a warning
on the `detector` log channel rather than failing the export: a painted video with no sound beats
no video at all.

## When you want the numbers instead

`exportPose` gives you a picture. [`detectOnImage` and `detectOnVideo`](./static-input.md) give
you the landmarks, and neither writes a file. They are the ones to reach for if you are counting
reps or measuring angles rather than showing someone their form.
