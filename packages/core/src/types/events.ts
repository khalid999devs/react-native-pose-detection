import type {
  Delegate,
  DelegateRequest,
  DeviceTier,
  Facing,
  ModelVariant,
  Resolution,
} from './camera';

const CODES = [
  'PERMISSION_DENIED',
  'MODEL_NOT_FOUND',
  'MODEL_LOAD_FAILED',
  'CAMERA_UNAVAILABLE',
  'CAMERA_START_FAILED',
  'DETECTOR_INIT_FAILED',
  'INVALID_CONFIG',
  'IMAGE_DECODE_FAILED',
  'VIDEO_DECODE_FAILED',
  'CAMERA_SWITCH_FAILED',
  'GPU_UNAVAILABLE',
  'DETECTION_FAILED',
] as const;

/**
 * The complete set. Native emits nothing outside it, so consumers can exhaustively switch on a
 * code and a new failure mode is a deliberate addition here rather than a new string in a catch
 * block somewhere.
 */
export type ErrorCode = (typeof CODES)[number];

export const ERROR_CODES: readonly ErrorCode[] = CODES;

export type ReadyEvent = {
  readonly model: ModelVariant;
  readonly delegate: Delegate;
  readonly delegateRequested: DelegateRequest;
  readonly targetFps: number;
  readonly deviceTier: DeviceTier;
  readonly resolution: Resolution;
  readonly analysisResolution: Resolution;
  readonly facing: Facing;
};

export type ErrorEvent = {
  readonly code: ErrorCode;
  readonly message: string;
  /** `false` means the pipeline recovered and is still running. Only `true` stops the camera. */
  readonly fatal: boolean;
};

export type CameraChangeEvent = {
  readonly facing: Facing;
};

export type PerformanceEvent = {
  readonly reason: 'calibration' | 'thermal' | 'load' | 'headroom' | 'gpu_fallback';
  readonly delegate: Delegate;
  readonly targetFps: number;
  readonly analysisResolution: Resolution;
  readonly actualFps: number;
};
