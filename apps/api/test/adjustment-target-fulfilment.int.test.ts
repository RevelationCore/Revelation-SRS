/**
 * How each adjustment target is fulfilled, per tenant, and the manual task
 * queue for targets with no connected system (attendance by default).
 *
 * A capability outside the core SRS is not always automated. The tenant
 * says per target whether it is connected (an integration consumes events),
 * manual (staff work a task queue), file (an SRS file exchange) or not used,
 * so "pending" never silently means "nothing will ever do this".
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher, PublishOptions } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

const published: Array<{ type: string; payload: Record<string, unknown>; options: PublishOptions }> = [];
const bus = {
  isConnected: () => true,
  publish: (type: string, _v: string, _t: string, _c: string, _cl: string, payload: unknown, options: PublishOptions = {}) => {
    published.push({ type, payload: payload as Record<string, unknown>, options });
    return Promise.resolve();
  },
  connect: () => Promise.resolve(),
  close: () => Promise.resolve(),
} as unknown as IntegrationBusPublisher;

let ctx: TestApp;
let registryJwt: string;
let adminJwt: string;
let officerJwt: string;

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: bus });
  registryJwt = await ctx.makeJwt();
  adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  officerJwt = await ctx.makeJwt({ sub: 'attendance-officer-1', roles: ['engagement-officer'] });
}, 120_000);

beforeEach(() => { published.length = 0; });

afterAll(async () => {
  await ctx?.teardown();
});

describe('Target fulfilment settings', () => {
  it('defaults to vle connected, attendance manual, exams file', async () => {
    const res = await get('/api/v1/adjustment-targets', adminJwt);
    expect(res.json()).toEqual([
      expect.objectContaining({ targetSystem: 'vle', fulfilmentModeCode: 'connected', isDefault: true }),
      expect.objectContaining({ targetSystem: 'attendance', fulfilmentModeCode: 'manual', isDefault: true, alertAfterHours: 72 }),
      expect.objectContaining({ targetSystem: 'exams', fulfilmentModeCode: 'file', isDefault: true }),
    ]);
  });

  it('creates distributions by mode: only connected targets are published as events', async () => {
    const f = await fixture('TF101');
    const { adjustmentId } = await adjust(f, 'all');

    const rows = await distributions(adjustmentId);
    expect(Object.fromEntries(rows.map((r) => [r.targetSystem, r.fulfilmentModeCode]))).toEqual({
      vle: 'connected', attendance: 'manual', exams: 'file',
    });
    for (const r of rows) expect(r.requestPublishedAt).not.toBeNull();
    const instructions = published.filter((e) => e.type === 'srs.adjustment.distribution-requested');
    expect(instructions.map((e) => e.options.subjectSuffix)).toEqual(['vle']);
  });

  it('creates no distribution for a not-used target, and validates the setting', async () => {
    expect((await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'not-used' }, adminJwt)).statusCode).toBe(200);
    try {
      const f = await fixture('TF102');
      const { adjustmentId } = await adjust(f, 'all');
      expect((await distributions(adjustmentId)).map((r) => r.targetSystem).sort()).toEqual(['exams', 'vle']);
    } finally {
      await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual' }, adminJwt);
    }

    expect((await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'carrier-pigeon' }, adminJwt)).statusCode).toBe(422);
    expect((await put('/api/v1/adjustment-targets/library', { fulfilmentModeCode: 'manual' }, adminJwt)).statusCode).toBe(404);
    expect((await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual' }, registryJwt)).statusCode).toBe(403);
  });

  it('a change of mode applies to new distributions only', async () => {
    const f = await fixture('TF103');
    const before = await adjust(f, 'attendance');
    await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'connected' }, adminJwt);
    try {
      const after = await adjust(f, 'attendance');
      expect((await distributions(before.adjustmentId))[0]!.fulfilmentModeCode).toBe('manual');
      expect((await distributions(after.adjustmentId))[0]!.fulfilmentModeCode).toBe('connected');
      expect(published.filter((e) => e.type === 'srs.adjustment.distribution-requested').map((e) => e.options.subjectSuffix)).toEqual(['attendance']);
    } finally {
      await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });
});

describe('Manual task queue', () => {
  it('lists what a person needs to act on, and no more', async () => {
    const f = await fixture('TQ101');
    const { adjustmentId } = await adjust(f, 'attendance', 'rest-breaks', { value: 10, unitCode: 'minutes-per-hour' });
    await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual', ownerDescription: 'Attendance team' }, adminJwt);

    const task = (await tasks()).find((t) => t.adjustmentId === adjustmentId);
    expect(task).toMatchObject({
      targetSystem: 'attendance',
      action: 'apply',
      statusCode: 'pending',
      personId: f.personId,
      studentName: 'TQ101 Fulfilment',
      adjustmentTypeCode: 'rest-breaks',
      amount: { value: 10, unitCode: 'minutes-per-hour' },
      ownerDescription: 'Attendance team',
      overdue: false,
    });
    expect(task!.studentNumber).toBeTruthy();
    expect(JSON.stringify(task)).not.toContain('PRIVATE-NOTE');
  });

  it('a person confirms an applied task; it leaves the queue and is audited', async () => {
    const f = await fixture('TQ102');
    const { adjustmentId } = await adjust(f, 'attendance');
    const task = (await tasks()).find((t) => t.adjustmentId === adjustmentId)!;

    const res = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${task.distributionId}/acknowledge`, { targetSystem: 'attendance' }, officerJwt);
    expect(res.statusCode).toBe(204);

    expect((await distributions(adjustmentId))[0]!.statusCode).toBe('distributed');
    expect((await tasks()).some((t) => t.adjustmentId === adjustmentId)).toBe(false);
    const audit = await ctx.db.execute(sql`
      SELECT actor_id FROM audit_record WHERE entity_type = 'adjustment_distribution' AND entity_id = ${task.distributionId}
    `);
    expect(audit.map((r) => r['actor_id'])).toContain('attendance-officer-1');
  });

  it('a person cannot confirm a distribution that a connected system fulfils', async () => {
    const f = await fixture('TQ103');
    const { adjustmentId } = await adjust(f, 'coursework');
    const [vle] = await distributions(adjustmentId);

    const res = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${vle!.distributionId}/acknowledge`, { targetSystem: 'vle' }, officerJwt);
    expect(res.statusCode).toBe(409);
    expect((await distributions(adjustmentId))[0]!.statusCode).toBe('pending');
  });

  it('a reported failure stays in the queue with its reason', async () => {
    const f = await fixture('TQ104');
    const { adjustmentId } = await adjust(f, 'attendance');
    const task = (await tasks()).find((t) => t.adjustmentId === adjustmentId)!;

    await post(`/api/v1/adjustments/${adjustmentId}/distributions/${task.distributionId}/failure`,
      { targetSystem: 'attendance', reason: 'Student not yet in the attendance register' }, officerJwt);

    expect((await tasks()).find((t) => t.adjustmentId === adjustmentId)).toMatchObject({
      action: 'apply', statusCode: 'failed', failureReason: 'Student not yet in the attendance register',
    });
  });

  it('an expired adjustment becomes a removal task, confirmed once', async () => {
    const f = await fixture('TQ105');
    const { adjustmentId } = await adjust(f, 'attendance');
    const task = (await tasks()).find((t) => t.adjustmentId === adjustmentId)!;
    await post(`/api/v1/adjustments/${adjustmentId}/distributions/${task.distributionId}/acknowledge`, { targetSystem: 'attendance' }, officerJwt);

    expect((await post(`/api/v1/adjustments/${adjustmentId}/expire`, {}, registryJwt)).statusCode).toBe(204);

    expect((await tasks()).find((t) => t.adjustmentId === adjustmentId)).toMatchObject({ action: 'remove', statusCode: 'withdrawal-requested' });
    expect(published.some((e) => e.type === 'srs.adjustment.distribution-withdrawal-requested' && e.options.subjectSuffix === 'attendance')).toBe(false);

    await post(`/api/v1/adjustments/${adjustmentId}/distributions/${task.distributionId}/withdrawal/acknowledge`, { targetSystem: 'attendance' }, officerJwt);
    expect((await distributions(adjustmentId))[0]!.statusCode).toBe('withdrawn');
    expect((await tasks()).some((t) => t.adjustmentId === adjustmentId)).toBe(false);
  });

  it('flags a task overdue once it is older than the target\'s alert period', async () => {
    await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual', alertAfterHours: 1 }, adminJwt);
    try {
      const f = await fixture('TQ106');
      const { adjustmentId } = await adjust(f, 'attendance');
      const task = (await tasks()).find((t) => t.adjustmentId === adjustmentId)!;
      expect(task.overdue).toBe(false);

      await ctx.db.execute(sql`
        UPDATE adjustment_distribution SET created_at = now() - interval '2 hours' WHERE id = ${task.distributionId}
      `);
      expect((await tasks()).find((t) => t.adjustmentId === adjustmentId)!.overdue).toBe(true);
    } finally {
      await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });

  it('sends a team mailbox one overdue digest a day, with counts and no student details', async () => {
    await put('/api/v1/adjustment-targets/attendance', {
      fulfilmentModeCode: 'manual', alertAfterHours: 1, notifyEmail: 'attendance-team@example.test',
    }, adminJwt);
    try {
      const f = await fixture('TQ107');
      const { adjustmentId } = await adjust(f, 'attendance');
      const task = (await tasks()).find((t) => t.adjustmentId === adjustmentId)!;
      await ctx.db.execute(sql`
        UPDATE adjustment_distribution SET created_at = now() - interval '3 hours' WHERE id = ${task.distributionId}
      `);

      const now = new Date();
      const first = await ctx.app.adjustmentTaskNoticeService.sendOverdueNotices(ctx.tenantId, now);
      expect(first).toEqual([expect.objectContaining({ targetSystem: 'attendance', overdueCount: expect.any(Number) as number })]);
      // The email channel is off by default: recorded, not sent.
      expect(first[0]!.statusCode).toBe('suppressed');

      const log = await ctx.db.execute(sql`
        SELECT recipient_ref, payload FROM communication_dispatch_log
        WHERE template_key = 'adjustment-tasks.overdue' ORDER BY dispatched_at DESC LIMIT 1
      `);
      expect(log[0]?.['recipient_ref']).toBe('attendance-team@example.test');
      const payload = JSON.stringify(log[0]?.['payload']);
      expect(payload).toContain('/operations/integration-tasks?tab=adjustments');
      expect(payload).not.toContain(f.personId);
      expect(payload).not.toContain('TQ107');

      // Not again within a day; again after one.
      expect(await ctx.app.adjustmentTaskNoticeService.sendOverdueNotices(ctx.tenantId, new Date(now.getTime() + 3_600_000))).toEqual([]);
      expect(await ctx.app.adjustmentTaskNoticeService.sendOverdueNotices(ctx.tenantId, new Date(now.getTime() + 25 * 3_600_000))).toHaveLength(1);
    } finally {
      await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });

  it('rejects a notify mailbox that is not an email address', async () => {
    const res = await put('/api/v1/adjustment-targets/attendance', { fulfilmentModeCode: 'manual', notifyEmail: 'attendance team' }, adminJwt);
    expect(res.statusCode).toBe(422);
  });

  it('is limited to staff who fulfil adjustments', async () => {
    const student = await ctx.makeJwt({ roles: ['student'] });
    expect((await get('/api/v1/adjustment-tasks', student)).statusCode).toBe(403);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Fixture { personId: string; enrolmentId: string }
interface Distribution { distributionId: string; targetSystem: string; statusCode: string; fulfilmentModeCode: string; requestPublishedAt: string | null }
interface Task {
  distributionId: string; adjustmentId: string; targetSystem: string; action: string; statusCode: string;
  failureReason: string | null; overdue: boolean; studentNumber: string | null;
}

async function fixture(code: string): Promise<Fixture> {
  const personId = (await post('/api/v1/students', { legalFirstName: code, legalFamilyName: 'Fulfilment' }, registryJwt)).json<{ personId: string }>().personId;
  const enrolmentId = (await post('/api/v1/enrolments', {
    personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  }, registryJwt)).json<{ enrolmentId: string }>().enrolmentId;
  return { personId, enrolmentId };
}

async function adjust(
  f: Fixture,
  scopeCode: string,
  adjustmentTypeCode = 'extra-time',
  amount: { value: number; unitCode: string } = { value: 25, unitCode: 'percent-of-duration' },
): Promise<{ adjustmentId: string }> {
  const res = await post(`/api/v1/students/${f.personId}/adjustments`, {
    enrolmentId: f.enrolmentId, adjustmentTypeCode, scopeCode, validFrom: '2026-09-21T00:00:00.000Z',
    amount, notes: 'PRIVATE-NOTE must not reach the task queue',
  }, registryJwt);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ adjustmentId: string }>();
}

async function distributions(adjustmentId: string): Promise<Distribution[]> {
  return (await get(`/api/v1/adjustments/${adjustmentId}/distributions`, registryJwt)).json<Distribution[]>();
}

async function tasks(): Promise<Task[]> {
  const res = await get('/api/v1/adjustment-tasks', officerJwt);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Task[]>();
}

function get(url: string, token: string) {
  return ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

function post(url: string, payload: Record<string, unknown>, token: string) {
  return ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
}

function put(url: string, payload: Record<string, unknown>, token: string) {
  return ctx.app.inject({ method: 'PUT', url, headers: { authorization: `Bearer ${token}` }, payload });
}
