import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { AdjustmentTasksPage } from '../src/pages/AdjustmentTasksPage.js';

const API = 'http://localhost:3000';

const applyTask = {
  distributionId: 'dist-001',
  adjustmentId: 'adj-001',
  targetSystem: 'attendance',
  action: 'apply',
  statusCode: 'pending',
  failureReason: null,
  personId: 'person-001',
  studentNumber: 'S1000001',
  studentName: 'Nina Rahman',
  enrolmentId: 'enr-001',
  adjustmentTypeCode: 'rest-breaks',
  scopeCode: 'attendance',
  amount: { value: 10, unitCode: 'minutes-per-hour' },
  validFrom: '2026-09-21T00:00:00.000Z',
  validTo: null,
  dueSince: '2026-09-21T09:00:00.000Z',
  ownerDescription: 'Attendance team',
  overdue: true,
};

const targets = [
  { targetSystem: 'vle', fulfilmentModeCode: 'connected', ownerDescription: null, alertAfterHours: 72, notifyEmail: null, lastOverdueNoticeAt: null, isDefault: true, updatedAt: null, updatedBy: null },
  { targetSystem: 'attendance', fulfilmentModeCode: 'manual', ownerDescription: 'Attendance team', alertAfterHours: 72, notifyEmail: null, lastOverdueNoticeAt: null, isDefault: false, updatedAt: null, updatedBy: null },
  { targetSystem: 'exams', fulfilmentModeCode: 'file', ownerDescription: null, alertAfterHours: 72, notifyEmail: null, lastOverdueNoticeAt: null, isDefault: true, updatedAt: null, updatedBy: null },
];

const modes = {
  entityName: 'adjustment_target_config',
  fieldName: 'fulfilment_mode_code',
  valueSetCode: 'distribution-fulfilment-mode-code',
  members: [
    { code: 'connected', displayLabel: 'Connected system' },
    { code: 'manual', displayLabel: 'Manual task' },
    { code: 'file', displayLabel: 'File exchange' },
    { code: 'not-used', displayLabel: 'Not used' },
  ],
};

function handlers(state: { tasks: unknown[] }) {
  return [
    http.get(`${API}/api/v1/adjustment-tasks`, () => HttpResponse.json(state.tasks)),
    http.get(`${API}/api/v1/adjustment-targets`, () => HttpResponse.json(targets)),
    http.get(`${API}/api/v1/fields/adjustment_target_config/fulfilment_mode_code/value-set`, () => HttpResponse.json(modes)),
  ];
}

describe('adjustment task queue', () => {
  it('lists an open task with what is needed to apply it, and flags it overdue', async () => {
    server.use(...handlers({ tasks: [applyTask] }));
    const { container } = renderWithProviders(<AdjustmentTasksPage />, { roles: ['engagement-officer'] });

    const row = (await screen.findByText('Nina Rahman')).closest('tr')!;
    await waitFor(() => expect(row).toHaveTextContent('Apply in Attendance'));
    expect(within(row).getByText('S1000001')).toBeInTheDocument();
    await waitFor(() => expect(row).toHaveTextContent(/10 minutes per hour/i));
    expect(within(row).getByText('Attendance team')).toBeInTheDocument();
    expect(screen.getByText('1 open · 1 overdue')).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it('confirming a task sends the same reply a connector would, then refreshes', async () => {
    const state = { tasks: [applyTask] as unknown[] };
    let body: unknown = null;
    server.use(
      ...handlers(state),
      http.post(`${API}/api/v1/adjustments/adj-001/distributions/dist-001/acknowledge`, async ({ request }) => {
        body = await request.json();
        state.tasks = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<AdjustmentTasksPage />, { roles: ['engagement-officer'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm applied' }));

    expect(await screen.findByText('Nothing to do.')).toBeInTheDocument();
    expect(body).toEqual({ targetSystem: 'attendance' });
  });

  it('reporting a task as not appliable sends the reason', async () => {
    let body: unknown = null;
    server.use(
      ...handlers({ tasks: [applyTask] }),
      http.post(`${API}/api/v1/adjustments/adj-001/distributions/dist-001/failure`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<AdjustmentTasksPage />, { roles: ['engagement-officer'] });

    await userEvent.click(await screen.findByRole('button', { name: "Can't apply" }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Why it cannot be applied' }), 'Not in the attendance register');
    await userEvent.click(screen.getByRole('button', { name: 'Report' }));

    await expect.poll(() => body).toEqual({ targetSystem: 'attendance', reason: 'Not in the attendance register' });
  });

  it('shows target settings read-only to staff who cannot configure them', async () => {
    server.use(...handlers({ tasks: [] }));
    renderWithProviders(<AdjustmentTasksPage />, { roles: ['engagement-officer'] });

    const mode = await screen.findByRole('combobox', { name: 'Attendance fulfilment' });
    expect(mode).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('lets a tenant administrator change how a target is fulfilled', async () => {
    let saved: unknown = null;
    server.use(
      ...handlers({ tasks: [] }),
      http.put(`${API}/api/v1/adjustment-targets/attendance`, async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ ...targets[1], fulfilmentModeCode: 'not-used' });
      }),
    );
    renderWithProviders(<AdjustmentTasksPage />, { roles: ['tenant-administrator'] });

    const select = await screen.findByRole('combobox', { name: 'Attendance fulfilment' });
    await within(select).findByRole('option', { name: 'Not used' });
    await userEvent.selectOptions(select, 'not-used');
    const form = select.closest('form')!;
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await expect.poll(() => saved).toEqual({ fulfilmentModeCode: 'not-used', ownerDescription: 'Attendance team', alertAfterHours: 72, notifyEmail: null });
  });
});
