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
        'deps-dev',
        'release',
      ],
    ],
    // Dependabot writes "Bump x from a to b" and cannot be configured otherwise.
    // Only the genuinely unreadable cases stay banned.
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'body-max-line-length': [1, 'always', 100],
  },
};
