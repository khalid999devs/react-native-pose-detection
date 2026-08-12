import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

import * as log from './log';
import type { ModelEntry, ModelVariant } from './manifest';
import {
  MODEL_FILE_PATTERN,
  MODEL_SIDECAR_FILE_PATTERN,
  formatBytes,
  resolveModel,
} from './manifest';

export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'react-native-pose-detection');

/** Time allowed for the response headers, and then for each further chunk of the body. */
const HEADERS_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 30_000;

/** A transfer that fails on the network is resumed from the `.part` rather than restarted. */
const TRANSFER_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1_000;

/** A lock nobody has touched for this long belonged to a process that died. */
const LOCK_STALE_MS = 60_000;
const LOCK_HEARTBEAT_MS = 10_000;
const LOCK_POLL_MS = 250;

export type EnsureModelOptions = {
  cacheDir?: string;
  /** Re-download even on a cache hit. */
  force?: boolean;
  /** Never touch the network. Returns null when the cache has nothing to offer. */
  skipDownload?: boolean;
};

/** `sha256` is null when the size was already wrong, since nothing was hashed. */
export type Verification = { ok: boolean; sha256: string | null; bytes: number | null };

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
 * A size check alone passes on a file a full disk truncated to the right length, which crashes
 * natively at model load rather than failing the build.
 */
export async function verifyFile(filePath: string, model: ModelEntry): Promise<Verification> {
  const bytes = await sizeOf(filePath);
  if (bytes === null) return { ok: false, sha256: null, bytes: null };
  if (bytes !== model.bytes) return { ok: false, sha256: null, bytes };

  const sha256 = await sha256OfFile(filePath);
  return { ok: sha256 === model.sha256, sha256, bytes };
}

/** The two lines every mismatch message carries, built from what the check already computed. */
export function describeMismatch(model: ModelEntry, result: Verification): string {
  const received =
    result.sha256 === null
      ? `received ${result.bytes ?? 0} bytes, so the sha256 was not computed`
      : `received sha256 ${result.sha256} (${result.bytes ?? 0} bytes)`;

  return `expected sha256 ${model.sha256} (${model.bytes} bytes)\n  ${received}`;
}

function progressLine(model: ModelEntry, received: number): string {
  const percent = Math.floor((received / model.bytes) * 100);
  return `downloading ${model.fileName} ${formatBytes(received)} / ${formatBytes(
    model.bytes,
  )} (${percent}%)`;
}

/** undici reports every connect failure as `fetch failed` and keeps the reason in `cause`. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

/** A response that arrived and was wrong. Another attempt would produce the same answer. */
class FatalTransferError extends Error {}

function transferFailure(model: ModelEntry, target: string, cause: unknown): Error {
  return new Error(
    `Downloading ${model.fileName} failed: ${messageOf(cause)}\n` +
      `  url:   ${model.url}\n` +
      `  cache: ${target}\n` +
      `If this machine has no network access, place the file at the cache path above, or ` +
      `vendor it and set skipDownload.`,
    { cause },
  );
}

type LockRelease = () => Promise<void>;

async function ageOf(filePath: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * The cache is one shared per-user directory, so two prebuilds would otherwise append into the
 * same `.part` and the loser would corrupt the file the winner already verified.
 */
async function acquireCacheLock(cachePath: string, fileName: string): Promise<LockRelease> {
  const lockPath = `${cachePath}.lock`;
  let waiting = false;

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();

      // The heartbeat is what makes the staleness check safe: a slow 30 MB download keeps
      // touching the lock, so only a holder that died ever looks stale.
      const heartbeat = setInterval(() => {
        const now = new Date();
        void utimes(lockPath, now, now).catch(() => undefined);
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref();

      return async () => {
        clearInterval(heartbeat);
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const age = await ageOf(lockPath);
    if (age === null) continue;

    if (age > LOCK_STALE_MS) {
      log.warn(`removing a download lock left behind by another process (${lockPath})`);
      await rm(lockPath, { force: true });
      continue;
    }

    if (!waiting) {
      log.line(`another process is downloading ${fileName}, waiting for it`);
      waiting = true;
    }
    await delay(LOCK_POLL_MS);
  }
}

function parseContentRange(header: string | null): { start: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header?.trim() ?? '');
  if (!match) return null;
  return { start: Number(match[1]), total: Number(match[3]) };
}

/** One transfer attempt. `FatalTransferError` means retrying cannot help. */
async function transfer(model: ModelEntry, partial: string): Promise<void> {
  let resumeFrom = (await sizeOf(partial)) ?? 0;

  if (resumeFrom >= model.bytes) {
    // A complete or over-long part file cannot be resumed into something correct.
    await rm(partial, { force: true });
    resumeFrom = 0;
  }

  const headers: Record<string, string> = {};
  if (resumeFrom > 0) headers['Range'] = `bytes=${resumeFrom}-`;

  const controller = new AbortController();
  let watchdog = setTimeout(
    () => controller.abort(new Error(`no response within ${HEADERS_TIMEOUT_MS / 1000}s`)),
    HEADERS_TIMEOUT_MS,
  );
  const armWatchdog = (): void => {
    clearTimeout(watchdog);
    watchdog = setTimeout(
      () => controller.abort(new Error(`the transfer stalled for ${IDLE_TIMEOUT_MS / 1000}s`)),
      IDLE_TIMEOUT_MS,
    );
  };

  try {
    const response = await fetch(model.url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new FatalTransferError(`the server answered HTTP ${response.status}`);
    }

    const body = response.body;
    if (!body) throw new FatalTransferError('the response had an empty body');

    // A server that ignores Range answers 200 with the whole file. Appending then would corrupt
    // the result, so treat it as a fresh download.
    const resuming = resumeFrom > 0 && response.status === 206;
    if (resumeFrom > 0 && !resuming) {
      await rm(partial, { force: true });
      resumeFrom = 0;
    }

    if (resuming) {
      const range = parseContentRange(response.headers.get('content-range'));
      if (range === null || range.start !== resumeFrom || range.total !== model.bytes) {
        // A proxy answering from a different offset would be appended at the wrong place and
        // only caught by the checksum, which reads as tampering rather than a broken cache.
        await body.cancel();
        await rm(partial, { force: true });
        throw new Error(
          `the server answered a range (${response.headers.get('content-range') ?? 'none'}) ` +
            `that does not continue the partial file at ${resumeFrom} bytes`,
        );
      }
      log.line(`resuming ${model.fileName} at ${formatBytes(resumeFrom)}`);
    } else {
      log.line(`downloading ${model.fileName} (${formatBytes(model.bytes)})…`);
    }

    let received = resumeFrom;
    const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > model.bytes) {
        // The manifest records the exact size, so anything longer is a captive portal or a
        // proxy, and letting it run fills the disk before the checksum ever gets to speak.
        source.destroy(
          new FatalTransferError(
            `the server sent more than the ${model.bytes} bytes the manifest records`,
          ),
        );
        return;
      }
      armWatchdog();
      log.progress(progressLine(model, received));
    });

    armWatchdog();
    try {
      await pipeline(source, createWriteStream(partial, { flags: resuming ? 'a' : 'w' }));
    } finally {
      log.clearProgress();
    }
  } finally {
    clearTimeout(watchdog);
  }
}

/**
 * Downloads to `.part` so an interrupted run leaves no short file where the verified one belongs,
 * and the next run resumes with a Range request. Callers hold the cache lock.
 */
async function downloadTo(model: ModelEntry, target: string): Promise<void> {
  const partial = `${target}.part`;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await transfer(model, partial);
      break;
    } catch (error) {
      if (error instanceof FatalTransferError) {
        await rm(partial, { force: true });
        throw transferFailure(model, target, error);
      }
      if (attempt >= TRANSFER_ATTEMPTS) throw transferFailure(model, target, error);

      const backoff = RETRY_BACKOFF_MS * attempt;
      log.warn(
        `${model.fileName}: ${messageOf(error)}. Retrying in ${backoff / 1000}s ` +
          `(attempt ${attempt + 1} of ${TRANSFER_ATTEMPTS}).`,
      );
      await delay(backoff);
    }
  }

  const result = await verifyFile(partial, model);
  if (!result.ok) {
    await rm(partial, { force: true });
    throw new Error(
      `Checksum mismatch for ${model.fileName}. The download was not installed.\n` +
        `  ${describeMismatch(model, result)}\n` +
        `  url ${model.url}\n` +
        `This means the file was corrupted or intercepted in transit. It is never ignored.`,
    );
  }

  log.line('sha256 ✓');
  await rename(partial, target);
}

/** Verified model path, downloading if needed. `null` when `skipDownload` finds no copy. */
export async function ensureModel(
  variant: ModelVariant | string,
  options: EnsureModelOptions = {},
): Promise<string | null> {
  const model = resolveModel(String(variant));
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const cachePath = join(cacheDir, model.fileName);

  await mkdir(cacheDir, { recursive: true });

  const cached = await verifyFile(cachePath, model);

  if (cached.ok && !options.force) {
    log.line(`model "${model.variant}" found in cache`);
    return cachePath;
  }

  if (options.skipDownload) {
    // skipDownload wins over force: there is no network to force a fresh copy out of. A damaged
    // entry is left alone rather than deleted, because this machine cannot fetch it again.
    if (cached.ok) {
      log.line(`model "${model.variant}" found in cache`);
      return cachePath;
    }
    if (cached.bytes === null) {
      log.warn(
        `skipDownload is set and ${model.fileName} is not in the cache (${cacheDir}). ` +
          `Leaving the native projects untouched.`,
      );
    } else {
      log.warn(
        `skipDownload is set and the cached ${model.fileName} failed verification. It is left ` +
          `in place and not re-downloaded, so nothing was installed.\n` +
          `  cache: ${cachePath}\n` +
          `  ${describeMismatch(model, cached)}\n` +
          `Delete that file and run again with network access, or vendor a good copy.`,
      );
    }
    return null;
  }

  if (cached.bytes === null) {
    log.line(`model "${model.variant}" not in cache`);
  } else if (!cached.ok) {
    // A cached file that no longer verifies is a damaged cache, not a rejected download. It is
    // removed and fetched again, and the fresh copy still has to verify or the build fails.
    log.warn(
      `cached ${model.fileName} failed verification, re-downloading\n  ` +
        describeMismatch(model, cached),
    );
  }

  const release = await acquireCacheLock(cachePath, model.fileName);
  try {
    if (!options.force) {
      // Whoever held the lock may have been downloading this exact file.
      const now = await verifyFile(cachePath, model);
      if (now.ok) {
        log.line(`model "${model.variant}" found in cache`);
        return cachePath;
      }
    }

    await rm(cachePath, { force: true });
    await downloadTo(model, cachePath);
  } finally {
    await release();
  }

  return cachePath;
}

/** Deletes only what this package wrote: `--cache-dir` is free-form user input. */
export async function clearCache(cacheDir: string = DEFAULT_CACHE_DIR): Promise<string[]> {
  if (resolve(cacheDir) === resolve(homedir())) {
    throw new Error(`Refusing to clear ${cacheDir}: that is the home directory, not a cache.`);
  }

  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const name of names.sort()) {
    if (!MODEL_FILE_PATTERN.test(name) && !MODEL_SIDECAR_FILE_PATTERN.test(name)) continue;

    const filePath = join(cacheDir, name);
    if (name.endsWith('.lock')) {
      // Deleting a lock another process is holding would let a second download start into the
      // same path. A stale one is already swept by whoever asks for it next.
      const age = await ageOf(filePath);
      if (age !== null && age <= LOCK_STALE_MS) continue;
    }

    await rm(filePath, { force: true });
    removed.push(name);
  }
  return removed;
}
