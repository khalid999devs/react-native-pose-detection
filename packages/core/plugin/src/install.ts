import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { MODEL_FILE_PATTERN } from './manifest';

export function androidAssetsDir(projectRoot: string): string {
  return join(projectRoot, 'android', 'app', 'src', 'main', 'assets');
}

export function iosResourcesDir(projectRoot: string, projectName: string): string {
  return join(projectRoot, 'ios', projectName, 'Resources');
}

export async function findInstalledModels(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => MODEL_FILE_PATTERN.test(name)).sort();
  } catch {
    return [];
  }
}

/**
 * Removes every model file, not just the previously selected variant. Switching `full` to `lite`
 * has to leave one model behind, and a rename or a hand-copied file would otherwise survive.
 */
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

/** Copies the verified cache file in, after clearing out anything already there. */
export async function installModelFile(sourcePath: string, destDir: string): Promise<string> {
  const fileName = basename(sourcePath);

  await mkdir(destDir, { recursive: true });
  await removeInstalledModels(destDir);
  await copyFile(sourcePath, join(destDir, fileName));

  return join(destDir, fileName);
}

/** The Xcode project name, which is also the folder holding the app's sources and resources. */
export async function findIosProjectName(projectRoot: string): Promise<string | null> {
  try {
    const names = await readdir(join(projectRoot, 'ios'));
    const xcodeproj = names.find((name) => name.endsWith('.xcodeproj'));
    return xcodeproj ? xcodeproj.replace(/\.xcodeproj$/, '') : null;
  } catch {
    return null;
  }
}
