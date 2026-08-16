/**
 * Stage 8 — Authenticated portal page rendering + WCAG 2.1 AA axe scans.
 *
 * Each test:
 *  1. Injects a valid student JWT into localStorage before the page loads.
 *  2. Mocks all /api/v1/** routes to return safe empty responses.
 *  3. Navigates to the route and waits for the page heading to appear.
 *  4. Runs axe and asserts zero violations.
 *
 * This covers all 17 protected portal routes (including the two dynamic
 * detail/edit routes and /modules/select, which the original table omitted
 * — see docs/product/accessibility-improvement-plan.md D1).
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { injectPortalAuth } from './helpers/auth.js';
import { mockApiRoutes, MOCK } from './helpers/api-mocks.js';

const PORTAL = 'http://localhost:5174';

// [route, heading text or regex]
const PAGES: [string, string | RegExp][] = [
  ['/dashboard',          /home/i],
  ['/profile',            /profile/i],
  ['/profile/edit',       /edit your profile/i],
  ['/profile/addresses/new', /add address/i],
  ['/profile/addresses/test-address-001/edit', /update address/i],
  ['/enrolments',         /enrolments/i],
  ['/enrolments/enrol-001', /BSC-CS/i],
  ['/modules',            /modules/i],
  ['/modules/add',        /add module/i],
  ['/modules/select',     /module selection/i],
  ['/results',            /results/i],
  ['/timetable',          /timetable/i],
  ['/exams',              /exams/i],
  ['/adjustments',        /adjustments/i],
  ['/disability',         /disability/i],
  ['/circumstances',      /circumstances/i],
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
      // Let in-flight fetches (e.g. value-set loads that disable/re-enable a
      // submit button) and their CSS transitions settle before scanning —
      // otherwise axe can catch a genuinely-accessible disabled→enabled
      // button mid-transition, which is neither the exempted disabled colour
      // nor the final enabled one, and fails color-contrast on neither.
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
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

    // Scoped to the sidebar nav landmark: several of these labels also
    // appear in dashboard quick-link cards (e.g. "View all enrolments"),
    // which would otherwise make an unscoped, substring-matching lookup
    // ambiguous.
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Dashboard', 'Profile', 'Enrolments', 'My modules', 'Results']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('login page passes axe', async ({ page }) => {
    await page.goto(`${PORTAL}/login`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('/403 page passes axe', async ({ page }) => {
    await page.goto(`${PORTAL}/403`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('accessibility statement page is accessible without auth', async ({ page }) => {
    await page.goto(`${PORTAL}/accessibility-statement`);
    await expect(page.getByRole('heading', { name: /accessibility statement/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});
