/**
 * ADR-024 Stage 6a: the bridge-based approval families on Temporal.
 *
 * Real PostgreSQL, a real Temporal dev server and a real worker, as in
 * temporal-execution.int.test.ts. Each family must apply its business change
 * exactly once, make no change on rejection, and keep the decision and the
 * open request when the change fails. The legacy bridge must now apply the
 * change before it closes the request.
 */
import { randomUUID } from 'node:crypto';

import { NativeConnection, type Worker } from '@temporalio/worker';
import { createSrsWorker } from '@revelation-srs/workflow';
import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

const TEMPORAL_IMAGE = 'temporalio/temporal:1.10.0';
const NAMESPACE = 'srs-test';
const TASK_QUEUE = `srs-6a-${randomUUID().slice(0, 8)}`;

let temporal: StartedTestContainer;
let ctx: TestApp;
let connection: NativeConnection;
let worker: Worker | null = null;
let workerRun: Promise<void> | null = null;

beforeAll(async () => {
  temporal = await new GenericContainer(TEMPORAL_IMAGE)
    .withCommand(['server', 'start-dev', '--ip', '0.0.0.0', '--namespace', NAMESPACE, '--headless'])
    .withExposedPorts(7233)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const address = `${temporal.getHost()}:${temporal.getMappedPort(7233)}`;

  ctx = await startTestApp({ temporal: { address, namespace: NAMESPACE, taskQueue: TASK_QUEUE, decisionWaitMs: 3_000 } });
  connection = await NativeConnection.connect({ address });
  worker = await createSrsWorker({
    connection, namespace: NAMESPACE, taskQueue: TASK_QUEUE, activities: ctx.app.reviewActivitiesService.activities(),
  });
  workerRun = worker.run();

  // Rollout flag on for the primary tenant only; the second tenant stays on the legacy bridge.
  await ctx.db.execute(sql`
    INSERT INTO feature_flag_assignment (tenant_id, flag_id, variant_id, status_code, priority, created_by)
    SELECT ${ctx.tenantId}::uuid, f.id, v.id, 'active', 10, 'test'
    FROM feature_flag f JOIN feature_flag_variant v ON v.flag_id = f.id AND v.variant_key = 'on'
    WHERE f.flag_key = 'workflow.temporal-execution'
  `);
}, 240_000);

afterAll(async () => {
  worker?.shutdown();
  await workerRun?.catch(() => undefined);
  await connection?.close();
  await ctx?.teardown();
  await temporal?.stop();
}, 120_000);

async function row<T>(query: ReturnType<typeof sql>): Promise<T> {
  return (await ctx.db.execute(query) as unknown as T[])[0]!;
}

const instanceRow = (id: string) => row<{ status_code: string; execution_status: string; execution_backend: string }>(
  sql`SELECT status_code, execution_status, execution_backend FROM workflow_instance WHERE id = ${id}`);

/** Re-run the applied command's activity, as Temporal would after a worker crash. */
async function replayAppliedCommand(workflowInstanceId: string): Promise<void> {
  const { id: commandId } = await row<{ id: string }>(
    sql`SELECT id FROM workflow_command WHERE workflow_instance_id = ${workflowInstanceId}`);
  await ctx.db.execute(sql`DELETE FROM workflow_operation_receipt WHERE operation_key = ${`command:${commandId}`}`);
  await ctx.db.execute(sql`UPDATE workflow_command SET delivery_state = 'delivered' WHERE id = ${commandId}`);
  await ctx.db.execute(sql`UPDATE workflow_task SET status_code = 'assigned' WHERE workflow_instance_id = ${workflowInstanceId}`);
  await ctx.app.reviewActivitiesService.applyReviewCommand({ tenantId: ctx.tenantId, workflowInstanceId, commandId });
}

describe('coverage', () => {
  it('registers a worker effect for every Stage 6a approval that changes a record', () => {
    expect(ctx.app.reviewActivitiesService.effectWorkflowCodes()).toEqual([
      'hesa-return-submission-approval',
      'legal-identity-change-approval',
      'module-allocation-run',
      'module-registration-change-approval',
      'module-selection-approval',
      'ofs-extract-generation-approval',
      'slc-confirmation-submission-approval',
      'ucas-confirmation-submission-approval',
    ]); // the CAS submission workflow was retired: a CAS case has its own approval (D-16)
  });
});

describe('legal identity change on Temporal', () => {
  let adminJwt: string;
  let studentJwt: string;
  let tutorJwt: string;
  let personId: string;

  beforeAll(async () => {
    adminJwt = await ctx.makeJwt();
    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${adminJwt}` },
      payload: { legalFirstName: 'Ida', legalFamilyName: 'Entity' },
    });
    personId = student.json<{ personId: string }>().personId;
    studentJwt = await ctx.makeJwt({ roles: ['student'], srsPersonId: personId });
    tutorJwt = await ctx.makeJwt({ roles: ['personal-tutor'] });
  });

  async function requestChange(nationalityCode: string): Promise<string> {
    const res = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/identity-change-requests`,
      headers: { authorization: `Bearer ${studentJwt}` }, payload: { nationalityCode },
    });
    expect(res.statusCode).toBe(202);
    return res.json<{ workflowInstanceId: string }>().workflowInstanceId;
  }

  const decide = (workflowInstanceId: string, decisionCode: 'approved' | 'rejected', jwt = tutorJwt) => ctx.app.inject({
    method: 'POST', url: `/api/v1/identity-change-requests/${workflowInstanceId}/decision`,
    headers: { authorization: `Bearer ${jwt}` }, payload: { decisionCode },
  });

  const nationality = async () => (await ctx.app.inject({
    method: 'GET', url: `/api/v1/students/${personId}`, headers: { authorization: `Bearer ${adminJwt}` },
  })).json<{ identity: { nationalityCode: string | null } }>().identity.nationalityCode;

  const identityVersions = async () => Number((await row<{ n: string }>(
    sql`SELECT count(*) AS n FROM person_identity WHERE person_id = ${personId}`)).n);

  it('runs on Temporal and applies an approval exactly once', async () => {
    const instanceId = await requestChange('FRA');
    expect((await instanceRow(instanceId)).execution_backend).toBe('temporal');

    expect((await decide(instanceId, 'approved')).statusCode).toBe(204);
    expect(await nationality()).toBe('FRA');
    expect((await instanceRow(instanceId)).status_code).toBe('completed');

    const versions = await identityVersions();
    await replayAppliedCommand(instanceId);
    expect(await identityVersions()).toBe(versions);
  });

  it('a rejection changes nothing', async () => {
    const instanceId = await requestChange('DEU');
    expect((await decide(instanceId, 'rejected')).statusCode).toBe(204);
    expect(await nationality()).toBe('FRA');
  });

  it('a failed change keeps the decision, leaves the request open, and a later decision succeeds', async () => {
    const instanceId = await requestChange('ESP');
    // A current identity version dated in the future makes the change invalid.
    await ctx.db.execute(sql`
      UPDATE person_identity SET valid_from = now() + interval '1 day'
      WHERE person_id = ${personId} AND recorded_until IS NULL`);

    const failed = await decide(instanceId, 'approved');
    expect(failed.statusCode).toBe(409);
    expect(failed.json<{ detail: string }>().detail).toMatch(/Decision recorded, but the change was not applied/);
    expect(await instanceRow(instanceId)).toMatchObject({ status_code: 'running', execution_status: 'awaiting-decision' });
    expect(await nationality()).toBe('FRA');

    await ctx.db.execute(sql`
      UPDATE person_identity SET valid_from = now() - interval '1 day'
      WHERE person_id = ${personId} AND recorded_until IS NULL`);
    expect((await decide(instanceId, 'approved')).statusCode).toBe(204);
    expect(await nationality()).toBe('ESP');
  });

  it('the student cannot decide their own request', async () => {
    const instanceId = await requestChange('ITA');
    expect((await decide(instanceId, 'approved', studentJwt)).statusCode).toBe(403);
    expect((await instanceRow(instanceId)).status_code).toBe('running');
  });
});

describe('OfS extract generation on Temporal', () => {
  it('generates one extract for an approval, even when the activity is replayed', async () => {
    const jwt = await ctx.makeJwt();
    const request = await ctx.app.inject({
      method: 'POST', url: '/api/v1/regulatory/ofs/generation-requests', headers: { authorization: `Bearer ${jwt}` },
      payload: { extractTypeCode: 'b3-student-outcomes', academicYear: '2040-41' },
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();
    expect((await instanceRow(workflowInstanceId)).execution_backend).toBe('temporal');

    const decided = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` }, payload: { decisionCode: 'approved' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json<{ extractId: string | null }>().extractId).not.toBeNull();

    const count = async () => Number((await row<{ n: string }>(
      sql`SELECT count(*) AS n FROM ofs_extract WHERE tenant_id = ${ctx.tenantId} AND academic_year = '2040-41'`)).n);
    expect(await count()).toBe(1);
    await replayAppliedCommand(workflowInstanceId);
    expect(await count()).toBe(1);
  });
});

describe('SLC confirmation submission on Temporal', () => {
  it('submits the snapshotted batch once, even when the activity is replayed', async () => {
    const jwt = await ctx.makeJwt();
    const person = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Sal', legalFamilyName: 'Sixa' },
    });
    const enrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId: person.json<{ personId: string }>().personId, modeOfStudyCode: 'full-time',
        academicYearOfEntry: '2027-28', startDate: '2027-09-20', feeBandCode: 'home-undergraduate',
        slcReference: 'SLC-6A-001', fundingSourceCode: 'slc',
      },
    });
    const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

    const request = await ctx.app.inject({
      method: 'POST', url: '/api/v1/regulatory/slc/confirmations/requests', headers: { authorization: `Bearer ${jwt}` }, payload: {},
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId, recordCount } = request.json<{ workflowInstanceId: string; recordCount: number }>();
    expect((await instanceRow(workflowInstanceId)).execution_backend).toBe('temporal');

    const decided = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/slc/confirmations/requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` }, payload: { decisionCode: 'approved' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json<{ processedCount: number }>().processedCount).toBe(recordCount);

    const trigger = () => row<{ status_code: string; sent_at: Date }>(sql`
      SELECT status_code, sent_at FROM enrolment_downstream_trigger
      WHERE enrolment_id = ${enrolmentId} AND trigger_type_code = 'slc-confirmation'`);
    const before = await trigger();
    expect(before.status_code).toBe('processed');
    await replayAppliedCommand(workflowInstanceId);
    expect(await trigger()).toEqual(before);
  });
});

describe('legacy bridge (tenant without the rollout flag)', () => {
  it('applies the change before closing, so a failed change leaves the request open', async () => {
    const adminJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${adminJwt}` },
      payload: { legalFirstName: 'Leg', legalFamilyName: 'Acy' },
    });
    const personId = student.json<{ personId: string }>().personId;
    const studentJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['student'], srsPersonId: personId });
    const tutorJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['personal-tutor'] });

    const request = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${personId}/identity-change-requests`,
      headers: { authorization: `Bearer ${studentJwt}` }, payload: { nationalityCode: 'FRA' },
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();
    expect((await instanceRow(workflowInstanceId)).execution_backend).not.toBe('temporal');

    await ctx.db.execute(sql`
      UPDATE person_identity SET valid_from = now() + interval '1 day'
      WHERE person_id = ${personId} AND recorded_until IS NULL`);
    const failed = await ctx.app.inject({
      method: 'POST', url: `/api/v1/identity-change-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` }, payload: { decisionCode: 'approved' },
    });
    expect(failed.statusCode).toBe(422);
    expect((await instanceRow(workflowInstanceId)).status_code).toBe('running');

    await ctx.db.execute(sql`
      UPDATE person_identity SET valid_from = now() - interval '1 day'
      WHERE person_id = ${personId} AND recorded_until IS NULL`);
    const retried = await ctx.app.inject({
      method: 'POST', url: `/api/v1/identity-change-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` }, payload: { decisionCode: 'approved' },
    });
    expect(retried.statusCode).toBe(204);
    expect((await instanceRow(workflowInstanceId)).status_code).toBe('completed');
  });
});

describe('module selection approval on Temporal', () => {
  let jwt: string;
  let approverJwt: string;
  let academicPeriodId: string;

  async function post<T>(url: string, payload: Record<string, unknown>, as = jwt): Promise<T> {
    const res = await ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${as}` }, payload });
    expect(res.statusCode, `${url}: ${res.body}`).toBeLessThan(300);
    return res.json<T>();
  }

  /** A proposal waitlisted because its one module offering is already full. */
  async function waitlistedProposal(code: string): Promise<{ proposalId: string; enrolmentId: string }> {
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const { programmeId } = await post<{ programmeId: string }>('/api/v1/programmes', { code, title: `Programme ${code}`, fheqLevel: 4, creditTotal: 120 });
    await post('/api/v1/programme-rule-sets', { programmeId, ruleSetCode: 'default' }, adminJwt);
    const { moduleId } = await post<{ moduleId: string }>('/api/v1/modules', { code: `${code}-M`, title: 'Oversubscribed', creditValue: 20, fheqLevel: 4 });
    const { moduleOfferingId } = await post<{ moduleOfferingId: string }>('/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 1 });
    const enrol = async (name: string) => {
      const { personId } = await post<{ personId: string }>('/api/v1/students', { legalFirstName: name, legalFamilyName: code });
      return (await post<{ enrolmentId: string }>('/api/v1/enrolments', {
        personId, programmeId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
      })).enrolmentId;
    };
    const filler = await enrol('Filler');
    await post('/api/v1/module-registrations', { enrolmentId: filler, moduleOfferingId, registrationDate: '2026-10-01' });
    const enrolmentId = await enrol('Waiting');
    const { moduleSelectionProposalId: proposalId } = await post<{ moduleSelectionProposalId: string }>(
      '/api/v1/module-selection-proposals', { enrolmentId, academicPeriodId, fheqLevel: 4 });
    await post(`/api/v1/module-selection-proposals/${proposalId}/items`, { moduleId, moduleOfferingId });
    const submitted = await post<{ statusCode: string }>(`/api/v1/module-selection-proposals/${proposalId}/submission`, {});
    expect(submitted.statusCode).toBe('waitlisted');
    return { proposalId, enrolmentId };
  }

  const instanceFor = async (proposalId: string) => (await row<{ workflow_instance_id: string }>(sql`
    SELECT workflow_instance_id FROM module_selection_proposal WHERE id = ${proposalId} AND recorded_until IS NULL`)).workflow_instance_id;

  const registrationCount = async (enrolmentId: string) => Number((await row<{ n: string }>(
    sql`SELECT count(*) AS n FROM module_registration WHERE enrolment_id = ${enrolmentId} AND recorded_until IS NULL`)).n);

  beforeAll(async () => {
    jwt = await ctx.makeJwt();
    approverJwt = await ctx.makeJwt({ roles: ['programme-approver'] });
    ({ academicPeriodId } = await post<{ academicPeriodId: string }>('/api/v1/academic-periods', {
      academicYear: '2026-27', periodCode: 'MS6A-SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15',
    }));
  });

  it('confirms an approved proposal once, even when the activity is replayed', async () => {
    const { proposalId, enrolmentId } = await waitlistedProposal('MS6A-1');
    const instanceId = await instanceFor(proposalId);
    expect((await instanceRow(instanceId)).execution_backend).toBe('temporal');

    const decided = await post<{ statusCode: string }>(`/api/v1/module-selection-proposals/${proposalId}/decision`,
      { decisionCode: 'approved', reason: 'Extra capacity authorised' }, approverJwt);
    expect(decided.statusCode).toBe('confirmed');
    expect(await registrationCount(enrolmentId)).toBe(1);
    expect((await instanceRow(instanceId)).status_code).toBe('completed');

    await replayAppliedCommand(instanceId);
    expect(await registrationCount(enrolmentId)).toBe(1);
  });

  it('a rejection closes the proposal with no registration', async () => {
    const { proposalId, enrolmentId } = await waitlistedProposal('MS6A-2');
    const decided = await post<{ statusCode: string }>(`/api/v1/module-selection-proposals/${proposalId}/decision`,
      { decisionCode: 'rejected', reason: 'No capacity' }, approverJwt);
    expect(decided.statusCode).toBe('rejected');
    expect(await registrationCount(enrolmentId)).toBe(0);
  });
});

describe('allocation run approval on Temporal (D-30)', () => {
  let f: ReturnType<typeof selectionFixtures>;
  let runner: string;
  let approver: string;
  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  beforeAll(async () => {
    f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
    runner = await ctx.makeJwt({ sub: 't-alloc-runner', roles: ['registry-administrator'] });
    approver = await ctx.makeJwt({ sub: 't-alloc-approver', roles: ['programme-approver'] });
  });

  /** A submitted run over two ranked students competing for one place. */
  async function submittedRun(): Promise<{ runId: string; instanceId: string; proposals: string[] }> {
    const periodId = await f.period();
    const programmeId = await f.programme();
    await f.ruleSet(programmeId);
    const x = await f.module(); const y = await f.module();
    const ox = await f.offering(x.moduleId, periodId, 1);
    const oy = await f.offering(y.moduleId, periodId, 5);
    const w = await f.inject('POST', '/api/v1/module-selection-windows', { academicPeriodId: periodId, opensAt: iso(-1), closesAt: iso(1), allocationModeCode: 'ranked' });
    const windowId = w.json<{ moduleSelectionWindowId: string }>().moduleSelectionWindowId;
    const proposals: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { enrolmentId } = await f.student(programmeId);
      const proposalId = await f.proposal(enrolmentId, periodId);
      await f.item(proposalId, x.moduleId, ox, { choiceSlot: 1, preferenceRank: 1 });
      await f.item(proposalId, y.moduleId, oy, { choiceSlot: 1, preferenceRank: 2 });
      expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('awaiting-allocation');
      proposals.push(proposalId);
    }
    const run = (await f.inject('POST', `/api/v1/module-selection-windows/${windowId}/allocation-runs`, { kindCode: 'main' }, runner)).json<{ allocationRunId: string }>();
    const submitted = await f.inject('POST', `/api/v1/allocation-runs/${run.allocationRunId}/submission`, undefined, runner);
    expect(submitted.statusCode, submitted.body).toBe(200);
    return { runId: run.allocationRunId, instanceId: submitted.json<{ workflowInstanceId: string }>().workflowInstanceId, proposals };
  }

  const registrations = async (proposals: string[]) => Number((await row<{ n: string }>(sql`
    SELECT count(*) AS n FROM module_registration r JOIN module_selection_proposal p ON p.enrolment_id = r.enrolment_id AND p.recorded_until IS NULL
    WHERE p.id IN (${sql.join(proposals.map((p) => sql`${p}::uuid`), sql`, `)}) AND r.recorded_until IS NULL`)).n);

  it('applies an approved run once, even when the activity is replayed', async () => {
    const { runId, instanceId, proposals } = await submittedRun();
    expect((await instanceRow(instanceId)).execution_backend).toBe('temporal');
    const decided = await f.inject('POST', `/api/v1/allocation-runs/${runId}/decision`, { decisionCode: 'approved' }, approver);
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json<{ statusCode: string }>().statusCode).toBe('applied');
    expect(await registrations(proposals)).toBe(2);
    expect((await instanceRow(instanceId)).status_code).toBe('completed');

    await replayAppliedCommand(instanceId);
    expect(await registrations(proposals)).toBe(2);
  });

  it('a rejection applies nothing', async () => {
    const { runId, proposals } = await submittedRun();
    const decided = await f.inject('POST', `/api/v1/allocation-runs/${runId}/decision`, { decisionCode: 'rejected' }, approver);
    expect(decided.json<{ statusCode: string }>().statusCode).toBe('rejected');
    expect(await registrations(proposals)).toBe(0);
  });
});
