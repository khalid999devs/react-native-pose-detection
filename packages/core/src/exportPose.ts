import { getNativeModule } from './native';
import type { OverlayConfig } from './types/camera';

export type ExportOptions = {
  /**
   * The same shape `<PoseCamera overlay>` takes, so one vocabulary configures the live skeleton
   * and the painted one. `false` writes the file without painting anything, which is a way to get
   * a normalized, size-capped copy and nothing else.
   */
  overlay?: boolean | OverlayConfig;
  /** 1 to 5. Only the first pose is painted; the rest are counted in `posesFound`. */
  maxPoses?: number;
  /**
   * Detection samples a second, not the video's frame rate. Default 10. Frames in between are
   * painted with the pose detected most recently, which is what the live overlay does between
   * inferences. Raising this costs inference time roughly linearly.
   */
  fps?: number;
  /** Long edge of the output. Default 1920. `0` keeps the source's own size. */
  maxSize?: number;
  /**
   * Where the file lands. `'cache'` (the default) is the app's caches directory, `'documents'` is
   * its documents directory, and anything else is taken as a directory path or `file://` URI and
   * created if it is missing.
   *
   * The result is an ordinary file inside your app's sandbox, so whatever you already use for
   * files works on it unchanged: move it, upload it, hand it to a share sheet, delete it.
   */
  directory?: 'cache' | 'documents' | (string & {});
  /** Without an extension. Defaults to the source's name with `-pose` appended. */
  fileName?: string;
  /** JPEG quality for images, 0.1 to 1. Default 0.9. Ignored for video. */
  quality?: number;
  /** 0 to 1, throttled to about every two percent. */
  onProgress?: (progress: number) => void;
};

export type ExportResult = {
  /** A `file://` URI inside the app's sandbox. */
  readonly uri: string;
  readonly width: number;
  readonly height: number;
  /** 0 for a still image. */
  readonly durationMs: number;
  /** 1 for a still image, the encoded frame count for a video. */
  readonly frameCount: number;
  /** How many frames a pose was found in. 0 means nothing was painted. */
  readonly posesFound: number;
};

export type ExportTask = {
  /**
   * Rejects with `EXPORT_CANCELLED` after `cancel()`, and with `EXPORT_FAILED` if the file could
   * not be read, painted or written. A cancelled export deletes its own partial file.
   */
  readonly result: Promise<ExportResult>;
  cancel(): void;
};

let nextTaskId = 1;

/**
 * Paints the skeleton into a copy of an image or video and writes it into the app's sandbox.
 *
 * The painting is the same native renderer the live camera uses, so an exported frame and a live
 * one put a joint in the same place. Nothing about this runs on the camera's threads or its GPU:
 * an export uses its own CPU detector on a background queue below the camera's, so a long export
 * running beside a live preview costs the preview nothing but shared CPU time.
 *
 * A task rather than a bare promise, because a video takes as long as it takes and something has
 * to be able to stop it.
 *
 * ```ts
 * const task = exportPose(pickedUri, {
 *   overlay: { color: '#4da3ff', lineWidth: 4 },
 *   directory: 'documents',
 *   onProgress: setProgress,
 * });
 * const { uri } = await task.result;
 * ```
 */
export function exportPose(uri: string, options?: ExportOptions): ExportTask {
  const module = getNativeModule();
  const taskId = nextTaskId;
  nextTaskId += 1;

  const { onProgress, ...rest } = options ?? {};
  // A callback cannot cross to native, so progress comes back as an event keyed by task id.
  const subscription = onProgress
    ? module.addListener('onExportProgress', (event: { taskId: number; progress: number }) => {
        if (event.taskId === taskId) onProgress(event.progress);
      })
    : null;

  const result = module
    .exportPose(uri, rest as Record<string, unknown>, taskId)
    .finally(() => subscription?.remove());

  return {
    result,
    cancel: () => module.cancelExportPose(taskId),
  };
}
