/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ADMIN = 'http://localhost:5173';

const PROTECTED_ROUTES = [
  '/dashboard',
  '/students',
  '/tasks',
  '/exam-boards',
  '/regulatory',
  '/regulatory/hesa',
  '/regulatory/ucas',
  '/regulatory/slc',
  '/regulatory/ukvi',
  '/regulatory/ofs',
  '/tenant-admin',
  '/tenant-admin/config',
  '/tenant-admin/value-sets',
  '/tenant-admin/globalisation',
  '/tenant-admin/rules',
  '/tenant-admin/workflows',
  '/tenant-admin/flags',
  '/tenant-admin/integrations',
  '/tenant-admin/audit',
  '/reporting',
  '/reporting/enrolments',
  '/reporting/regulatory-status',
  '/reporting/foi',
  '/operations',
  '/operations/environment',
  '/operations/integrations',
];

test.describe('Admin smoke', () => {
  test('login page renders and passes axe', async ({ page }) => {
    await page.goto(`${ADMIN}/login`);
    await expect(page.getByRole('heading', { name: 'Revelation SRS' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('root redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto(ADMIN);
    await page.waitForURL(`${ADMIN}/login`);
    expect(page.url()).toContain('/login');
  });

  test('/403 renders forbidden page and passes axe', async ({ page }) => {
    await page.goto(`${ADMIN}/403`);
    await expect(page.getByRole('heading', { name: /permission/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to /login when unauthenticated`, async ({ page }) => {
      await page.goto(`${ADMIN}${route}`);
      await page.waitForURL(`${ADMIN}/login`);
      expect(page.url()).toContain('/login');
    });
  }
});
