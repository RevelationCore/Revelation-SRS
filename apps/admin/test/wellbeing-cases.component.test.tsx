import { Route, Routes } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { WellbeingPage } from '../src/pages/WellbeingPage.js';
import { DisabilityCasesPage } from '../src/pages/DisabilityCasesPage.js';
import { DisabilityCaseDetailPage } from '../src/pages/DisabilityCaseDetailPage.js';
import { MentalHealthCaseDetailPage } from '../src/pages/MentalHealthCaseDetailPage.js';

const API = 'http://localhost:3000/bff/srs';
const WB = 'http://localhost:3000/bff/wellbeing';
const PERSON = 'person-001';

const CODES: Record<string, Array<{ code: string; displayLabel: string }>> = {
  'wellbeing.disability_support_case/status_code': [
    { code: 'assessment_pending', displayLabel: 'Assessment pending' }, { code: 'evidence_pending', displayLabel: 'Evidence pending' },
    { code: 'active', displayLabel: 'Active support' }, { code: 'rejected', displayLabel: 'Not eligible' }, { code: 'closed', displayLabel: 'Closed' },
  ],
  'wellbeing.disability_support_case/support_type_code': [{ code: 'dsa', displayLabel: "Disabled Students' Allowance" }],
  'wellbeing.disability_support_case/support_plan_status_code': [{ code: 'none', displayLabel: 'No plan' }],
  'wellbeing.evidence_reference/evidence_type_code': [{ code: 'medical', displayLabel: 'Medical evidence' }],
  'wellbeing.evidence_reference/status_code': [
    { code: 'pending', displayLabel: 'Awaited' }, { code: 'received', displayLabel: 'Received' },
    { code: 'verified', displayLabel: 'Verified' }, { code: 'rejected', displayLabel: 'Rejected' },
  ],
  'wellbeing.dsa_entitlement/entitlement_type_code': [{ code: 'equipment', displayLabel: 'Equipment' }],
  'wellbeing.mental_health_case/status_code': [
    { code: 'referral_received', displayLabel: 'Referral received' }, { code: 'assessment_pending', displayLabel: 'Assessment pending' },
    { code: 'active', displayLabel: 'Active' }, { code: 'closed', displayLabel: 'Closed' },
  ],
  'wellbeing.mental_health_case/risk_level_code': [
    { code: 'low', displayLabel: 'Low' }, { code: 'medium', displayLabel: 'Medium' }, { code: 'high', displayLabel: 'High' }, { code: 'crisis', displayLabel: 'Crisis' },
  ],
  'wellbeing.mental_health_case/presenting_concern_code': [{ code: 'anxiety', displayLabel: 'Anxiety' }],
  'wellbeing.intervention_plan/plan_type_code': [{ code: 'counselling', displayLabel: 'Counselling' }],
  'wellbeing.intervention_plan/status_code': [{ code: 'draft', displayLabel: 'Draft' }, { code: 'active', displayLabel: 'Active' }],
  'wellbeing.intervention_plan/session_frequency_code': [{ code: 'weekly', displayLabel: 'Weekly' }],
  'wellbeing.mh_session_note/session_type_code': [{ code: 'individual', displayLabel: 'Individual' }],
  'wellbeing.early_warning_alert/alert_type_code': [
    { code: 'ukvi-compliance', displayLabel: 'UKVI compliance' }, { code: 'tutor-concern', displayLabel: 'Tutor concern' }, { code: 'staff-referral', displayLabel: 'Staff referral' },
  ],
  'wellbeing.early_warning_alert/alert_source_code': [{ code: 'tutor', displayLabel: 'Tutor' }, { code: 'staff', displayLabel: 'Staff' }],
  'wellbeing.early_warning_alert/triage_status_code': [
    { code: 'pending', displayLabel: 'Awaiting triage' }, { code: 'reviewed', displayLabel: 'Reviewed' }, { code: 'assigned', displayLabel: 'Assigned to case' },
    { code: 'resolved', displayLabel: 'Resolved' }, { code: 'dismissed', displayLabel: 'Dismissed' },
  ],
};

function common() {
  return [
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => {
      const key = `${String(params['entity'])}/${String(params['field'])}`;
      return HttpResponse.json({ entityName: params['entity'], fieldName: params['field'], valueSetCode: key, members: CODES[key] ?? [] });
    }),
    http.get(`${API}/api/v1/students/${PERSON}`, () => HttpResponse.json({
      personId: PERSON, studentNumber: 'S1000001', hesaId: null, personStatusCode: 'student', sourceSystem: null, createdAt: '2025-09-01T00:00:00Z',
      identity: { legalFirstName: 'Nina', legalFamilyName: 'Rahman', preferredName: null },
    })),
  ];
}

const alert = {
  id: 'alert-001', personId: PERSON, alertTypeCode: 'tutor-concern', alertSourceCode: 'tutor', triageStatusCode: 'pending',
  assignedCaseId: null, alertPayload: { summary: 'Missed three tutorials' }, receivedAt: '2026-11-10T09:00:00Z',
  triagedBy: null, triagedAt: null, allowedNextStatuses: ['reviewed', 'assigned', 'resolved', 'dismissed'],
};

const mhCase = {
  id: 'mh-001', wellbeingCaseId: 'wc-002', personId: PERSON, presentingConcernCode: 'anxiety', statusCode: 'referral_received',
  riskLevelCode: 'high', consentGiven: false, consentDate: null, validFrom: '2026-11-01T00:00:00Z', recordedAt: '2026-11-01T00:00:00Z',
  allowedNextStatuses: ['assessment_pending', 'active', 'closed'],
};

const disabilityCase = {
  id: 'dc-001', wellbeingCaseId: 'wc-001', caseRef: 'WB-2026-ABC123', personId: PERSON, supportTypeCode: 'dsa', statusCode: 'assessment_pending',
  supportPlanStatusCode: 'none', dsaAwardRef: 'DSA-1', assignedAdvisorId: 'advisor-001', notes: null,
  validFrom: '2026-10-01T00:00:00Z', recordedAt: '2026-10-01T00:00:00Z', allowedNextStatuses: ['evidence_pending', 'active', 'rejected', 'closed'],
};

describe('wellbeing overview', () => {
  it('lists concerns awaiting triage with the student and summary, and assigns one to the student\'s case', async () => {
    let triaged: unknown = null;
    server.use(
      ...common(),
      http.get(`${WB}/api/v1/reports/wellbeing-summary`, () => HttpResponse.json({ openMentalHealthCases: 4, activeInterventionPlans: 2, pendingAlerts: 1 })),
      http.get(`${WB}/api/v1/early-warning-alerts`, () => HttpResponse.json({ items: triaged ? [] : [alert], total: triaged ? 0 : 1 })),
      http.get(`${WB}/api/v1/mental-health-cases`, () => HttpResponse.json({ items: [mhCase], total: 1 })),
      http.patch(`${WB}/api/v1/early-warning-alerts/alert-001/triage`, async ({ request }) => {
        triaged = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { container } = renderWithProviders(<WellbeingPage />, { roles: ['wellbeing-advisor'] });

    const row = (await screen.findByText('Nina Rahman (S1000001)')).closest('tr')!;
    expect(within(row).getByText('Tutor concern')).toBeInTheDocument();
    expect(within(row).getByText(/Missed three tutorials/)).toBeInTheDocument();
    expect(screen.getByText('Concerns awaiting triage').parentElement!.parentElement!).toHaveTextContent('Concerns awaiting triage1');
    await expectNoA11yViolations(container);

    await userEvent.selectOptions(within(row).getByLabelText('Triage outcome for this concern'), 'assigned');
    await within(row).findByLabelText('Mental health case');
    await userEvent.click(within(row).getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('No concerns in this queue.')).toBeInTheDocument();
    expect(triaged).toEqual({ triageStatusCode: 'assigned', assignedCaseId: 'mh-001' });
  });

  it('a registry administrator sees no concerns and cannot raise one', async () => {
    server.use(...common());
    renderWithProviders(<WellbeingPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByRole('link', { name: 'Disability support cases' })).toBeInTheDocument();
    expect(screen.queryByText('Early-warning concerns')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise a concern' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mental health cases' })).not.toBeInTheDocument();
  });
});

describe('disability support caseload and case', () => {
  it('lists open cases with the student and links to each case', async () => {
    server.use(...common(), http.get(`${WB}/api/v1/disability-cases/caseload`, () => HttpResponse.json({ items: [disabilityCase], total: 1 })));
    const { container } = renderWithProviders(<DisabilityCasesPage />, { roles: ['wellbeing-advisor'] });

    const row = (await screen.findByText('WB-2026-ABC123')).closest('tr')!;
    expect(await within(row).findByRole('link', { name: 'Nina Rahman (S1000001)' })).toHaveAttribute('href', `/students/${PERSON}`);
    expect(within(row).getByText('Assessment pending')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /View/ })).toHaveAttribute('href', '/wellbeing/disability-cases/dc-001');
    await expectNoA11yViolations(container);
  });

  it('offers only the statuses the lifecycle allows, and shows the service\'s refusal', async () => {
    let sent: unknown = null;
    server.use(
      ...common(),
      http.get(`${WB}/api/v1/disability-cases/dc-001`, () => HttpResponse.json({ ...disabilityCase, evidence: [], entitlements: [] })),
      http.patch(`${WB}/api/v1/disability-cases/dc-001/status`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ title: 'Status change not allowed', detail: "A disability case cannot move from 'assessment_pending' to 'rejected'" }, { status: 409 });
      }),
    );
    const { container } = renderWithProviders(
      <Routes><Route path="/wellbeing/disability-cases/:caseId" element={<DisabilityCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-advisor'], route: '/wellbeing/disability-cases/dc-001' },
    );

    const select = await screen.findByLabelText('Change status to');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Evidence pending', 'Active support', 'Not eligible', 'Closed']);
    await expectNoA11yViolations(container);

    await userEvent.selectOptions(select, 'rejected');
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("cannot move from 'assessment_pending' to 'rejected'");
    expect(sent).toEqual({ statusCode: 'rejected' });
  });

  it('a reader without disability:write sees the case but no controls', async () => {
    server.use(...common(), http.get(`${WB}/api/v1/disability-cases/dc-001`, () => HttpResponse.json({ ...disabilityCase, evidence: [], entitlements: [] })));
    renderWithProviders(
      <Routes><Route path="/wellbeing/disability-cases/:caseId" element={<DisabilityCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-auditor'], route: '/wellbeing/disability-cases/dc-001' },
    );
    expect(await screen.findByRole('heading', { name: 'Disability support case WB-2026-ABC123' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Change status to')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register evidence' })).not.toBeInTheDocument();
  });
});

describe('mental health case', () => {
  const detailHandlers = (notesRead: { count: number }) => [
    ...common(),
    http.get(`${WB}/api/v1/mental-health-cases/mh-001`, () => HttpResponse.json({ ...mhCase, interventionPlans: [] })),
    http.get(`${WB}/api/v1/early-warning-alerts`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${WB}/api/v1/mental-health-cases/mh-001/session-notes`, () => {
      notesRead.count += 1;
      return HttpResponse.json({ items: [{ id: 'n1', practitionerId: 'mh-001', sessionDate: '2026-11-05T00:00:00Z', sessionTypeCode: 'individual', content: 'Discussed sleep', createdAt: '2026-11-05T00:00:00Z' }], total: 1 });
    }),
  ];

  it('does not load session notes until the practitioner asks, then shows them', async () => {
    const notesRead = { count: 0 };
    server.use(...detailHandlers(notesRead));
    const { container } = renderWithProviders(
      <Routes><Route path="/wellbeing/mental-health-cases/:caseId" element={<MentalHealthCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-mental-health-advisor'], route: '/wellbeing/mental-health-cases/mh-001' },
    );

    await screen.findByText('High');
    expect(notesRead.count).toBe(0);
    await expectNoA11yViolations(container);

    await userEvent.click(screen.getByRole('button', { name: 'Show session notes' }));
    expect(await screen.findByText('Discussed sleep')).toBeInTheDocument();
    expect(notesRead.count).toBe(1);
    expect(screen.getByRole('button', { name: 'Add session note' })).toBeInTheDocument();
  });

  it('a wellbeing advisor manages the case but never sees the session notes card', async () => {
    server.use(...detailHandlers({ count: 0 }));
    renderWithProviders(
      <Routes><Route path="/wellbeing/mental-health-cases/:caseId" element={<MentalHealthCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-advisor'], route: '/wellbeing/mental-health-cases/mh-001' },
    );
    await screen.findByText('High');
    expect(screen.getByLabelText('Change status to')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record consent' })).toBeInTheDocument();
    expect(screen.queryByText('Session notes')).not.toBeInTheDocument();
  });
});
