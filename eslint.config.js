// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

const sharedTsRules = {
  ...tseslint.configs['recommended-type-checked'].rules,
  '@typescript-eslint/no-explicit-any':        'error',
  '@typescript-eslint/no-unused-vars':          ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  'import-x/order': ['error', {
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
    'newlines-between': 'always',
  }],
  'no-console': ['warn', { allow: ['error', 'warn'] }],
};

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs', '**/*.d.ts'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser:        tsparser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'import-x':           importX,
    },
    rules: sharedTsRules,
  },
  // .tsx previously matched no config block at all, so every React
  // component in apps/*/src and packages/ui/src was silently skipped by
  // `pnpm lint` entirely. Turning on the full shared TS ruleset (the same
  // one '**/*.ts' gets) here surfaces ~790 pre-existing findings across 99
  // files that have simply never been checked (no-floating-promises,
  // no-explicit-any, import order, ...) — real, but a large, separate
  // cleanup unrelated to accessibility. This block deliberately enables
  // only jsx-a11y and the two core hooks rules for now, so the
  // accessibility gap this was meant to close is actually closed without
  // silently exploding `pnpm lint`'s failure surface with an unrelated
  // backlog. See docs/product/accessibility-improvement-plan.md.
  {
    files: ['**/*.tsx'],
    languageOptions: {
      // No `project`/type-aware parsing here: jsx-a11y and the two hooks
      // rules are pure-AST, and skipping it avoids building a TS program
      // for 99 files just to run rules that never consult it.
      parser:        tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'jsx-a11y':    jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Only the two classic, well-understood hooks rules — not the full
      // v7 "recommended" set, which adds React Compiler-oriented rules
      // (static-components, immutability, set-state-in-effect, ...) that
      // are a separate, much larger concern than this pass's scope.
      'react-hooks/rules-of-hooks':  'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
