import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include:     ['test/**/*.int.test.ts'],
    reporters:   ['verbose'],
    // Used with --coverage (CI integration job). Thresholds sit just under the
    // measured level (2026-11-16: lines 87.9%, functions 88.4%, branches 69.1%)
    // so coverage can only ratchet up.
    coverage: {
      provider:          'istanbul',
      reporter:          ['text-summary', 'lcov', 'html'],
      reportsDirectory:  'coverage',
      include:           ['src/platform/**/*.ts'],
      exclude:           ['src/platform/clock.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines:     85,
        functions: 85,
        branches:  65,
      },
    },
  },
});
