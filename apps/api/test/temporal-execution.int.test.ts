/**
 * Live Temporal execution (ADR-024, plan Stages 2–5).
 *
 * Runs the API against real PostgreSQL and a real Temporal server (the
 * pinned CLI dev server image), with a real worker in this process. Mocks
 * cannot show durable execution, so nothing here stubs Temporal.
 */
import { randomUUID } from 'node:crypto';

import { NativeConnection, type Worker } from '@temporalio/worker';
import { createSrsWorker } from '@revelation-srs/workflow';
import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReviewExecutionService, type TemporalGateway } from '../src/platform/platform-controls/review-execution-service.js';
import { WorkflowEventOutbox } from '../src/platform/platform-controls/workflow-event-outbox.js';
import { AuditService } from '../src/platform/audit/service.js';
import { FeatureFlagService } from '../src/platform/platform-controls/feature-flag-service.js';
import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

const TEMPORAL_IMAGE = 'temporalio/temporal:1.10.0';
const NAMESPACE = 'srs-test';
const TASK_QUEUE = `srs-test-${randomUUID().slice(0, 8)}`;

let temporal: StartedTestContainer;
let address: string;
let ctx: TestApp;
let connection: NativeConnection;
let worker: Worker | null = null;
let workerRun: Promise<void> | null = null;

async function startWorker(): Promise<void> {
  worker = await createSrsWorker({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    activities: ctx.app.reviewActivitiesService.activities(),
  });
  workerRun = worker.run();
}

async function stopWorker(): Promise<void> {
  worker?.shutdown();
  await workerRun;
  worker = null;
  workerRun = null;
}

beforeAll(async () => {
  temporal = await new GenericContainer(TEMPORAL_IMAGE)
    .withCommand(['server', 'start-dev', '--ip', '0.0.0.0', '--namespace', NAMESPACE, '--headless'])
    .withExposedPorts(7233)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  address = `${temporal.getHost()}:${temporal.getMappedPort(7233)}`;

  ctx = await startTestApp({
    temporal: { address, namespace: NAMESPACE, taskQueue: TASK_QUEUE, decisionWaitMs: 3_000 },
  });
  connection = await NativeConnection.connect({ address });
  await startWorker();

  // Turn the rollout flag on for the primary test tenant only.
  await ctx.db.execute(sql`
    INSERT INTO feature_flag_assignment (tenant_id, flag_id, variant_id, status_code, priority, created_by)
    SELECT ${ctx.tenantId}::uuid, f.id, v.id, 'active', 10, 'test'
    FROM feature_flag f JOIN feature_flag_variant v ON v.flag_id = f.id AND v.variant_key = 'on'
    WHERE f.flag_key = 'workflow.temporal-execution'
  `);
}, 240_000);

afterAll(async () => {
  await stopWorker().catch(() => undefined);
  await connection?.close();
  await ctx?.teardown();
  await temporal?.stop();
}, 120_000);

// ── helpers ──────────────────────────────────────────────────────────────────

const REVIEW_STEP = 'review-and-decide';

async function publishedReview(step: Record<string, unknown> = {}) {
  const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  const definitionCode = `temporal-test-${randomUUID().slice(0, 8)}`;
  const def = await ctx.app.inject({
    method: 'POST', url: '/api/v1/workflow-definitions', headers: { authorization: `Bearer ${jwt}` },
    payload: { definitionCode, displayName: 'Temporal test review' },
  });
  const { workflowDefinitionId } = def.json<{ workflowDefinitionId: string }>();
  const version = await ctx.app.inject({
    method: 'POST', url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      step: {
        displayName: 'Review',
        assigneeRoleCode: 'registry-administrator',
        outcomeOptions: [{ code: 'approved', label: 'Approve' }, { code: 'rejected', label: 'Reject' }],
        ...step,
      },
    },
  });
  const { workflowDefinitionVersionId } = version.json<{ workflowDefinitionVersionId: string }>();
  await ctx.app.inject({
    method: 'POST', url: `/api/v1/workflow-definition-versions/${workflowDefinitionVersionId}/publish`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  return { workflowDefinitionVersionId, definitionCode };
}

async function startReview(opts: { step?: Record<string, unknown>; dueAt?: string } = {}) {
  const { workflowDefinitionVersionId, definitionCode } = await publishedReview(opts.step);
  const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  const res = await ctx.app.inject({
    method: 'POST', url: '/api/v1/workflow-instances', headers: { authorization: `Bearer ${jwt}` },
    payload: {
      workflowDefinitionVersionId,
      workflowCode: definitionCode,
      subjectEntityType: 'student',
      task: { stepKey: REVIEW_STEP, ...(opts.dueAt ? { dueAt: opts.dueAt } : {}) },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ workflowInstanceId: string; workflowTaskId: string; executionBackend: string; executionStatus: string }>();
}

async function decide(workflowTaskId: string, decisionCode: string, opts: { roles?: string[]; key?: string } = {}) {
  const jwt = await ctx.makeJwt({ roles: opts.roles ?? ['registry-administrator'] });
  return ctx.app.inject({
    method: 'POST', url: `/api/v1/workflow-tasks/${workflowTaskId}/completion`,
    headers: { authorization: `Bearer ${jwt}`, ...(opts.key ? { 'idempotency-key': opts.key } : {}) },
    payload: { decisionCode },
  });
}

async function row<T>(query: ReturnType<typeof sql>): Promise<T> {
  return (await ctx.db.execute(query) as unknown as T[])[0]!;
}

async function waitFor<T>(fn: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting; last value: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 250));
    value = await fn();
  }
  return value;
}

const taskRow = (id: string) => row<{ status_code: string; assignee_role_code: string | null; revision: number; attention_reason_code: string | null }>(
  sql`SELECT status_code, assignee_role_code, revision, attention_reason_code FROM workflow_task WHERE id = ${id}`);
const instanceRow = (id: string) => row<{ status_code: string; execution_status: string; execution_backend: string; temporal_run_id: string | null }>(
  sql`SELECT status_code, execution_status, execution_backend, temporal_run_id FROM workflow_instance WHERE id = ${id}`);

// ── generic reviews ──────────────────────────────────────────────────────────

describe('generic review on Temporal', () => {
  it('starts on Temporal and applies the real outcome (rejection is not recorded as approval)', async () => {
    const started = await startReview();
    expect(started).toMatchObject({ executionBackend: 'temporal', executionStatus: 'awaiting-decision' });
    expect((await instanceRow(started.workflowInstanceId)).temporal_run_id).toBeTruthy();

    const res = await decide(started.workflowTaskId, 'rejected');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'applied', decisionCode: 'rejected' });

    const audit = await row<{ decision_code: string }>(
      sql`SELECT decision_code FROM workflow_decision_audit WHERE workflow_instance_id = ${started.workflowInstanceId}`);
    expect(audit.decision_code).toBe('rejected');
    expect(await instanceRow(started.workflowInstanceId)).toMatchObject({ status_code: 'completed', execution_status: 'completed' });
    expect((await taskRow(started.workflowTaskId)).status_code).toBe('completed');
  });

  it('returns the same receipt for a repeated request and refuses a conflicting or second decision', async () => {
    const started = await startReview();
    const key = randomUUID();
    const first = await decide(started.workflowTaskId, 'approved', { key });
    const repeat = await decide(started.workflowTaskId, 'approved', { key });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json<{ commandId: string }>().commandId).toBe(first.json<{ commandId: string }>().commandId);

    expect((await decide(started.workflowTaskId, 'rejected', { key })).statusCode).toBe(409);
    expect((await decide(started.workflowTaskId, 'rejected')).statusCode).toBe(409);

    const decisions = await row<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workflow_decision_audit WHERE workflow_instance_id = ${started.workflowInstanceId}`);
    expect(decisions.n).toBe(1);
  });

  it('requires a decision when the task has outcome options', async () => {
    const started = await startReview();
    const jwt = await ctx.makeJwt({ roles: ['registry-administrator'] });
    const res = await ctx.app.inject({
      method: 'POST', url: `/api/v1/workflow-tasks/${started.workflowTaskId}/completion`,
      headers: { authorization: `Bearer ${jwt}` }, payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('two concurrent decisions produce exactly one applied decision', async () => {
    const started = await startReview();
    const results = await Promise.all([
      decide(started.workflowTaskId, 'approved'),
      decide(started.workflowTaskId, 'rejected', { roles: ['registry-administrator', 'tenant-administrator'] }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const decisions = await row<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workflow_decision_audit WHERE workflow_instance_id = ${started.workflowInstanceId}`);
    expect(decisions.n).toBe(1);
  });

  it('escalates at the deadline without the sweep, and the escalation role can then decide', async () => {
    const dueAt = new Date(Date.now() + 2_000).toISOString();
    const started = await startReview({ step: { escalateToRoleCode: 'tenant-administrator' }, dueAt });

    const escalated = await waitFor(() => taskRow(started.workflowTaskId), (t) => t.status_code === 'escalated');
    expect(escalated).toMatchObject({ assignee_role_code: 'tenant-administrator', revision: 1 });

    // The legacy sweep must not touch a Temporal-owned task.
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const sweep = await ctx.app.inject({
      method: 'POST', url: '/api/v1/workflow-tasks/sweep-overdue', headers: { authorization: `Bearer ${adminJwt}` },
    });
    expect(sweep.json<{ escalatedTaskIds: string[] }>().escalatedTaskIds).not.toContain(started.workflowTaskId);

    // The original role no longer holds the task; the escalation role does.
    expect((await decide(started.workflowTaskId, 'approved')).statusCode).toBe(403);
    const res = await decide(started.workflowTaskId, 'approved', { roles: ['tenant-administrator'] });
    expect(res.statusCode).toBe(200);
    expect((await instanceRow(started.workflowInstanceId)).status_code).toBe('completed');
  });

  it('flags needs-attention when the deadline passes with no escalation role, and never auto-completes', async () => {
    const dueAt = new Date(Date.now() + 1_000).toISOString();
    const started = await startReview({ dueAt });
    await waitFor(() => instanceRow(started.workflowInstanceId), (i) => i.execution_status === 'needs-attention');
    expect(await instanceRow(started.workflowInstanceId)).toMatchObject({ status_code: 'running' });
    expect((await taskRow(started.workflowTaskId)).attention_reason_code).toBe('deadline-passed-no-escalation-role');

    const res = await decide(started.workflowTaskId, 'approved');
    expect(res.statusCode).toBe(200);
  });

  it('refuses a decision after the deadline while escalation is still pending', async () => {
    await stopWorker();
    try {
      const dueAt = new Date(Date.now() + 500).toISOString();
      const started = await startReview({ step: { escalateToRoleCode: 'tenant-administrator' }, dueAt });
      await new Promise((r) => setTimeout(r, 1_000));
      const res = await decide(started.workflowTaskId, 'approved');
      expect(res.statusCode).toBe(409);
      expect(res.json<{ detail: string }>().detail).toMatch(/escalation is pending/);
    } finally {
      await startWorker();
    }
  });

  it('cancels through the review, and refuses administrative completion', async () => {
    const started = await startReview();
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const complete = await ctx.app.inject({
      method: 'POST', url: `/api/v1/workflow-instances/${started.workflowInstanceId}/completion`,
      headers: { authorization: `Bearer ${jwt}` }, payload: { statusCode: 'completed' },
    });
    expect(complete.statusCode).toBe(409);

    const cancel = await ctx.app.inject({
      method: 'POST', url: `/api/v1/workflow-instances/${started.workflowInstanceId}/completion`,
      headers: { authorization: `Bearer ${jwt}` }, payload: { statusCode: 'cancelled' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(await instanceRow(started.workflowInstanceId)).toMatchObject({ status_code: 'cancelled', execution_status: 'cancelled' });
    expect((await decide(started.workflowTaskId, 'approved')).statusCode).toBe(409);
  });

  it('keeps legacy starts for a tenant without the flag', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'], tenantId: ctx.secondTenantId });
    const definitionCode = `legacy-${randomUUID().slice(0, 8)}`;
    const def = await ctx.app.inject({
      method: 'POST', url: '/api/v1/workflow-definitions', headers: { authorization: `Bearer ${jwt}` },
      payload: { definitionCode, displayName: 'Legacy review' },
    });
    const { workflowDefinitionId } = def.json<{ workflowDefinitionId: string }>();
    const version = await ctx.app.inject({
      method: 'POST', url: `/api/v1/workflow-definitions/${workflowDefinitionId}/versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { step: { displayName: 'Review', assigneeRoleCode: 'registry-administrator', outcomeOptions: [{ code: 'ok', label: 'OK' }] } },
    });
    const { workflowDefinitionVersionId } = version.json<{ workflowDefinitionVersionId: string }>();
    await ctx.app.inject({
      method: 'POST', url: `/api/v1/workflow-definition-versions/${workflowDefinitionVersionId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/workflow-instances', headers: { authorization: `Bearer ${jwt}` },
      payload: { workflowDefinitionVersionId, workflowCode: definitionCode, subjectEntityType: 'student', task: { stepKey: REVIEW_STEP } },
    });
    expect(res.json()).toMatchObject({ executionBackend: 'legacy' });
  });
});

// ── recovery ─────────────────────────────────────────────────────────────────

describe('recovery', () => {
  it('keeps a decision made while the worker is down and applies it after restart', async () => {
    const started = await startReview();
    await stopWorker();
    let commandId: string;
    try {
      const res = await decide(started.workflowTaskId, 'approved');
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ status: 'pending' });
      commandId = res.json<{ commandId: string }>().commandId;
      expect((await instanceRow(started.workflowInstanceId)).status_code).toBe('running');
    } finally {
      await startWorker();
    }

    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const reconcile = await ctx.app.inject({
      method: 'POST', url: '/api/v1/workflow-execution/reconcile', headers: { authorization: `Bearer ${jwt}` },
    });
    expect(reconcile.json<{ commandsRedelivered: number }>().commandsRedelivered).toBeGreaterThanOrEqual(1);

    const status = await waitFor(
      async () => (await ctx.app.inject({
        method: 'GET', url: `/api/v1/workflow-commands/${commandId!}`, headers: { authorization: `Bearer ${jwt}` },
      })).json<{ status: string }>(),
      (s) => s.status === 'applied',
    );
    expect(status.status).toBe('applied');
    expect((await instanceRow(started.workflowInstanceId)).status_code).toBe('completed');
  });

  it('a waiting review survives a worker restart and still escalates on time', async () => {
    const dueAt = new Date(Date.now() + 4_000).toISOString();
    const started = await startReview({ step: { escalateToRoleCode: 'tenant-administrator' }, dueAt });
    await stopWorker();
    await startWorker();
    await waitFor(() => taskRow(started.workflowTaskId), (t) => t.status_code === 'escalated');
  });

  it('starts a review that was saved while Temporal was unreachable', async () => {
    const unreachable: TemporalGateway = {
      startReview: () => Promise.reject(new Error('connection refused')),
      submitCommand: () => Promise.reject(new Error('connection refused')),
      signalCommand: () => Promise.reject(new Error('connection refused')),
    };
    const disconnectedBus = { isConnected: () => false } as unknown as IntegrationBusPublisher;
    const offline = new ReviewExecutionService(
      ctx.db, new AuditService(ctx.db), new WorkflowEventOutbox(ctx.db, disconnectedBus), new FeatureFlagService(ctx.db),
      { enabled: true, namespace: NAMESPACE, taskQueue: TASK_QUEUE, environmentCode: 'test', decisionWaitMs: 1_000 },
      unreachable,
    );
    const { workflowDefinitionVersionId, definitionCode } = await publishedReview();
    const saved = await offline.startReview({
      tenantId: ctx.tenantId, workflowDefinitionVersionId, workflowCode: definitionCode,
      subjectEntityType: 'student', startedBy: 'test-user-001', context: {},
      task: { stepKey: REVIEW_STEP, assigneeRoleCode: 'registry-administrator', payload: {} },
    });
    expect(saved.executionStatus).toBe('starting');

    // A decision made before the start reaches Temporal is saved, not lost.
    const early = await offline.submitCommand({
      tenantId: ctx.tenantId, workflowTaskId: saved.workflowTaskId, actorId: 'test-user-001',
      commandType: 'decision', decisionCode: 'approved',
    });
    expect(early.status).toBe('pending');

    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const reconcile = await ctx.app.inject({
      method: 'POST', url: '/api/v1/workflow-execution/reconcile', headers: { authorization: `Bearer ${jwt}` },
    });
    expect(reconcile.json<{ startsRetried: number }>().startsRetried).toBeGreaterThanOrEqual(1);
    await waitFor(() => instanceRow(saved.workflowInstanceId), (i) => i.status_code === 'completed');
  });

  it('retrying an applied command returns the first result and changes nothing', async () => {
    const started = await startReview();
    const res = await decide(started.workflowTaskId, 'approved');
    const { commandId } = res.json<{ commandId: string }>();
    const again = await ctx.app.reviewActivitiesService.applyReviewCommand({
      tenantId: ctx.tenantId, workflowInstanceId: started.workflowInstanceId, commandId,
    });
    expect(again).toMatchObject({ outcome: 'applied', instanceClosed: true });
    const decisions = await row<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workflow_decision_audit WHERE workflow_instance_id = ${started.workflowInstanceId}`);
    expect(decisions.n).toBe(1);
  });

  it('ignores a command from another tenant or a forged command ID', async () => {
    const started = await startReview();
    const res = await decide(started.workflowTaskId, 'approved');
    const { commandId } = res.json<{ commandId: string }>();

    const crossTenant = await ctx.app.reviewActivitiesService.applyReviewCommand({
      tenantId: ctx.secondTenantId, workflowInstanceId: started.workflowInstanceId, commandId,
    });
    expect(crossTenant).toMatchObject({ outcome: 'superseded', errorCode: 'unknown-command' });

    const forged = await ctx.app.reviewActivitiesService.applyReviewCommand({
      tenantId: ctx.tenantId, workflowInstanceId: started.workflowInstanceId, commandId: randomUUID(),
    });
    expect(forged).toMatchObject({ outcome: 'superseded', errorCode: 'unknown-command' });
  });

  it('saves workflow events while NATS is down', async () => {
    const before = await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM workflow_event_outbox WHERE published_at IS NULL`);
    await startReview();
    const after = await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM workflow_event_outbox WHERE published_at IS NULL`);
    expect(after.n).toBeGreaterThan(before.n);
  });
});

// ── module registration pilot ────────────────────────────────────────────────

describe('module registration change approval on Temporal', () => {
  let regJwt: string;
  let studentJwt: string;
  let tutorJwt: string;
  let enrolmentId: string;
  let periodId: string;

  async function offering(code: string, capacity = 20): Promise<string> {
    const mod = await ctx.app.inject({
      method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${regJwt}` },
      payload: { code, title: `Temporal ${code}`, creditValue: 20 },
    });
    const off = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${regJwt}` },
      payload: { moduleId: mod.json<{ moduleId: string }>().moduleId, academicPeriodId: periodId, deliveryModeCode: 'in-person', capacity },
    });
    return off.json<{ moduleOfferingId: string }>().moduleOfferingId;
  }

  async function request(moduleOfferingId: string): Promise<string> {
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations/requests', headers: { authorization: `Bearer ${studentJwt}` },
      payload: { enrolmentId, moduleOfferingId, registrationDate: '2026-10-01' },
    });
    expect(res.statusCode).toBe(202);
    return res.json<{ workflowInstanceId: string }>().workflowInstanceId;
  }

  async function decideRequest(workflowInstanceId: string, decisionCode: 'approved' | 'rejected') {
    return ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registration-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` }, payload: { decisionCode },
    });
  }

  async function registrationsFor(moduleOfferingId: string) {
    const res = await ctx.app.inject({
      method: 'GET', url: `/api/v1/module-registrations?enrolmentId=${enrolmentId}&moduleOfferingId=${moduleOfferingId}`,
      headers: { authorization: `Bearer ${regJwt}` },
    });
    return res.json<Array<{ moduleRegistrationId: string; statusCode: string }>>();
  }

  beforeAll(async () => {
    regJwt = await ctx.makeJwt();
    const period = await ctx.app.inject({
      method: 'POST', url: '/api/v1/academic-periods', headers: { authorization: `Bearer ${regJwt}` },
      payload: { academicYear: '2026-27', periodCode: 'TMP-SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15' },
    });
    periodId = period.json<{ academicPeriodId: string }>().academicPeriodId;
    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${regJwt}` },
      payload: { legalFirstName: 'Tempo', legalFamilyName: 'Ral' },
    });
    const personId = student.json<{ personId: string }>().personId;
    const enrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${regJwt}` },
      payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' },
    });
    enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;
    studentJwt = await ctx.makeJwt({ roles: ['student'], srsPersonId: personId });
    tutorJwt = await ctx.makeJwt({ roles: ['personal-tutor'] });
  });

  it('runs on Temporal and applies an approval exactly once', async () => {
    const offeringId = await offering('TMP101');
    const instanceId = await request(offeringId);
    expect((await instanceRow(instanceId)).execution_backend).toBe('temporal');

    const res = await decideRequest(instanceId, 'approved');
    expect(res.statusCode).toBe(200);
    const { moduleRegistrationId } = res.json<{ moduleRegistrationId: string }>();
    expect(await registrationsFor(offeringId)).toEqual([
      expect.objectContaining({ moduleRegistrationId, statusCode: 'registered' }),
    ]);
    expect((await instanceRow(instanceId)).status_code).toBe('completed');

    // Replaying the activity (as Temporal would after a worker crash) does not register twice.
    const { id: commandId } = await row<{ id: string }>(
      sql`SELECT id FROM workflow_command WHERE workflow_instance_id = ${instanceId}`);
    await ctx.db.execute(sql`DELETE FROM workflow_operation_receipt WHERE operation_key = ${`command:${commandId}`}`);
    await ctx.db.execute(sql`UPDATE workflow_command SET delivery_state = 'delivered' WHERE id = ${commandId}`);
    await ctx.db.execute(sql`UPDATE workflow_task SET status_code = 'assigned' WHERE workflow_instance_id = ${instanceId}`);
    await ctx.app.reviewActivitiesService.applyReviewCommand({ tenantId: ctx.tenantId, workflowInstanceId: instanceId, commandId });
    expect(await registrationsFor(offeringId)).toHaveLength(1);
  });

  it('a rejection makes no registration change', async () => {
    const offeringId = await offering('TMP102');
    const instanceId = await request(offeringId);
    const res = await decideRequest(instanceId, 'rejected');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ moduleRegistrationId: null });
    expect(await registrationsFor(offeringId)).toHaveLength(0);
  });

  it('a failed change keeps the decision visible, leaves the request open, and a later decision succeeds', async () => {
    const offeringId = await offering('TMP103');
    const instanceId = await request(offeringId);
    const direct = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${regJwt}` },
      payload: { enrolmentId, moduleOfferingId: offeringId, registrationDate: '2026-10-01' },
    });
    const directId = direct.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

    const failed = await decideRequest(instanceId, 'approved');
    expect(failed.statusCode).toBe(409);
    expect(failed.json<{ detail: string }>().detail).toMatch(/Decision recorded, but the registration change was not applied/);
    expect(await instanceRow(instanceId)).toMatchObject({ status_code: 'running', execution_status: 'awaiting-decision' });
    const recorded = await row<{ decision_code: string; metadata: { changeApplied: boolean } }>(
      sql`SELECT decision_code, metadata FROM workflow_decision_audit WHERE workflow_instance_id = ${instanceId}`);
    expect(recorded).toMatchObject({ decision_code: 'approved', metadata: { changeApplied: false } });

    await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registrations/${directId}/withdrawal`,
      headers: { authorization: `Bearer ${regJwt}` }, payload: {},
    });
    const retried = await decideRequest(instanceId, 'approved');
    expect(retried.statusCode).toBe(200);
    expect((await instanceRow(instanceId)).status_code).toBe('completed');
  });
});
