import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { describeMismatch, verifyFile } from './download';
import type { ModelEntry } from './manifest';
import { MODEL_FILE_PATTERN } from './manifest';
import type * as Pbxproj from './pbxproj';

export function androidAssetsDir(projectRoot: string): string {
  return join(projectRoot, 'android', 'app', 'src', 'main', 'assets');
}

export function iosResourcesDir(projectRoot: string, projectName: string): string {
  return join(projectRoot, 'ios', projectName, 'Resources');
}

export async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export async function findInstalledModels(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => MODEL_FILE_PATTERN.test(name)).sort();
  } catch {
    return [];
  }
}

/** Every model, not just the previous variant: a hand-copied file would otherwise survive. */
export async function removeInstalledModels(dir: string, keep?: string): Promise<string[]> {
  const present = await findInstalledModels(dir);
  const removed: string[] = [];

  for (const name of present) {
    if (name === keep) continue;
    await rm(join(dir, name), { force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * Re-verified after the copy: this is the step that puts bytes into the native project, and the
 * cache it reads is shared with every other process on the machine.
 */
export async function installModelFile(
  sourcePath: string,
  destDir: string,
  model: ModelEntry,
): Promise<string> {
  const fileName = basename(sourcePath);
  const destPath = join(destDir, fileName);

  await mkdir(destDir, { recursive: true });
  await removeInstalledModels(destDir);
  await copyFile(sourcePath, destPath);

  const result = await verifyFile(destPath, model);
  if (!result.ok) {
    await rm(destPath, { force: true });
    throw new Error(
      `${fileName} did not verify after being copied into ${destDir}. Nothing was installed.\n` +
        `  ${describeMismatch(model, result)}\n` +
        `  source ${sourcePath}\n` +
        `A copy that does not match the manifest means the source was still being written, or ` +
        `the disk is full. It is never ignored.`,
    );
  }

  return destPath;
}

/**
 * Asks expo the same question the config plugin asks, so a renamed project gets one answer
 * rather than two disagreeing heuristics. Loaded on demand, the CLI works without `expo`.
 */
async function iosProjectNameFromExpo(projectRoot: string): Promise<string | null> {
  try {
    const xcode: typeof Pbxproj = await import('./pbxproj.js');
    return xcode.iosSourceRootName(projectRoot);
  } catch {
    return null;
  }
}

/** The `ios/<name>.xcodeproj` bundle, which does not have to be named after the source root. */
export async function findXcodeProjectPath(projectRoot: string): Promise<string | null> {
  try {
    const names = (await readdir(join(projectRoot, 'ios'))).sort();
    const xcodeproj = names.find((name) => name.endsWith('.xcodeproj'));
    return xcodeproj ? join(projectRoot, 'ios', xcodeproj) : null;
  } catch {
    return null;
  }
}

/** The folder under `ios/` holding the app's sources and resources. */
export async function findIosProjectName(projectRoot: string): Promise<string | null> {
  const fromExpo = await iosProjectNameFromExpo(projectRoot);
  if (fromExpo !== null) return fromExpo;

  const xcodeproj = await findXcodeProjectPath(projectRoot);
  return xcodeproj === null ? null : basename(xcodeproj).replace(/\.xcodeproj$/, '');
}
