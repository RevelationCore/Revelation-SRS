import { expect, test } from '@playwright/test';

import { injectAdminAuth } from './helpers/auth.js';

const ADMIN = 'http://localhost:5173';
const decision = {
  decisionId: 'a0000000-0000-4000-8000-000000000001',
  enrolmentId: '20000001-0001-4000-8000-000000000001',
  evidenceSnapshotId: 'b0000000-0000-4000-8000-000000000001',
  outcomeCode: 'report',
  rationaleCode: 'sustained-non-engagement',
  guidanceVersion: 'student-sponsor-guidance-2027.1',
  statusCode: 'pending-authorisation',
  decidedAt: '2027-10-21T09:00:00Z',
  decidedBy: 'compliance-officer',
  authorisedAt: null,
  authorisedBy: null,
  externalReportId: null,
};

test.beforeEach(async ({ page }) => {
  await injectAdminAuth(page);
  await page.route('**/api/v1/regulatory/ukvi/cas-requests', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/regulatory/ukvi/compliance-alerts', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/regulatory/ukvi/sponsor-decisions', route => route.fulfill({ json: [decision] }));
  await page.route('**/api/v1/regulatory/ukvi/operations/status', route => route.fulfill({
    json: { reconciliationRequired: 1, pendingAuthorisation: 1, failedExchanges: 0 },
  }));
});

test('shows the governed sponsor-decision and operational boundary', async ({ page }) => {
  await page.goto(`${ADMIN}/regulatory/ukvi`);
  await page.getByRole('button', { name: 'Sponsor decisions' }).click();
  await expect(page.getByText(/never automatically changes academic status/i)).toBeVisible();
  await expect(page.getByText('sustained-non-engagement')).toBeVisible();
  await expect(page.getByText('Evidence reconciliation').locator('..')).toContainText('1');
  await expect(page.getByRole('button', { name: 'Authorise decision' })).toBeVisible();
});

