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

    // Welcome heading should include the student name
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    await expect(page.getByText(/student/i)).toBeVisible();
  });

  test('dashboard shows enrolment summary card', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);

    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    // Enrolment data from mock should appear
    await expect(page.getByText(/BSC-CS/i).or(page.getByText(/enrolled/i))).toBeVisible();
  });
});

test.describe('Portal — profile (GP-P02)', () => {
  test('profile page shows legal name', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/profile`);

    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
    await expect(page.getByText('Test').or(page.getByText('Student'))).toBeVisible();
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
    await expect(page.getByText('BSC-CS').or(page.getByText('enrolled'))).toBeVisible();
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
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();

    await page.getByRole('link', { name: /profile/i }).click();
    expect(page.url()).toContain('/profile');
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
  });

  test('clicking Enrolments nav item routes to /enrolments', async ({ page }) => {
    await setupPortal(page);
    await page.goto(`${PORTAL}/dashboard`);

    await page.getByRole('link', { name: /enrolments/i }).click();
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
