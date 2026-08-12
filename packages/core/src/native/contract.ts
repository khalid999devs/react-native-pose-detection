import type { LogLevelConfig } from '../types/logging';
import type { TriggerEvent } from '../types/triggers';

/** Exactly what Android reports. The four-state public status is derived from these two. */
export type NativeCameraPermission = {
  readonly status: 'granted' | 'denied' | 'undetermined';
  readonly canAskAgain: boolean;
};

/** Module-level surface. View props, ref methods and events are declared on the view. */
export type NativePoseModule = {
  setLogLevel(config: LogLevelConfig): void;
  getCameraPermission(): Promise<NativeCameraPermission>;
  /** Prompts when the system still will, and resolves with the outcome either way. */
  requestCameraPermission(): Promise<NativeCameraPermission>;
  /** Called when the first JS listener attaches, so the native ring buffer stays idle until then. */
  startLogStream(): void;
  /** Called when the last listener detaches. */
  stopLogStream(): void;
};

/**
 * A frame cannot ride an event, so native holds it and sends a claim ticket that
 * `<PoseCamera>` redeems. See
 * [ADR 0009](../../../../docs/adr/0009-trigger-snapshots-are-claimed.md).
 */
export type NativeTriggerEvent = Omit<TriggerEvent, 'snapshot'> & {
  readonly snapshotId?: number;
};

/**
 * Imperative surface behind `<PoseCamera>`'s ref. Frames are pulled rather than pushed because
 * only a function return carries an ArrayBuffer, and the `onFrames` tick that prompts a drain
 * carries no payload. See
 * [ADR 0008](../../../../docs/adr/0008-frames-are-drained-not-pushed.md).
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
  /** Redeems a trigger's ticket. An unknown or spent ticket returns an empty buffer. */
  takeTriggerSnapshot(snapshotId: number): Promise<ArrayBuffer>;
};
