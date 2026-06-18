import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    testTimeout: 120_000,
    hookTimeout: 240_000, // S2 (8k students) needs up to ~3 min for container + inserts
    include:     ['test/**/*.int.test.ts'],
    reporters:   ['verbose'],
    // Run test files sequentially so Testcontainers doesn't exhaust Docker resources.
    pool:        'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
