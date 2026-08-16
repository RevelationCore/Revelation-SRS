import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ModuleAddPage } from '../src/pages/ModuleAddPage.js';
import { ModulesPage } from '../src/pages/ModulesPage.js';

const API = 'http://localhost:3000';
const ENROLMENT_ID = 'enrolment-001';
const OFFERING_ID = 'offering-001';

const enrolment = {
  enrolmentId: ENROLMENT_ID, personId: 'test-student-001', programmeId: 'p1', programmeCode: 'BSC-CS', programmeName: 'BSc Computer Science',
  statusCode: 'enrolled', modeOfStudyCode: 'full-time', attendanceTypeCode: null, academicYearOfEntry: '2025/26', feeBandCode: null, fundingSourceCode: null,
  startDate: '2025-09-22', expectedEndDate: null, actualEndDate: null, validFrom: '2025-09-22', recordedAt: '2025-09-22T00:00:00Z',
};
const offering = {
  moduleOfferingId: OFFERING_ID, moduleId: 'm1', moduleCode: 'CS201', moduleTitle: 'Algorithms', academicPeriodId: 'period-1', periodCode: '2025/26-S1',
  deliveryModeCode: 'on-campus', capacity: 40, creditValue: 20,
};

function handlers({ registrations = [], offerings = [offering], changeRequests = [] } = {}) {
  return [
    http.get(`${API}/api/v1/students/:personId/enrolments`, () => HttpResponse.json([enrolment])),
    http.get(`${API}/api/v1/module-registrations`, () => HttpResponse.json(registrations)),
    http.get(`${API}/api/v1/module-registrations/timetable`, () => HttpResponse.json([])),
    http.get(`${API}/api/v1/module-offerings`, () => HttpResponse.json(offerings)),
    http.get(`${API}/api/v1/students/:personId/module-registration-requests`, () => HttpResponse.json(changeRequests)),
  ];
}

describe('module registration/approval workflow — student portal', () => {
  it('eligible: lists an available module offering and lets the student register for it', async () => {
    server.use(...handlers());
    const { container } = renderWithProviders(<ModuleAddPage />, { route: '/modules/add' });
    expect(await screen.findByText('CS201')).toBeVisible();
    await expectNoA11yViolations(container);

    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    expect(screen.getByText('Register for this module?')).toBeVisible();
  });

  it('submitted/pending: confirming registration submits the request and the modules list shows it awaiting approval', async () => {
    let requestBody: unknown;
    server.use(
      ...handlers(),
      http.post(`${API}/api/v1/module-registrations/requests`, async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ workflowInstanceId: 'wf-001' }, { status: 201 });
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/modules/add" element={<ModuleAddPage />} />
        <Route path="/modules" element={<ModulesPage />} />
      </Routes>,
      { route: '/modules/add' },
    );
    await screen.findByText('CS201');
    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/awaiting staff approval/)).toBeVisible();
    expect(requestBody).toMatchObject({ enrolmentId: ENROLMENT_ID, moduleOfferingId: OFFERING_ID });
  });

  it('pending: a previously submitted request is visible on the modules page pending approval', async () => {
    server.use(...handlers({
      registrations: [], changeRequests: [{ workflowInstanceId: 'wf-002', workflowTaskId: 't1', statusCode: 'running', context: { actionType: 'register' }, startedAt: '2026-08-01T00:00:00Z' }],
    }));
    const { container } = renderWithProviders(<ModulesPage />, { route: '/modules' });
    expect(await screen.findByText('Pending requests')).toBeVisible();
    expect(screen.getByText('Registration request')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('API failure: a failed offerings request surfaces an accessible error, not a silent empty state', async () => {
    server.use(
      http.get(`${API}/api/v1/students/:personId/enrolments`, () => HttpResponse.json([enrolment])),
      http.get(`${API}/api/v1/module-registrations`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/module-offerings`, () => HttpResponse.json({ type: 'about:blank', title: 'Service unavailable', status: 503 }, { status: 503 })),
    );
    renderWithProviders(<ModuleAddPage />, { route: '/modules/add' });
    expect(await screen.findByRole('alert')).toHaveTextContent('An error occurred.');
  });
});
