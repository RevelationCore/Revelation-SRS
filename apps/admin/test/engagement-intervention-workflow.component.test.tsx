import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { EngagementPage } from '../src/pages/EngagementPage.js';
import { EngagementCasePage } from '../src/pages/EngagementCasePage.js';

const API = 'http://localhost:3000';
const CASE_ID = 'case-001';

const explainableAlert = {
  alertId: 'alert-001', personId: 'person-00000001', enrolmentId: 'enrolment-001', policyVersionId: 'policy-v1',
  evidenceWindowFrom: '2026-05-01', evidenceWindowTo: '2026-06-01',
  evidenceSnapshot: { expectedEventCount: 10, absenceCount: 6, absenceRate: 0.6, unsafeEvidenceCount: 0 },
  explanation: { decision: 'threshold-breached', automatedAdverseActionPermitted: false, policyCode: 'attendance-concern', policyVersion: 3 },
  severityCode: 'medium', statusCode: 'open', reevaluationRequired: false, recordedAt: '2026-06-01T00:00:00Z',
};

function emptyEngagementHandlers(overrides: { alerts?: unknown[] } = {}) {
  return [
    http.get(`${API}/api/v1/engagement/alerts`, () => HttpResponse.json(overrides.alerts ?? [])),
    http.get(`${API}/api/v1/engagement/events`, () => HttpResponse.json([])),
    http.get(`${API}/api/v1/engagement/policies`, () => HttpResponse.json([])),
  ];
}

async function openAlertQueueTab() {
  // EngagementPage's default tab is a useState initialiser keyed off
  // permissions that are still empty on the very first render (auth resolves
  // asynchronously); the real route tree only mounts this page once auth is
  // ready (via RequireRole), but a directly-rendered component test isn't
  // gated the same way, so assert against the tab explicitly rather than
  // relying on whichever tab happened to be selected on first paint.
  const tab = await screen.findByRole('tab', { name: /Alert queue/ });
  await userEvent.click(tab);
}

describe('engagement intervention workflow — alert queue', () => {
  it('explainable alert: shows the policy, version and evidence metrics behind the alert, not just a bare flag', async () => {
    server.use(...emptyEngagementHandlers({ alerts: [explainableAlert] }));
    const { container } = renderWithProviders(<EngagementPage />, { roles: ['engagement-officer'] });
    await openAlertQueueTab();
    expect(await screen.findByText('Policy attendance-concern v3')).toBeVisible();
    expect(screen.getByText('60%')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open intervention' })).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('disputed evidence: unsafe/reevaluation-required evidence blocks escalation instead of silently proceeding', async () => {
    server.use(...emptyEngagementHandlers({ alerts: [{ ...explainableAlert, statusCode: 'suspended-reconciliation', reevaluationRequired: true }] }));
    renderWithProviders(<EngagementPage />, { roles: ['engagement-officer'] });
    await openAlertQueueTab();
    expect(await screen.findByText('Evidence needs reconciliation. Intervention escalation is suspended.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open intervention' })).not.toBeInTheDocument();
  });
});

const openCase = {
  intervention: { id: CASE_ID, versionId: 'v1', alertId: 'alert-001', personId: 'person-00000001', enrolmentId: 'enrolment-001', statusCode: 'open', outcomeCode: null, assignedRoleCode: 'engagement-officer', assignedActorId: null, openedAt: '2026-06-01T00:00:00Z', reviewAt: null, dueAt: null },
  contacts: [], actions: [], referrals: [],
};

describe('engagement intervention workflow — case management', () => {
  it('action/contact: recording a contact attempt persists it and reloads the timeline', async () => {
    server.use(
      http.get(`${API}/api/v1/engagement/cases/${CASE_ID}`, () => HttpResponse.json(openCase), { once: true }),
      http.get(`${API}/api/v1/engagement/cases/${CASE_ID}`, () => HttpResponse.json({ ...openCase, contacts: [{ id: 'contact-001', channelCode: 'telephone', attemptedAt: '2026-06-02T00:00:00Z', outcomeCode: 'contacted', communicationLocale: 'en-GB', operationalNote: 'Spoke to student.' }] })),
      http.post(`${API}/api/v1/engagement/cases/${CASE_ID}/contacts`, () => HttpResponse.json({ id: 'contact-001' }, { status: 201 })),
    );
    renderWithProviders(<Routes><Route path="/engagement/cases/:caseId" element={<EngagementCasePage />} /></Routes>, { roles: ['engagement-officer'], route: `/engagement/cases/${CASE_ID}` });

    expect(await screen.findByText('No contact attempts recorded.')).toBeVisible();
    // Minimum-necessary information boundary: the case-note form itself warns
    // against entering restricted category data, rather than silently accepting it.
    expect(screen.getByText('Do not enter medical, disability, safeguarding or other restricted narrative.')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('telephone · contacted')).toBeVisible();
  });

  it('restricted referral: reviewing the case with a refer decision records a referral to the target service', async () => {
    let referBody: unknown;
    server.use(
      http.get(`${API}/api/v1/engagement/cases/${CASE_ID}`, () => HttpResponse.json(openCase), { once: true }),
      http.get(`${API}/api/v1/engagement/cases/${CASE_ID}`, () => HttpResponse.json({ ...openCase, referrals: [{ id: 'referral-001', targetServiceCode: 'wellbeing', referralTypeCode: 'support-request', statusCode: 'pending', externalReference: null, referredAt: '2026-06-03T00:00:00Z' }] })),
      http.post(`${API}/api/v1/engagement/cases/${CASE_ID}/review`, async ({ request }) => {
        referBody = await request.json();
        return HttpResponse.json({ id: 'review-001' }, { status: 201 });
      }),
    );
    renderWithProviders(<Routes><Route path="/engagement/cases/:caseId" element={<EngagementCasePage />} /></Routes>, { roles: ['engagement-officer'], route: `/engagement/cases/${CASE_ID}` });
    await screen.findByText('No referrals recorded.');

    await userEvent.selectOptions(screen.getByLabelText('Decision'), 'refer');
    await userEvent.selectOptions(screen.getByLabelText('Referral target'), 'wellbeing');
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));

    expect(await screen.findByText('wellbeing · pending')).toBeVisible();
    expect(referBody).toMatchObject({ decision: 'refer', referral: { targetServiceCode: 'wellbeing' } });
  });

  it('closed case: a closed intervention no longer offers contact, action or review forms', async () => {
    server.use(http.get(`${API}/api/v1/engagement/cases/${CASE_ID}`, () => HttpResponse.json({ ...openCase, intervention: { ...openCase.intervention, statusCode: 'closed', outcomeCode: 'engagement-restored' } })));
    renderWithProviders(<Routes><Route path="/engagement/cases/:caseId" element={<EngagementCasePage />} /></Routes>, { roles: ['engagement-officer'], route: `/engagement/cases/${CASE_ID}` });

    await screen.findByText('No contact attempts recorded.');
    expect(screen.queryByRole('button', { name: 'Save contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record review' })).not.toBeInTheDocument();
  });

  it('API failure: a failed contact save surfaces the reason without discarding the open case view', async () => {
    server.use(
      http.get(`${API}/api/v1/engagement/cases/${CASE_ID}`, () => HttpResponse.json(openCase)),
      http.post(`${API}/api/v1/engagement/cases/${CASE_ID}/contacts`, () => HttpResponse.json({ type: 'about:blank', title: 'Forbidden', detail: 'You are not assigned to this case.' }, { status: 403 })),
    );
    renderWithProviders(<Routes><Route path="/engagement/cases/:caseId" element={<EngagementCasePage />} /></Routes>, { roles: ['engagement-officer'], route: `/engagement/cases/${CASE_ID}` });
    await screen.findByText('No contact attempts recorded.');

    await userEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('You are not assigned to this case.')).toBeVisible();
    expect(screen.getByText('Intervention case')).toBeVisible();
  });
});
