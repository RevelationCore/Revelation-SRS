/**
 * Phase 5 admin journeys against mocked API routes: a board decides on the
 * data pack it is shown (D-36), an EC outcome is decided by someone else
 * (D-41), and bank holidays are listed on the working-day calendar (D-42).
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { injectAdminAuth } from './helpers/auth.js';
import { mockApiRoutes } from './helpers/api-mocks.js';

const ADMIN = 'http://localhost:5173';
const HASH = `sha256:${'a'.repeat(64)}`;

async function axe(page: Page) {
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
}

test('a board decides on the pack it is shown, after verifying it (D-36)', async ({ page }) => {
  await injectAdminAuth(page, ['exam-board-chair', 'registry-administrator']);
  await mockApiRoutes(page);
  let decision: unknown = null;
  await page.route('**/api/v1/exam-boards/test-exam-board-001/data-pack', (r) => r.fulfill({ json: {
    dataPackId: 'pack-1', examBoardId: 'test-exam-board-001', packVersion: 2, supersededById: null, sourceTransactionTime: '2026-06-01T09:00:00Z',
    candidateCount: 12, generatedAt: '2026-06-01T09:00:00Z', generatedBy: 'staff', packHash: HASH, ruleManifestRef: `sha256:${'b'.repeat(64)}`,
  } }));
  await page.route('**/api/v1/exam-boards/test-exam-board-001/data-packs/pack-1/verification', (r) => r.fulfill({ json: {
    dataPackId: 'pack-1', storedHash: HASH, recomputedHash: HASH, status: 'verified', superseded: false, supersededById: null,
    ruleManifestRef: `sha256:${'b'.repeat(64)}`, manifestHashMatches: true, drift: [{ versionId: 'v-1', ruleTypeCode: 'pass-mark' }], decisions: [], ratifiedAgainst: null,
  } }));
  await page.route('**/api/v1/exam-boards/test-exam-board-001/decisions', async (r) => { decision = r.request().postDataJSON(); await r.fulfill({ json: { decisionId: 'decision-1' } }); });

  await page.goto(`${ADMIN}/exam-boards/test-exam-board-001`);
  await page.getByRole('tab', { name: 'Board authority' }).click();
  await expect(page.getByText(/Data pack v2, 12 candidates/)).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('The stored pack matches its hash.')).toBeVisible();
  await expect(page.getByText(/no longer in force \(pass-mark\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Record decision on this pack' }).click();
  await expect(page.getByText('decision-1')).toBeVisible();
  expect(decision).toMatchObject({ dataPackId: 'pack-1', packHash: HASH, decisionTypeCode: 'ratify' });
  await axe(page);
});

test('an EC outcome is decided by someone other than its proposer (D-41)', async ({ page }) => {
  // ADR-028 (BL-169): deciding EC claims is the ec-decision-maker's alone.
  await injectAdminAuth(page, ['ec-decision-maker']);
  await mockApiRoutes(page);
  let decided = false;
  await page.route('**/api/v1/ec-determinations?statusCode=proposed', (r) => r.fulfill({ json: decided ? [] : [{
    id: 'det-1', exceptionalCircumstancesId: 'ec-1', proposedOutcomeCode: 'defer', reason: 'Illness during the exam period', statusCode: 'proposed',
    proposedBy: 'registry-1', proposedAt: '2026-06-01T09:00:00Z', recordedBy: 'registry-1', workflowInstanceId: 'wf-1', decidedBy: null, decidedAt: null, decisionReason: null,
  }] }));
  await page.route('**/api/v1/ec-determinations/det-1/decision', async (r) => { decided = true; await r.fulfill({ json: { id: 'det-1', statusCode: 'upheld' } }); });

  await page.goto(`${ADMIN}/ec-determinations`);
  await expect(page.getByText('Illness during the exam period')).toBeVisible();
  await page.getByRole('button', { name: 'Uphold', exact: true }).click();
  await expect(page.getByText('Nothing awaits a decision.')).toBeVisible();
  await axe(page);
});

test('the working-day calendar lists bank holidays and closure days (D-42)', async ({ page }) => {
  await injectAdminAuth(page, ['tenant-administrator']);
  await mockApiRoutes(page);
  await page.route('**/api/v1/calendar/non-working-days?**', (r) => r.fulfill({ json: [
    { id: 'd-1', date: '2027-05-03', divisionCode: 'england-and-wales', description: 'Early May bank holiday', source: 'gov-uk-json', createdBy: 'admin', createdAt: '2026-11-18T00:00:00Z' },
    { id: 'd-2', date: '2027-12-29', divisionCode: 'tenant', description: 'Winter closure', source: 'manual', createdBy: 'admin', createdAt: '2026-11-18T00:00:00Z' },
  ] }));
  await page.goto(`${ADMIN}/tenant-admin/working-days`);
  await expect(page.getByRole('cell', { name: 'Early May bank holiday' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Winter closure' })).toBeVisible();
  await expect(page.getByLabel('GOV.UK bank holidays file')).toBeVisible();
  await axe(page);
});
