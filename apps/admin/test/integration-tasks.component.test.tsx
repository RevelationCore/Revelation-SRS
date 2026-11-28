import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { IntegrationTasksPage } from '../src/pages/IntegrationTasksPage.js';

const API = 'http://localhost:3000/bff/srs';

const libraryTask = {
  deliveryItemId: 'item-001',
  flowCode: 'F-SIS-LIB-01',
  flowName: 'Library access from enrolment status',
  targetLabel: 'library system',
  targetSystem: 'lib',
  subjectType: 'enrolment',
  subjectId: 'enr-001',
  personId: 'person-001',
  studentNumber: 'S2000002',
  studentName: 'Sam Patel',
  payload: { accessAction: 'grant', effectiveFrom: '2026-09-21' },
  summary: 'Grant library access from 2026-09-21 (enrolment enrolled)',
  fulfilmentModeCode: 'manual',
  statusCode: 'pending',
  failureReason: null,
  requestPublishedAt: '2026-09-21T09:00:00.000Z',
  deliveredAt: null,
  createdAt: '2026-09-21T09:00:00.000Z',
  ownerDescription: 'Library team',
  overdue: false,
};

const flows = [
  { flowCode: 'F-SIS-LIB-01', targetSystem: 'lib', targetLabel: 'library system', name: 'Library access from enrolment status', producer: 'implemented', producerNote: '', fulfilmentModeCode: 'manual', ownerDescription: 'Library team', alertAfterHours: 72, notifyEmail: null, lastOverdueNoticeAt: null, isDefault: false },
  { flowCode: 'F-SIS-PAY-01', targetSystem: 'pay', targetLabel: 'payroll system', name: 'Student support payment instructions', producer: 'none', producerNote: 'No SRS trigger.', fulfilmentModeCode: 'manual', ownerDescription: null, alertAfterHours: 72, notifyEmail: null, lastOverdueNoticeAt: null, isDefault: true },
  { flowCode: 'F-SIS-EST-01', targetSystem: 'est', targetLabel: 'estates system', name: 'Enrolment volumes and occupancy forecasts to estates', producer: 'extract', producerNote: '', fulfilmentModeCode: 'manual', ownerDescription: null, alertAfterHours: 72, notifyEmail: null, lastOverdueNoticeAt: null, isDefault: true },
];

const modes = {
  entityName: 'delivery_flow_config', fieldName: 'fulfilment_mode_code', valueSetCode: 'distribution-fulfilment-mode-code',
  members: [
    { code: 'connected', displayLabel: 'Connected system' },
    { code: 'manual', displayLabel: 'Manual task' },
    { code: 'file', displayLabel: 'File exchange' },
    { code: 'not-used', displayLabel: 'Not used' },
  ],
};

function handlers(state: { tasks: unknown[] }) {
  return [
    http.get(`${API}/api/v1/delivery-tasks`, () => HttpResponse.json(state.tasks)),
    http.get(`${API}/api/v1/academic-periods`, () => HttpResponse.json([
      { academicPeriodId: 'p1', academicYear: '2026-27', periodCode: 'SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15' },
    ])),
    http.get(`${API}/api/v1/delivery-flows`, () => HttpResponse.json(flows)),
    http.get(`${API}/api/v1/fields/delivery_flow_config/fulfilment_mode_code/value-set`, () => HttpResponse.json(modes)),
    http.get(`${API}/api/v1/adjustment-tasks`, () => HttpResponse.json([])),
    http.get(`${API}/api/v1/adjustment-targets`, () => HttpResponse.json([])),
    http.get(`${API}/api/v1/fields/adjustment_target_config/fulfilment_mode_code/value-set`, () => HttpResponse.json({ ...modes, entityName: 'adjustment_target_config' })),
  ];
}

describe('integration tasks', () => {
  it('shows both tabs to staff who fulfil both, and opens the tab a digest links to', async () => {
    server.use(...handlers({ tasks: [libraryTask] }));
    const { container } = renderWithProviders(<IntegrationTasksPage />, {
      roles: ['registry-administrator'], route: '/operations/integration-tasks?tab=systems',
    });

    expect(await screen.findByRole('tab', { name: 'Adjustments' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Other systems' })).toHaveAttribute('aria-selected', 'true');
    const row = (await screen.findByText('Sam Patel')).closest('tr')!;
    expect(within(row).getByText('Grant library access from 2026-09-21 (enrolment enrolled)')).toBeInTheDocument();
    expect(within(row).getByText('S2000002')).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it('marks flows the SRS cannot produce yet', async () => {
    server.use(...handlers({ tasks: [] }));
    renderWithProviders(<IntegrationTasksPage />, { roles: ['registry-administrator'], route: '/operations/integration-tasks?tab=systems' });

    await screen.findByText('Student support payment instructions');
    expect(screen.getAllByText('No SRS trigger yet')).toHaveLength(1);
  });

  it('runs an aggregate flow for a period', async () => {
    let body: unknown = null;
    server.use(
      ...handlers({ tasks: [] }),
      http.post(`${API}/api/v1/delivery-flows/F-SIS-EST-01/run`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ flowCode: 'F-SIS-EST-01', periodCode: '2026-27 SEM1', offerings: 4, created: 3, unchanged: 1 });
      }),
    );
    renderWithProviders(<IntegrationTasksPage />, { roles: ['registry-administrator'], route: '/operations/integration-tasks?tab=systems' });

    const select = await screen.findByRole('combobox', { name: 'Run Enrolment volumes and occupancy forecasts to estates for' });
    await within(select).findByRole('option', { name: '2026-27 SEM1' });
    await userEvent.selectOptions(select, 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('2026-27 SEM1: 3 sent, 1 unchanged (4 offerings)')).toBeInTheDocument();
    expect(body).toEqual({ academicPeriodId: 'p1' });
  });

  it('confirming a library task sends the reply and refreshes the queue', async () => {
    const state = { tasks: [libraryTask] as unknown[] };
    let called = false;
    server.use(
      ...handlers(state),
      http.post(`${API}/api/v1/delivery-items/item-001/acknowledge`, () => {
        called = true;
        state.tasks = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<IntegrationTasksPage />, { roles: ['registry-administrator'], route: '/operations/integration-tasks?tab=systems' });

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm done' }));

    expect(await screen.findAllByText('Nothing to do.')).not.toHaveLength(0);
    expect(called).toBe(true);
  });

  it('shows only the adjustments tab to staff who only fulfil adjustments', async () => {
    server.use(...handlers({ tasks: [] }));
    renderWithProviders(<IntegrationTasksPage />, { roles: ['engagement-officer'] });

    expect(await screen.findByRole('tab', { name: 'Adjustments' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Other systems' })).not.toBeInTheDocument();
  });
});
