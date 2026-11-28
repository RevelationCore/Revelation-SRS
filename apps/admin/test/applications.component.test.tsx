import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ApplicationsPage } from '../src/pages/ApplicationsPage.js';
import { ApplicationDetailPage } from '../src/pages/ApplicationDetailPage.js';

const API = 'http://localhost:3000/bff/srs';
const ME = 'test-user-001';

const VALUE_SETS: Record<string, Array<{ code: string; displayLabel: string }>> = {
  assessment_type_code: [{ code: 'academic', displayLabel: 'Academic' }],
  outcome_code: [{ code: 'meets', displayLabel: 'Meets' }],
  condition_type_code: [{ code: 'academic', displayLabel: 'Academic' }],
  provenance_code: [{ code: 'ucas-results', displayLabel: 'UCAS results' }],
};

function baseHandlers() {
  return [
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => HttpResponse.json({
      setCode: String(params['field']), displayName: 'Set',
      members: (VALUE_SETS[String(params['field'])] ?? []).map((m, i) => ({ ...m, description: null, sortOrder: i })),
    })),
    http.get(`${API}/api/v1/programmes`, () => HttpResponse.json([{ programmeId: 'prog-1', code: 'BSC-CS', title: 'BSc Computer Science' }])),
  ];
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1', channelCode: 'ucas', sourceReference: '2027:1234567890', cycle: '2027', personId: 'person-1',
    identityMatchCode: 'created', programmeId: 'prog-1', intakeCode: '2027-09', modeOfStudyCode: 'full-time',
    latestPayloadId: 'payload-1', ucasApplicationId: 'ucas-1', statusCode: 'received', routingReasonCode: null,
    recommendationCode: null, recommendationReason: null, recommendedBy: null, recommendedAt: null,
    createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', assessments: [], offers: [], ...overrides,
  };
}

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1', version: 1, previousOfferId: null, programmeId: 'prog-1', intakeCode: '2027-09', modeOfStudyCode: 'full-time',
    offerTypeCode: 'conditional', statusCode: 'made', expiresOn: null, decidedBy: 'decider', decidedAt: '2026-11-02T10:00:00Z',
    changeReason: null, responseCode: null, responseSourceAt: null, confirmation: null,
    conditions: [{ id: 'cond-1', conditionTypeCode: 'academic', description: 'AAB at A-level', requiredValue: 'AAB', statusCode: 'pending', decidedBy: null, decidedAt: null, decisionNote: null, evidence: [] }],
    ...overrides,
  };
}

const renderDetail = (roles: string[]) => renderWithProviders(
  <Routes><Route path="/applications/:applicationId" element={<ApplicationDetailPage />} /></Routes>,
  { roles, route: '/applications/app-1' },
);

describe('applications worklist', () => {
  it('lists open applications and filters to the identity worklist', async () => {
    server.use(...baseHandlers(), http.get(`${API}/api/v1/applications`, () => HttpResponse.json([
      application(),
      application({ id: 'app-2', sourceReference: '2027:2222222222', identityMatchCode: 'needs-review', personId: null, routingReasonCode: 'identity' }),
      application({ id: 'app-3', sourceReference: '2027:3333333333', statusCode: 'incomplete', routingReasonCode: 'incomplete', programmeId: null, intakeCode: null }),
    ])));
    const { container } = renderWithProviders(<ApplicationsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('2027:1234567890')).toBeVisible();
    expect(screen.getByText('Not yet known')).toBeVisible();
    await expectNoA11yViolations(container);

    await userEvent.selectOptions(screen.getByLabelText('Worklist:'), 'identity');
    expect(screen.getByText('2027:2222222222')).toBeVisible();
    expect(screen.queryByText('2027:1234567890')).toBeNull();
  });
});

describe('application detail', () => {
  it('confirms an uncertain applicant identity', async () => {
    let body: unknown;
    server.use(
      ...baseHandlers(),
      http.get(`${API}/api/v1/applications/app-1`, () => HttpResponse.json(application({ identityMatchCode: 'needs-review', personId: null, routingReasonCode: 'identity' }))),
      http.post(`${API}/api/v1/applications/app-1/identity`, async ({ request }) => { body = await request.json(); return HttpResponse.json(application()); }),
    );
    const { container } = renderDetail(['registry-administrator']);
    await userEvent.type(await screen.findByLabelText(/Person ID/), 'person-9');
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm identity' }));
    await screen.findByText('Application');
    expect(body).toEqual({ personId: 'person-9' });
  });

  it('the recommender is told someone else must decide', async () => {
    server.use(...baseHandlers(), http.get(`${API}/api/v1/applications/app-1`, () => HttpResponse.json(application({
      statusCode: 'recommended', recommendationCode: 'offer', recommendationReason: 'Strong', recommendedBy: ME,
    }))));
    renderDetail(['programme-approver']);
    expect(await screen.findByText('You recommended this application, so someone else must decide it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Make offer' })).toBeNull();
  });

  it('another decider makes a conditional offer with its conditions', async () => {
    let body: unknown;
    server.use(
      ...baseHandlers(),
      http.get(`${API}/api/v1/applications/app-1`, () => HttpResponse.json(application({
        statusCode: 'recommended', recommendationCode: 'offer', recommendationReason: 'Strong', recommendedBy: 'someone-else',
      }))),
      http.post(`${API}/api/v1/applications/app-1/decision`, async ({ request }) => { body = await request.json(); return HttpResponse.json(application()); }),
    );
    renderDetail(['programme-approver']);
    await userEvent.selectOptions(await screen.findByLabelText('Condition 1 type'), 'academic');
    await userEvent.type(screen.getByLabelText('Condition 1 description'), 'AAB at A-level');
    await userEvent.type(screen.getByLabelText('Condition 1 required value'), 'AAB');
    await userEvent.click(screen.getByRole('button', { name: 'Make offer' }));
    await screen.findByText('Application');
    expect(body).toEqual({
      decisionCode: 'offer',
      offer: { offerTypeCode: 'conditional', conditions: [{ conditionTypeCode: 'academic', description: 'AAB at A-level', requiredValue: 'AAB' }] },
    });
  });

  it('a refused condition decision is shown and the condition stays pending', async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${API}/api/v1/applications/app-1`, () => HttpResponse.json(application({ statusCode: 'offered', offers: [offer({ statusCode: 'accepted', responseCode: 'accept' })] }))),
      http.post(`${API}/api/v1/offer-conditions/cond-1/decision`, () => HttpResponse.json(
        { type: 'about:blank', title: 'Conflict', status: 409, detail: 'A condition is met only on verified evidence (BP-01-004 step 3)' }, { status: 409 },
      )),
    );
    renderDetail(['programme-approver']);
    await userEvent.click(await screen.findByRole('button', { name: 'Decide AAB at A-level' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
    expect(await screen.findByText('A condition is met only on verified evidence (BP-01-004 step 3)')).toBeVisible();
    expect(screen.getByText('pending')).toBeVisible();
  });

  it('confirms an accepted offer', async () => {
    let body: unknown;
    const met = offer({ statusCode: 'accepted', responseCode: 'accept', conditions: [{ ...offer().conditions[0], statusCode: 'met' }] });
    server.use(
      ...baseHandlers(),
      http.get(`${API}/api/v1/applications/app-1`, () => HttpResponse.json(application({ statusCode: 'offered', offers: [met] }))),
      http.post(`${API}/api/v1/admissions-offers/offer-1/confirmation`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }),
    );
    renderDetail(['programme-approver']);
    expect(await screen.findByText('Offer version 1')).toBeVisible();
    expect(screen.getByText('Confirmation')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Record confirmation' }));
    await screen.findByText('Application');
    expect(body).toEqual({ decisionCode: 'confirmed' });
  });

  it('the registry completes the hand-off by creating the enrolment from the confirmed offer', async () => {
    let body: unknown;
    const conversion = {
      applicationId: 'app-1', personId: 'person-1', offerId: 'offer-1', enrolmentId: 'enr-9', enrolmentExists: false, programmeId: 'prog-1', programmeSource: 'offer',
      modeOfStudyCode: 'full-time', intakeCode: '2027-09', academicYearOfEntry: '2027-28', startDate: '2027-09-20', feeStatusBasisCode: null,
      handoffTaskId: 'task-1', handoffTaskStatus: 'assigned', blockers: [],
    };
    server.use(
      ...baseHandlers(),
      http.get(`${API}/api/v1/applications/app-1`, () => HttpResponse.json(application({ statusCode: 'offered', offers: [offer({ statusCode: 'confirmed', conditions: [] })] }))),
      http.get(`${API}/api/v1/applications/app-1/enrolment-conversion`, () => HttpResponse.json(conversion)),
      http.post(`${API}/api/v1/applications/app-1/enrolment-conversion`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...conversion, enrolmentExists: true, handoffTaskStatus: 'completed' });
      }),
    );
    const { container } = renderDetail(['registry-administrator']);
    expect(await screen.findByText(/Complete the hand-off/)).toBeVisible();
    expect(screen.getByText('2027-28')).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Create enrolment' }));
    expect(await screen.findByText(/in pre-registration until they register/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open the student record' })).toBeVisible();
    expect(body).toEqual({ startDate: '2027-09-20' });
  });
});
