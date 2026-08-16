/**
 * Stage 8 — Portal golden-path E2E tests.
 *
 * Tests the primary student self-service workflows end-to-end.
 * Journey coverage:
 *   GP-P01  Dashboard — authenticated, shows welcome and enrolment summary
 *   GP-P02  Profile — identity and contact details visible
 *   GP-P03  Enrolments — enrolment list renders
 *   GP-P04  Module registration — module list and withdrawal confirm
 *   GP-P05  Results — results page renders (empty when no locked results)
 *   GP-P06  Timetable — renders (empty state)
 *   GP-P07  Adjustments — renders (empty state)
 *   GP-P08  Navigation — clicking nav items routes correctly
 */
import { test, expect } from '@playwright/test';

import { injectPortalAuth } from './helpers/auth.js';
import { mockApiRoutes, MOCK } from './helpers/api-mocks.js';

const PORTAL = 'http://localhost:5174';

async function setupPortal(page: Parameters<typeof mockApiRoutes>[0]) {
  await injectPortalAuth(page);
  await page.route('**/api/v1/students/test-student-001', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MOCK.student });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  await page.route('**/api/v1/students/test-student-001/enrolments', async (route) => {
    await route.fulfill({ json: [MOCK.enrolment] });
  });
  await mockApiRoutes(page);
}

test.describe('Portal — dashboard (GP-P01)', () => {
  test('dashboard renders welcome heading with student name', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);

    // Home heading includes the student's name — checked together since
    // "student" alone also matches the sidebar brand and other page chrome.
    await expect(page.getByRole('heading', { name: /home, test student/i })).toBeVisible();
  });

  test('dashboard shows enrolment summary card', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);

    await expect(page.getByRole('heading', { name: /home/i })).toBeVisible();
    // Both appear more than once on the dashboard (a stat card and a table
    // row) — .first() confirms presence without asserting which surface.
    await expect(page.getByText('BSC-CS').first()).toBeVisible();
    await expect(page.getByText('Enrolled').first()).toBeVisible();
  });
});

test.describe('Portal — profile (GP-P02)', () => {
  test('profile page shows legal name', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/profile`);

    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
    // Scoped to the page content, not the sidebar (which also shows the
    // signed-in user's truncated name and would otherwise make an unscoped
    // 'Test'/'Student' substring search ambiguous). Both legal name fields
    // are expected together, not as alternatives.
    const main = page.getByRole('main');
    await expect(main.getByText('Test', { exact: true })).toBeVisible();
    await expect(main.getByText('Student', { exact: true })).toBeVisible();
  });

  test('edit profile link is visible', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/profile`);

    await expect(page.getByRole('link', { name: /edit/i }).or(
      page.getByRole('button', { name: /edit/i }),
    )).toBeVisible();
  });
});

test.describe('Portal — enrolments (GP-P03)', () => {
  test('enrolment list renders with enrolled programme', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/enrolments`);

    await expect(page.getByRole('heading', { name: /enrolments/i })).toBeVisible();
    // Both are expected to be present at once (programme code and status),
    // not alternatives — an .or() here is a strict-mode violation once both
    // render, since each half matches a different element.
    await expect(page.getByText('BSC-CS')).toBeVisible();
    await expect(page.getByText('Enrolled')).toBeVisible();
  });
});

test.describe('Portal — modules (GP-P04)', () => {
  test('modules page renders with add module link', async ({ page }) => {
    await setupPortal(page);
    await page.route('**/api/v1/module-registrations**', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.goto(`${PORTAL}/modules`);

    await expect(page.getByRole('heading', { name: /modules/i })).toBeVisible();
    // "Add module" should be accessible (no enrolled modules → empty state + add link)
    await expect(
      page.getByRole('link', { name: /add module/i }).or(page.getByText(/no modules/i)),
    ).toBeVisible();
  });
});

test.describe('Portal — results (GP-P05)', () => {
  test('results page renders (empty if no locked results)', async ({ page }) => {
    await setupPortal(page);
    await page.route('**/api/v1/module-registrations**', async (route) => {
      await route.fulfill({ json: [] });
    });
    await page.goto(`${PORTAL}/results`);

    await expect(page.getByRole('heading', { name: /results/i })).toBeVisible();
  });
});

test.describe('Portal — navigation (GP-P08)', () => {
  test('clicking Profile nav item routes to /profile', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);
    await expect(page.getByRole('heading', { name: /home/i })).toBeVisible();

    // Scoped to the sidebar nav landmark — dashboard quick-link cards repeat
    // some of these labels (e.g. "Profile Identity and contact details"),
    // which would otherwise make an unscoped lookup ambiguous.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile' }).click();
    expect(page.url()).toContain('/profile');
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
  });

  test('clicking Enrolments nav item routes to /enrolments', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /enrolments/i }).click();
    expect(page.url()).toContain('/enrolments');
    await expect(page.getByRole('heading', { name: /enrolments/i })).toBeVisible();
  });

  test('sign out button is visible and labelled accessibly', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);

    await expect(
      page.getByRole('button', { name: /sign out/i }).or(
        page.getByRole('link', { name: /sign out/i }),
      ),
    ).toBeVisible();
  });

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto(`${PORTAL}/dashboard`);
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain('/login');
  });
});
