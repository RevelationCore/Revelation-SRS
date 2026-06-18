import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    testTimeout: 90_000,
    hookTimeout: 90_000,
    include:     ['test/**/*.int.test.ts'],
    reporters:   ['verbose'],
  },
});
