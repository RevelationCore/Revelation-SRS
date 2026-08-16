import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { ModuleRegistrationRequestsPage } from '../src/pages/ModuleRegistrationRequestsPage.js';

const API = 'http://localhost:3000';

const pendingRequest = {
  workflowInstanceId: 'wf-001', workflowTaskId: 'task-001', statusCode: 'running',
  context: { actionType: 'register', enrolmentId: 'enrolment-001', moduleOfferingId: 'offering-001' },
  startedAt: '2026-08-01T00:00:00Z',
};

describe('module registration/approval workflow — registry approval', () => {
  it('pending: an outstanding request is listed with its type and reference, awaiting a decision', async () => {
    server.use(http.get(`${API}/api/v1/module-registration-requests`, () => HttpResponse.json([pendingRequest])));
    const { container } = renderWithProviders(<ModuleRegistrationRequestsPage />, { roles: ['registry-administrator'] });
    expect(await screen.findByText('Registration')).toBeVisible();
    expect(screen.getByText('enrolment-001')).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('approved: deciding approve submits the decision and the request drops off the list', async () => {
    let decisionBody: unknown;
    server.use(
      http.get(`${API}/api/v1/module-registration-requests`, () => HttpResponse.json([pendingRequest]), { once: true }),
      http.get(`${API}/api/v1/module-registration-requests`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/module-registration-requests/:id/decision`, async ({ request }) => {
        decisionBody = await request.json();
        return HttpResponse.json({ moduleRegistrationId: 'reg-001' });
      }),
    );
    renderWithProviders(<ModuleRegistrationRequestsPage />, { roles: ['registry-administrator'] });
    await screen.findByText('Registration');
    await userEvent.click(screen.getByRole('button', { name: 'Decide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('No pending requests.')).toBeVisible();
    expect(decisionBody).toMatchObject({ decisionCode: 'approved' });
  });

  it('returned: deciding reject records a rejection decision', async () => {
    let decisionBody: unknown;
    server.use(
      http.get(`${API}/api/v1/module-registration-requests`, () => HttpResponse.json([pendingRequest]), { once: true }),
      http.get(`${API}/api/v1/module-registration-requests`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/module-registration-requests/:id/decision`, async ({ request }) => {
        decisionBody = await request.json();
        return HttpResponse.json({ moduleRegistrationId: null });
      }),
    );
    renderWithProviders(<ModuleRegistrationRequestsPage />, { roles: ['registry-administrator'] });
    await screen.findByText('Registration');
    await userEvent.click(screen.getByRole('button', { name: 'Decide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('No pending requests.')).toBeVisible();
    expect(decisionBody).toMatchObject({ decisionCode: 'rejected' });
  });

  it('API failure: a failed decision surfaces an error and keeps the request visible for retry', async () => {
    server.use(
      http.get(`${API}/api/v1/module-registration-requests`, () => HttpResponse.json([pendingRequest])),
      http.post(`${API}/api/v1/module-registration-requests/:id/decision`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', detail: 'Request already decided' }, { status: 409 })),
    );
    renderWithProviders(<ModuleRegistrationRequestsPage />, { roles: ['registry-administrator'] });
    await screen.findByText('Registration');
    await userEvent.click(screen.getByRole('button', { name: 'Decide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Request already decided')).toBeVisible();
    expect(screen.getByText('Registration')).toBeVisible();
  });
});
