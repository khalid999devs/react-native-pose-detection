export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Keep in sync with docs/contributing.md
    'scope-enum': [
      2,
      'always',
      [
        // package areas
        'core',
        'ios',
        'android',
        'engine',
        'camera',
        'triggers',
        'calibration',
        'overlay',
        'logging',
        'plugin',
        'cli',
        // repository areas
        'repo',
        'example',
        'docs',
        'guides',
        'ci',
        'deps',
        'release',
      ],
    ],
    'body-max-line-length': [1, 'always', 100],
  },
};
