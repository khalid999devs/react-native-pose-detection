// Mirrors the ModelVariant union in src/types/camera.ts. The plugin compiles as a separate
// Node program, so it cannot import from the runtime sources without dragging them into a
// build that only ever runs on a developer machine at prebuild time.
export type ModelVariant = 'lite' | 'full' | 'heavy';

export const MODEL_VARIANTS: readonly ModelVariant[] = ['lite', 'full', 'heavy'];

export const DEFAULT_MODEL: ModelVariant = 'full';

const BASE_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

/**
 * Revision `1`, never `latest`: the two carry the same weights but differ by four zip timestamp
 * bytes on `full`, enough to fail a checksum. See ADR 0004.
 */
const REVISION = 'float16/1';

export type ModelEntry = {
  readonly variant: ModelVariant;
  readonly fileName: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
};

function entry(variant: ModelVariant, bytes: number, sha256: string): ModelEntry {
  const fileName = `pose_landmarker_${variant}.task`;
  return {
    variant,
    fileName,
    url: `${BASE_URL}/pose_landmarker_${variant}/${REVISION}/${fileName}`,
    bytes,
    sha256,
  };
}

const MODEL_MANIFEST: Readonly<Record<ModelVariant, ModelEntry>> = {
  lite: entry(
    'lite',
    5_777_746,
    '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  ),
  full: entry(
    'full',
    9_398_198,
    '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  ),
  heavy: entry(
    'heavy',
    30_664_242,
    '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b',
  ),
};

/**
 * Matches what the native side matches (`pose_landmarker_*.task`): a file this misses is one the
 * runtime can still load ahead of the installed model.
 */
export const MODEL_FILE_PATTERN = /^pose_landmarker_[A-Za-z0-9_.-]*\.task$/;

/** The three names this package installs, for the places that map a file back to a variant. */
export const KNOWN_MODEL_FILE_PATTERN = /^pose_landmarker_(?:lite|full|heavy)\.task$/;

/** The downloader's sidecars, so `clear-cache` sweeps them with the models they belong to. */
export const MODEL_SIDECAR_FILE_PATTERN = /^pose_landmarker_[A-Za-z0-9_.-]*\.task\.(?:part|lock)$/;

function isModelVariant(value: unknown): value is ModelVariant {
  return typeof value === 'string' && MODEL_VARIANTS.includes(value as ModelVariant);
}

export function resolveModel(variant: string): ModelEntry {
  if (!isModelVariant(variant)) {
    throw new Error(`Unknown model "${variant}". Expected one of: ${MODEL_VARIANTS.join(', ')}.`);
  }
  return MODEL_MANIFEST[variant];
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
