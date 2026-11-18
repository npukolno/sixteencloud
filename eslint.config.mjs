// Lint config. Rules aim at real bugs; style is left alone.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.claude/**', 'dist/**', 'release/**', 'node_modules/**', 'assets/**', 'docs/**', 'native/**', 'certs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Page bridges and SoundCloud payloads are untyped JSON by nature.
      '@typescript-eslint/no-explicit-any': 'off',
      // ffmpeg-static and electron-updater are loaded lazily on purpose.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Main-world hooks wrap native methods and must forward `arguments`/`this` verbatim.
    files: ['src/preload/api-tap.ts', 'src/preload/audio-hook.ts'],
    rules: { 'prefer-rest-params': 'off', '@typescript-eslint/no-this-alias': 'off' },
  },
  {
    files: ['src/renderer/mini-player/**/*.ts', 'src/renderer/page/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
