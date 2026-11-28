/**
 * Playwright configuration for the assisted UAT suite (e2e/uat).
 *
 * Runs against the live stack (pnpm evaluate, or pnpm dev with demo data):
 * the personas sign in through each app's BFF and Keycloak (BL-375). The
 * default config ignores e2e/uat, so `playwright test uat/…` with it found
 * no tests.
 *
 * Run with: pnpm test:uat
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/uat',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  // One worker: each persona signs in once and later stories reuse the session.
  workers: 1,
  reporter: 'list',

  use: {
    trace:      'retain-on-failure',
    screenshot: 'only-on-failure',
    headless:   true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer block: the suite expects the stack to be running already.
});
