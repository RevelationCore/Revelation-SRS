/**
 * Stage 8 — Responsive layout tests.
 *
 * Verifies that key admin pages render usably at common viewport breakpoints.
 * The admin UI uses a horizontal nav with no mobile breakpoints (known gap
 * documented in Phase 10 acceptance review as R-A11Y-001). These tests
 * verify that pages are at minimum not broken at smaller viewports.
 *
 * Viewports tested:
 *   desktop  1280×800  (primary target)
 *   tablet   768×1024  (iPad portrait)
 *   mobile   375×667   (iPhone SE)
 *
 * The portal nav is responsive (hamburger menu) — tested separately.
 */
 
import { test, expect, type Page } from '@playwright/test';

import { injectAdminAuth } from './helpers/auth.js';
import { mockApiRoutes } from './helpers/api-mocks.js';

const ADMIN = 'http://localhost:5173';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'mobile',  width: 375,  height: 667 },
] as const;

async function setup(page: Page) {
  await injectAdminAuth(page);
  await mockApiRoutes(page);
}

for (const vp of VIEWPORTS) {
  test.describe(`Admin — ${vp.name} viewport (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('dashboard page renders main heading', async ({ page }) => {
      await setup(page);
      await page.goto(`${ADMIN}/dashboard`);
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });

    test('students page table area is present', async ({ page }) => {
      await setup(page);
      await page.route('**/api/v1/students**', async (route) => {
        await route.fulfill({ json: [] });
      });
      await page.goto(`${ADMIN}/students`);
      await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    });

    test('navigation links are reachable (may scroll on small vp)', async ({ page }) => {
      await setup(page);
      await page.goto(`${ADMIN}/dashboard`);
      // Nav is rendered — links exist in DOM even if scrolled off screen
      const studentsLink = page.getByRole('link', { name: 'Students' });
      await expect(studentsLink).toBeAttached();
    });

    test('tenant admin page renders without overflow errors', async ({ page }) => {
      await setup(page);
      await page.goto(`${ADMIN}/tenant-admin`);
      await expect(page.getByRole('heading', { name: /administration/i })).toBeVisible();
      // No horizontal scroll beyond viewport on desktop/tablet (content cards wrap)
      if (vp.width >= 768) {
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(vp.width + 20); // 20px tolerance for scrollbar
      }
    });
  });
}

// Portal responsive — portal has a proper hamburger nav
test.describe('Portal — mobile viewport (375×667)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('portal login page renders on mobile', async ({ page }) => {
    await page.goto('http://localhost:5174/login');
    await expect(page.getByRole('heading', { name: 'Revelation SRS' })).toBeVisible();
  });
});
