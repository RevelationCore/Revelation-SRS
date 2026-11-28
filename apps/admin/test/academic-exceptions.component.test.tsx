import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AcademicExceptionsTab } from '../src/pages/AcademicExceptionsTab.js';

const API = 'http://localhost:3000/bff/srs';
const ME = 'test-user-001';

const VALUE_SETS: Record<string, Array<{ code: string; displayLabel: string }>> = {
  recognition_type_code: [{ code: 'rpcl', displayLabel: 'Prior certificated learning' }, { code: 'exemption', displayLabel: 'Module exemption' }],
  exception_type_code: [{ code: 'waiver', displayLabel: 'Waiver' }, { code: 'variation', displayLabel: 'Variation' }],
};

const credit = (overrides: Record<string, unknown> = {}) => ({
  recognisedCreditId: 'credit-1', enrolmentId: 'enr-1', recognitionTypeCode: 'rpcl', sourceDescription: 'HND Engineering 2025',
  creditValue: 120, fheqLevel: 4, moduleId: null, statusCaseId: null, evidenceRef: null, academicYear: '2027-28', statusCode: 'proposed',
  createdBy: 'proposer-1', createdAt: '2026-11-01T10:00:00Z', decidedBy: null, decidedAt: null, decisionReason: null, ...overrides,
});

const exception = (overrides: Record<string, unknown> = {}) => ({
  ruleExceptionId: 'exc-1', enrolmentId: 'enr-1', programmeRuleSetId: null, ruleCode: 'max-credits-per-period', exceptionTypeCode: 'variation',
  description: 'Allow 140 credits', validFrom: '2027-09-01', validTo: null, authorityRef: 'Board 2027/3', variationValue: { maxCredits: 140 },
  statusCode: 'approved', createdBy: 'proposer-1', createdAt: '2026-11-01T10:00:00Z', decidedBy: 'approver-1', decidedAt: null, decisionReason: 'Justified', ...overrides,
});

function handlers(credits: unknown[], exceptions: unknown[]) {
  return [
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => HttpResponse.json({
      setCode: String(params['field']), displayName: 'Set',
      members: (VALUE_SETS[String(params['field'])] ?? []).map((m, i) => ({ ...m, description: null, sortOrder: i })),
    })),
    http.get(`${API}/api/v1/modules`, () => HttpResponse.json([{ moduleId: 'mod-1', code: 'MATH101', title: 'Maths', creditValue: 20 }])),
    http.get(`${API}/api/v1/students/:personId/enrolments`, () => HttpResponse.json([{
      enrolmentId: 'enr-1', personId: 'person-1', programmeId: 'prog-1', programmeCode: 'BSC-ENG', programmeName: 'BSc Engineering',
      statusCode: 'enrolled', modeOfStudyCode: 'full-time', attendanceTypeCode: null, academicYearOfEntry: '2026-27', startDate: null, expectedEndDate: null, actualEndDate: null,
    }])),
    http.get(`${API}/api/v1/enrolments/enr-1/recognised-credits`, () => HttpResponse.json({ credits, approvedCreditTotal: 0 })),
    http.get(`${API}/api/v1/enrolments/enr-1/rule-exceptions`, () => HttpResponse.json(exceptions)),
  ];
}

const renderTab = () => renderWithProviders(
  <AcademicExceptionsTab personId="person-1" canPropose canApprove />, { roles: ['registry-administrator'] },
);

describe('recognised credit and rule exceptions on the student record', () => {
  it('lists credit and exceptions; the proposer cannot decide their own proposal', async () => {
    server.use(...handlers([credit({ createdBy: ME })], [exception()]));
    const { container } = renderTab();
    expect(await screen.findByText('HND Engineering 2025')).toBeVisible();
    expect(screen.getByText('You proposed this; someone else must decide it.')).toBeVisible();
    expect(screen.getByText('Variation: maxCredits 140')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('another approver approves proposed credit with a reason', async () => {
    let body: unknown;
    server.use(
      ...handlers([credit()], []),
      http.post(`${API}/api/v1/recognised-credits/credit-1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json(credit({ statusCode: 'approved' })); }),
    );
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Decide credit HND Engineering 2025' }));
    await userEvent.type(screen.getByLabelText(/Reason/), 'Mapped to year 1');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('HND Engineering 2025');
    expect(body).toEqual({ decisionCode: 'approved', reason: 'Mapped to year 1' });
  });

  it('proposes a variation with the replacement value for the chosen rule', async () => {
    let body: unknown;
    server.use(
      ...handlers([], []),
      http.post(`${API}/api/v1/enrolments/enr-1/rule-exceptions`, async ({ request }) => { body = await request.json(); return HttpResponse.json(exception({ statusCode: 'proposed' }), { status: 201 }); }),
    );
    renderTab();
    await userEvent.selectOptions(await screen.findByLabelText(/^Rule/), 'progression-credit-requirement');
    await userEvent.selectOptions(screen.getByLabelText(/^Exception/), 'variation');
    const propose = screen.getByRole('button', { name: 'Propose exception' });
    expect(propose).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Required credits'), '40');
    await userEvent.type(screen.getByLabelText(/^Description/), 'Complete the deferred module');
    await userEvent.type(screen.getByLabelText(/In force from/), '2027-09-01');
    await userEvent.click(propose);
    await screen.findByText('No rule exceptions.');
    expect(body).toEqual({
      ruleCode: 'progression-credit-requirement', exceptionTypeCode: 'variation', description: 'Complete the deferred module',
      validFrom: '2027-09-01', variationValue: { requiredCredits: 40 },
    });
  });

  it('an exemption needs a module, and an API refusal is shown', async () => {
    server.use(
      ...handlers([], []),
      http.post(`${API}/api/v1/enrolments/enr-1/recognised-credits`, () => HttpResponse.json(
        { type: 'about:blank', title: 'Unprocessable', status: 422, detail: 'Credit academicYear must look like 2027-28' }, { status: 422 },
      )),
    );
    renderTab();
    await userEvent.selectOptions(await screen.findByLabelText(/^Recognition/), 'exemption');
    await userEvent.type(screen.getByLabelText(/^Source/), 'A-level Maths');
    await userEvent.type(screen.getByLabelText(/^Credits/), '20');
    const propose = screen.getByRole('button', { name: 'Propose credit' });
    expect(propose).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/Exempt module/), 'mod-1');
    await userEvent.type(screen.getByLabelText(/Counts towards year/), '2027');
    await userEvent.click(propose);
    expect(await screen.findByText('Credit academicYear must look like 2027-28')).toBeVisible();
  });

  it('revokes an approved exception with a reason', async () => {
    let body: unknown;
    server.use(
      ...handlers([], [exception()]),
      http.post(`${API}/api/v1/rule-exceptions/exc-1/revocation`, async ({ request }) => { body = await request.json(); return HttpResponse.json(exception({ statusCode: 'revoked' })); }),
    );
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke exception to Maximum credits per period' }));
    await userEvent.type(screen.getByLabelText(/Reason for revoking/), 'Changed route');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await screen.findByText('Allow 140 credits');
    expect(body).toEqual({ reason: 'Changed route' });
  });
});
