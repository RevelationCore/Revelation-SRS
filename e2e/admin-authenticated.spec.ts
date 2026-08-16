/**
 * Stage 8 — Authenticated admin page rendering + WCAG 2.1 AA axe scans.
 *
 * Each test:
 *  1. Injects a valid staff JWT into localStorage before the page loads.
 *  2. Mocks all /api/v1/** routes to return safe empty responses.
 *  3. Navigates to the route and waits for the page heading to appear.
 *  4. Runs axe and asserts zero violations.
 *
 * This covers all 42 protected admin routes (including the Governance
 * section, StudentDetailPage, and ExamBoardDetailPage, which the original
 * table omitted — see docs/product/accessibility-improvement-plan.md D1).
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
  ['/students/test-student-001',   /test student/i],
  ['/tasks',                       'Task inbox'],
  ['/module-selection-proposals',  'Module selection proposals'],
  ['/module-registration-requests', 'Module registration requests'],
  ['/identity-change-requests',    'Legal identity change requests'],
  ['/exam-boards',                 'Exam boards'],
  ['/exam-boards/test-exam-board-001', /progression/i],
  ['/engagement',                  'Academic engagement'],
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
  ['/tenant-admin/registration-windows', 'Registration windows'],
  ['/tenant-admin/workflows',      'Workflow definitions'],
  ['/tenant-admin/flags',          'Feature flags'],
  ['/tenant-admin/integrations',   'Integrations'],
  ['/tenant-admin/audit',          'Audit'],
  ['/reporting',                   'Reporting'],
  ['/reporting/enrolments',        'Enrolment volumes'],
  ['/reporting/regulatory-status', 'Regulatory submission status'],
  ['/reporting/foi',               /freedom of information/i],
  ['/governance/moderation',              'Mark moderation'],
  ['/governance/regulatory-collections',  'Regulatory collections'],
  ['/governance/identity-resolution',     'Identity resolution'],
  ['/governance/pgr-supervision',         'PGR supervision'],
  ['/governance/pgr-progress-review',     'PGR progress review'],
  ['/governance/pgr-examination',         'PGR thesis examination'],
  ['/governance/pgr-completion',          'PGR completion'],
  ['/governance/rights-requests',         'Individual rights requests'],
  ['/governance/audit-review',            'Audit review'],
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
      // 15s: under a full local parallel run (all specs, unlimited workers)
      // this occasionally borders on a plain 10s timeout for no logic
      // reason — CI already runs with only 2 workers, where this has more
      // headroom.
      await expect(locator).toBeVisible({ timeout: 15_000 });
      // Let in-flight fetches (which disable/re-enable buttons like
      // "Refresh" once loading finishes) and their CSS transitions settle
      // before scanning — otherwise axe can catch a genuinely-accessible
      // disabled→enabled control mid-transition, matching neither the
      // exempted disabled colour nor the final enabled one.
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
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
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('login page passes axe', async ({ page }) => {
    await page.goto(`${ADMIN}/login`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});
