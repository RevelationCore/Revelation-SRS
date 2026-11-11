import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function createCustomDefinition(): Promise<{ workflowDefinitionId: string }> {
  const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/workflow-definitions',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      definitionCode: `builder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      displayName: 'Data quality flag review',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ workflowDefinitionId: string }>();
}

const STEP_INPUT = {
  step: {
    displayName: 'Review the flag',
    assigneeRoleCode: 'registry-administrator',
    outcomeOptions: [
      { code: 'approved', label: 'Approve' },
      { code: 'rejected', label: 'Reject' },
    ],
    dueAfterHours: 48,
    escalateToRoleCode: 'tenant-administrator',
  },
};

describe('generic workflow authoring', () => {
  it('creates a draft version with an auto-generated start/task/end step shape and an assignment rule', async () => {
    const { workflowDefinitionId } = await createCustomDefinition();
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });

    const versionRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: STEP_INPUT,
    });
    expect(versionRes.statusCode).toBe(201);
    const { workflowDefinitionVersionId, versionNumber } = versionRes.json<{
      workflowDefinitionVersionId: string;
      versionNumber: number;
    }>();
    expect(versionNumber).toBe(1);

    const versionsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const [version] = versionsRes.json<Array<{
      workflowDefinitionVersionId: string;
      statusCode: string;
      steps: Array<{ stepKey: string; stepTypeCode: string; configuration: Record<string, unknown> }>;
    }>>();
    expect(version!.statusCode).toBe('draft');
    const stepKeys = version!.steps.map((s) => s.stepKey).sort();
    expect(stepKeys).toEqual(['end', 'review-and-decide', 'start']);
    const taskStep = version!.steps.find((s) => s.stepTypeCode === 'human-task')!;
    expect(taskStep.configuration['outcomeOptions']).toEqual(STEP_INPUT.step.outcomeOptions);
    expect(taskStep.configuration['dueAfterHours']).toBe(48);
    expect(taskStep.configuration['escalateToRoleCode']).toBe('tenant-administrator');

    const rulesRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workflow-assignment-rules?workflowDefinitionVersionId=${workflowDefinitionVersionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const rules = rulesRes.json<Array<{ stepKey: string; assigneeRoleCode: string | null }>>();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.stepKey).toBe('review-and-decide');
    expect(rules[0]!.assigneeRoleCode).toBe('registry-administrator');
  });

  it('rejects authoring against a definition that is not admin-authored ("custom")', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-definitions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        definitionCode: `bespoke-test-${Date.now()}`,
        displayName: 'Bespoke module workflow',
        ownerModuleCode: 'registration',
      },
    });
    const { workflowDefinitionId } = createRes.json<{ workflowDefinitionId: string }>();

    const versionRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: STEP_INPUT,
    });
    expect(versionRes.statusCode).toBe(422);
  });

  it('rejects a step with no outcome options at the schema level', async () => {
    const { workflowDefinitionId } = await createCustomDefinition();
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { step: { ...STEP_INPUT.step, outcomeOptions: [] } },
    });
    // Caught by the route's TypeBox minItems: 1 constraint before the
    // service's own ValidationError check ever runs.
    expect(res.statusCode).toBe(400);
  });

  it('publishing a draft version activates it and sets the definition\'s current version number', async () => {
    const { workflowDefinitionId } = await createCustomDefinition();
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const versionRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: STEP_INPUT,
    });
    const { workflowDefinitionVersionId } = versionRes.json<{ workflowDefinitionVersionId: string }>();

    const publishRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definition-versions/${workflowDefinitionVersionId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(publishRes.statusCode).toBe(204);

    const defRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const definition = defRes.json<{ currentVersionNumber: number | null; statusCode: string }>();
    expect(definition.currentVersionNumber).toBe(1);
    expect(definition.statusCode).toBe('active');
  });
});

describe('generic workflow: start, decide, and audit', () => {
  async function publishedGenericWorkflow(step = STEP_INPUT) {
    const { workflowDefinitionId } = await createCustomDefinition();
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const versionRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: step,
    });
    const { workflowDefinitionVersionId } = versionRes.json<{ workflowDefinitionVersionId: string }>();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definition-versions/${workflowDefinitionVersionId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const defRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const { definitionCode } = defRes.json<{ definitionCode: string }>();
    return { workflowDefinitionId, workflowDefinitionVersionId, definitionCode };
  }

  it('resolves the assignee from the assignment rule (not an explicit passthrough) and can be decided', async () => {
    const { workflowDefinitionVersionId, definitionCode } = await publishedGenericWorkflow();
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });

    const startRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-instances',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        workflowDefinitionVersionId,
        workflowCode: definitionCode,
        subjectEntityType: 'student',
        task: { stepKey: 'review-and-decide' },
      },
    });
    expect(startRes.statusCode).toBe(201);
    const { workflowInstanceId, workflowTaskId } = startRes.json<{
      workflowInstanceId: string;
      workflowTaskId: string;
    }>();
    expect(workflowTaskId).toBeTruthy();

    const registryJwt = await ctx.makeJwt({ roles: ['registry-administrator'] });
    const taskListRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workflow-tasks?workflowInstanceId=${workflowInstanceId}`,
      headers: { authorization: `Bearer ${registryJwt}` },
    });
    const [task] = taskListRes.json<Array<{
      workflowTaskId: string;
      assigneeRoleCode: string | null;
      outcomeOptions: Array<{ code: string; label: string }> | null;
    }>>();
    expect(task!.assigneeRoleCode).toBe('registry-administrator');
    expect(task!.outcomeOptions).toEqual(STEP_INPUT.step.outcomeOptions);

    const rejectInvalidRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-tasks/${workflowTaskId}/completion`,
      headers: { authorization: `Bearer ${registryJwt}` },
      payload: { decisionCode: 'not-a-real-option' },
    });
    expect(rejectInvalidRes.statusCode).toBe(422);

    const decideRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-tasks/${workflowTaskId}/completion`,
      headers: { authorization: `Bearer ${registryJwt}` },
      payload: { decisionCode: 'approved', note: 'looks fine' },
    });
    expect(decideRes.statusCode).toBe(204);

    const auditRows = await ctx.db.execute(sql`
      SELECT decision_code, gateway_key, metadata FROM workflow_decision_audit
      WHERE workflow_instance_id = ${workflowInstanceId}
    `);
    const audit = (auditRows as unknown as Array<{ decision_code: string; gateway_key: string; metadata: Record<string, unknown> }>)[0];
    expect(audit?.decision_code).toBe('approved');
    expect(audit?.gateway_key).toBe('review-and-decide:completion');
    expect(audit?.metadata).toMatchObject({ note: 'looks fine' });

    const instanceRows = await ctx.db.execute(sql`
      SELECT status_code FROM workflow_instance WHERE id = ${workflowInstanceId}
    `);
    expect((instanceRows as unknown as Array<{ status_code: string }>)[0]?.status_code).toBe('completed');
  });
});

describe('escalation sweep', () => {
  it('escalates an overdue task once, reassigning it if the step configured an escalation role, and is idempotent on repeat sweeps', async () => {
    const { workflowDefinitionVersionId, definitionCode } = await publishedGenericWorkflowFixture();
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const pastDueAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const startRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-instances',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        workflowDefinitionVersionId,
        workflowCode: definitionCode,
        subjectEntityType: 'student',
        task: { stepKey: 'review-and-decide', dueAt: pastDueAt },
      },
    });
    const { workflowTaskId } = startRes.json<{ workflowTaskId: string }>();

    const firstSweep = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-tasks/sweep-overdue',
      headers: { authorization: `Bearer ${adminJwt}` },
    });
    expect(firstSweep.statusCode).toBe(200);
    expect(firstSweep.json<{ escalatedTaskIds: string[] }>().escalatedTaskIds).toContain(workflowTaskId);

    const taskRows = await ctx.db.execute(sql`
      SELECT status_code, assignee_role_code FROM workflow_task WHERE id = ${workflowTaskId}
    `);
    const taskRow = (taskRows as unknown as Array<{ status_code: string; assignee_role_code: string | null }>)[0];
    expect(taskRow?.status_code).toBe('escalated');
    expect(taskRow?.assignee_role_code).toBe('tenant-administrator');

    const secondSweep = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-tasks/sweep-overdue',
      headers: { authorization: `Bearer ${adminJwt}` },
    });
    expect(secondSweep.json<{ escalatedTaskIds: string[] }>().escalatedTaskIds).not.toContain(workflowTaskId);
  });

  it('leaves tasks that are not yet due untouched', async () => {
    const { workflowDefinitionVersionId, definitionCode } = await publishedGenericWorkflowFixture();
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const futureDueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const startRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-instances',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        workflowDefinitionVersionId,
        workflowCode: definitionCode,
        subjectEntityType: 'student',
        task: { stepKey: 'review-and-decide', dueAt: futureDueAt },
      },
    });
    const { workflowTaskId } = startRes.json<{ workflowTaskId: string }>();

    const sweep = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-tasks/sweep-overdue',
      headers: { authorization: `Bearer ${adminJwt}` },
    });
    expect(sweep.json<{ escalatedTaskIds: string[] }>().escalatedTaskIds).not.toContain(workflowTaskId);
  });

  async function publishedGenericWorkflowFixture() {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/workflow-definitions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        definitionCode: `builder-sweep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        displayName: 'Escalation fixture',
      },
    });
    const { workflowDefinitionId } = createRes.json<{ workflowDefinitionId: string }>();
    const versionRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: STEP_INPUT,
    });
    const { workflowDefinitionVersionId } = versionRes.json<{ workflowDefinitionVersionId: string }>();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/workflow-definition-versions/${workflowDefinitionVersionId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const defRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workflow-definitions/${workflowDefinitionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const { definitionCode } = defRes.json<{ definitionCode: string }>();
    return { workflowDefinitionId, workflowDefinitionVersionId, definitionCode };
  }
});
