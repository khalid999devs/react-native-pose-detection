import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { DEFAULT_CACHE_DIR, clearCache, ensureModel, sha256OfFile } from './download';
import {
  androidAssetsDir,
  findInstalledModels,
  findIosProjectName,
  installModelFile,
  iosResourcesDir,
  removeInstalledModels,
} from './install';
import * as log from './log';
import type { ModelEntry } from './manifest';
import type * as Pbxproj from './pbxproj';
import { MODEL_VARIANTS, resolveModel } from './manifest';

const USAGE = `
react-native-pose-detection <command>

  fetch-model <lite|full|heavy>   download, verify, and install into both native projects
  doctor                          check the things that actually break
  clear-cache                     delete the model cache

Flags for fetch-model:
  --force                         re-download even on a cache hit
  --cache-dir <path>              override the cache location
  --ios-only, --android-only      install into one platform
`.trim();

type Flags = {
  force: boolean;
  cacheDir: string;
  android: boolean;
  ios: boolean;
  positionals: string[];
};

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = {
    force: false,
    cacheDir: DEFAULT_CACHE_DIR,
    android: true,
    ios: true,
    positionals: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    switch (arg) {
      case '--force':
        flags.force = true;
        break;
      case '--ios-only':
        flags.android = false;
        break;
      case '--android-only':
        flags.ios = false;
        break;
      case '--cache-dir': {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new Error('--cache-dir needs a path.');
        }
        flags.cacheDir = value;
        index += 1;
        break;
      }
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}.\n\n${USAGE}`);
        flags.positionals.push(arg);
    }
  }

  if (!flags.android && !flags.ios) {
    throw new Error('--ios-only and --android-only cannot both be set.');
  }
  return flags;
}

/**
 * Loaded on demand rather than imported at the top, so `--android-only` and `doctor` still work
 * in a project where the iOS side was never set up or `expo` cannot be resolved.
 */
async function loadXcodeSupport(): Promise<typeof Pbxproj | null> {
  try {
    return await import('./pbxproj.js');
  } catch {
    return null;
  }
}

async function installIos(
  projectRoot: string,
  cachePath: string,
  model: ModelEntry,
): Promise<void> {
  const projectName = await findIosProjectName(projectRoot);
  if (!projectName) {
    log.warn('no ios/*.xcodeproj found, skipping the iOS install.');
    return;
  }

  // A hand-copied file next to the sources ends up in the bundle too, so clear that first.
  await removeInstalledModels(join(projectRoot, 'ios', projectName));
  const installed = await installModelFile(cachePath, iosResourcesDir(projectRoot, projectName));
  log.line(`copied → ${relative(projectRoot, installed)}`);

  const xcode = await loadXcodeSupport();
  if (!xcode) {
    log.warn(
      'could not load expo/config-plugins, so the Xcode project was not updated. Add ' +
        `${relative(projectRoot, installed)} to your app target in Xcode once.`,
    );
    return;
  }

  const project = xcode.loadProject(projectRoot);
  const { removed } = xcode.syncModelReference(project, projectName, model.fileName);
  const filepath = await xcode.saveProject(project);

  for (const stale of removed) log.line(`unregistered ${stale}`);
  log.line(`registered → ${relative(projectRoot, filepath)}`);
}

async function fetchModelCommand(flags: Flags): Promise<number> {
  const variant = flags.positionals[0];
  if (variant === undefined) {
    throw new Error(`fetch-model needs a variant: ${MODEL_VARIANTS.join(', ')}.`);
  }

  const model = resolveModel(variant);
  const projectRoot = process.cwd();

  const cachePath = await ensureModel(model.variant, {
    cacheDir: flags.cacheDir,
    force: flags.force,
  });
  if (cachePath === null) throw new Error(`${model.fileName} could not be resolved.`);

  if (flags.android) {
    const installed = await installModelFile(cachePath, androidAssetsDir(projectRoot));
    log.line(`copied → ${relative(projectRoot, installed)}`);
  }
  if (flags.ios) {
    await installIos(projectRoot, cachePath, model);
  }
  return 0;
}

/**
 * `skip` matters as much as the other two. Expo resolves `minSdkVersion` inside a Gradle plugin,
 * so no file in the project holds the number. Reporting that as a failure trains people to
 * ignore doctor output, which is worse than not checking it.
 */
type Check = { status: 'pass' | 'fail' | 'skip'; label: string; detail: string };

const pass = (label: string, detail: string): Check => ({ status: 'pass', label, detail });
const fail = (label: string, detail: string): Check => ({ status: 'fail', label, detail });
const skip = (label: string, detail: string): Check => ({ status: 'skip', label, detail });

const SYMBOL = { pass: '✓', fail: '✗', skip: '–' } as const;

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Exactly one model in the directory, and its bytes matching the manifest. */
async function checkInstalledModel(dir: string, shortDir: string): Promise<Check[]> {
  const present = await findInstalledModels(dir);

  if (present.length === 0) return [fail('model installed', `${shortDir} has no model`)];
  if (present.length > 1) {
    return [fail('model installed', `${shortDir} has ${present.length}: ${present.join(', ')}`)];
  }

  const fileName = present[0] as string;
  const variant = fileName.replace(/^pose_landmarker_/, '').replace(/\.task$/, '');
  const actual = await sha256OfFile(join(dir, fileName));
  const expected = resolveModel(variant).sha256;

  return [
    pass('model installed', `${shortDir}/${fileName}`),
    actual === expected
      ? pass('SHA-256 matches manifest', fileName)
      : fail('SHA-256 matches manifest', `${fileName} hashes to ${actual}`),
  ];
}

/**
 * Bare React Native writes the number into `android/build.gradle`, and `expo-build-properties`
 * writes it into `gradle.properties`. A plain Expo prebuild does neither: it resolves through
 * the `expo-root-project` Gradle plugin, and nothing on disk holds the value.
 */
async function checkMinSdk(projectRoot: string): Promise<Check> {
  const label = 'minSdkVersion 24';
  const sources = await Promise.all([
    readIfPresent(join(projectRoot, 'android', 'build.gradle')),
    readIfPresent(join(projectRoot, 'android', 'gradle.properties')),
  ]);

  if (sources.every((source) => source === null)) {
    return skip(label, 'no android/ directory, run prebuild first');
  }

  const text = sources.join('\n');
  const found = /(?:minSdkVersion\s*=\s*|android\.minSdkVersion\s*=\s*)(\d+)/.exec(text)?.[1];

  if (found === undefined) {
    return skip(label, 'resolved by the Expo Gradle plugin, not readable from the project');
  }
  return Number(found) >= 24
    ? pass(label, `found ${found}`)
    : fail(label, `found ${found}, this package needs 24`);
}

/** The pbxproj holds the value Xcode actually builds against, whatever the Podfile computes. */
async function checkDeploymentTarget(projectRoot: string, projectName: string): Promise<Check> {
  const label = 'iOS deployment target 15.1';
  const pbxproj = await readIfPresent(
    join(projectRoot, 'ios', `${projectName}.xcodeproj`, 'project.pbxproj'),
  );
  if (pbxproj === null) return skip(label, 'no Xcode project, run prebuild first');

  const targets = [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+)/g)].map((match) =>
    parseFloat(match[1] as string),
  );
  if (targets.length === 0) return skip(label, 'no IPHONEOS_DEPLOYMENT_TARGET in the project');

  const lowest = Math.min(...targets);
  return lowest >= 15.1
    ? pass(label, `found ${lowest}`)
    : fail(label, `found ${lowest}, this package needs 15.1`);
}

/**
 * Regex reads rather than parsers. `doctor` runs against a project this package did not create,
 * where Gradle files are templated and Podfiles are hand-edited, so a best-effort read that can
 * say "could not determine" beats a parser that throws on the first unusual project.
 */
async function doctorCommand(): Promise<number> {
  const projectRoot = process.cwd();
  const checks: Check[] = [];

  checks.push(
    ...(await checkInstalledModel(androidAssetsDir(projectRoot), 'android/app/src/main/assets')),
  );

  const projectName = await findIosProjectName(projectRoot);
  if (projectName === null) {
    checks.push(fail('ios project', 'no ios/*.xcodeproj found'));
  } else {
    checks.push(
      ...(await checkInstalledModel(
        iosResourcesDir(projectRoot, projectName),
        `ios/${projectName}/Resources`,
      )),
    );

    const stray = await findInstalledModels(join(projectRoot, 'ios', projectName));
    if (stray.length > 0) {
      checks.push(fail('one model on iOS', `also found ${stray.join(', ')} beside the sources`));
    }
  }

  checks.push(await checkMinSdk(projectRoot));

  if (projectName !== null) {
    checks.push(await checkDeploymentTarget(projectRoot, projectName));
  }

  const manifest = await readIfPresent(
    join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  );
  checks.push(
    manifest === null
      ? skip('android.permission.CAMERA', 'no AndroidManifest.xml, run prebuild first')
      : manifest.includes('android.permission.CAMERA')
      ? pass('android.permission.CAMERA', 'AndroidManifest.xml')
      : fail('android.permission.CAMERA', 'missing from AndroidManifest.xml'),
  );

  if (projectName !== null) {
    const plist = await readIfPresent(join(projectRoot, 'ios', projectName, 'Info.plist'));
    checks.push(
      plist === null
        ? skip('NSCameraUsageDescription', 'no Info.plist, run prebuild first')
        : plist.includes('NSCameraUsageDescription')
        ? pass('NSCameraUsageDescription', 'Info.plist')
        : fail('NSCameraUsageDescription', 'missing from Info.plist'),
    );
  }

  for (const check of checks) {
    log.line(`${SYMBOL[check.status]} ${check.label.padEnd(27)} ${check.detail}`);
  }

  const failures = checks.filter((check) => check.status === 'fail').length;
  if (failures > 0) log.line(`${failures} of ${checks.length} checks failed`);

  return failures > 0 ? 1 : 0;
}

export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'fetch-model':
      return fetchModelCommand(parseFlags(rest));

    case 'doctor':
      return doctorCommand();

    case 'clear-cache': {
      const flags = parseFlags(rest);
      await clearCache(flags.cacheDir);
      log.line(`cleared ${flags.cacheDir}`);
      return 0;
    }

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      log.line(USAGE);
      return 0;

    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}
