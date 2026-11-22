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
// The deployed NATS requires nkey auth (BL-337).
const NATS_CONNECT = {
  selector: 'CallExpression[callee.name="connect"] > ObjectExpression:first-child:has(Property[key.name="servers"])',
  message: 'Use connect(natsConnectOptions(url)) so the connection carries the NATS credentials.',
};
// ADR-030: system content is stored unscanned, so only the award renderer may make it.
const SYSTEM_CONTENT = {
  selector: 'CallExpression[callee.property.name="systemContent"]',
  message: 'Uploads are scanned (documentStore.scanUpload); systemContent is for server-rendered award documents only (ADR-030).',
};

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
  // Connectors stay independently replaceable (ADR-032): the only workspace
  // package they import at runtime is the leaf client package.
  {
    files: ['adapters/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^@revelation-srs/(?!service-client$|domain$)',
          message: 'Connectors import only @revelation-srs/service-client (and domain types); see ADR-032.',
        }],
      }],
    },
  },
  // Every outbound HTTP call from a service is time-bounded (BL-011, P-09):
  // services call fetchWithTimeout, never bare fetch.
  {
    files: ['apps/api/src/**/*.ts', 'apps/bff/src/**/*.ts', 'modules/*/src/**/*.ts', 'adapters/*/src/**/*.ts', 'packages/auth/src/**/*.ts', 'packages/db/src/**/*.ts', 'packages/documents/src/**/*.ts', 'packages/workflow/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use fetchWithTimeout (@revelation-srs/auth) so the call has a timeout.' }],
      // NATS credentials (BL-337) and scanning (ADR-030).
      'no-restricted-syntax': ['error', NATS_CONNECT, SYSTEM_CONTENT],
    },
  },
  // ADR-030: only the award-document renderer stores unscanned (system) content.
  {
    files: ['apps/api/src/platform/progression/award-document-service.ts'],
    rules: { 'no-restricted-syntax': ['error', NATS_CONNECT] },
  },
  // ADR-030: services never build a no-op scanner themselves; configuration
  // (createDocumentScanner) chooses it, and refuses it outside development and test.
  {
    files: ['apps/api/src/**/*.ts', 'modules/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@revelation-srs/documents', importNames: ['NoopScanner'], message: 'Set DOCUMENT_SCANNER=noop (development and test only) instead; see ADR-030.' }],
      }],
    },
  },
];
