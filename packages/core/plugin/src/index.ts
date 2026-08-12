import type { ConfigPlugin } from 'expo/config-plugins';
import { createRunOncePlugin } from 'expo/config-plugins';

import type { PoseDetectionPluginOptions } from './options';
import { resolveOptions } from './options';
import { withAndroidModel } from './withAndroidModel';
import { withIosModel } from './withIosModel';

const PACKAGE_NAME = 'react-native-pose-detection';

const withPoseDetection: ConfigPlugin<PoseDetectionPluginOptions | undefined> = (
  config,
  options,
) => {
  const resolved = resolveOptions(options);

  config = withAndroidModel(config, resolved);
  config = withIosModel(config, resolved);

  return config;
};

// Listing the plugin twice, directly and through another package, must not install the model
// twice or race two downloads into the same cache path.
export default createRunOncePlugin(withPoseDetection, PACKAGE_NAME);

export type { PoseDetectionPluginOptions };
