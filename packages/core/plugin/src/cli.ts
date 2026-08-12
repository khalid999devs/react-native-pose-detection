import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { DEFAULT_CACHE_DIR, clearCache, ensureModel, sha256OfFile } from './download';
import {
  androidAssetsDir,
  directoryExists,
  findInstalledModels,
  findIosProjectName,
  findXcodeProjectPath,
  installModelFile,
  iosResourcesDir,
  removeInstalledModels,
} from './install';
import * as log from './log';
import type { ModelEntry } from './manifest';
import type * as Pbxproj from './pbxproj';
import { KNOWN_MODEL_FILE_PATTERN, MODEL_VARIANTS, resolveModel } from './manifest';

const USAGE = `
react-native-pose-detection <command>

  fetch-model <lite|full|heavy>   download, verify, and install into both native projects
  doctor                          check the things that actually break
  clear-cache                     delete the model cache

Flags for fetch-model:
  --force                         re-download even on a cache hit
  --cache-dir <path>              override the cache location
  --ios-only, --android-only      install into one platform

Flags for clear-cache:
  --cache-dir <path>              override the cache location
`.trim();

type Flags = {
  force: boolean;
  cacheDir: string;
  android: boolean;
  ios: boolean;
  positionals: string[];
};

/** An inapplicable flag is an error: `doctor --cache-dir` reads as a request that is ignored. */
function parseFlags(command: string, argv: readonly string[], allowed: readonly string[]): Flags {
  const flags: Flags = {
    force: false,
    cacheDir: DEFAULT_CACHE_DIR,
    android: true,
    ios: true,
    positionals: [],
  };

  const accept = (flag: string): void => {
    if (!allowed.includes(flag)) {
      throw new Error(`${command} does not take ${flag}.\n\n${USAGE}`);
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    switch (arg) {
      case '--force':
        accept(arg);
        flags.force = true;
        break;
      case '--ios-only':
        accept(arg);
        flags.android = false;
        break;
      case '--android-only':
        accept(arg);
        flags.ios = false;
        break;
      case '--cache-dir': {
        accept(arg);
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

/** On demand, so `--android-only` and `doctor` work where `expo` cannot be resolved. */
async function loadXcodeSupport(): Promise<typeof Pbxproj | null> {
  try {
    return await import('./pbxproj.js');
  } catch {
    return null;
  }
}

/** Returns whether anything was installed, which is what decides the exit code. */
async function installIos(
  projectRoot: string,
  cachePath: string,
  model: ModelEntry,
): Promise<boolean> {
  const projectName = await findIosProjectName(projectRoot);
  if (!projectName) {
    log.warn('no ios/*.xcodeproj found, skipping the iOS install.');
    return false;
  }

  // A hand-copied file next to the sources ends up in the bundle too, so clear that first.
  await removeInstalledModels(join(projectRoot, 'ios', projectName));
  const installed = await installModelFile(
    cachePath,
    iosResourcesDir(projectRoot, projectName),
    model,
  );
  log.line(`copied → ${relative(projectRoot, installed)}`);

  const xcode = await loadXcodeSupport();
  if (!xcode) {
    log.warn(
      'could not load expo/config-plugins, so the Xcode project was not updated. Add ' +
        `${relative(projectRoot, installed)} to your app target in Xcode once.`,
    );
    return true;
  }

  const project = xcode.loadProject(projectRoot);
  const { removed } = xcode.syncModelReference(project, projectName, model.fileName);
  const filepath = await xcode.saveProject(project);

  for (const stale of removed) log.line(`unregistered ${stale}`);
  log.line(`registered → ${relative(projectRoot, filepath)}`);
  return true;
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

  let installed = 0;

  if (flags.android) {
    // The guard belongs here rather than in installModelFile: the config plugin installs during
    // prebuild, where android/ legitimately does not exist yet and mkdir -p is the right thing.
    // Run from anywhere else, that same mkdir fabricates a four-level tree nobody asked for.
    if (await directoryExists(join(projectRoot, 'android'))) {
      const target = await installModelFile(cachePath, androidAssetsDir(projectRoot), model);
      log.line(`copied → ${relative(projectRoot, target)}`);
      installed += 1;
    } else {
      log.warn('no android/ directory here, skipping the Android install.');
    }
  }

  if (flags.ios && (await installIos(projectRoot, cachePath, model))) installed += 1;

  if (installed === 0) {
    log.warn(
      `the model is in the cache, but ${projectRoot} holds no native project to install it ` +
        `into. Run this from the app root, after prebuild.`,
    );
    return 1;
  }
  return 0;
}

/** `skip` matters: reporting an unknowable value as a failure trains people to ignore doctor. */
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
  if (!KNOWN_MODEL_FILE_PATTERN.test(fileName)) {
    // The native side loads any pose_landmarker_*.task, so a hand-placed one is the model that
    // runs, and nothing here can say what it should hash to.
    return [
      fail(
        'model installed',
        `${shortDir}/${fileName} is not a model this package installs, and the runtime loads it`,
      ),
    ];
  }

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
 * Bare RN writes it to `android/build.gradle` and `expo-build-properties` to
 * `gradle.properties`. A plain prebuild writes neither, so the value is unknowable here.
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

const PBX_UUID = '[0-9A-Fa-f]{12,32}';

/** Everything between the `Begin`/`End` comments the pbxproj writers emit around each section. */
function pbxSection(pbxproj: string, name: string): string {
  const start = pbxproj.indexOf(`/* Begin ${name} section */`);
  const end = pbxproj.indexOf(`/* End ${name} section */`);
  return start === -1 || end === -1 || end < start ? '' : pbxproj.slice(start, end);
}

/** Text read, not a parser, so `doctor` survives the misconfigured projects it exists for. */
function pbxObject(section: string, uuid: string): string | null {
  const definition = new RegExp(`\\b${uuid}\\b\\s*(?:/\\*[^*]*\\*/\\s*)?=\\s*\\{`).exec(section);
  if (!definition) return null;

  const open = definition.index + definition[0].length - 1;
  let depth = 0;

  for (let index = open; index < section.length; index += 1) {
    const char = section[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return section.slice(open + 1, index);
    }
  }
  return null;
}

/** Every uuid referenced from an object body, in order. */
function pbxReferences(body: string): string[] {
  return [...body.matchAll(new RegExp(`(${PBX_UUID}) /\\*`, 'g'))].map(
    (match) => match[1] as string,
  );
}

/** The app target, which is not always the first one: a widget or a test target can precede it. */
function applicationTarget(pbxproj: string): string | null {
  const targets = pbxSection(pbxproj, 'PBXNativeTarget');

  for (const uuid of pbxReferences(targets)) {
    const body = pbxObject(targets, uuid);
    if (body === null || !body.includes('isa = PBXNativeTarget')) continue;
    if (/productType = "?com\.apple\.product-type\.application"?/.test(body)) return uuid;
  }
  return null;
}

/** The XCConfigurationList a target or the project itself points at. */
function buildConfigurationList(body: string | null): string | undefined {
  return new RegExp(`buildConfigurationList = (${PBX_UUID})`).exec(body ?? '')?.[1];
}

function deploymentTargetsOf(pbxproj: string, listUuid: string | undefined): number[] {
  if (listUuid === undefined) return [];

  const listBody = pbxObject(pbxSection(pbxproj, 'XCConfigurationList'), listUuid);
  if (listBody === null) return [];

  const configurations = pbxSection(pbxproj, 'XCBuildConfiguration');
  const values: number[] = [];

  for (const uuid of pbxReferences(listBody)) {
    const body = pbxObject(configurations, uuid);
    const found = /IPHONEOS_DEPLOYMENT_TARGET = "?([\d.]+)"?/.exec(body ?? '')?.[1];
    if (found !== undefined) values.push(parseFloat(found));
  }
  return values;
}

/**
 * The pbxproj holds what Xcode actually builds against. Only the app target counts: an extension
 * pinned lower is no reason to fail a correct app.
 */
function checkDeploymentTarget(pbxproj: string | null): Check {
  const label = 'iOS deployment target 15.1';
  if (pbxproj === null) return skip(label, 'no Xcode project, run prebuild first');

  const appUuid = applicationTarget(pbxproj);
  const targetBody =
    appUuid === null ? null : pbxObject(pbxSection(pbxproj, 'PBXNativeTarget'), appUuid);
  const values = deploymentTargetsOf(pbxproj, buildConfigurationList(targetBody));

  // A target that sets nothing inherits the project-level value.
  const found =
    values.length > 0
      ? values
      : deploymentTargetsOf(pbxproj, buildConfigurationList(pbxSection(pbxproj, 'PBXProject')));

  if (found.length === 0) {
    return skip(label, 'no IPHONEOS_DEPLOYMENT_TARGET on the app target');
  }

  const lowest = Math.min(...found);
  return lowest >= 15.1
    ? pass(label, `found ${lowest}`)
    : fail(label, `found ${lowest}, this package needs 15.1`);
}

/**
 * A .task no target builds is never bundled and fails at runtime with MODEL_NOT_FOUND. The CLI
 * produces exactly that state when `expo/config-plugins` cannot be resolved.
 */
async function checkXcodeRegistration(
  pbxproj: string | null,
  resourcesDir: string,
): Promise<Check> {
  const label = 'model in the app target';
  if (pbxproj === null) return skip(label, 'no Xcode project, run prebuild first');

  const fileName = (await findInstalledModels(resourcesDir))[0];
  if (fileName === undefined) return skip(label, 'no model installed to look for');

  const appUuid = applicationTarget(pbxproj);
  const body = appUuid === null ? null : pbxObject(pbxSection(pbxproj, 'PBXNativeTarget'), appUuid);
  if (body === null) return skip(label, 'no application target in the Xcode project');

  const phases = pbxSection(pbxproj, 'PBXResourcesBuildPhase');
  for (const uuid of pbxReferences(body)) {
    const phase = pbxObject(phases, uuid);
    if (phase === null) continue;

    if (phase.includes(fileName)) return pass(label, `${fileName} is a build resource`);

    // An empty phase is an answer. A phase with entries but no comments is not: some writers
    // strip them, and guessing from uuids alone would produce a failure nobody can act on.
    const entries = phase.match(new RegExp(PBX_UUID, 'g')) ?? [];
    if (entries.length > 0 && !phase.includes('/*')) {
      return skip(label, 'the build phase lists no file names to read');
    }

    return fail(
      label,
      `${fileName} is on disk but not built into the app target, so it will not be in the bundle`,
    );
  }
  return skip(label, 'the application target has no Resources build phase');
}

/** Best-effort reads that can say "could not determine" beat a parser that throws. */
async function doctorCommand(): Promise<number> {
  const projectRoot = process.cwd();
  const checks: Check[] = [];

  checks.push(
    ...(await checkInstalledModel(androidAssetsDir(projectRoot), 'android/app/src/main/assets')),
  );

  const projectName = await findIosProjectName(projectRoot);
  let pbxproj: string | null = null;

  if (projectName === null) {
    checks.push(fail('ios project', 'no ios/*.xcodeproj found'));
  } else {
    const xcodeproj = await findXcodeProjectPath(projectRoot);
    pbxproj = xcodeproj === null ? null : await readIfPresent(join(xcodeproj, 'project.pbxproj'));

    const resourcesDir = iosResourcesDir(projectRoot, projectName);
    checks.push(...(await checkInstalledModel(resourcesDir, `ios/${projectName}/Resources`)));
    checks.push(await checkXcodeRegistration(pbxproj, resourcesDir));

    const stray = await findInstalledModels(join(projectRoot, 'ios', projectName));
    if (stray.length > 0) {
      checks.push(fail('one model on iOS', `also found ${stray.join(', ')} beside the sources`));
    }
  }

  checks.push(await checkMinSdk(projectRoot));

  if (projectName !== null) {
    checks.push(checkDeploymentTarget(pbxproj));
  }

  const manifest = await readIfPresent(
    join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  );
  // Absent from the app manifest is not a failure: this package declares the permission in its
  // own manifest, and the merger adds it. Reporting that as broken is how doctor gets ignored.
  checks.push(
    manifest === null
      ? skip('android.permission.CAMERA', 'no AndroidManifest.xml, run prebuild first')
      : manifest.includes('android.permission.CAMERA')
      ? pass('android.permission.CAMERA', 'AndroidManifest.xml')
      : pass('android.permission.CAMERA', 'merged in from this package, not in the app manifest'),
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

  // Checked before the dispatch, because `<command> --help` is what people type.
  if (
    command === undefined ||
    command === 'help' ||
    argv.includes('--help') ||
    argv.includes('-h')
  ) {
    log.line(USAGE);
    return 0;
  }

  switch (command) {
    case 'fetch-model': {
      const flags = parseFlags(command, rest, [
        '--force',
        '--cache-dir',
        '--ios-only',
        '--android-only',
      ]);
      if (flags.positionals.length > 1) {
        throw new Error(
          `fetch-model takes one variant, got: ${flags.positionals.join(' ')}.\n\n${USAGE}`,
        );
      }
      return fetchModelCommand(flags);
    }

    case 'doctor': {
      const flags = parseFlags(command, rest, []);
      if (flags.positionals.length > 0) {
        throw new Error(`doctor takes no arguments, got: ${flags.positionals.join(' ')}.`);
      }
      return doctorCommand();
    }

    case 'clear-cache': {
      const flags = parseFlags(command, rest, ['--cache-dir']);
      if (flags.positionals.length > 0) {
        // `clear-cache full` reads as clearing one variant, and it never did that.
        throw new Error(
          `clear-cache takes no arguments, got: ${flags.positionals.join(' ')}. It clears the ` +
            `whole cache.`,
        );
      }

      const removed = await clearCache(flags.cacheDir);
      log.line(
        removed.length === 0
          ? `nothing to clear in ${flags.cacheDir}`
          : `cleared ${removed.join(', ')} from ${flags.cacheDir}`,
      );
      return 0;
    }

    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}
