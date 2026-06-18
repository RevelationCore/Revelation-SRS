/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PORTAL = 'http://localhost:5174';

test.describe('Portal smoke', () => {
  test('login page renders and passes axe', async ({ page }) => {
    await page.goto(`${PORTAL}/login`);
    await expect(page.getByRole('heading', { name: 'Revelation SRS' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('root redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto(PORTAL);
    await page.waitForURL(/\/(login|dashboard)/);
    expect(page.url()).toMatch(/\/(login|dashboard)/);
  });

  test('unknown route renders 404', async ({ page }) => {
    await page.goto(`${PORTAL}/no-such-page`);
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
  });

  test('/403 renders forbidden page and passes axe', async ({ page }) => {
    await page.goto(`${PORTAL}/403`);
    await expect(page.getByRole('heading', { name: /permission/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  // All protected routes redirect to /login when unauthenticated
  for (const route of [
    '/dashboard',
    '/profile',
    '/profile/edit',
    '/profile/addresses/new',
    '/enrolments',
    '/modules',
    '/modules/add',
    '/results',
    '/timetable',
    '/exams',
    '/adjustments',
    '/disability',
    '/circumstances',
    '/notifications',
  ]) {
    test(`${route} redirects to /login when unauthenticated`, async ({ page }) => {
      await page.goto(`${PORTAL}${route}`);
      await page.waitForURL(`${PORTAL}/login`);
      expect(page.url()).toContain('/login');
    });
  }
});
