import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { TaskInboxPage } from '../src/pages/TaskInboxPage.js';

const API = 'http://localhost:3000/bff/srs';

const genericTask = {
  workflowTaskId: 'task-001',
  workflowInstanceId: 'wf-001',
  stepKey: 'review-and-decide',
  taskTypeCode: 'human-task',
  statusCode: 'pending',
  assigneeActorId: null,
  assigneeRoleCode: 'registry-administrator',
  dueAt: '2026-08-19T00:00:00Z',
  completedBy: null,
  completedAt: null,
  payload: {},
  createdAt: '2026-08-17T00:00:00Z',
  outcomeOptions: [{ code: 'approved', label: 'Approve' }, { code: 'rejected', label: 'Reject' }],
};

const bespokeTask = {
  ...genericTask,
  workflowTaskId: 'task-002',
  outcomeOptions: null,
};

describe('TaskInboxPage — typed outcomes and escalation', () => {
  it('a task with configured outcome options shows Decide, then real Approve/Reject buttons', async () => {
    let completionBody: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([genericTask]), { once: true }),
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/workflow-tasks/:id/completion`, async ({ request }) => {
        completionBody = await request.json() as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { container } = renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('No tasks found.')).toBeVisible();
    expect(completionBody).toMatchObject({ decisionCode: 'approved' });
    await expectNoA11yViolations(container);
  });

  it('a task with no configured outcome options keeps the plain Complete confirm flow', async () => {
    server.use(
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([bespokeTask]), { once: true }),
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/workflow-tasks/:id/completion`, () => new HttpResponse(null, { status: 204 })),
    );
    renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Complete' }));
    expect(screen.getByText('Complete task?')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('No tasks found.')).toBeVisible();
  });

  it('an escalated task is still shown as actionable, with a distinct status colour', async () => {
    const escalatedTask = { ...genericTask, statusCode: 'escalated' };
    server.use(http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([escalatedTask])));
    renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    expect(await screen.findByText('escalated')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Decide' })).toBeVisible();
  });

  it('shows an assigned task under the default Open view and lets it be decided', async () => {
    const assignedTask = { ...genericTask, statusCode: 'assigned' };
    server.use(http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([
      assignedTask,
      { ...genericTask, workflowTaskId: 'task-done', statusCode: 'completed' },
    ])));
    renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    expect(await screen.findByRole('button', { name: 'Decide' })).toBeVisible();
    // Only the open task is listed; the completed one is filtered out.
    expect(screen.getAllByRole('button', { name: 'Decide' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'View workflow' })).toHaveLength(1);
  });
});

describe('TaskInboxPage — Temporal-run tasks', () => {
  const temporalTask = {
    ...genericTask,
    statusCode: 'assigned',
    executionBackend: 'temporal',
    revision: 0,
    escalatedAt: null,
    attentionReasonCode: null,
  };

  it('tells the user a saved decision is being applied, then that it was applied', async () => {
    server.use(
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([temporalTask]), { once: true }),
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/workflow-tasks/:id/completion`, () => HttpResponse.json({
        commandId: 'cmd-1', workflowInstanceId: 'wf-001', decisionCode: 'approved', status: 'pending',
        acceptedAt: '2026-11-11T10:00:00Z', appliedAt: null, errorDetail: null,
        statusUrl: '/api/v1/workflow-commands/cmd-1',
      }, { status: 202 })),
      http.get(`${API}/api/v1/workflow-commands/cmd-1`, () => HttpResponse.json({
        commandId: 'cmd-1', workflowInstanceId: 'wf-001', decisionCode: 'approved', status: 'applied',
        acceptedAt: '2026-11-11T10:00:00Z', appliedAt: '2026-11-11T10:00:03Z', errorDetail: null,
        statusUrl: '/api/v1/workflow-commands/cmd-1',
      })),
    );
    const { container } = renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Decision received. Applying it now…')).toBeVisible();
    expect(await screen.findByText('Decision applied.', {}, { timeout: 5_000 })).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('marks a task whose deadline passed with nobody to escalate to', async () => {
    server.use(http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([
      { ...temporalTask, attentionReasonCode: 'deadline-passed-no-escalation-role' },
    ])));
    renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    expect(await screen.findByText('Needs attention')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Decide' })).toBeVisible();
  });

  it('shows why a decision could not be applied', async () => {
    server.use(
      http.get(`${API}/api/v1/workflow-tasks`, () => HttpResponse.json([temporalTask])),
      http.post(`${API}/api/v1/workflow-tasks/:id/completion`, () => HttpResponse.json({
        type: 'about:blank', title: 'Conflict', status: 409,
        detail: 'A decision has already been made for this task',
      }, { status: 409 })),
    );
    renderWithProviders(<TaskInboxPage />, { roles: ['registry-administrator'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A decision has already been made for this task');
  });
});
