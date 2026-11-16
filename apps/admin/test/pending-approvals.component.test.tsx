import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { PendingApprovalsPage } from '../src/pages/PendingApprovalsPage.js';

const API = 'http://localhost:3000';
const ME = 'test-user-001';
const subject = { personId: 'person-1', studentNumber: 'S1001', studentName: 'Ada Lovelace', programmeCode: 'BSC-CS', programmeTitle: 'BSc CS' };

const credit = (overrides: Record<string, unknown> = {}) => ({
  recognisedCreditId: 'credit-1', enrolmentId: 'enr-1', recognitionTypeCode: 'rpcl', sourceDescription: 'HND Engineering 2025',
  creditValue: 120, fheqLevel: 4, moduleId: null, statusCaseId: null, evidenceRef: null, academicYear: '2027-28', statusCode: 'proposed',
  createdBy: 'proposer-1', createdAt: '2026-11-01T10:00:00Z', decidedBy: null, decidedAt: null, decisionReason: null, subject, ...overrides,
});
const exception = (overrides: Record<string, unknown> = {}) => ({
  ruleExceptionId: 'exc-1', enrolmentId: 'enr-1', programmeRuleSetId: null, ruleCode: 'progression-credit-requirement', exceptionTypeCode: 'variation',
  description: 'Deferred module', validFrom: '2027-09-01', validTo: null, authorityRef: 'Board 2027/3', variationValue: { requiredCredits: 40 },
  statusCode: 'proposed', createdBy: ME, createdAt: '2026-11-02T10:00:00Z', decidedBy: null, decidedAt: null, decisionReason: null, subject, ...overrides,
});

const noBindingChanges = () => http.get(`${API}/api/v1/curriculum-binding-changes`, () => HttpResponse.json([]));

describe('credit & exception approvals worklist', () => {
  it('a programme approver sees every pending proposal with its student, without a student-record link', async () => {
    server.use(noBindingChanges(), http.get(`${API}/api/v1/academic-exceptions/pending`, () => HttpResponse.json({ credits: [credit()], exceptions: [exception()] })));
    const { container } = renderWithProviders(<PendingApprovalsPage />, { roles: ['programme-approver'] });
    expect(await screen.findByText('HND Engineering 2025')).toBeVisible();
    expect(screen.getAllByText('Ada Lovelace')[0]).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Ada Lovelace' })).toBeNull();
    expect(screen.getByText('Variation: requiredCredits 40')).toBeVisible();
    // The exception was proposed by this user.
    expect(screen.getByText('You proposed this; someone else must decide it.')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('a registry administrator can open the student record', async () => {
    server.use(noBindingChanges(), http.get(`${API}/api/v1/academic-exceptions/pending`, () => HttpResponse.json({ credits: [credit()], exceptions: [] })));
    renderWithProviders(<PendingApprovalsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/students/person-1');
    expect(screen.getByText('No rule exception awaits a decision.')).toBeVisible();
  });

  it('approving removes the proposal from the worklist', async () => {
    let body: unknown;
    server.use(
      noBindingChanges(),
      http.get(`${API}/api/v1/academic-exceptions/pending`, () => HttpResponse.json({ credits: [credit()], exceptions: [] }), { once: true }),
      http.get(`${API}/api/v1/academic-exceptions/pending`, () => HttpResponse.json({ credits: [], exceptions: [] })),
      http.post(`${API}/api/v1/recognised-credits/credit-1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json(credit({ statusCode: 'approved' })); }),
    );
    renderWithProviders(<PendingApprovalsPage />, { roles: ['programme-approver'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Decide credit HND Engineering 2025 for Ada Lovelace' }));
    await userEvent.type(screen.getByLabelText(/Reason/), 'Mapped to year 1');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('No recognised credit awaits a decision.')).toBeVisible();
    expect(body).toEqual({ decisionCode: 'approved', reason: 'Mapped to year 1' });
  });

  it('a refused decision is shown and the proposal stays', async () => {
    server.use(
      noBindingChanges(),
      http.get(`${API}/api/v1/academic-exceptions/pending`, () => HttpResponse.json({ credits: [credit()], exceptions: [] })),
      http.post(`${API}/api/v1/recognised-credits/credit-1/decision`, () => HttpResponse.json(
        { type: 'about:blank', title: 'Conflict', status: 409, detail: 'This record is already approved' }, { status: 409 },
      )),
    );
    renderWithProviders(<PendingApprovalsPage />, { roles: ['programme-approver'] });
    await userEvent.click(await screen.findByRole('button', { name: /^Decide credit/ }));
    await userEvent.type(screen.getByLabelText(/Reason/), 'Ok');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('This record is already approved')).toBeVisible();
    expect(screen.getByText('HND Engineering 2025')).toBeVisible();
  });

  it('a programme approver decides a rule-set change (D-11)', async () => {
    let body: unknown;
    const change = {
      curriculumBindingChangeId: 'bc-1', enrolmentId: 'enr-1', programmeRouteId: null, programmeRuleSetId: 'rs-2', changeReasonCode: 'pathway-change',
      reason: 'Moved to the data pathway', effectiveDate: '2027-10-01', statusCode: 'proposed', proposedBy: 'registry-1', proposedAt: '2026-11-01T00:00:00Z',
      decidedBy: null, decidedAt: null, decisionReason: null, subject,
    };
    server.use(
      http.get(`${API}/api/v1/academic-exceptions/pending`, () => HttpResponse.json({ credits: [], exceptions: [] })),
      http.get(`${API}/api/v1/curriculum-binding-changes`, () => HttpResponse.json([change]), { once: true }),
      http.get(`${API}/api/v1/curriculum-binding-changes`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/curriculum-binding-changes/bc-1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...change, statusCode: 'approved' }); }),
    );
    renderWithProviders(<PendingApprovalsPage />, { roles: ['programme-approver'] });
    expect(await screen.findByText('Moved to the data pathway')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Decide rule-set change for Ada Lovelace' }));
    await userEvent.type(screen.getByLabelText(/Reason/), 'Pathway confirmed');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('No rule-set change awaits a decision.')).toBeVisible();
    expect(body).toEqual({ decisionCode: 'approved', reason: 'Pathway confirmed' });
  });
});
