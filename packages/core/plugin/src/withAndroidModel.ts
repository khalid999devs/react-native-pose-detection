import type { ConfigPlugin } from 'expo/config-plugins';
import { AndroidConfig, withAndroidManifest, withDangerousMod } from 'expo/config-plugins';
import { relative } from 'node:path';

import { androidAssetsDir, installModelFile } from './install';
import * as log from './log';
import type { ResolvedOptions } from './options';
import { ensureModelOnce } from './options';

const withModelAsset: ConfigPlugin<ResolvedOptions> = (config, options) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const cachePath = await ensureModelOnce(options);
      // skipDownload with a cold cache: leave whatever is already vendored in place.
      if (!cachePath) return config;

      const { projectRoot } = config.modRequest;
      const installed = await installModelFile(cachePath, androidAssetsDir(projectRoot));
      log.line(`copied → ${relative(projectRoot, installed)}`);

      return config;
    },
  ]);

const withCameraPermission: ConfigPlugin = (config) =>
  withAndroidManifest(config, (config) => {
    AndroidConfig.Permissions.ensurePermissions(config.modResults, ['android.permission.CAMERA']);
    return config;
  });

export const withAndroidModel: ConfigPlugin<ResolvedOptions> = (config, options) => {
  config = withModelAsset(config, options);
  config = withCameraPermission(config);
  return config;
};
