import type { XcodeProject } from 'expo/config-plugins';
import { IOSConfig } from 'expo/config-plugins';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { MODEL_FILE_PATTERN } from './manifest';

// Matches expo-font and expo-asset: one top-level virtual group, with file paths relative to
// `ios/`. Following the first-party pattern rather than inventing one keeps this working across
// Xcode project layout changes.
const RESOURCE_GROUP = 'Resources';

/** Every model reference, any variant. One left behind after a switch ships a second model. */
function findModelReferences(project: XcodeProject): string[] {
  const section = project.pbxFileReferenceSection() as Record<string, unknown>;
  const paths = new Set<string>();

  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith('_comment') || typeof value !== 'object' || value === null) continue;

    const entry = value as { path?: string; name?: string };
    const raw = entry.path ?? entry.name;
    if (typeof raw !== 'string') continue;

    // A project written by an older run on Windows holds backslashes. Normalizing here is what
    // lets that reference be recognized and cleaned up rather than left beside a new one.
    const filePath = raw.replace(/^"|"$/g, '').replace(/\\/g, '/');
    if (MODEL_FILE_PATTERN.test(basename(filePath))) paths.add(filePath);
  }
  return [...paths];
}

/** `getFirstTarget` is index 0 with no product-type check, so it is only the fallback. */
function applicationTargetUuid(project: XcodeProject): string {
  const application = project.getTarget('com.apple.product-type.application') as
    | { uuid?: string }
    | null
    | undefined;

  return application?.uuid ?? project.getFirstTarget().uuid;
}

/** Leaves exactly one model referenced. Idempotent. */
export function syncModelReference(
  project: XcodeProject,
  projectName: string,
  fileName: string,
): { added: string; removed: string[] } {
  IOSConfig.XcodeUtils.ensureGroupRecursively(project, RESOURCE_GROUP);
  const groupKey = project.findPBXGroupKey({ name: RESOURCE_GROUP });

  // A pbxproj path is always forward-slashed, whatever the platform running prebuild. Xcode
  // treats a backslash as part of the filename, so path.join here would write a reference that
  // no Mac can build, and that the stale-reference comparison below would never match again.
  const filepath = [projectName, RESOURCE_GROUP, fileName].join('/');

  const targetUuid = applicationTargetUuid(project);
  const removed = findModelReferences(project).filter((stale) => stale !== filepath);
  for (const stale of removed) {
    project.removeResourceFile(stale, { target: targetUuid }, groupKey);
  }

  // No targetUuid: config-plugins then resolves the application target itself, which is what
  // expo-font and expo-asset rely on. The first target is not always the app, and a model added
  // to a widget or a test target never reaches the bundle.
  IOSConfig.XcodeUtils.addResourceFileToGroup({
    filepath,
    groupName: RESOURCE_GROUP,
    project,
    isBuildFile: true,
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

/** Asked through here so the CLI and the plugin agree in a renamed project. */
export function iosSourceRootName(projectRoot: string): string | null {
  try {
    return basename(IOSConfig.Paths.getSourceRoot(projectRoot));
  } catch {
    return null;
  }
}
