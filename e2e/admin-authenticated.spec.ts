/**
 * Stage 8 — Authenticated admin page rendering + WCAG 2.1 AA axe scans.
 *
 * Each test:
 *  1. Injects a valid staff JWT into localStorage before the page loads.
 *  2. Mocks all /api/v1/** routes to return safe empty responses.
 *  3. Navigates to the route and waits for the page heading to appear.
 *  4. Runs axe and asserts zero violations.
 *
 * This covers all 26 protected admin routes.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { injectAdminAuth } from './helpers/auth.js';
import { mockApiRoutes } from './helpers/api-mocks.js';

const ADMIN = 'http://localhost:5173';

// [route, heading text or partial regex]
const PAGES: [string, string | RegExp][] = [
  ['/dashboard',                   'Dashboard'],
  ['/students',                    'Students'],
  ['/tasks',                       'Task inbox'],
  ['/exam-boards',                 'Exam boards'],
  ['/regulatory',                  'Regulatory'],
  ['/regulatory/hesa',             'HESA'],
  ['/regulatory/ucas',             'UCAS'],
  ['/regulatory/slc',              'SLC'],
  ['/regulatory/ukvi',             'UKVI'],
  ['/regulatory/ofs',              'OfS'],
  ['/tenant-admin',                'Administration'],
  ['/tenant-admin/config',         'Tenant configuration'],
  ['/tenant-admin/value-sets',     'Value sets'],
  ['/tenant-admin/globalisation',  'Globalisation'],
  ['/tenant-admin/rules',          'Academic rules'],
  ['/tenant-admin/workflows',      'Workflow definitions'],
  ['/tenant-admin/flags',          'Feature flags'],
  ['/tenant-admin/integrations',   'Integrations'],
  ['/tenant-admin/audit',          'Audit'],
  ['/reporting',                   'Reporting'],
  ['/reporting/enrolments',        'Enrolment volumes'],
  ['/reporting/regulatory-status', 'Regulatory submission status'],
  ['/reporting/foi',               /freedom of information/i],
  ['/operations',                  'Operations'],
  ['/operations/environment',      'Environment runtime'],
  ['/operations/integrations',     'Integration operations'],
];

test.describe('Admin — authenticated page rendering and axe scans', () => {
  for (const [route, heading] of PAGES) {
    test(`${route} renders and passes axe`, async ({ page }) => {
      await injectAdminAuth(page);
      await mockApiRoutes(page);

      await page.goto(`${ADMIN}${route}`);

      // Wait for the page heading to appear (not the spinner)
      const locator =
        typeof heading === 'string'
          ? page.getByRole('heading', { name: heading, exact: false, level: 1 })
          : page.getByRole('heading', { name: heading });
      await expect(locator).toBeVisible({ timeout: 10_000 });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('navigation links are all visible and correct', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await page.goto(`${ADMIN}/dashboard`);

    await expect(page.getByRole('link', { name: 'Students' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tasks' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Exam boards' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Regulatory', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Administration', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reporting' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operations' })).toBeVisible();
  });

  test('user display name appears in nav when authenticated', async ({ page }) => {
    await injectAdminAuth(page);
    await mockApiRoutes(page);
    await page.goto(`${ADMIN}/dashboard`);

    // JWT given_name + family_name = "Staff User"
    await expect(page.getByText('Staff User')).toBeVisible();
  });

  test('/403 page renders without auth and passes axe', async ({ page }) => {
    await page.goto(`${ADMIN}/403`);
    await expect(page.getByRole('heading', { name: /permission/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('login page passes axe', async ({ page }) => {
    await page.goto(`${ADMIN}/login`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});
