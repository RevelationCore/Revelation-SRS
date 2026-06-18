/**
 * S0 CI Golden Dataset — real-backend smoke journeys.
 *
 * These tests exercise the admin and portal apps against the real API with
 * S0 golden data loaded. They require a running API server that has been
 * seeded with the CI golden dataset (pnpm demo:reset --scenario ci-golden).
 *
 * The tests use stable UUIDs from packages/demo-data/src/golden-ids.ts and
 * story markers from packages/demo-data/src/story-markers.ts. Because the
 * IDs are deterministic, test assertions can reference specific records by
 * their known UUID rather than relying on search results.
 *
 * Prerequisites:
 *   DEMO_GOLDEN_ADMIN_URL  — base URL of the admin app (default: http://localhost:5173)
 *   DEMO_GOLDEN_API_URL    — base URL of the API server (default: http://localhost:3000)
 *
 * If neither URL is set to a reachable server the tests skip automatically.
 * Run with: pnpm test:e2e:playwright:golden
 */
import { type Page, test, expect } from '@playwright/test';

import { GOLDEN_IDS } from '../../packages/demo-data/src/golden-ids.js';

const ADMIN_URL = process.env['DEMO_GOLDEN_ADMIN_URL'] ?? 'http://localhost:5173';
const API_URL   = process.env['DEMO_GOLDEN_API_URL']   ?? 'http://localhost:3000';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const body   = b64url(payload);
  return `${header}.${body}.golden-sig`;
}

const EXP = 9_999_999_999;

function goldenStaffToken(tenantId: string): string {
  return makeJwt({
    sub:                'golden-staff-001',
    preferred_username: 'demo.staff',
    given_name:         'Demo',
    family_name:        'Staff',
    email:              'demo.staff@demo.srs',
    realm_access:       { roles: ['registry-administrator', 'tenant-administrator'] },
    tenant_id:          tenantId,
    exp:                EXP,
    iat:                1_718_000_000,
  });
}

async function injectStaffAuth(page: Page, tenantId: string): Promise<void> {
  const token = goldenStaffToken(tenantId);
  await page.addInitScript(
    ({ t }: { t: string }) => {
      localStorage.setItem('srs_admin_token',         t);
      localStorage.setItem('srs_admin_refresh_token', t);
    },
    { t: token },
  );
}

// ─── Demo status preflight ─────────────────────────────────────────────────────

async function getDemoStatus(): Promise<{ active: boolean; tenantId?: string }> {
  try {
    const res  = await fetch(`${API_URL}/api/v1/demo/status`);
    const data = await res.json() as { active: boolean; scenarioSlug?: string };
    return { active: data.active === true };
  } catch {
    return { active: false };
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('S0 golden — demo banner', () => {
  test('demo status endpoint returns active scenario', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/demo/status`);
    test.skip(!res.ok(), 'API is not reachable — skipping golden tests');
    expect(res.status()).toBe(200);
    const body = await res.json() as { active: boolean; scenarioSlug: string | null };
    expect(body.active).toBe(true);
    expect(body.scenarioSlug).toBe('ci-golden');
  });
});

test.describe('S0 golden — admin student record (PERSON_ENROLLED)', () => {
  test.beforeEach(async ({ page }) => {
    const status = await getDemoStatus();
    test.skip(!status.active, 'Demo API is not active — skipping golden admin tests');

    await injectStaffAuth(page, 'test-golden');
  });

  test('enrolled student record is accessible by golden ID', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/students/${GOLDEN_IDS.PERSON_ENROLLED}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/enrolled/i)).toBeVisible();
  });

  test('graduated student record shows graduated status', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/students/${GOLDEN_IDS.PERSON_GRADUATED}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/graduated/i)).toBeVisible();
  });

  test('intermitting student record shows intermitting status', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/students/${GOLDEN_IDS.PERSON_INTERMITTING}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/intermitting/i)).toBeVisible();
  });

  test('withdrawn student record shows withdrawn status', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/students/${GOLDEN_IDS.PERSON_WITHDRAWN}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/withdrawn/i)).toBeVisible();
  });
});

test.describe('S0 golden — exam boards', () => {
  test.beforeEach(async ({ page }) => {
    const status = await getDemoStatus();
    test.skip(!status.active, 'Demo API is not active — skipping golden board tests');
    await injectStaffAuth(page, 'test-golden');
  });

  test('scheduled board is visible in the boards list', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/exam-boards`);
    await expect(page.getByRole('heading', { name: /exam boards/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/scheduled/i)).toBeVisible();
  });

  test('ratified board is visible in the boards list', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/exam-boards`);
    await expect(page.getByRole('heading', { name: /exam boards/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/ratified/i)).toBeVisible();
  });
});
