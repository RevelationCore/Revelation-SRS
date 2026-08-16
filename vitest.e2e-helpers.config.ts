import { defineConfig } from 'vitest/config';

// Unit tests for helper modules that live outside any workspace package (e.g.
// e2e/uat/*.ts) — Playwright specs (*.spec.ts) are excluded; those run under
// playwright.config.ts, not here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
  },
});
