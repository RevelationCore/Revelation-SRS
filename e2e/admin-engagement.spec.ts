import { expect, test } from '@playwright/test';

import { injectAdminAuth } from './helpers/auth.js';

const ADMIN = 'http://localhost:5173';
const alert = {
  alertId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  personId: '10000001-0001-4000-8000-000000000003',
  enrolmentId: '20000001-0001-4000-8000-000000000003',
  policyVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  evidenceWindowFrom: '2025-10-01T00:00:00Z', evidenceWindowTo: '2025-10-10T00:00:00Z',
  evidenceSnapshot: { expectedEventCount: 3, absenceCount: 2, absenceRate: 0.67, unsafeEvidenceCount: 1 },
  explanation: { policyCode: 'DEMO-ENGAGEMENT', policyVersion: 1, automatedAdverseActionPermitted: false },
  severityCode: 'medium', statusCode: 'suspended-reconciliation', reevaluationRequired: true,
  recordedAt: '2025-10-10T10:00:00Z',
};

test.beforeEach(async ({ page }) => {
  await injectAdminAuth(page);
  await page.route('**/api/v1/engagement/events', route => route.fulfill({ json: [{
    expectedEventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', personId: alert.personId,
    enrolmentId: alert.enrolmentId, activityTypeCode: 'lecture', activityReference: 'DEMO-CS101',
    eventModeCode: 'in-person', scheduledFrom: '2025-10-06T09:00:00Z',
    statusCode: 'expected', sourceSystemCode: 'demo-timetable',
  }] }));
  await page.route('**/api/v1/engagement/alerts', route => route.fulfill({ json: [alert] }));
  await page.route('**/api/v1/engagement/policies', route => route.fulfill({ json: [{
    policyVersionId: alert.policyVersionId, policyCode: 'DEMO-ENGAGEMENT', versionNumber: 1,
    displayName: 'DEMO - Academic engagement review', statusCode: 'approved',
    validFrom: '2025-09-01T00:00:00Z', validTo: null, alertRules: {}, evidenceWindow: {},
  }] }));
});

test('shows an explainable alert and reconciliation boundary', async ({ page }) => {
  await page.goto(`${ADMIN}/engagement`);
  await expect(page.getByRole('heading', { name: 'Academic engagement' })).toBeVisible();
  await expect(page.getByText('Evidence needs reconciliation')).toBeVisible();
  await expect(page.getByText('Unsafe evidence').locator('..')).toContainText('1');
  await expect(page.getByRole('button', { name: 'Open intervention' })).toHaveCount(0);
});

test('switches to the evidence worklist using accessible tabs', async ({ page }) => {
  await page.goto(`${ADMIN}/engagement`);
  await page.getByRole('tab', { name: /Evidence worklist/ }).click();
  await expect(page.getByText('DEMO-CS101')).toBeVisible();
  await expect(page.getByText('demo-timetable')).toBeVisible();
});

test('shows approved policy versions to tenant administrators', async ({ page }) => {
  await page.goto(`${ADMIN}/engagement`);
  await page.getByRole('tab', { name: /Policies/ }).click();
  await expect(page.getByText('DEMO - Academic engagement review')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New policy version' })).toBeVisible();
});
