const path = require('node:path');

const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The package is consumed through the workspace symlink, so Metro has to watch the repository
// root and resolve out of the hoisted node_modules as well as this app's own.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

module.exports = mergeConfig(getDefaultConfig(projectRoot), {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
  },
});
