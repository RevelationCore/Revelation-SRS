import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include:     ['test/**/*.int.test.ts'],
    reporters:   ['verbose'],
  },
});
