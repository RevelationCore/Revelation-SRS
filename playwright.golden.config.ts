/**
 * Playwright configuration for the real-backend golden smoke suite.
 *
 * Unlike playwright.config.ts (mock-based), these tests run against a live
 * API server with demo data loaded. They are skipped automatically when the
 * API is unreachable.
 *
 * Run with: pnpm test:e2e:playwright:golden
 *
 * Required environment variables (default to localhost):
 *   DEMO_GOLDEN_ADMIN_URL  http://localhost:5173
 *   DEMO_GOLDEN_API_URL    http://localhost:3000
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/golden',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    trace:    'on-first-retry',
    baseURL:  process.env['DEMO_GOLDEN_ADMIN_URL'] ?? 'http://localhost:5173',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer block: tests expect the stack to already be running.
});
