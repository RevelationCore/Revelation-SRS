/**
 * Phase 5 D-38 to D-40: the portal serves applicants and research staff as
 * well as students. Each journey runs against mocked API routes.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { injectPortalAuthAs } from './helpers/auth.js';
import { mockApiRoutes } from './helpers/api-mocks.js';

const PORTAL = 'http://localhost:5174';

const application = (over: Record<string, unknown> = {}) => ({
  applicationId: 'app-1', channelCode: 'direct', cycle: '2027',
  programme: { programmeId: 'p-1', code: 'BSC-CS', title: 'BSc Computer Science' },
  intakeCode: '2027-09', modeOfStudyCode: 'full-time', status: 'offer-made', respondElsewhere: false,
  offer: {
    offerId: 'offer-1', version: 1, offerTypeCode: 'conditional', statusCode: 'made', expiresOn: '2027-06-30', responseCode: null, respondedAt: null,
    conditions: [{ conditionId: 'cond-1', description: 'AAB at A level', requiredValue: 'AAB', statusCode: 'pending', evidence: [] }],
  },
  confirmation: null, cas: null, withdrawnAt: null, ...over,
});

test.describe('Portal — applicants (D-39)', () => {
  test('an applicant sees only Applications, and accepts a direct offer', async ({ page }) => {
    await injectPortalAuthAs(page, ['applicant'], 'applicant-001');
    await mockApiRoutes(page);
    let accepted = false;
    await page.route('**/api/v1/applicants/applicant-001/applications', (r) => r.fulfill({ json: [application()] }));
    await page.route('**/api/v1/applicants/applicant-001/applications/app-1', (r) => r.fulfill({ json: application(accepted ? { status: 'offer-accepted', offer: { ...application().offer, statusCode: 'accepted', responseCode: 'accept' } } : {}) }));
    await page.route('**/api/v1/applicants/applicant-001/offers/offer-1/response', async (r) => {
      accepted = true;
      await r.fulfill({ json: application({ status: 'offer-accepted', offer: { ...application().offer, statusCode: 'accepted', responseCode: 'accept' } }) });
    });

    await page.goto(`${PORTAL}/dashboard`);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Applications', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'My modules', exact: true })).toHaveCount(0);

    await page.goto(`${PORTAL}/applications`);
    await page.getByRole('link', { name: 'BSc Computer Science' }).click();
    await page.getByRole('button', { name: 'Accept offer' }).click();
    await expect(page.getByText('You accepted this offer.')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('a UCAS applicant is sent to UCAS Hub', async ({ page }) => {
    await injectPortalAuthAs(page, ['applicant'], 'applicant-001');
    await mockApiRoutes(page);
    await page.route('**/api/v1/applicants/applicant-001/applications/app-1', (r) => r.fulfill({ json: application({ channelCode: 'ucas', respondElsewhere: true }) }));
    await page.goto(`${PORTAL}/applications/app-1`);
    await expect(page.getByText(/withdraw in UCAS Hub/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept offer' })).toHaveCount(0);
  });
});

test.describe('Portal — research staff (D-40)', () => {
  test('an examiner sees their examinations and the report form, with the co-examiner\'s report hidden', async ({ page }) => {
    await injectPortalAuthAs(page, ['pgr-examiner'], 'examiner-001');
    await mockApiRoutes(page);
    await page.route('**/api/v1/research-staff/examiner-001/pgr/assignments', (r) => r.fulfill({ json: {
      supervisees: [], panels: [],
      examinations: [{ examinationCaseId: 'ex-1', studentName: 'Taylor Candidate', statusCode: 'examiners-confirmed', examinerRoleCode: 'external', reportSubmitted: false }],
    } }));
    await page.route('**/api/v1/research-staff/examiner-001/pgr/examinations/ex-1', (r) => r.fulfill({ json: {
      examinationCaseId: 'ex-1', statusCode: 'examiners-confirmed', studentName: 'Taylor Candidate',
      thesis: { versionNumber: 1, formatCode: 'traditional', submittedAt: '2029-01-01T00:00:00Z', downloadable: true, storageRef: null },
      appointment: { appointmentId: 'ap-1', examinerRoleCode: 'external', confirmed: true, independenceChecked: true, conflictTypeCode: null },
      coExaminers: [{ name: 'Elena Vasquez', examinerRoleCode: 'internal' }], ownReport: null, reportExchange: 'after-all-submitted', otherReports: null,
    } }));

    await page.goto(`${PORTAL}/research`);
    await page.getByRole('link', { name: 'Taylor Candidate' }).click();
    await expect(page.getByText(/Co-examiners: Elena Vasquez/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit report' })).toBeVisible();
    await expect(page.getByText(/shown once the exchange rule allows/)).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});
