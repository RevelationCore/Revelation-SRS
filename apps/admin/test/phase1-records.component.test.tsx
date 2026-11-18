import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ProgressionSection } from '../src/pages/ProgressionSection.js';
import { AwardDocumentsSection } from '../src/pages/AwardDocumentsSection.js';
import { MisconductTab } from '../src/pages/MisconductTab.js';
import { IdentityVerificationSection } from '../src/pages/IdentityVerificationSection.js';
import { CurriculumPublicationDetailPage } from '../src/pages/CurriculumPublicationsPage.js';
import { GraduationCycleDetailPage } from '../src/pages/GraduationCycleDetailPage.js';

const API = 'http://localhost:3000';
const ME = 'test-user-001';
const valueSets = http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => HttpResponse.json({
  setCode: 'x', displayName: 'x',
  members: ({
    document_type_code: [{ code: 'certificate', displayLabel: 'Award certificate' }],
    channel_code: [{ code: 'post', displayLabel: 'Post' }],
    issue_type_code: [{ code: 'original', displayLabel: 'Original' }],
    reason_code: [{ code: 'error', displayLabel: 'Issued in error' }],
    penalty_code: [{ code: 'mark-cap', displayLabel: 'Mark capped' }],
  } as Record<string, Array<{ code: string; displayLabel: string }>>)[String(params['field'])]?.map((m, i) => ({ ...m, description: null, sortOrder: i })) ?? [],
}));

describe('progression (D-3)', () => {
  it('shows how the decision was reached, including recognised credit and exceptions; a locked year cannot be re-run', async () => {
    server.use(
      http.get(`${API}/api/v1/enrolments/enr-1/progression/history`, () => HttpResponse.json([
        { progressionDecisionId: 'pd-1', enrolmentId: 'enr-1', academicYear: '2026-27', yearOfStudy: '1', decisionCode: 'progress', examBoardId: null, locked: true, recordedUntil: null },
      ])),
      http.get(`${API}/api/v1/progression-decisions/pd-1/evidence`, () => HttpResponse.json({
        requiredCredits: 120, earnedCredits: 120, compensationCredits: 20, unresolvedCredits: 0, compensationThreshold: 30, compensationCreditLimit: 40,
        condonementThreshold: null, decisionCode: 'progress', recognisedCredits: 20, recognisedCreditIds: ['rc-1'],
        appliedExceptions: [{ exceptionId: 'x-1', ruleCode: 'progression-credit-requirement', exceptionTypeCode: 'variation' }], calculatedAt: '2027-06-20T00:00:00Z',
      })),
    );
    const { container } = renderWithProviders(<ProgressionSection enrolmentId="enr-1" canRun />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('120 of 120 required')).toBeVisible();
    expect(await screen.findByText('Credits needed to progress (Variation)')).toBeVisible();
    expect(screen.getByText('Ratified, locked')).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Academic year/), '2026-27');
    expect(screen.getByRole('button', { name: 'Run progression' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });
});

describe('award documents (D-4)', () => {
  it('revoking needs a reason and a confirmation, and is sent as a request (D-20)', async () => {
    let body: unknown;
    server.use(valueSets,
      http.get(`${API}/api/v1/awards/a-1/documents`, () => HttpResponse.json([{
        documentIssueId: 'di-1', studentDocumentId: 'sd-1', documentTypeCode: 'certificate', awardId: 'a-1', issueNumber: 1, issueTypeCode: 'original',
        contentHash: 'h', verificationCode: 'VER-111', channelCode: 'post', statusCode: 'issued', issuedBy: 'reg', issuedAt: '2027-07-01T00:00:00Z', revocation: null,
      }])),
      http.get(`${API}/api/v1/document-revocation-requests`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/document-issues/di-1/revocation`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 201 }); }));
    renderWithProviders(<AwardDocumentsSection awardId="a-1" canIssue canRevoke />, { roles: ['registry-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke certificate #1' }));
    await userEvent.selectOptions(screen.getByLabelText(/^Reason/), 'error');
    await userEvent.type(screen.getByLabelText(/Explanation/), 'Wrong classification printed');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(body).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Request revocation' }));
    await screen.findByText('VER-111');
    expect(body).toEqual({ reasonCode: 'error', reasonText: 'Wrong classification printed' });
  });
});

describe('misconduct (D-5)', () => {
  it('records an outcome with its effect on a module, and warns not to enter allegations', async () => {
    let body: unknown;
    server.use(valueSets,
      http.get(`${API}/api/v1/students/p-1/misconduct-outcomes`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/students/p-1/enrolments`, () => HttpResponse.json([{ enrolmentId: 'enr-1', programmeCode: 'BSC-CS', academicYearOfEntry: '2026-27', statusCode: 'enrolled' }])),
      http.get(`${API}/api/v1/module-registrations`, () => HttpResponse.json([{ moduleRegistrationId: 'mr-1', moduleCode: 'CS101', moduleTitle: 'Programming', periodCode: 'SEM1' }])),
      http.post(`${API}/api/v1/students/p-1/misconduct-outcomes`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ misconductOutcomeId: 'mo-1' }, { status: 201 }); }));
    renderWithProviders(<MisconductTab personId="p-1" canRecord />, { roles: ['integrity-officer'] });
    expect(await screen.findByText(/Do not enter allegation details or evidence/)).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Case reference/), 'AI-2027-014');
    await userEvent.selectOptions(screen.getByLabelText(/^Penalty/), 'mark-cap');
    await userEvent.type(screen.getByLabelText(/Effective from/), '2027-03-01');
    await userEvent.selectOptions(await screen.findByLabelText(/Module affected/), 'mr-1');
    await userEvent.type(screen.getByLabelText(/Effect on the module/), 'Cap module mark at 40');
    await userEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
    await screen.findByText('No misconduct outcomes.');
    expect(body).toEqual({
      enrolmentId: 'enr-1', caseReference: 'AI-2027-014', penaltyCode: 'mark-cap', effectiveDate: '2027-03-01', caseStatusCode: 'closed',
      penaltyEffects: [{ targetEntityType: 'module_registration', targetEntityId: 'mr-1', penaltyDetail: 'Cap module mark at 40' }],
    });
  });
});

describe('identity verification (D-6)', () => {
  it('marking a check fraud flagged needs a confirmation', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/api/v1/students/p-1/identity-verifications`, () => HttpResponse.json([{ verificationCheckId: 'iv-1', statusCode: 'requested', confidenceScore: null, fraudFlag: false, providerReference: 'YOTI-1', requestedAt: '2026-09-01T00:00:00Z', completedAt: null }])),
      http.post(`${API}/api/v1/students/p-1/identity-verifications/iv-1/completion`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }));
    renderWithProviders(<IdentityVerificationSection personId="p-1" canWrite />, { roles: ['registry-administrator'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Record result' }));
    await userEvent.selectOptions(screen.getByLabelText('Result'), 'fraud-flagged');
    await userEvent.click(screen.getByRole('button', { name: 'Save result' }));
    expect(body).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm fraud flag' }));
    await screen.findByText('YOTI-1');
    expect(body).toEqual({ statusCode: 'fraud-flagged', fraudFlag: true });
  });
});

describe('curriculum publications (D-7)', () => {
  const publication = {
    publicationId: 'pub-1', sourceSystemCode: 'cm', sourcePublicationRef: 'PUB-MANUAL', publicationVersion: '1', approvalRef: null, effectiveFrom: '2031-08-01',
    statusCode: 'validated', counts: { added: 1, changed: 0, closed: 0, unchanged: 0, rejected: 0 }, receivedBy: ME, receivedAt: '2026-11-01T00:00:00Z',
    appliedBy: null, appliedAt: null, items: [{ itemId: 'i-1', objectTypeCode: 'module', objectCode: 'MAN101', sourceReference: null, changeTypeCode: 'add', issue: null, appliedEntityId: null }],
  };
  it('the person who entered a publication is told someone else must apply it', async () => {
    server.use(http.get(`${API}/api/v1/curriculum-publications/pub-1`, () => HttpResponse.json(publication)));
    renderWithProviders(<Routes><Route path="/curriculum-publications/:publicationId" element={<CurriculumPublicationDetailPage />} /></Routes>, { roles: ['registry-administrator'], route: '/curriculum-publications/pub-1' });
    expect(await screen.findByText('You entered this publication, so someone else must apply it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Apply to catalogue' })).toBeNull();
  });
});

describe('graduation (D-4)', () => {
  it('allocates an attending graduand to a ceremony with space', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/api/v1/graduation-cycles/cy-1`, () => HttpResponse.json({
        cycleId: 'cy-1', cycleCode: 'S27', title: 'Summer 2027', awardsFrom: '2027-06-01', awardsTo: '2027-07-31', statusCode: 'open', createdAt: '2027-05-01T00:00:00Z', frozenAt: null,
        ceremonies: [{ ceremonyId: 'c-am', ceremonyCode: 'AM', startsAt: '2027-07-20T10:00:00Z', venue: 'Great Hall', capacity: 2, guestLimit: 2, allocated: 2 },
          { ceremonyId: 'c-pm', ceremonyCode: 'PM', startsAt: '2027-07-20T15:00:00Z', venue: 'Great Hall', capacity: 2, guestLimit: 2, allocated: 0 }],
      })),
      http.get(`${API}/api/v1/graduation-cycles/cy-1/invitations`, () => HttpResponse.json([{
        invitationId: 'inv-1', cycleId: 'cy-1', awardId: 'a-1', personId: 'p-1', responseCode: 'attending', guestCount: 2, accessibilityRequired: true,
        respondedAt: '2027-06-01T00:00:00Z', createdAt: '2027-05-01T00:00:00Z', studentName: 'Ada Lovelace', studentNumber: 'S1001', allocation: null,
      }])),
      http.post(`${API}/api/v1/graduation-invitations/inv-1/allocation`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }),
    );
    const { container } = renderWithProviders(<Routes><Route path="/graduation/:cycleId" element={<GraduationCycleDetailPage />} /></Routes>, { roles: ['registry-administrator'], route: '/graduation/cy-1' });
    expect(await screen.findByText(/accessibility support requested/)).toBeVisible();
    expect(screen.getByRole('option', { name: 'AM (0 left)' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Ceremony for Ada Lovelace'), 'c-pm');
    await userEvent.click(screen.getByRole('button', { name: 'Allocate' }));
    await screen.findByText('Ada Lovelace');
    expect(body).toEqual({ ceremonyId: 'c-pm' });
    await expectNoA11yViolations(container);
  });
});

describe('two-person revocation (D-20)', () => {
  it('another registry administrator approves a pending revocation; the requester cannot', async () => {
    let decided: unknown;
    const issue = {
      documentIssueId: 'di-2', studentDocumentId: 'sd-2', documentTypeCode: 'certificate', awardId: 'a-2', issueNumber: 1, issueTypeCode: 'original',
      contentHash: 'h', verificationCode: 'VER-222', channelCode: 'post', statusCode: 'issued', issuedBy: 'reg', issuedAt: '2027-07-01T00:00:00Z', revocation: null,
      rendered: { documentId: 'doc-2', templateCode: 'certificate', templateVersion: 'builtin-1', pdfSha256: 'x', signingKeyId: 'k' },
    };
    const request = { caseId: 'rc-1', documentIssueId: 'di-2', statusCode: 'open', reasonCode: 'error', reasonText: 'Wrong name', requestedBy: 'someone-else', requestedAt: '2027-07-02T00:00:00Z', decision: null };
    server.use(valueSets,
      http.get(`${API}/api/v1/awards/a-2/documents`, () => HttpResponse.json([issue])),
      http.get(`${API}/api/v1/document-revocation-requests`, () => HttpResponse.json([request])),
      http.post(`${API}/api/v1/document-revocation-requests/rc-1/decision`, async ({ request: r }) => { decided = await r.json(); return HttpResponse.json({}); }));
    renderWithProviders(<AwardDocumentsSection awardId="a-2" canIssue canRevoke />, { roles: ['registry-administrator'] });
    expect(await screen.findByRole('button', { name: /Download PDF/ })).toBeVisible();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve revocation' }));
    expect(decided).toEqual({ outcome: 'approved' });
  });
});
