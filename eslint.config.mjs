import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/build/**',
      '**/lib/**',
      '.test-build/**',
      '**/node_modules/**',
      '**/android/**',
      '**/ios/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // CommonJS by convention, not by choice: Expo resolves app.plugin.js itself, the bin is
    // loaded by Node before any bundler is involved, and Metro and Babel read their configs
    // through require.
    files: [
      'packages/core/app.plugin.js',
      'packages/core/cli/index.js',
      'example/*/metro.config.js',
      'example/*/babel.config.js',
    ],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
