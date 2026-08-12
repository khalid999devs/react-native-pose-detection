import type { AngleJointName, JointName } from './joints';

export type ModelVariant = 'lite' | 'full' | 'heavy';

/** What actually ran. `DelegateRequest` is what you asked for. */
export type Delegate = 'GPU' | 'CPU';
export type DelegateRequest = 'auto' | 'gpu' | 'cpu';

export type DeviceTier = 'high' | 'medium' | 'low';

export type Facing = 'front' | 'back';
export type FacingRequest = 'auto' | Facing;

export type ResolutionPreset = '480p' | '720p' | '1080p';
export type AnalysisResolutionPreset = '360p' | '480p' | '720p';

export type Resolution = { readonly width: number; readonly height: number };

export type ThermalPolicy = 'adaptive' | 'critical-only' | 'off';

export type Profile = 'auto' | 'efficient' | 'balanced' | 'quality' | 'unrestricted';

export type ProfileState = {
  readonly profile: Profile;
  readonly phase: 'calibrating' | 'settled' | 'cached';
  readonly source: 'measured' | 'static' | 'cache';
  readonly tier: DeviceTier;
  readonly resolved: {
    readonly delegate: Delegate;
    readonly targetFps: number;
    readonly preview: ResolutionPreset;
    readonly analysis: AnalysisResolutionPreset;
  };
  readonly p50InferenceMs: number;
};

export type CameraState = {
  readonly facing: Facing;
  readonly active: boolean;
  readonly detecting: boolean;
  readonly fps: number;
  readonly delegate: Delegate;
  readonly deviceTier: DeviceTier;
};

/** One-Euro filter parameters. Lower `minCutoff` smooths more; higher `beta` tracks fast motion. */
export type SmoothingConfig = {
  minCutoff?: number;
  beta?: number;
};

export type AngleOverlay = {
  joint: AngleJointName;
  /** Draw the degree value next to the arc. Default true. */
  label?: boolean;
  /** Arc radius in points. Default 40. */
  radius?: number;
  /** Defaults to the overlay color. */
  color?: string;
  /** Decimal places on the label. Default 0. */
  decimals?: number;
  /** Hide the arc when the vertex is tracked below this. Default 0.5. */
  minVisibility?: number;
};

export type OverlayConfig = {
  landmarks?: boolean;
  connections?: boolean;
  color?: string;
  lineWidth?: number;
  pointRadius?: number;
  minVisibility?: number;
  /** Draw a subset of the skeleton. Connections with an excluded endpoint are skipped. */
  only?: readonly JointName[];
  angles?: readonly AngleOverlay[];
};

/**
 * How often frames cross to JavaScript. Triggers are independent of this, they fire on their own
 * schedule even at `off`.
 */
export type DataMode = 'off' | 'throttled' | 'batched' | 'live';

export type DataConfig = {
  /** Default `'off'`, which is zero crossings per second. */
  mode: DataMode;
  /** `'throttled'` only. Default 100. */
  throttleMs?: number;
  /** `'batched'` only. Default 500. */
  flushMs?: number;
  landmarks?: boolean;
  worldLandmarks?: boolean;
  angles?: boolean;
  /**
   * Narrows the landmark buffer to these joints and drives lazy angle computation. The joints
   * appear on `PoseFrame.selection` in buffer order.
   */
  select?: readonly JointName[];
};
