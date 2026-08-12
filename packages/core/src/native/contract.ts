import type { LogLevelConfig } from '../types/logging';

/**
 * What the Expo module must implement. View props, ref methods, and events are declared on the
 * view, not here, so this stays the module-level surface only.
 */
export type NativePoseModule = {
  setLogLevel(config: LogLevelConfig): void;
  /** Called when the first JS listener attaches, so the native ring buffer stays idle until then. */
  startLogStream(): void;
  /** Called when the last listener detaches. */
  stopLogStream(): void;
};

/**
 * The imperative surface on the native view. `<PoseCamera>`'s ref forwards to it.
 *
 * `drainFrames` is the one that matters: events cannot carry an ArrayBuffer through Expo
 * Modules but function returns can, so frames are pulled rather than pushed. See
 * docs/adr/0008-frames-are-drained-not-pushed.md.
 */
export type NativePoseCameraView = {
  switchCamera(): Promise<void>;
  setFacing(facing: 'front' | 'back'): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  startDetection(): Promise<void>;
  stopDetection(): Promise<void>;
  setOverlayEnabled(enabled: boolean): Promise<void>;
  getState(): Promise<Record<string, unknown>>;
  /** Everything buffered since the last call, in one self-describing ArrayBuffer. */
  drainFrames(): Promise<ArrayBuffer>;
  /** The current frame on demand, regardless of `data.mode`. Empty when no pose is present. */
  snapshotFrame(): Promise<ArrayBuffer>;
};
