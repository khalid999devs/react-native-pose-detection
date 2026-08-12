const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

// The package is consumed through the workspace symlink, so Metro has to watch the repository
// root and resolve out of the hoisted node_modules as well as this app's own.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
