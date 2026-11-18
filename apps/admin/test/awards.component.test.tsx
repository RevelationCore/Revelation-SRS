import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AwardsTab, type AwardsTabPermissions } from '../src/pages/AwardsTab.js';

const API = 'http://localhost:3000';
const ME = 'test-user-001';
const ALL: AwardsTabPermissions = { canRecommend: true, canConfer: true, canReadPlans: true, canWritePlans: true, canReadBoards: true };

const VALUE_SETS: Record<string, Array<{ code: string; displayLabel: string }>> = {
  award_type_code: [{ code: 'standard', displayLabel: 'Standard award' }, { code: 'aegrotat', displayLabel: 'Aegrotat award' }],
  plan_type_code: [{ code: 'referral', displayLabel: 'Referral' }, { code: 'repeat-stage', displayLabel: 'Repeat stage' }],
};

const recommendation = (overrides: Record<string, unknown> = {}) => ({
  recommendationId: 'rec-1', enrolmentId: 'enr-1', personId: 'person-1', examBoardId: 'board-1', awardTypeCode: 'standard',
  qualificationCode: 'BSc (Hons)', classificationCode: 'upper-second', calculatedClassificationCode: 'upper-second', aggregateMark: 64, discretionReason: null,
  authorityRef: null, statusCode: 'recommended', recommendedBy: 'board-chair', recommendedAt: '2027-06-20T10:00:00Z', withdrawnReason: null, conferment: null,
  ...overrides,
});

function handlers({ recommendations = [] as unknown[], plans = [] as unknown[], decisions = [] as unknown[] } = {}) {
  return [
    // Only the fields this test defines; every other field falls through to the real value sets.
    http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => (VALUE_SETS[String(params['field'])] ? HttpResponse.json({
      setCode: String(params['field']), displayName: 'Set',
      members: VALUE_SETS[String(params['field'])]!.map((m, i) => ({ ...m, description: null, sortOrder: i })),
    }) : undefined)),
    http.get(`${API}/api/v1/students/:personId/enrolments`, () => HttpResponse.json([{
      enrolmentId: 'enr-1', personId: 'person-1', programmeId: 'prog-1', programmeCode: 'BSC-CS', programmeName: 'BSc CS',
      statusCode: 'enrolled', modeOfStudyCode: 'full-time', attendanceTypeCode: null, academicYearOfEntry: '2024-25', startDate: null, expectedEndDate: null, actualEndDate: null,
    }])),
    http.get(`${API}/api/v1/enrolments/enr-1/award-recommendations`, () => HttpResponse.json(recommendations)),
    http.get(`${API}/api/v1/enrolments/enr-1/reassessment-plans`, () => HttpResponse.json(plans)),
    http.get(`${API}/api/v1/enrolments/enr-1/progression/history`, () => HttpResponse.json(decisions)),
    http.get(`${API}/api/v1/module-registrations`, () => HttpResponse.json([{
      moduleRegistrationId: 'mr-1', enrolmentId: 'enr-1', moduleOfferingId: 'mo-1', moduleId: 'mod-1', moduleCode: 'CS201', moduleTitle: 'Algorithms',
      academicPeriodId: 'ap-1', periodCode: 'SEM1', statusCode: 'registered', registrationDate: '2026-10-01', validFrom: '2026-10-01', validTo: null, recordedAt: '2026-10-01', recordedUntil: null,
    }])),
    http.get(`${API}/api/v1/exam-boards`, () => HttpResponse.json([
      { examBoardId: 'board-1', boardTypeCode: 'award', academicYear: '2026-27', periodCode: null, ratifiedAt: '2027-06-15T00:00:00Z' },
      { examBoardId: 'board-2', boardTypeCode: 'award', academicYear: '2026-27', periodCode: null, ratifiedAt: null },
    ])),
    http.get(`${API}/api/v1/enrolments/enr-1/classification`, () => HttpResponse.json({
      enrolmentId: 'enr-1', aggregateMark: 64.2, classificationCode: 'upper-second', algorithm: 'weighted-mean',
      boundariesApplied: [{ code: 'first', minimumMark: 70 }, { code: 'upper-second', minimumMark: 60 }],
    })),
  ];
}

const renderTab = (permissions: AwardsTabPermissions = ALL) =>
  renderWithProviders(<AwardsTab personId="person-1" permissions={permissions} />, { roles: ['registry-administrator'] });

describe('award recommendation and conferment', () => {
  it('recommends from a ratified board; a classification that differs from the calculation needs a discretion reason', async () => {
    let body: unknown;
    server.use(...handlers(), http.post(`${API}/api/v1/enrolments/enr-1/award-recommendations`, async ({ request }) => {
      body = await request.json(); return HttpResponse.json(recommendation(), { status: 201 });
    }));
    const { container } = renderTab();
    expect(await screen.findByText('Upper second class honours (2:1)')).toBeVisible();
    // Only the ratified board is offered.
    expect(screen.getAllByRole('option', { name: /Award Board 2026-27/ })).toHaveLength(1);
    await expectNoA11yViolations(container);

    await userEvent.selectOptions(screen.getByLabelText(/Recommending exam board/), 'board-1');
    await userEvent.type(screen.getByLabelText(/^Qualification/), 'BSc (Hons)');
    expect(screen.getByLabelText(/^Classification/)).toHaveValue('upper-second');
    expect(screen.queryByLabelText(/Discretion reason/)).toBeNull();
    await userEvent.clear(screen.getByLabelText(/^Classification/));
    await userEvent.type(screen.getByLabelText(/^Classification/), 'first');
    await userEvent.type(screen.getByLabelText(/Discretion reason/), 'Borderline; board discretion');
    await userEvent.click(screen.getByRole('button', { name: 'Recommend award' }));
    await screen.findAllByText('Award');
    expect(body).toEqual({
      awardTypeCode: 'standard', qualificationCode: 'BSc (Hons)', classificationCode: 'first', examBoardId: 'board-1',
      discretionReason: 'Borderline; board discretion',
    });
  });

  it('an aegrotat award asks for the policy authority', async () => {
    server.use(...handlers());
    renderTab();
    await screen.findByRole('option', { name: 'Aegrotat award' });
    await userEvent.selectOptions(screen.getByLabelText(/Award type/), 'aegrotat');
    expect(screen.getByLabelText(/Policy authority/)).toBeVisible();
  });

  it('the recommender is told someone else must confer', async () => {
    server.use(...handlers({ recommendations: [recommendation({ recommendedBy: ME })] }));
    renderTab();
    expect(await screen.findByText('You recommended this award, so someone else must confer it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confer award' })).toBeNull();
  });

  it('another person confers under delegated authority', async () => {
    let body: unknown;
    server.use(...handlers({ recommendations: [recommendation()] }), http.post(`${API}/api/v1/award-recommendations/rec-1/conferment`, async ({ request }) => {
      body = await request.json(); return HttpResponse.json(recommendation({ statusCode: 'conferred' }), { status: 201 });
    }));
    renderTab();
    await userEvent.type(await screen.findByLabelText(/Delegated authority/), 'Senate delegation 2026/4');
    await userEvent.clear(screen.getByLabelText(/Conferment date/));
    await userEvent.type(screen.getByLabelText(/Conferment date/), '2027-07-01');
    await userEvent.click(screen.getByRole('button', { name: 'Confer award' }));
    await screen.findAllByText('Award');
    expect(body).toEqual({ confermentDate: '2027-07-01', authorityRef: 'Senate delegation 2026/4' });
  });

  it('an API refusal is shown', async () => {
    server.use(...handlers({ recommendations: [recommendation()] }), http.post(`${API}/api/v1/award-recommendations/rec-1/conferment`, () => HttpResponse.json(
      { type: 'about:blank', title: 'Conflict', status: 409, detail: 'This recommendation is already conferred' }, { status: 409 },
    )));
    renderTab();
    await userEvent.type(await screen.findByLabelText(/Delegated authority/), 'Senate 2026/4');
    await userEvent.click(screen.getByRole('button', { name: 'Confer award' }));
    expect(await screen.findByText('This recommendation is already conferred')).toBeVisible();
  });
});

describe('reassessment plans', () => {
  const ratifiedResit = { progressionDecisionId: 'pd-1', enrolmentId: 'enr-1', academicYear: '2026-27', yearOfStudy: '1', decisionCode: 'resit', examBoardId: null, locked: true, recordedUntil: null };

  it('adds a module referral after a ratified resit decision', async () => {
    let body: unknown;
    server.use(...handlers({ decisions: [ratifiedResit] }), http.post(`${API}/api/v1/progression-decisions/pd-1/reassessment-plans`, async ({ request }) => {
      body = await request.json(); return HttpResponse.json({}, { status: 201 });
    }));
    renderTab();
    await userEvent.selectOptions(await screen.findByLabelText(/^Plan/), 'referral');
    await userEvent.selectOptions(screen.getByLabelText(/^Module/), 'mr-1');
    await userEvent.type(screen.getByLabelText(/Mark cap/), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Add plan' }));
    await screen.findByText('Reassessment plans');
    expect(body).toEqual({ planTypeCode: 'referral', moduleRegistrationId: 'mr-1', markCap: 40 });
  });

  it('without a ratified resit or repeat decision, explains that no plan can be added', async () => {
    server.use(...handlers({ decisions: [{ ...ratifiedResit, locked: false }] }));
    renderTab();
    expect(await screen.findByText('A plan can be added once a resit or repeat-year progression decision has been ratified.')).toBeVisible();
  });

  it('closes a planned attempt', async () => {
    let body: unknown;
    const plan = {
      reassessmentPlanId: 'plan-1', enrolmentId: 'enr-1', progressionDecisionId: 'pd-1', planTypeCode: 'referral', moduleRegistrationId: 'mr-1',
      assessmentComponentId: null, academicPeriodId: null, attemptNumber: 2, markCap: 40, dueDate: '2027-08-15', statusCode: 'planned',
      outcomeNote: null, createdBy: 'x', createdAt: '2027-07-01T00:00:00Z', closedBy: null, closedAt: null,
    };
    server.use(...handlers({ plans: [plan], decisions: [ratifiedResit] }), http.post(`${API}/api/v1/reassessment-plans/plan-1/closure`, async ({ request }) => {
      body = await request.json(); return HttpResponse.json({ ...plan, statusCode: 'completed' });
    }));
    renderTab();
    expect(await screen.findByText('CS201 Algorithms')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Close referral plan/i }));
    await userEvent.type(screen.getByLabelText(/^Note/), 'Passed at referral');
    await userEvent.click(screen.getByRole('button', { name: 'Close plan' }));
    await screen.findByText('Reassessment plans');
    expect(body).toEqual({ statusCode: 'completed', note: 'Passed at referral' });
  });
});
