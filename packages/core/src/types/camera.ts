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
  /** Decimal places on the label, 0 to 3. Default 0. Larger values are capped at 3. */
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
  mode?: DataMode;
  /** `'throttled'` only. Default 100. */
  throttleMs?: number;
  /** `'batched'` only. Default 500. */
  flushMs?: number;
  landmarks?: boolean;
  worldLandmarks?: boolean;
  /**
   * `true` computes all 12. An array computes only those. Triggers and `overlay.angles` add to
   * whatever this asks for, so leaving it unset still gets you the angles they need.
   */
  angles?: boolean | readonly AngleJointName[];
  /**
   * Narrows the landmark buffer to these joints, which appear on `PoseFrame.selection` in buffer
   * order. It holds exactly these: angles are computed natively from the full set beforehand, so
   * asking for an angle never widens the payload.
   */
  select?: readonly JointName[];
};
