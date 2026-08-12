import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import * as log from './log';
import type { ModelEntry, ModelVariant } from './manifest';
import { formatBytes, resolveModel } from './manifest';

export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'react-native-pose-detection');

export type EnsureModelOptions = {
  cacheDir?: string;
  /** Re-download even on a cache hit. */
  force?: boolean;
  /** Never touch the network. Returns null when the cache has nothing to offer. */
  skipDownload?: boolean;
};

export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function sizeOf(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

/**
 * Reads the file back and compares. A size check alone would pass on a file truncated to the
 * right length by a full disk, which is exactly the case that produces a native crash at model
 * load rather than a build error.
 */
async function verify(filePath: string, model: ModelEntry): Promise<boolean> {
  if ((await sizeOf(filePath)) !== model.bytes) return false;
  return (await sha256OfFile(filePath)) === model.sha256;
}

function progressLine(model: ModelEntry, received: number): string {
  const percent = Math.floor((received / model.bytes) * 100);
  return `downloading ${model.fileName} ${formatBytes(received)} / ${formatBytes(
    model.bytes,
  )} (${percent}%)`;
}

/**
 * Downloads to a `.part` file so an interrupted run never leaves a short file where the verified
 * one belongs, and so the next run can resume with a Range request instead of starting over.
 */
async function downloadTo(model: ModelEntry, target: string): Promise<void> {
  const partial = `${target}.part`;
  let resumeFrom = (await sizeOf(partial)) ?? 0;

  if (resumeFrom >= model.bytes) {
    // A complete or over-long part file cannot be resumed into something correct.
    await rm(partial, { force: true });
    resumeFrom = 0;
  }

  const headers: Record<string, string> = {};
  if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

  const response = await fetch(model.url, { headers });
  if (!response.ok) {
    throw new Error(
      `Downloading ${model.fileName} failed with HTTP ${response.status}.\n` +
        `  url:   ${model.url}\n` +
        `  cache: ${target}\n` +
        `If this machine has no network access, place the file at the cache path above, or ` +
        `vendor it and set skipDownload.`,
    );
  }
  if (!response.body) {
    throw new Error(`Downloading ${model.fileName} returned an empty response body.`);
  }

  // A server that ignores Range answers 200 with the whole file. Appending then would corrupt
  // the result, so treat it as a fresh download.
  const resuming = resumeFrom > 0 && response.status === 206;
  if (resumeFrom > 0 && !resuming) {
    await rm(partial, { force: true });
    resumeFrom = 0;
  }

  if (resuming) {
    log.line(`resuming ${model.fileName} at ${formatBytes(resumeFrom)}`);
  } else {
    log.line(`downloading ${model.fileName} (${formatBytes(model.bytes)})…`);
  }

  let received = resumeFrom;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    log.progress(progressLine(model, received));
  });

  try {
    await pipeline(source, createWriteStream(partial, { flags: resuming ? 'a' : 'w' }));
  } finally {
    log.clearProgress();
  }

  if (!(await verify(partial, model))) {
    const actual = await sha256OfFile(partial);
    const size = await sizeOf(partial);
    await rm(partial, { force: true });
    throw new Error(
      `Checksum mismatch for ${model.fileName}. The download was not installed.\n` +
        `  expected sha256 ${model.sha256} (${model.bytes} bytes)\n` +
        `  received sha256 ${actual} (${size ?? 0} bytes)\n` +
        `  url ${model.url}\n` +
        `This means the file was corrupted or intercepted in transit. It is never ignored.`,
    );
  }

  log.line('sha256 ✓');
  await rename(partial, target);
}

/**
 * Resolves a verified model file on disk, downloading it into the cache if needed. Returns the
 * cache path, or `null` when `skipDownload` is set and the cache has no copy.
 */
export async function ensureModel(
  variant: ModelVariant | string,
  options: EnsureModelOptions = {},
): Promise<string | null> {
  const model = resolveModel(String(variant));
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const cachePath = join(cacheDir, model.fileName);

  await mkdir(cacheDir, { recursive: true });

  const cached = (await sizeOf(cachePath)) !== null;

  if (cached && !options.force) {
    if (await verify(cachePath, model)) {
      log.line(`model "${model.variant}" found in cache`);
      return cachePath;
    }
    // A cached file that no longer verifies is a damaged cache, not a rejected download. It is
    // removed and fetched again, and the fresh copy still has to verify or the build fails.
    log.warn(`cached ${model.fileName} failed verification, re-downloading`);
    await rm(cachePath, { force: true });
  }

  if (options.skipDownload) {
    log.warn(
      `skipDownload is set and ${model.fileName} is not in the cache (${cacheDir}). ` +
        `Leaving the native projects untouched.`,
    );
    return null;
  }

  if (!cached) log.line(`model "${model.variant}" not in cache`);

  await downloadTo(model, cachePath);
  return cachePath;
}

export async function clearCache(cacheDir: string = DEFAULT_CACHE_DIR): Promise<void> {
  await rm(cacheDir, { recursive: true, force: true });
}
