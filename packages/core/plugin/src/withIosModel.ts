import type { ConfigPlugin } from 'expo/config-plugins';
import { withDangerousMod, withInfoPlist, withXcodeProject } from 'expo/config-plugins';
import { join, relative } from 'node:path';

import { installModelFile, iosResourcesDir, removeInstalledModels } from './install';
import * as log from './log';
import type { ResolvedOptions } from './options';
import { ensureModelOnce } from './options';
import { syncModelReference } from './pbxproj';

const withModelResource: ConfigPlugin<ResolvedOptions> = (config, options) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const cachePath = await ensureModelOnce(options);
      // skipDownload with a cold cache: leave whatever is already vendored in place.
      if (!cachePath) return config;

      const { projectRoot, projectName } = config.modRequest;
      if (!projectName) return config;

      // An older install, or a hand-copied file, can sit next to the sources rather than in
      // Resources/. Both end up in the bundle, so both have to be cleared.
      await removeInstalledModels(join(projectRoot, 'ios', projectName));

      const installed = await installModelFile(
        cachePath,
        iosResourcesDir(projectRoot, projectName),
      );
      log.line(`copied → ${relative(projectRoot, installed)}`);

      return config;
    },
  ]);

const withModelInXcodeProject: ConfigPlugin<ResolvedOptions> = (config, options) =>
  withXcodeProject(config, (config) => {
    const { projectName } = config.modRequest;
    if (!projectName) return config;

    syncModelReference(config.modResults, projectName, options.model.fileName);
    return config;
  });

// A description already in the app config is the author being specific, so it wins over our
// fallback text. Passing cameraPermissionText is also the author being specific, so it wins
// over both.
const withCameraUsageDescription: ConfigPlugin<ResolvedOptions> = (config, options) =>
  withInfoPlist(config, (config) => {
    const existing = config.modResults['NSCameraUsageDescription'];
    const hasExisting = typeof existing === 'string' && existing.trim() !== '';

    if (options.cameraPermissionTextExplicit || !hasExisting) {
      config.modResults['NSCameraUsageDescription'] = options.cameraPermissionText;
    }
    return config;
  });

export const withIosModel: ConfigPlugin<ResolvedOptions> = (config, options) => {
  config = withModelResource(config, options);
  config = withModelInXcodeProject(config, options);
  config = withCameraUsageDescription(config, options);
  return config;
};
