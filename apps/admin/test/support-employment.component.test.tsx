import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { SupportEmploymentTab } from '../src/pages/SupportEmploymentTab.js';

const API = 'http://localhost:3000';

const instalment = (over: Record<string, unknown>) => ({
  instalmentId: 'inst-1', awardId: 'award-1', paymentTypeCode: 'stipend', currencyCode: 'GBP', amountMinorUnits: 180000,
  periodStart: '2026-10-01', periodEnd: '2026-10-31', dueDate: '2026-10-25', statusCode: 'planned',
  approvedBy: null, approvedAt: null, paymentReference: null, paidOn: null, paidAmountMinorUnits: null, rejectionReason: null, createdBy: 'u1',
  ...over,
});

const award = (instalments: unknown[]) => ({
  awardId: 'award-1', personId: 'p1', enrolmentId: 'e1', awardTypeCode: 'studentship', awardReference: 'UKRI-123',
  funder: 'UKRI', startDate: '2026-10-01', endDate: '2029-09-30', statusCode: 'approved', createdBy: 'u1',
  approvedBy: 'u2', approvedAt: '2026-09-01T09:00:00.000Z', instalments,
});

const vs = (entityName: string, fieldName: string, members: string[]) =>
  http.get(`${API}/api/v1/fields/${entityName}/${fieldName}/value-set`, () => HttpResponse.json({
    entityName, fieldName, valueSetCode: 'x', members: members.map((code) => ({ code, displayLabel: code })),
  }));

function handlers(state: { awards: unknown[] }) {
  return [
    http.get(`${API}/api/v1/students/p1/support-awards`, () => HttpResponse.json(state.awards)),
    http.get(`${API}/api/v1/students/p1/enrolments`, () => HttpResponse.json([{ enrolmentId: 'e1' }])),
    http.get(`${API}/api/v1/students/p1/employment-links`, () => HttpResponse.json({
      links: [{ linkId: 'l1', personId: 'p1', hrEmploymentReference: 'HR-1', roleTypeCode: 'gta', startDate: '2026-10-01', endDate: null, weeklyHours: 8, moduleOfferingIds: [], supervisorAgreedAt: null, sourceCode: 'person' }],
      warnings: [{ ruleCode: 'studentship', message: 'University employment totals 8 h/week, over the 6 h/week studentship limit' }],
    })),
    http.get(`${API}/api/v1/work-limits`, () => HttpResponse.json([
      { ruleCode: 'student-visa-term-time', maxWeeklyHours: 20, description: 'Student visa, term time', isDefault: true },
      { ruleCode: 'studentship', maxWeeklyHours: 6, description: 'Studentship', isDefault: true },
    ])),
    vs('support_award', 'award_type_code', ['studentship', 'bursary']),
    vs('support_instalment', 'payment_type_code', ['stipend', 'gta-pay']),
    vs('student_employment_link', 'role_type_code', ['gta']),
  ];
}

describe('support and employment tab', () => {
  it('shows instalment payment states, employment and limit warnings', async () => {
    server.use(...handlers({ awards: [award([
      instalment({}),
      instalment({ instalmentId: 'inst-2', statusCode: 'approved' }),
      instalment({ instalmentId: 'inst-3', statusCode: 'paid', paymentReference: 'PAY-9', paidOn: '2026-10-25' }),
      instalment({ instalmentId: 'inst-4', statusCode: 'rejected', rejectionReason: 'Bank details missing' }),
    ])] }));
    const { container } = renderWithProviders(<SupportEmploymentTab personId="p1" />, { roles: ['finance-administrator', 'pgr-administrator'] });

    expect(await screen.findByText('UKRI-123')).toBeInTheDocument();
    expect(screen.getByText('Instructed; awaiting payroll')).toBeInTheDocument();
    expect(screen.getByText('PAY-9 on 2026-10-25')).toBeInTheDocument();
    expect(screen.getByText('Bank details missing')).toBeInTheDocument();
    expect(await screen.findByText(/over the 6 h\/week studentship limit/)).toBeInTheDocument();
    expect(screen.getByText('HR-1')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('approving an instalment instructs payroll and refreshes', async () => {
    const state = { awards: [award([instalment({})])] as unknown[] };
    let called = false;
    server.use(...handlers(state), http.post(`${API}/api/v1/support-instalments/inst-1/approve`, () => {
      called = true;
      state.awards = [award([instalment({ statusCode: 'approved' })])];
      return HttpResponse.json(instalment({ statusCode: 'approved' }));
    }));
    renderWithProviders(<SupportEmploymentTab personId="p1" />, { roles: ['finance-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Approve and instruct payroll' }));
    expect(await screen.findByText('Instructed; awaiting payroll')).toBeInTheDocument();
    expect(called).toBe(true);
  });

  it('does not offer teaching pay as a support payment type', async () => {
    server.use(...handlers({ awards: [award([])] }));
    renderWithProviders(<SupportEmploymentTab personId="p1" />, { roles: ['pgr-administrator'] });

    const select = await screen.findByRole('combobox', { name: /Payment type/ });
    await within(select).findByRole('option', { name: 'stipend' });
    expect(within(select).queryByRole('option', { name: 'gta-pay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and instruct payroll' })).not.toBeInTheDocument();
  });

  it('a supervisor no longer reads support or employment in the admin app (Phase 5 D-40)', async () => {
    server.use(...handlers({ awards: [] }));
    renderWithProviders(<SupportEmploymentTab personId="p1" />, { roles: ['research-supervisor'] });

    // Supervisors see their own supervisees through the portal's Research pages instead.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('HR-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Student support')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
