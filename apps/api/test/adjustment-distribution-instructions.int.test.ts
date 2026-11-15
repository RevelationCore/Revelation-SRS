/**
 * AJ-21 finding 1 — per-target adjustment instructions.
 *
 * Target systems are told to apply an adjustment by
 * srs.adjustment.distribution-requested.<target> (one per distribution row)
 * and to remove it by srs.adjustment.distribution-withdrawal-requested.<target>.
 * The distribution row is the outbox: anything not published (bus down,
 * publish error) stays due and the dispatcher sends it later with the same
 * event id. Adjustments carry a structured amount so a target can compute a
 * concrete value per assessment.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher, PublishOptions } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

interface CapturedEvent {
  type:     string;
  payload:  Record<string, unknown>;
  options:  PublishOptions;
  classification: string;
}

/** A spy bus that can be disconnected or made to fail, to exercise the outbox. */
const bus = {
  connected: true,
  /** Fail the next publish of this event type, once. */
  failType: null as string | null,
  events: [] as CapturedEvent[],
};

function createControllableBus(): IntegrationBusPublisher {
  return {
    isConnected: () => bus.connected,
    publish: (
      type: string,
      _version: string,
      _tenantId: string,
      _correlationId: string,
      classification: string,
      payload: unknown,
      options: PublishOptions = {},
    ): Promise<void> => {
      if (bus.failType === type) {
        bus.failType = null;
        return Promise.reject(new Error('simulated JetStream failure'));
      }
      bus.events.push({ type, classification, payload: payload as Record<string, unknown>, options });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
let integrationJwt: string;

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createControllableBus() });
  jwt = await ctx.makeJwt();
  integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  // These tests cover publishing to connected targets, so every target is
  // connected here (by default attendance is a manual task and exams is the
  // SRS's own file exchange — see adjustment-target-fulfilment.int.test.ts).
  for (const target of ['vle', 'attendance', 'exams']) {
    const res = await ctx.app.inject({
      method: 'PUT', url: `/api/v1/adjustment-targets/${target}`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: { fulfilmentModeCode: 'connected' },
    });
    expect(res.statusCode).toBe(200);
  }
}, 120_000);

beforeEach(() => {
  bus.connected = true;
  bus.failType = null;
  bus.events.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

const REQUESTED = 'srs.adjustment.distribution-requested';
const WITHDRAWAL = 'srs.adjustment.distribution-withdrawal-requested';

function eventsOf(type: string): CapturedEvent[] {
  return bus.events.filter((e) => e.type === type);
}

describe('Structured amount', () => {
  it('records and returns the amount, and carries it on the approved event', async () => {
    const f = await createFixture('AMT101');
    const { adjustmentId } = await record(f, {
      adjustmentTypeCode: 'extra-time', scopeCode: 'exam',
      amount: { value: 25, unitCode: 'percent-of-duration' },
    });

    const get = await ctx.app.inject({
      method: 'GET', url: `/api/v1/adjustments/${adjustmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.json<{ amount: unknown }>().amount).toEqual({ value: 25, unitCode: 'percent-of-duration' });

    const approved = eventsOf('srs.adjustment.approved').find((e) => e.payload['adjustmentId'] === adjustmentId);
    expect(approved?.payload['amount']).toEqual({ value: 25, unitCode: 'percent-of-duration' });
  });

  it('returns null amount when none was recorded', async () => {
    const f = await createFixture('AMT102');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'separate-room', scopeCode: 'exam' });
    const get = await ctx.app.inject({
      method: 'GET', url: `/api/v1/adjustments/${adjustmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.json<{ amount: unknown }>().amount).toBeNull();
  });

  it.each([
    ['a unit the type does not take',      'extra-time',    { value: 5,  unitCode: 'days' }],
    ['an amount on a type that takes none', 'reader',        { value: 1,  unitCode: 'minutes-per-hour' }],
    ['a unit not in the value set',         'extra-time',    { value: 25, unitCode: 'percent' }],
    ['more than two decimal places',        'rest-breaks',   { value: 10.125, unitCode: 'minutes-per-hour' }],
  ])('rejects %s with 422', async (_label, adjustmentTypeCode, amount) => {
    const f = await createFixture(`AMT-${adjustmentTypeCode}-${amount.unitCode}`);
    const res = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${f.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: f.enrolmentId, adjustmentTypeCode, scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z', amount },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a zero amount at the schema boundary', async () => {
    const f = await createFixture('AMT103');
    const res = await ctx.app.inject({
      method: 'POST', url: `/api/v1/students/${f.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: f.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'exam',
        validFrom: '2027-09-01T00:00:00.000Z', amount: { value: 0, unitCode: 'percent-of-duration' },
      },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});

describe('distribution-requested instructions', () => {
  it('publishes one instruction per target, addressed by subject, without notes', async () => {
    const f = await createFixture('INS101');
    const { adjustmentId } = await record(f, {
      adjustmentTypeCode: 'extra-time', scopeCode: 'all',
      amount: { value: 15, unitCode: 'minutes-per-hour' },
      validTo: '2028-07-31T00:00:00.000Z',
      notes: 'Diagnosis detail that must not reach target systems',
    });

    const instructions = eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === adjustmentId);
    expect(instructions.map((e) => e.options.subjectSuffix).sort()).toEqual(['attendance', 'exams', 'vle']);

    const distributions = await listDistributions(adjustmentId);
    for (const instruction of instructions) {
      const row = distributions.find((d) => d.distributionId === instruction.payload['distributionId'])!;
      expect(row).toBeDefined();
      expect(instruction.payload['targetSystem']).toBe(row.targetSystem);
      expect(instruction.options.subjectSuffix).toBe(row.targetSystem);
      expect(instruction.classification).toBe('sensitive');
      expect(instruction.payload).toMatchObject({
        personId: f.personId,
        enrolmentId: f.enrolmentId,
        adjustmentTypeCode: 'extra-time',
        scopeCode: 'all',
        amount: { value: 15, unitCode: 'minutes-per-hour' },
        validFrom: '2027-09-01T00:00:00.000Z',
        validTo: '2028-07-31T00:00:00.000Z',
      });
      expect(JSON.stringify(instruction.payload)).not.toContain('Diagnosis');
      expect(row.requestPublishedAt).not.toBeNull();
      expect(row.statusCode).toBe('pending');
    }
  });

  it('addresses a coursework adjustment only to the VLE', async () => {
    const f = await createFixture('INS102');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'deadline-extension', scopeCode: 'coursework' });
    const instructions = eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === adjustmentId);
    expect(instructions.map((e) => e.options.subjectSuffix)).toEqual(['vle']);
  });

  it('keeps instructions due while the bus is down and sends them on the next drain', async () => {
    bus.connected = false;
    const f = await createFixture('INS103');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    expect(eventsOf(REQUESTED)).toHaveLength(0);
    const [before] = await listDistributions(adjustmentId);
    expect(before!.requestPublishedAt).toBeNull();

    bus.connected = true;
    const drained = await ctx.app.adjustmentDispatcher.drain();
    expect(drained.requestsPublished).toBeGreaterThanOrEqual(1);
    const sent = eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === adjustmentId);
    expect(sent).toHaveLength(1);

    const [after] = await listDistributions(adjustmentId);
    expect(after!.requestPublishedAt).not.toBeNull();

    // Nothing is sent twice once stamped.
    bus.events.length = 0;
    await ctx.app.adjustmentDispatcher.drain();
    expect(eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === adjustmentId)).toHaveLength(0);
  });

  it('retries a failed publish with the same event id', async () => {
    bus.failType = REQUESTED;
    const f = await createFixture('INS104');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    // The instruction publish fails; recording still succeeds.
    expect(eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === adjustmentId)).toHaveLength(0);

    await ctx.app.adjustmentDispatcher.drain();
    const first = eventsOf(REQUESTED).find((e) => e.payload['adjustmentId'] === adjustmentId);
    expect(first).toBeDefined();
    expect(first!.options.eventId).toMatch(/^[0-9a-f-]{36}$/);

    // The id is the row's, not per attempt: simulate a crash after publish
    // (row stamped null again) and check the republish reuses it.
    await ctx.db.execute(
      sql`UPDATE adjustment_distribution SET request_published_at = NULL WHERE id = ${String(first!.payload['distributionId'])}`,
    );
    bus.events.length = 0;
    await ctx.app.adjustmentDispatcher.drain();
    const second = eventsOf(REQUESTED).find((e) => e.payload['adjustmentId'] === adjustmentId);
    expect(second?.options.eventId).toBe(first!.options.eventId);
  });

  it('dispatches on an idempotent replay if the original attempt did not', async () => {
    bus.connected = false;
    const f = await createFixture('INS105');
    const payload = { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' };
    const first = await record(f, payload, 'replay-key-INS105');
    bus.connected = true;
    const replay = await record(f, payload, 'replay-key-INS105', 200);
    expect(replay.adjustmentId).toBe(first.adjustmentId);
    expect(eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === first.adjustmentId)).toHaveLength(1);
  });
});

describe('Acknowledgement and failure reports', () => {
  it('records a failure with its reason, and still accepts a later acknowledgement', async () => {
    const f = await createFixture('ACK101');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    const [d] = await listDistributions(adjustmentId);

    const fail = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/failure`,
      { targetSystem: 'vle', reason: 'No amount recorded; cannot compute per-quiz extra time' });
    expect(fail.statusCode).toBe(204);
    const [failed] = await listDistributions(adjustmentId);
    expect(failed).toMatchObject({ statusCode: 'failed', failureReason: 'No amount recorded; cannot compute per-quiz extra time' });

    const ack = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/acknowledge`, { targetSystem: 'vle' });
    expect(ack.statusCode).toBe(204);
    const [acked] = await listDistributions(adjustmentId);
    expect(acked!.statusCode).toBe('distributed');

    const late = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/failure`,
      { targetSystem: 'vle', reason: 'late' });
    expect(late.statusCode).toBe(409);
  });

  it('treats a failure report from the wrong target as not found', async () => {
    const f = await createFixture('ACK102');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    const [d] = await listDistributions(adjustmentId);
    const res = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/failure`,
      { targetSystem: 'attendance', reason: 'x' });
    expect(res.statusCode).toBe(404);
  });
});

describe('Withdrawal on expiry', () => {
  it('requests withdrawal of every published instruction, acknowledged or not', async () => {
    const f = await createFixture('WD101');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'all' });
    const rows = await listDistributions(adjustmentId);
    const vle = rows.find((r) => r.targetSystem === 'vle')!;
    await post(`/api/v1/adjustments/${adjustmentId}/distributions/${vle.distributionId}/acknowledge`, { targetSystem: 'vle' });

    bus.events.length = 0;
    await expire(adjustmentId);

    const after = await listDistributions(adjustmentId);
    // All three targets are connected here, so each is asked to remove it.
    expect(Object.fromEntries(after.map((r) => [r.targetSystem, r.statusCode]))).toEqual({
      vle: 'withdrawal-requested', attendance: 'withdrawal-requested', exams: 'withdrawal-requested',
    });
    for (const r of after) expect(r.withdrawalPublishedAt).not.toBeNull();

    const withdrawals = eventsOf(WITHDRAWAL);
    expect(withdrawals.map((e) => e.options.subjectSuffix).sort()).toEqual(['attendance', 'exams', 'vle']);
    expect(withdrawals[0]!.payload).toMatchObject({ adjustmentId, reasonCode: 'expired', personId: f.personId });
    expect(typeof withdrawals[0]!.payload['endedAt']).toBe('string');
  });

  it('supersedes, without a withdrawal, instructions that were never sent', async () => {
    bus.connected = false;
    const f = await createFixture('WD102');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    await expire(adjustmentId);
    bus.connected = true;
    await ctx.app.adjustmentDispatcher.drain();

    const [row] = await listDistributions(adjustmentId);
    expect(row!.statusCode).toBe('superseded');
    expect(eventsOf(REQUESTED).filter((e) => e.payload['adjustmentId'] === adjustmentId)).toHaveLength(0);
    expect(eventsOf(WITHDRAWAL).filter((e) => e.payload['adjustmentId'] === adjustmentId)).toHaveLength(0);
  });

  it('refuses an apply-acknowledgement once withdrawal is requested, then confirms the withdrawal once', async () => {
    const f = await createFixture('WD103');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    const [d] = await listDistributions(adjustmentId);
    await expire(adjustmentId);

    const lateAck = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/acknowledge`, { targetSystem: 'vle' });
    expect(lateAck.statusCode).toBe(409);

    const url = `/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/withdrawal/acknowledge`;
    expect((await post(url, { targetSystem: 'vle' })).statusCode).toBe(204);
    expect((await post(url, { targetSystem: 'vle' })).statusCode).toBe(204);
    const [row] = await listDistributions(adjustmentId);
    expect(row).toMatchObject({ statusCode: 'withdrawn' });
    expect(row!.withdrawnAt).not.toBeNull();
  });

  it('records a withdrawal failure without leaving withdrawal-requested', async () => {
    const f = await createFixture('WD104');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    const [d] = await listDistributions(adjustmentId);
    await expire(adjustmentId);
    const res = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/failure`,
      { targetSystem: 'vle', reason: 'VLE API unavailable' });
    expect(res.statusCode).toBe(204);
    const [row] = await listDistributions(adjustmentId);
    expect(row).toMatchObject({ statusCode: 'withdrawal-requested', failureReason: 'VLE API unavailable' });
  });

  it('rejects a withdrawal acknowledgement when no withdrawal was requested', async () => {
    const f = await createFixture('WD105');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    const [d] = await listDistributions(adjustmentId);
    const res = await post(`/api/v1/adjustments/${adjustmentId}/distributions/${d!.distributionId}/withdrawal/acknowledge`, { targetSystem: 'vle' });
    expect(res.statusCode).toBe(409);
  });

  it('sends a withdrawal later if the bus was down at expiry', async () => {
    const f = await createFixture('WD106');
    const { adjustmentId } = await record(f, { adjustmentTypeCode: 'extra-time', scopeCode: 'coursework' });
    bus.connected = false;
    await expire(adjustmentId);
    const [due] = await listDistributions(adjustmentId);
    expect(due).toMatchObject({ statusCode: 'withdrawal-requested', withdrawalPublishedAt: null });

    bus.connected = true;
    await ctx.app.adjustmentDispatcher.drain();
    expect(eventsOf(WITHDRAWAL).filter((e) => e.payload['adjustmentId'] === adjustmentId)).toHaveLength(1);
    const [sent] = await listDistributions(adjustmentId);
    expect(sent!.withdrawalPublishedAt).not.toBeNull();
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Fixture { personId: string; enrolmentId: string }

interface DistributionWire {
  distributionId: string;
  targetSystem: string;
  statusCode: string;
  failureReason: string | null;
  requestPublishedAt: string | null;
  withdrawalPublishedAt: string | null;
  withdrawnAt: string | null;
}

async function createFixture(code: string): Promise<Fixture> {
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Instruction' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;
  const enrolment = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' },
  });
  expect(enrolment.statusCode).toBe(201);
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}

async function record(
  f: Fixture,
  body: { adjustmentTypeCode: string; scopeCode: string; amount?: { value: number; unitCode: string }; validTo?: string; notes?: string },
  idempotencyKey?: string,
  expectedStatus = 201,
): Promise<{ adjustmentId: string }> {
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/students/${f.personId}/adjustments`,
    headers: {
      authorization: `Bearer ${jwt}`,
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
    },
    payload: { enrolmentId: f.enrolmentId, validFrom: '2027-09-01T00:00:00.000Z', ...body },
  });
  expect(res.statusCode, res.body).toBe(expectedStatus);
  return res.json<{ adjustmentId: string }>();
}

async function listDistributions(adjustmentId: string): Promise<DistributionWire[]> {
  const res = await ctx.app.inject({
    method: 'GET', url: `/api/v1/adjustments/${adjustmentId}/distributions`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<DistributionWire[]>();
}

async function expire(adjustmentId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/adjustments/${adjustmentId}/expire`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(204);
}

function post(url: string, payload: unknown) {
  return ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${integrationJwt}` }, payload });
}
