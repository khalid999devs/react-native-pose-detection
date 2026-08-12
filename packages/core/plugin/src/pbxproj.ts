import type { XcodeProject } from 'expo/config-plugins';
import { IOSConfig } from 'expo/config-plugins';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { MODEL_FILE_PATTERN } from './manifest';

// Matches expo-font and expo-asset: one top-level virtual group, with file paths relative to
// `ios/`. Following the first-party pattern rather than inventing one keeps this working across
// Xcode project layout changes.
const RESOURCE_GROUP = 'Resources';

/**
 * Every model file reference in the project, whichever variant it names. A reference left behind
 * after a variant switch ships a second model, and then which one wins at
 * `Bundle.main.path(forResource:)` is not something the app gets to decide.
 */
function findModelReferences(project: XcodeProject): string[] {
  const section = project.pbxFileReferenceSection() as Record<string, unknown>;
  const paths = new Set<string>();

  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith('_comment') || typeof value !== 'object' || value === null) continue;

    const entry = value as { path?: string; name?: string };
    const raw = entry.path ?? entry.name;
    if (typeof raw !== 'string') continue;

    const filePath = raw.replace(/^"|"$/g, '');
    if (MODEL_FILE_PATTERN.test(basename(filePath))) paths.add(filePath);
  }
  return [...paths];
}

/**
 * Leaves the project referencing exactly one model: `fileName`. Safe to run repeatedly, the add
 * is a no-op when the reference is already there.
 */
export function syncModelReference(
  project: XcodeProject,
  projectName: string,
  fileName: string,
): { added: string; removed: string[] } {
  IOSConfig.XcodeUtils.ensureGroupRecursively(project, RESOURCE_GROUP);
  const groupKey = project.findPBXGroupKey({ name: RESOURCE_GROUP });
  const targetUuid = project.getFirstTarget().uuid;

  const filepath = join(projectName, RESOURCE_GROUP, fileName);

  const removed = findModelReferences(project).filter((stale) => stale !== filepath);
  for (const stale of removed) {
    project.removeResourceFile(stale, { target: targetUuid }, groupKey);
  }

  IOSConfig.XcodeUtils.addResourceFileToGroup({
    filepath,
    groupName: RESOURCE_GROUP,
    project,
    isBuildFile: true,
    targetUuid,
  });

  return { added: filepath, removed };
}

export function loadProject(projectRoot: string): XcodeProject {
  return IOSConfig.XcodeUtils.getPbxproj(projectRoot);
}

export async function saveProject(project: XcodeProject): Promise<string> {
  await writeFile(project.filepath, project.writeSync());
  return project.filepath;
}
