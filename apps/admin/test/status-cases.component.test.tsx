import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { StatusCasesPage } from '../src/pages/StatusCasesPage.js';
import { StatusCaseDetailPage } from '../src/pages/StatusCaseDetailPage.js';

const API = 'http://localhost:3000';
const ME = 'test-user-001';
const subject = { personId: 'p-1', studentNumber: 'S1001', studentName: 'Ada Lovelace', programmeCode: 'BSC-CS', programmeTitle: 'BSc CS' };

const statusCase = (overrides: Record<string, unknown> = {}) => ({
  statusCaseId: 'sc-1', businessCaseId: 'bc-1', enrolmentId: 'enr-1', personId: 'p-1', caseTypeCode: 'interruption', initiatedByCode: 'student',
  reasonCategoryCode: 'health', requestedEffectiveDate: '2027-01-10', expectedReturnDate: '2027-09-20', destinationProgrammeId: null,
  destinationModeOfStudyCode: null, relatedCaseId: null, institutionalOutcomeRef: null, statusCode: 'requested', decidedBy: null, decidedAt: null,
  decisionReason: null, approvedEffectiveDate: null, approvedReturnDate: null, enrolmentStatusTransitionId: null, createdBy: 'student-ada',
  createdAt: '2026-11-01T10:00:00Z', assessments: [], conditions: [], outstandingReturnConditions: [], subject, ...overrides,
});

const valueSets = http.get(`${API}/api/v1/fields/:entity/:field/value-set`, ({ params }) => HttpResponse.json({
  setCode: 'x', displayName: 'x',
  members: ({
    assessor_role_code: [{ code: 'academic', displayLabel: 'Academic approver' }, { code: 'compliance', displayLabel: 'UKVI compliance' }],
    outcome_code: [{ code: 'supports', displayLabel: 'Supports' }],
    condition_type_code: [{ code: 'fitness-to-study', displayLabel: 'Fitness to study' }],
  } as Record<string, Array<{ code: string; displayLabel: string }>>)[String(params['field'])]?.map((m, i) => ({ ...m, description: null, sortOrder: i })) ?? [],
}));

const renderCase = (roles: string[]) => renderWithProviders(
  <Routes><Route path="/status-cases/:statusCaseId" element={<StatusCaseDetailPage />} /></Routes>, { roles, route: '/status-cases/sc-1' },
);

describe('status cases', () => {
  it('the worklist names each case\'s student for assessors without student-record access', async () => {
    server.use(http.get(`${API}/api/v1/status-cases`, () => HttpResponse.json([statusCase(), statusCase({ statusCaseId: 'sc-2', caseTypeCode: 'withdrawal' })])));
    const { container } = renderWithProviders(<StatusCasesPage />, { roles: ['programme-approver'] });
    expect((await screen.findAllByText('Ada Lovelace')).length).toBe(2);
    expect(screen.getAllByText('S1001 · BSC-CS')[0]).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.selectOptions(screen.getByLabelText('Type:'), 'withdrawal');
    expect(screen.getAllByText('Ada Lovelace')).toHaveLength(1);
  });

  it('an assessor records advice', async () => {
    let body: unknown;
    server.use(valueSets, http.get(`${API}/api/v1/status-cases/sc-1`, () => HttpResponse.json(statusCase())),
      http.post(`${API}/api/v1/status-cases/sc-1/assessments`, async ({ request }) => { body = await request.json(); return HttpResponse.json(statusCase()); }));
    renderCase(['programme-approver']);
    await userEvent.selectOptions(await screen.findByLabelText(/Advising as/), 'academic');
    await userEvent.selectOptions(screen.getByLabelText(/^Advice/), 'supports');
    await userEvent.click(screen.getByRole('button', { name: 'Record advice' }));
    await screen.findByText('Request');
    expect(body).toEqual({ assessorRoleCode: 'academic', outcomeCode: 'supports' });
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
  });

  it('whoever opened the case is told someone else must decide it', async () => {
    server.use(valueSets, http.get(`${API}/api/v1/status-cases/sc-1`, () => HttpResponse.json(statusCase({ createdBy: ME, initiatedByCode: 'institution' }))));
    renderCase(['registry-administrator']);
    expect(await screen.findByText('You opened this case, so someone else must decide it.')).toBeVisible();
  });

  it('a registry decider approves an interruption with its return date, and a refusal is shown', async () => {
    let body: unknown;
    server.use(valueSets, http.get(`${API}/api/v1/status-cases/sc-1`, () => HttpResponse.json(statusCase())),
      http.post(`${API}/api/v1/status-cases/sc-1/decision`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'This student is sponsored on a Student visa: record UKVI compliance advice before deciding' }, { status: 409 });
      }));
    renderCase(['registry-administrator']);
    await userEvent.type(await screen.findByLabelText(/^Reason/), 'Medical evidence seen');
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText(/record UKVI compliance advice/)).toBeVisible();
    expect(body).toEqual({ decisionCode: 'approved', reason: 'Medical evidence seen', effectiveDate: '2027-01-10', returnDate: '2027-09-20' });
  });
});
