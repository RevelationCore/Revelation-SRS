import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['golden/**', 'uat/**'],
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 2 : undefined,
  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @revelation-srs/portal dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @revelation-srs/admin dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
