import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { RightToStudySection } from '../src/pages/RightToStudySection.js';
import { FinancialRegistrationSection } from '../src/pages/FinancialRegistrationSection.js';

const API = 'http://localhost:3000';
// Only these fields; every other field falls through to the real value sets.
const OVERRIDES: Record<string, Array<{ code: string; displayLabel: string }>> = {
  basis_code: [{ code: 'british-irish', displayLabel: 'British or Irish citizen' }],
  method_code: [{ code: 'identity-passport', displayLabel: 'Passport from the identity check' }],
  hold_reason_code: [{ code: 'tuition-unpaid', displayLabel: 'Tuition fees unpaid' }],
  fee_status_code: [{ code: 'home', displayLabel: 'Home' }, { code: 'overseas', displayLabel: 'Overseas' }],
};
const valueSets = http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => {
  const members = OVERRIDES[String(params['field'])];
  return members ? HttpResponse.json({ setCode: 'x', displayName: 'x', members: members.map((m, i) => ({ ...m, description: null, sortOrder: i })) }) : undefined;
});

describe('right to study on the student record (D-17)', () => {
  it('records an eligible check with its basis and method', async () => {
    let body: unknown;
    server.use(
      valueSets,
      http.get(`${API}/api/v1/students/p-1/right-to-study`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/students/p-1/right-to-study`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 201 }); }),
    );
    const { container } = renderWithProviders(<RightToStudySection personId="p-1" />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('No right-to-study check recorded.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Record a check' }));
    await userEvent.selectOptions(await screen.findByLabelText(/^Basis/), 'british-irish');
    await userEvent.selectOptions(screen.getByLabelText(/^Method/), 'identity-passport');
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Record check' }));
    await screen.findByText('No right-to-study check recorded.');
    expect(body).toEqual({ basisCode: 'british-irish', methodCode: 'identity-passport', outcomeCode: 'eligible' });
  });

  it('a regulatory officer decides a referred check with a reason', async () => {
    let body: unknown;
    server.use(
      valueSets,
      http.get(`${API}/api/v1/students/p-1/right-to-study`, () => HttpResponse.json([{
        checkId: 'c-1', personId: 'p-1', enrolmentId: null, casCaseId: null, basisCode: 'british-irish', methodCode: 'identity-passport', outcomeCode: 'referred',
        checkedBy: 'reg-1', checkedAt: '2027-06-01T00:00:00Z', permissionExpiresOn: null, ukEntryDate: null, restrictionCode: null, evidenceRef: null, recheckDueOn: null, shareCodeSubmitted: false, note: null,
      }])),
      http.post(`${API}/api/v1/right-to-study/c-1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }),
    );
    renderWithProviders(<RightToStudySection personId="p-1" />, { roles: ['regulatory-officer'] });
    expect(await screen.findByText('Referred to a regulatory officer')).toBeVisible();
    await userEvent.type(screen.getByLabelText(/Reason for the decision/), 'Passport checked again');
    await userEvent.click(screen.getByRole('button', { name: 'Eligible' }));
    expect(body).toEqual({ outcomeCode: 'eligible', note: 'Passport checked again' });
  });
});

describe('financial registration on the student record (D-18)', () => {
  it('puts a year on hold with a reason', async () => {
    let body: unknown;
    server.use(
      valueSets,
      http.get(`${API}/api/v1/enrolments/e-1/financial-registration`, () => HttpResponse.json([{
        liabilityId: 'l-1', enrolmentId: 'e-1', personId: 'p-1', academicYear: '2027-28', feeBandCode: null, feeStatusCode: 'home', financialStatusCode: 'pending',
        payerArrangementCode: null, financeReference: null, holdReasonCode: null, statusSourceCode: null, statusUpdatedBy: null, statusUpdatedAt: null, financiallyRegistered: false, subject: null,
      }])),
      http.get(`${API}/api/v1/fee-status-reassessments`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/fee-liabilities/l-1/financial-status`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }),
    );
    const { container } = renderWithProviders(<FinancialRegistrationSection enrolmentId="e-1" feeStatusCode="home" />, { roles: ['finance-administrator'] });
    expect(await screen.findByText('Not yet arranged')).toBeVisible();
    expect(screen.getByText(/Fee status: Home/)).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: /Change/ }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'hold');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Hold reason'), 'tuition-unpaid');
    await userEvent.click(save);
    expect(body).toEqual({ financialStatusCode: 'hold', holdReasonCode: 'tuition-unpaid' });
  });
});
