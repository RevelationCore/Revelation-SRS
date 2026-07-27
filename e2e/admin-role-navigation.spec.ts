import { expect, test } from '@playwright/test';

import { injectAdminAuth } from './helpers/auth.js';
import { mockApiRoutes } from './helpers/api-mocks.js';

const ADMIN = 'http://localhost:5173';

test('module tutor sees only permitted navigation and cannot open regulatory routes', async ({ page }) => {
  await injectAdminAuth(page, ['module-tutor']);
  await mockApiRoutes(page);
  await page.goto(`${ADMIN}/dashboard`);

  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Engagement' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Students' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Exam boards' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Regulatory' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Operations' })).toHaveCount(0);

  await page.goto(`${ADMIN}/regulatory/ukvi`);
  await expect(page.getByRole('heading', { name: /permission/i })).toBeVisible();
});

test('DPO sees compliance navigation without operational or academic menus', async ({ page }) => {
  await injectAdminAuth(page, ['dpo']);
  await mockApiRoutes(page);
  await page.goto(`${ADMIN}/dashboard`);

  await expect(page.getByRole('link', { name: 'Students' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Regulatory', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reporting' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Exam boards' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Operations' })).toHaveCount(0);
});
