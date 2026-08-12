import type { StyleProp, ViewStyle } from 'react-native';

import type {
  AnalysisResolutionPreset,
  DataConfig,
  DelegateRequest,
  Facing,
  FacingRequest,
  OverlayConfig,
  Profile,
  ProfileState,
  ResolutionPreset,
  SmoothingConfig,
  ThermalPolicy,
  CameraState,
} from './camera';
import type { PoseFrame } from './frame';
import type { CameraChangeEvent, ErrorEvent, PerformanceEvent, ReadyEvent } from './events';
import type { LogEntry, LogLevelConfig } from './logging';
import type { Trigger, TriggerEvent } from './triggers';

/**
 * Every axis defaults to `'auto'`. Setting one pins it and calibration leaves it alone, the rest
 * keep adapting. See the precedence chain in guides/performance.md.
 */
export type PoseCameraProps = {
  style?: StyleProp<ViewStyle>;

  profile?: Profile;
  facing?: FacingRequest;
  delegate?: DelegateRequest;
  targetFps?: 'auto' | number;
  resolution?: 'auto' | ResolutionPreset;
  /** What the model sees. Independent of `resolution`, which only affects the preview. */
  analysisResolution?: 'auto' | AnalysisResolutionPreset;
  thermalPolicy?: ThermalPolicy;
  /** 1 to 5. Triggers evaluate against the primary pose. */
  maxPoses?: number;
  smoothing?: boolean | SmoothingConfig;

  /** Camera on or off. The lowest power state short of unmounting. */
  active?: boolean;
  /** Inference on or off. `false` releases GPU resources, the preview keeps running. */
  detection?: boolean;
  overlay?: boolean | OverlayConfig;

  data?: DataConfig;
  triggers?: readonly Trigger[];

  /** Raises the level while this camera is mounted. `setLogLevel()` sets it globally. */
  logLevel?: LogLevelConfig;

  onReady?: (event: ReadyEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onCameraChange?: (event: CameraChangeEvent) => void;
  onPerformanceChange?: (event: PerformanceEvent) => void;
  onTrigger?: (event: TriggerEvent) => void;
  /** `data.mode` of `'throttled'` or `'live'`. */
  onPose?: (frame: PoseFrame) => void;
  /** `data.mode` of `'batched'`. */
  onPoseBatch?: (frames: readonly PoseFrame[]) => void;
  /**
   * Frames the native ring buffer dropped because this consumer could not keep up. Reported per
   * delivery, so a steady trickle here means the callback is doing too much work.
   */
  onFramesDropped?: (count: number) => void;
  onLog?: (entries: readonly LogEntry[]) => void;
};

export type PoseCameraRef = {
  /** Resolves once the session is stable again, not when the switch begins. */
  switchCamera(): Promise<void>;
  setFacing(facing: Facing): Promise<void>;

  /**
   * These reach native over the same asynchronous path as everything else, so they return a
   * promise. Ignoring it is fine and common; awaiting it is how you see a failure.
   */
  pause(): Promise<void>;
  resume(): Promise<void>;
  startDetection(): Promise<void>;
  /** Releases GPU resources rather than gating a still-running pipeline. */
  stopDetection(): Promise<void>;
  setOverlayEnabled(enabled: boolean): Promise<void>;

  /** Not implemented yet. Both throw until calibration lands. */
  setProfile(profile: Profile): void;
  /**
   * Asynchronous because it reads native state: the phase, the source and the measured p50 are not
   * on any event, so JavaScript has nothing to mirror them from. `getState()` stays synchronous
   * because everything in it does arrive on an event.
   */
  getProfile(): Promise<ProfileState>;
  /** The last known state, mirrored from the events that carry it. Never a bridge call. */
  getState(): CameraState;

  /**
   * The current frame regardless of `data.mode`. `null` when no pose is present.
   *
   * Async because the landmark buffer comes back over the function-return path, which is the
   * only one that carries an ArrayBuffer. See
   * [ADR 0008](../../../docs/adr/0008-frames-are-drained-not-pushed.md).
   */
  snapshot(): Promise<PoseFrame | null>;
};
