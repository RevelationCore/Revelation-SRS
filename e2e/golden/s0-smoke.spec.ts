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
 * Required environments fail during setup when either URL is unavailable.
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

async function getDemoStatus(): Promise<{ active: boolean; tenantId: string; scenarioSlug: string | null }> {
  const res = await fetch(`${API_URL}/api/v1/demo/status`);
  if (!res.ok) throw new Error(`Demo status preflight failed: HTTP ${res.status}`);
  const data = await res.json() as { active: boolean; tenantId: string | null; scenarioSlug: string | null };
  if (!data.active || !data.tenantId) throw new Error('Demo status preflight failed: no active demo tenant');
  return { active: true, tenantId: data.tenantId, scenarioSlug: data.scenarioSlug };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('S0 golden — demo banner', () => {
  test('demo status endpoint returns active scenario', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/demo/status`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { active: boolean; scenarioSlug: string | null };
    expect(body.active).toBe(true);
    expect(body.scenarioSlug).toBe('ci-golden');
  });
});

test.describe('S0 golden — admin student record (PERSON_ENROLLED)', () => {
  test.beforeEach(async ({ page }) => {
    const status = await getDemoStatus();
    expect(status.scenarioSlug).toBe('ci-golden');
    await injectStaffAuth(page, status.tenantId);
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
    expect(status.scenarioSlug).toBe('ci-golden');
    await injectStaffAuth(page, status.tenantId);
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

test.describe('S0 golden — persisted student-record mutation', () => {
  test('staff creates an address and the real API returns the persisted result', async ({ page, request }) => {
    const status = await getDemoStatus();
    expect(status.scenarioSlug).toBe('ci-golden');
    const token = goldenStaffToken(status.tenantId);
    await injectStaffAuth(page, status.tenantId);

    const marker = `DEMO - Journey ${Date.now()}`;
    const create = await request.post(`${API_URL}/api/v1/students/${GOLDEN_IDS.PERSON_ENROLLED}/addresses`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        addressTypeCode: 'term-time',
        line1: marker,
        city: 'Testford',
        postcode: 'ZZ1 1ZZ',
        countryCode: 'GB',
      },
    });
    expect(create.status()).toBe(201);
    const { addressId } = await create.json() as { addressId: string };

    const persisted = await request.get(
      `${API_URL}/api/v1/students/${GOLDEN_IDS.PERSON_ENROLLED}/addresses/${addressId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(persisted.status()).toBe(200);
    await expect(persisted.json()).resolves.toMatchObject({ id: addressId, line1: marker, city: 'Testford' });

    // The browser uses the same real API and must still render the subject after mutation.
    await page.goto(`${ADMIN_URL}/students/${GOLDEN_IDS.PERSON_ENROLLED}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Keep repeated local/CI runs isolated while proving the delete path too.
    const cleanup = await request.delete(
      `${API_URL}/api/v1/students/${GOLDEN_IDS.PERSON_ENROLLED}/addresses/${addressId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(cleanup.status()).toBe(204);
  });
});
