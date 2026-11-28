import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { StartWorkflowPage } from '../src/pages/StartWorkflowPage.js';

const API = 'http://localhost:3000/bff/srs';

const definition = {
  workflowDefinitionId: 'def-001',
  tenantId: 'test-tenant-001',
  definitionCode: 'data-quality-flag-review',
  displayName: 'Data quality flag review',
  description: null,
  statusCode: 'active',
  currentVersionNumber: 1,
  ownerModuleCode: 'custom',
  createdBy: 'admin',
  createdAt: '2026-08-17T00:00:00Z',
  updatedAt: '2026-08-17T00:00:00Z',
};

const version = {
  workflowDefinitionVersionId: 'ver-001',
  workflowDefinitionId: 'def-001',
  versionNumber: 1,
  statusCode: 'active',
  definitionJson: {},
  bpmnSourceId: null,
  effectiveFrom: '2026-08-17T00:00:00Z',
  effectiveTo: null,
  createdBy: 'admin',
  createdAt: '2026-08-17T00:00:00Z',
  steps: [
    { stepKey: 'start', stepTypeCode: 'start', displayName: 'Started', ownerRoleCode: null, sortOrder: 10, configuration: {} },
    {
      stepKey: 'review-and-decide', stepTypeCode: 'human-task', displayName: 'Review the flag',
      ownerRoleCode: 'registry-administrator', sortOrder: 20,
      configuration: {
        outcomeOptions: [{ code: 'approved', label: 'Approve' }, { code: 'rejected', label: 'Reject' }],
        dueAfterHours: 48, escalateToRoleCode: 'tenant-administrator',
      },
    },
    { stepKey: 'end', stepTypeCode: 'end', displayName: 'Closed', ownerRoleCode: null, sortOrder: 30, configuration: {} },
  ],
};

describe('StartWorkflowPage', () => {
  it('lists published, admin-authored workflows and starts an instance against a subject', async () => {
    let startBody: Record<string, unknown> | undefined;
    server.use(
      http.get(`${API}/api/v1/workflow-definitions`, () => HttpResponse.json([definition])),
      http.get(`${API}/api/v1/workflow-definitions/:id/versions`, () => HttpResponse.json([version])),
      http.post(`${API}/api/v1/workflow-instances`, async ({ request }) => {
        startBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ workflowInstanceId: 'wf-001', workflowTaskId: 'task-001' }, { status: 201 });
      }),
    );
    const { container } = renderWithProviders(<StartWorkflowPage />, { roles: ['tenant-administrator'] });

    await userEvent.selectOptions(await screen.findByLabelText(/Workflow/), 'def-001');
    await userEvent.type(screen.getByLabelText(/Subject type/), 'student');
    await userEvent.type(screen.getByLabelText(/Subject ID/), '11111111-1111-1111-1111-111111111111');
    await userEvent.type(screen.getByLabelText(/Note/), 'Flagged by nightly data check');
    await userEvent.click(screen.getByRole('button', { name: 'Start workflow' }));

    expect(await screen.findByText(/Started\. Workflow instance/)).toBeVisible();
    expect(screen.getByText('wf-001')).toBeVisible();
    expect(startBody).toMatchObject({
      workflowDefinitionVersionId: 'ver-001',
      workflowCode: 'data-quality-flag-review',
      subjectEntityType: 'student',
      subjectEntityId: '11111111-1111-1111-1111-111111111111',
      task: { stepKey: 'review-and-decide', payload: { note: 'Flagged by nightly data check' } },
    });
    expect(typeof (startBody!.task as Record<string, unknown>).dueAt).toBe('string');
    await expectNoA11yViolations(container);
  });

  it('explains there is nothing to start when no generic workflow is published yet', async () => {
    server.use(http.get(`${API}/api/v1/workflow-definitions`, () => HttpResponse.json([])));
    renderWithProviders(<StartWorkflowPage />, { roles: ['tenant-administrator'] });
    expect(await screen.findByText(/No published workflows are available to start yet/)).toBeVisible();
  });
});
