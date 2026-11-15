// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'data/**', 'build/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The crash class from the review: hooks after an early return.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['electron/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts', '*.config.{js,ts,mts}', '.claude/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    // page.evaluate() bodies run in the browser.
    files: ['.claude/**/*.mjs', 'tests/smoke.test.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // One-off import scripts keep reference constants around.
    files: ['scripts/import-*/**/*.ts'],
    rules: { '@typescript-eslint/no-unused-vars': 'warn' }
  }
)
