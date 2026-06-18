/**
 * Stage 8 — Authenticated portal page rendering + WCAG 2.1 AA axe scans.
 *
 * Each test:
 *  1. Injects a valid student JWT into localStorage before the page loads.
 *  2. Mocks all /api/v1/** routes to return safe empty responses.
 *  3. Navigates to the route and waits for the page heading to appear.
 *  4. Runs axe and asserts zero violations.
 *
 * This covers all 14 protected portal routes.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { injectPortalAuth } from './helpers/auth.js';
import { mockApiRoutes, MOCK } from './helpers/api-mocks.js';

const PORTAL = 'http://localhost:5174';

// [route, heading text or regex]
const PAGES: [string, string | RegExp][] = [
  ['/dashboard',          /welcome/i],
  ['/profile',            /profile/i],
  ['/profile/edit',       /edit profile/i],
  ['/profile/addresses/new', /add address/i],
  ['/enrolments',         /enrolments/i],
  ['/modules',            /modules/i],
  ['/modules/add',        /add module/i],
  ['/results',            /results/i],
  ['/timetable',          /timetable/i],
  ['/exams',              /exams/i],
  ['/adjustments',        /adjustments/i],
  ['/disability',         /disability/i],
  ['/circumstances',      /exceptional circumstances/i],
  ['/notifications',      /notifications/i],
];

test.describe('Portal — authenticated page rendering and axe scans', () => {
  for (const [route, heading] of PAGES) {
    test(`${route} renders and passes axe`, async ({ page }) => {
      await injectPortalAuth(page);
      // Portal pages call /api/v1/students/:sub for profile, etc.
      await page.route('**/api/v1/students/test-student-001', async (route) => {
        await route.fulfill({ json: MOCK.student });
      });
      await mockApiRoutes(page);

      await page.goto(`${PORTAL}${route}`);

      const locator =
        typeof heading === 'string'
          ? page.getByRole('heading', { name: heading, exact: false })
          : page.getByRole('heading', { name: heading });
      await expect(locator).toBeVisible({ timeout: 10_000 });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('navigation contains all expected links', async ({ page }) => {
    await injectPortalAuth(page);
    await page.route('**/api/v1/students/test-student-001', async (r) => {
      await r.fulfill({ json: MOCK.student });
    });
    await mockApiRoutes(page);
    await page.goto(`${PORTAL}/dashboard`);

    for (const label of ['Dashboard', 'Profile', 'Enrolments', 'Modules', 'Results']) {
      await expect(page.getByRole('link', { name: label, exact: false })).toBeVisible();
    }
  });

  test('login page passes axe', async ({ page }) => {
    await page.goto(`${PORTAL}/login`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('/403 page passes axe', async ({ page }) => {
    await page.goto(`${PORTAL}/403`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});
