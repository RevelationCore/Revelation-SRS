import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { server } from '../../../test/msw-server.mjs';
import { renderWithProviders } from './render.js';
import { WorkflowDefsPage } from '../src/pages/WorkflowDefsPage.js';

const API = 'http://localhost:3000';

const customDefinition = {
  workflowDefinitionId: 'def-001',
  tenantId: 'test-tenant-001',
  definitionCode: 'data-quality-flag-review',
  displayName: 'Data quality flag review',
  description: null,
  statusCode: 'draft',
  currentVersionNumber: null,
  ownerModuleCode: 'custom',
  createdBy: 'admin',
  createdAt: '2026-08-17T00:00:00Z',
  updatedAt: '2026-08-17T00:00:00Z',
};

const bespokeDefinition = {
  ...customDefinition,
  workflowDefinitionId: 'def-002',
  definitionCode: 'module-registration-change-approval',
  displayName: 'Module registration change approval',
  ownerModuleCode: 'registration',
};

describe('generic workflow builder — WorkflowDefsPage', () => {
  it('offers "Configure step" only for admin-authored ("custom") definitions', async () => {
    server.use(
      http.get(`${API}/api/v1/workflow-definitions`, () => HttpResponse.json([customDefinition, bespokeDefinition])),
      http.get(`${API}/api/v1/workflow-definitions/:id/versions`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/workflow-assignment-rules`, () => HttpResponse.json([])),
    );
    const { container } = renderWithProviders(<WorkflowDefsPage />, { roles: ['tenant-administrator'] });

    await userEvent.click(await screen.findByText('Data quality flag review'));
    expect(await screen.findByRole('button', { name: 'Configure step' })).toBeVisible();

    await userEvent.click(screen.getByText('Module registration change approval'));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Configure step' })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/owned by a developer-authored module/)).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('authoring a step creates a version and publishes it, and the published version becomes visible', async () => {
    let versionBody: unknown;
    let published = false;
    server.use(
      http.get(`${API}/api/v1/workflow-definitions`, () => HttpResponse.json([customDefinition])),
      http.get(`${API}/api/v1/workflow-definitions/:id/versions`, () => {
        if (!published) return HttpResponse.json([]);
        return HttpResponse.json([{
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
        }]);
      }),
      http.get(`${API}/api/v1/workflow-assignment-rules`, () => HttpResponse.json([])),
      http.post(`${API}/api/v1/workflow-definitions/:id/versions`, async ({ request }) => {
        versionBody = await request.json();
        return HttpResponse.json({ workflowDefinitionVersionId: 'ver-001', versionNumber: 1 }, { status: 201 });
      }),
      http.post(`${API}/api/v1/workflow-definition-versions/:id/publish`, () => {
        published = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<WorkflowDefsPage />, { roles: ['tenant-administrator'] });
    await userEvent.click(await screen.findByText('Data quality flag review'));
    await userEvent.click(await screen.findByRole('button', { name: 'Configure step' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Step name/), 'Review the flag');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Assignee role/), 'registry-administrator');
    await userEvent.type(within(dialog).getByLabelText(/Due after/), '48');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Escalate to role/), 'tenant-administrator');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and publish' }));

    expect(await screen.findByText('v1')).toBeVisible();
    expect(screen.getByText('Review the flag')).toBeVisible();
    expect(screen.getByText(/Outcomes: Approve \/ Reject/)).toBeVisible();
    expect(screen.getByText(/Escalates to tenant-administrator/)).toBeVisible();
    expect(versionBody).toMatchObject({
      step: {
        displayName: 'Review the flag',
        assigneeRoleCode: 'registry-administrator',
        dueAfterHours: 48,
        escalateToRoleCode: 'tenant-administrator',
      },
    });
  });
});
