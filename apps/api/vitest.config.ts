import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    testTimeout: 15_000,
    include:     ['test/**/*.test.ts'],
    exclude:     ['test/**/*.int.test.ts', 'node_modules/**'],
    reporters:   ['verbose'],
    coverage: {
      provider:          'istanbul',
      reporter:          ['text', 'lcov', 'html'],
      reportsDirectory:  'coverage',
      include:           ['src/platform/**/*.ts'],
      exclude:           ['src/platform/clock.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines:     70,
        functions: 70,
        branches:  65,
      },
    },
  },
});
