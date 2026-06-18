import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include:     ['test/**/*.test.ts'],
    exclude:     ['test/**/*.int.test.ts', 'node_modules/**'],
    reporters:        ['verbose'],
    passWithNoTests:  true,
  },
});
