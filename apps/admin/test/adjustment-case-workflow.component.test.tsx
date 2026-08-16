import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AdjustmentCasesPage } from '../src/pages/AdjustmentCasesPage.js';
import { AdjustmentCaseDetailPage } from '../src/pages/AdjustmentCaseDetailPage.js';

const WELLBEING_API = 'http://localhost:3002';
const CASE_ID = 'case-001';

const queuedCase = {
  id: CASE_ID,
  tenantId: 'test-tenant-001',
  wellbeingCaseId: 'wc-001',
  disabilitySupportCaseId: 'dsc-001',
  personId: 'person-001',
  adjustmentTypeCode: 'exam-time',
  statusCode: 'referral_received',
  recommendedAdjustment: null,
  rationale: 'Medical evidence supports additional time.',
  dsaEntitlementId: null,
  srsApplicationRef: null,
  actorId: 'advisor-001',
  validFrom: '2026-06-01T00:00:00Z',
};

const caseDetail = {
  ...queuedCase,
  assessments: [],
  panelDecision: null,
  srsHandoffStatus: null,
  evidence: [],
};

function baseHandlers() {
  return [
    http.get(`${WELLBEING_API}/api/v1/adjustment-cases`, () => HttpResponse.json({ items: [queuedCase], total: 1 })),
    http.get(`${WELLBEING_API}/api/v1/adjustment-cases/${CASE_ID}`, () => HttpResponse.json(caseDetail)),
  ];
}

describe('adjustment case workflow', () => {
  it('the queue lists a case and links to its detail page', async () => {
    server.use(...baseHandlers());
    const { container } = renderWithProviders(<AdjustmentCasesPage />, { roles: ['wellbeing-advisor'] });

    await screen.findByText('person-001');
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', `/governance/adjustment-cases/${CASE_ID}`);

    await expectNoA11yViolations(container);
  });

  it('the detail page shows case information and the referral state action', async () => {
    server.use(...baseHandlers());
    const { container } = renderWithProviders(
      <Routes><Route path="/governance/adjustment-cases/:caseId" element={<AdjustmentCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-advisor'], route: `/governance/adjustment-cases/${CASE_ID}` },
    );

    await screen.findByRole('heading', { name: /exam time adjustment/i });
    expect(screen.getByText('person-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start assessment' })).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it('starting an assessment calls the action endpoint and refreshes the case', async () => {
    let startAssessmentCalled = false;
    server.use(
      http.get(`${WELLBEING_API}/api/v1/adjustment-cases/${CASE_ID}`, () =>
        HttpResponse.json(startAssessmentCalled ? { ...caseDetail, statusCode: 'under_assessment' } : caseDetail)),
      http.post(`${WELLBEING_API}/api/v1/adjustment-cases/${CASE_ID}/start-assessment`, () => {
        startAssessmentCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(
      <Routes><Route path="/governance/adjustment-cases/:caseId" element={<AdjustmentCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-advisor'], route: `/governance/adjustment-cases/${CASE_ID}` },
    );

    await screen.findByRole('button', { name: 'Start assessment' });
    await userEvent.click(screen.getByRole('button', { name: 'Start assessment' }));

    await screen.findByText('Under assessment');
    expect(startAssessmentCalled).toBe(true);
  });

  it('a role without adjustment-case:assess does not see the start-assessment action', async () => {
    server.use(...baseHandlers());
    renderWithProviders(
      <Routes><Route path="/governance/adjustment-cases/:caseId" element={<AdjustmentCaseDetailPage />} /></Routes>,
      { roles: ['wellbeing-panel-chair'], route: `/governance/adjustment-cases/${CASE_ID}` },
    );

    await screen.findByRole('heading', { name: /exam time adjustment/i });
    expect(screen.queryByRole('button', { name: 'Start assessment' })).not.toBeInTheDocument();
  });
});
