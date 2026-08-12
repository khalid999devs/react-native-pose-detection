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
    // Both are CommonJS entry points by convention: Expo resolves app.plugin.js itself, and the
    // bin is loaded by Node before any bundler is involved. Neither can be ESM.
    files: ['packages/core/app.plugin.js', 'packages/core/cli/index.js'],
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
