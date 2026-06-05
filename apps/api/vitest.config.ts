import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    testTimeout: 15_000,
    include:     ['test/**/*.test.ts'],
    exclude:     ['test/**/*.int.test.ts', 'node_modules/**'],
    reporters:   ['verbose'],
  },
});
