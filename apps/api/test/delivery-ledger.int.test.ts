/**
 * Platform delivery ledger: outbound reference-model flows to adjacent
 * systems with no other route (library, CRM, ...), each fulfilled per tenant
 * as connected, manual, file or not-used. F-SIS-LIB-01 (library access from
 * enrolment status) is the first flow with an SRS producer.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher, PublishOptions } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

const bus = { connected: true, events: [] as Array<{ type: string; payload: Record<string, unknown>; options: PublishOptions }> };
const spy = {
  isConnected: () => bus.connected,
  publish: (type: string, _v: string, _t: string, _c: string, _cl: string, payload: unknown, options: PublishOptions = {}) => {
    bus.events.push({ type, payload: payload as Record<string, unknown>, options });
    return Promise.resolve();
  },
  connect: () => Promise.resolve(),
  close: () => Promise.resolve(),
} as unknown as IntegrationBusPublisher;

let ctx: TestApp;
let registryJwt: string;
let adminJwt: string;

const LIB = 'F-SIS-LIB-01';

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: spy });
  registryJwt = await ctx.makeJwt();
  adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

beforeEach(() => {
  bus.connected = true;
  bus.events.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Delivery flows', () => {
  it('registers every outbound flow with no other route, and says which have an SRS trigger', async () => {
    const flows = (await get('/api/v1/delivery-flows', adminJwt)).json<Array<{ flowCode: string; producer: string; fulfilmentModeCode: string; isDefault: boolean }>>();
    expect(flows.map((f) => f.flowCode).sort()).toEqual([
      'F-SIS-ACC-01', 'F-SIS-CM-01', 'F-SIS-CMS-01', 'F-SIS-CRM-01', 'F-SIS-EST-01', 'F-SIS-ITSM-01',
      'F-SIS-LIB-01', 'F-SIS-OIV-01', 'F-SIS-PAY-01', 'F-SIS-RP-01', 'F-SIS-SETS-01',
    ]);
    expect(flows.find((f) => f.flowCode === LIB)).toMatchObject({ producer: 'implemented', fulfilmentModeCode: 'manual', isDefault: true });
    expect(flows.filter((f) => f.producer === 'implemented').map((f) => f.flowCode)).toEqual([LIB]);
  });

  it('validates settings and restricts them to configuration administrators', async () => {
    expect((await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'smoke-signal' }, adminJwt)).statusCode).toBe(422);
    expect((await put('/api/v1/delivery-flows/F-SIS-NOPE-01', { fulfilmentModeCode: 'manual' }, adminJwt)).statusCode).toBe(404);
    expect((await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'manual' }, registryJwt)).statusCode).toBe(403);
  });
});

describe('F-SIS-LIB-01 library access from enrolment status (manual by default)', () => {
  it('an enrolment becomes a library task to grant access, with who and from when', async () => {
    const f = await fixture('LIB101');

    const task = (await tasks()).find((t) => t.subjectId === f.enrolmentId);
    expect(task).toMatchObject({
      flowCode: LIB,
      flowName: 'Library access from enrolment status',
      targetLabel: 'library system',
      statusCode: 'pending',
      studentName: 'LIB101 Library',
      payload: expect.objectContaining({ accessAction: 'grant', enrolmentStatus: 'enrolled', effectiveFrom: '2026-09-21', enrolmentId: f.enrolmentId }) as Record<string, unknown>,
    });
    expect(task!.studentNumber).toBeTruthy();
    expect(task!.payload['studentNumber']).toBe(task!.studentNumber);
    expect(task!.summary).toBe('Grant library access from 2026-09-21 (enrolment enrolled)');
    expect(bus.events.some((e) => e.type === 'srs.delivery.requested')).toBe(false);
  });

  it('a later status supersedes an undelivered earlier one: the library gets the latest', async () => {
    const f = await fixture('LIB102');
    expect((await post(`/api/v1/enrolments/${f.enrolmentId}/intermit`, { reasonCode: 'health' }, registryJwt)).statusCode).toBe(204);

    const open = (await tasks()).filter((t) => t.subjectId === f.enrolmentId);
    expect(open.map((t) => t.payload['accessAction'])).toEqual(['suspend']);
    const all = (await get(`/api/v1/delivery-items?flowCode=${LIB}&subjectId=${f.enrolmentId}`, registryJwt)).json<Array<{ statusCode: string }>>();
    expect(all.map((i) => i.statusCode)).toEqual(['superseded', 'pending']);
  });

  it('staff confirm a task (audited, repeat-safe), or report why they cannot', async () => {
    const f = await fixture('LIB103');
    const task = (await tasks()).find((t) => t.subjectId === f.enrolmentId)!;

    expect((await post(`/api/v1/delivery-items/${task.deliveryItemId}/failure`, { reason: 'Borrower record locked' }, registryJwt)).statusCode).toBe(204);
    expect((await tasks()).find((t) => t.deliveryItemId === task.deliveryItemId)).toMatchObject({ statusCode: 'failed', failureReason: 'Borrower record locked' });

    expect((await post(`/api/v1/delivery-items/${task.deliveryItemId}/acknowledge`, {}, registryJwt)).statusCode).toBe(204);
    expect((await post(`/api/v1/delivery-items/${task.deliveryItemId}/acknowledge`, {}, registryJwt)).statusCode).toBe(204);
    expect((await tasks()).some((t) => t.deliveryItemId === task.deliveryItemId)).toBe(false);

    const audit = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM audit_record WHERE entity_type = 'delivery_item' AND entity_id = ${task.deliveryItemId}`);
    expect(audit[0]?.['n']).toBeGreaterThanOrEqual(2);
  });

  it('a superseded item cannot be confirmed', async () => {
    const f = await fixture('LIB104');
    const first = (await tasks()).find((t) => t.subjectId === f.enrolmentId)!;
    await post(`/api/v1/enrolments/${f.enrolmentId}/withdraw`, { reasonCode: 'personal' }, registryJwt);

    expect((await post(`/api/v1/delivery-items/${first.deliveryItemId}/acknowledge`, {}, registryJwt)).statusCode).toBe(409);
  });
});

describe('Connected and not-used flows', () => {
  it('connected: published on the flow\'s subject; only the integration replies', async () => {
    await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'connected' }, adminJwt);
    try {
      const f = await fixture('LIB201');
      const event = bus.events.find((e) => e.type === 'srs.delivery.requested' && e.payload['subjectId'] === f.enrolmentId);
      expect(event?.options.subjectSuffix).toBe('f-sis-lib-01');
      expect(event?.payload).toMatchObject({ flowCode: LIB, targetSystem: 'lib', payload: expect.objectContaining({ accessAction: 'grant' }) as Record<string, unknown> });
      const itemId = String(event!.payload['deliveryItemId']);
      expect(event!.options.eventId).toMatch(/^[0-9a-f-]{36}$/);

      expect((await post(`/api/v1/delivery-items/${itemId}/acknowledge`, {}, registryJwt)).statusCode).toBe(409);
      expect((await post(`/api/v1/delivery-items/${itemId}/acknowledge`, {}, adminJwt)).statusCode).toBe(204);
    } finally {
      await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });

  it('connected while the bus is down: published later by the drain, once', async () => {
    await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'connected' }, adminJwt);
    try {
      bus.connected = false;
      const f = await fixture('LIB202');
      expect(bus.events.some((e) => e.type === 'srs.delivery.requested')).toBe(false);

      bus.connected = true;
      expect(await ctx.app.deliveryService.drain()).toBeGreaterThanOrEqual(1);
      expect(bus.events.filter((e) => e.payload['subjectId'] === f.enrolmentId)).toHaveLength(1);
      bus.events.length = 0;
      await ctx.app.deliveryService.drain();
      expect(bus.events.filter((e) => e.payload['subjectId'] === f.enrolmentId)).toHaveLength(0);
    } finally {
      await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });

  it('not-used: nothing is recorded', async () => {
    await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'not-used' }, adminJwt);
    try {
      const f = await fixture('LIB203');
      const items = (await get(`/api/v1/delivery-items?subjectId=${f.enrolmentId}`, registryJwt)).json<unknown[]>();
      expect(items).toEqual([]);
    } finally {
      await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });
});

describe('Overdue digest for a delivery flow', () => {
  it('sends the flow\'s mailbox a digest with counts and a link, no student details', async () => {
    await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'manual', alertAfterHours: 1, notifyEmail: 'library@example.test' }, adminJwt);
    try {
      const f = await fixture('LIB301');
      await ctx.db.execute(sql`UPDATE delivery_item SET created_at = now() - interval '2 hours' WHERE subject_id = ${f.enrolmentId}`);

      const results = await ctx.app.adjustmentTaskNoticeService.sendOverdueNotices(ctx.tenantId);
      expect(results).toContainEqual(expect.objectContaining({ targetSystem: LIB, statusCode: 'suppressed' }));
      const [log] = await ctx.db.execute(sql`
        SELECT recipient_ref, payload FROM communication_dispatch_log
        WHERE template_key = 'delivery-tasks.overdue' ORDER BY dispatched_at DESC LIMIT 1
      `);
      expect(log?.['recipient_ref']).toBe('library@example.test');
      const payload = JSON.stringify(log?.['payload']);
      expect(payload).toContain('/operations/integration-tasks?tab=systems');
      expect(payload).not.toContain('LIB301');
    } finally {
      await put(`/api/v1/delivery-flows/${LIB}`, { fulfilmentModeCode: 'manual' }, adminJwt);
    }
  });

  it('the task queue is limited to staff who fulfil deliveries', async () => {
    const student = await ctx.makeJwt({ roles: ['student'] });
    expect((await get('/api/v1/delivery-tasks', student)).statusCode).toBe(403);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Task {
  deliveryItemId: string; flowCode: string; subjectId: string; statusCode: string; failureReason: string | null;
  studentNumber: string | null; summary: string; payload: Record<string, unknown>;
}

async function fixture(code: string): Promise<{ personId: string; enrolmentId: string }> {
  const personId = (await post('/api/v1/students', { legalFirstName: code, legalFamilyName: 'Library' }, registryJwt)).json<{ personId: string }>().personId;
  const res = await post('/api/v1/enrolments', {
    personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  }, registryJwt);
  expect(res.statusCode, res.body).toBe(201);
  return { personId, enrolmentId: res.json<{ enrolmentId: string }>().enrolmentId };
}

async function tasks(): Promise<Task[]> {
  const res = await get('/api/v1/delivery-tasks', registryJwt);
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
