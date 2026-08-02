import { defineConfig, devices } from '@playwright/test';

// Separate, standalone Playwright config for the tutorial recording —
// deliberately not merged into the root playwright.config.ts, since this
// suite has different goals (a single clean video recording at a fixed
// size, not parallel CI test coverage) and different lifecycle needs (the
// app is started/reset by tutorials/setup/*, not by Playwright's webServer).
export default defineConfig({
  testDir: './automation',
  outputDir: './generated/test-results',
  timeout: 180_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1920, height: 1080 },
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    trace: 'off',
    screenshot: 'off',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      // devices['Desktop Chrome'] carries its own 1280x720 viewport, which
      // would otherwise silently override the 1920x1080 set above (project
      // `use` wins over the top-level `use` for any overlapping key) — so
      // viewport must be re-asserted here, after the spread.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
