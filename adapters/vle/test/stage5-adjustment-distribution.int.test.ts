/**
 * Stage 5 — Adjustment Distribution Flow (F-SIS-VLE-02), instruction-driven.
 *
 * The connector acts on srs.adjustment.distribution-requested.vle and
 * ...distribution-withdrawal-requested.vle (AJ-21 finding 1). For each it
 * records the instruction, re-derives the student's desired VLE state (one
 * combined extra-time percentage per enrolment, per active course) and makes
 * the VLE match through the platform driver, then replies to the SRS.
 *
 * NATS is not started — dispatch() is called directly. VLE writes go to the
 * in-process stub VLE through StubVleDriver; SRS replies go to StubSrsAckServer.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type {
  AdjustmentDistributionRequestedV1Payload,
  AdjustmentDistributionWithdrawalRequestedV1Payload,
  CatalogueModuleUpdatedV1Payload,
  DomainEventEnvelope,
  EnrolmentModuleRegisteredV1Payload,
  StudentEnrolledV1Payload,
} from '@revelation-srs/domain';

import { VleEventConsumer } from '../src/consumers/vle-event-consumer.js';
import { adjustmentMap } from '../src/db/schema/adjustment-map.js';
import { courseMap } from '../src/db/schema/course-map.js';
import { enrolmentMap } from '../src/db/schema/enrolment-map.js';
import { eventLedger } from '../src/db/schema/event-ledger.js';
import { reconciliationRun } from '../src/db/schema/reconciliation.js';
import { studentEnrolmentMap } from '../src/db/schema/student-enrolment-map.js';
import { ReconciliationService } from '../src/reliability/reconciliation-service.js';
import { HttpSrsAcknowledgementClient } from '../src/srs-client/acknowledgement-client.js';
import { HttpVleClient } from '../src/vle-client/client.js';
import type { VlePlatformDriver } from '../src/vle-platforms/driver.js';
import { StubVleDriver } from '../src/vle-platforms/stub-driver.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const log = pino({ level: 'silent' });
const TENANT = '00000000-0000-0000-0000-000000000001';

let ctx: TestVleApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

beforeEach(async () => {
  for (const table of [eventLedger, courseMap, enrolmentMap, studentEnrolmentMap, adjustmentMap, reconciliationRun]) {
    await ctx.db.delete(table).where(eq(table.tenantId, TENANT));
  }
  ctx.stubVle.stubStore.reset();
  ctx.stubSrsAck.reset();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope<T>(type: string, payload: T): DomainEventEnvelope<T> {
  return {
    id:                 randomUUID(),
    type,
    version:            '1.0.0',
    schemaRef:          `https://srs.example.com/schemas/events/${type.replace(/\./g, '/')}/1.0.0.json`,
    tenantId:           TENANT,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'sensitive',
    payload,
  };
}

function consumer(opts: { driver?: VlePlatformDriver | null; logger?: typeof log } = {}): VleEventConsumer {
  return new VleEventConsumer('nats://unused', ctx.db, TENANT, opts.logger ?? log, {
    vleClient:    new HttpVleClient(ctx.stubVleBaseUrl),
    srsAckClient: new HttpSrsAcknowledgementClient(ctx.stubSrsAckBaseUrl, 'test-token'),
    ...(opts.driver === null ? {} : { platformDriver: opts.driver ?? new StubVleDriver(ctx.stubVleBaseUrl) }),
  });
}

interface Student { personId: string; enrolmentId: string }

async function enrolStudent(c: VleEventConsumer): Promise<Student> {
  const s = { personId: randomUUID(), enrolmentId: randomUUID() };
  await c.dispatch(envelope('srs.student.enrolled', {
    ...s, academicYear: '2026/27', modeOfStudy: 'full-time',
  } satisfies StudentEnrolledV1Payload));
  return s;
}

/** Create a VLE course for a module and register the student on it; returns the VLE course id. */
async function registerOnNewCourse(c: VleEventConsumer, s: Student, code: string): Promise<string> {
  const moduleId = randomUUID();
  await c.dispatch(envelope('srs.catalogue.module-updated', {
    moduleId, code, title: `${code} module`, creditValue: 20, effectiveDate: '2026-09-01',
  } satisfies CatalogueModuleUpdatedV1Payload));
  await c.dispatch(envelope('srs.enrolment.module-registered', {
    enrolmentId: s.enrolmentId, moduleRegistrationId: randomUUID(), moduleId,
    moduleOfferingId: randomUUID(), academicPeriodId: randomUUID(), registrationDate: '2026-09-20',
  } satisfies EnrolmentModuleRegisteredV1Payload));
  const [row] = await ctx.db.select({ vleCourseId: courseMap.vleCourseId }).from(courseMap)
    .where(and(eq(courseMap.tenantId, TENANT), eq(courseMap.moduleId, moduleId)));
  return row!.vleCourseId;
}

function requested(
  s: Student,
  overrides: Partial<AdjustmentDistributionRequestedV1Payload> = {},
): AdjustmentDistributionRequestedV1Payload {
  return {
    adjustmentId:       randomUUID(),
    distributionId:     randomUUID(),
    targetSystem:       'vle',
    personId:           s.personId,
    enrolmentId:        s.enrolmentId,
    adjustmentTypeCode: 'extra-time',
    scopeCode:          'all',
    amount:             { value: 25, unitCode: 'percent-of-duration' },
    validFrom:          '2026-01-01T00:00:00.000Z',
    requestedAt:        new Date().toISOString(),
    ...overrides,
  };
}

function withdrawal(r: AdjustmentDistributionRequestedV1Payload): AdjustmentDistributionWithdrawalRequestedV1Payload {
  return {
    distributionId: r.distributionId,
    adjustmentId:   r.adjustmentId,
    targetSystem:   'vle',
    personId:       r.personId,
    enrolmentId:    r.enrolmentId,
    endedAt:        new Date().toISOString(),
    reasonCode:     'expired',
    requestedAt:    new Date().toISOString(),
  };
}

const REQUESTED = 'srs.adjustment.distribution-requested';
const WITHDRAWAL = 'srs.adjustment.distribution-withdrawal-requested';

function vlePercent(vleCourseId: string, personId: string): number | undefined {
  return ctx.stubVle.stubStore.timeAccommodations.get(`${vleCourseId}:${personId}`)?.extraTimePercent;
}

async function mapRow(distributionId: string) {
  const [row] = await ctx.db.select().from(adjustmentMap)
    .where(and(eq(adjustmentMap.tenantId, TENANT), eq(adjustmentMap.distributionId, distributionId)));
  return row;
}

// ── 1. Applying an instruction ───────────────────────────────────────────────

describe('Stage 5 — applying distribution-requested', () => {
  it('1.1 sets the time accommodation in every active course, acknowledges, and records the amount', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const courseA = await registerOnNewCourse(c, s, 'HIS101');
    const courseB = await registerOnNewCourse(c, s, 'HIS102');
    const r = requested(s);

    await c.dispatch(envelope(REQUESTED, r));

    expect(vlePercent(courseA, s.personId)).toBe(25);
    expect(vlePercent(courseB, s.personId)).toBe(25);
    expect(ctx.stubSrsAck.getAckCalls()).toEqual([{ adjustmentId: r.adjustmentId, distributionId: r.distributionId, targetSystem: 'vle' }]);
    const row = await mapRow(r.distributionId);
    expect(row).toMatchObject({ statusCode: 'acknowledged', amountUnitCode: 'percent-of-duration' });
    expect(Number(row!.amountValue)).toBe(25);
  });

  it('1.2 combines a student\'s time adjustments into one figure (25% + 10 min/hour = 41.67%)', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'CHE101');

    await c.dispatch(envelope(REQUESTED, requested(s)));
    await c.dispatch(envelope(REQUESTED, requested(s, {
      adjustmentTypeCode: 'rest-breaks', amount: { value: 10, unitCode: 'minutes-per-hour' },
    })));

    expect(vlePercent(course, s.personId)).toBe(41.67);
  });

  it('1.3 applies an adjustment only to courses of the enrolment it was recorded on', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'MAT101');
    const other: Student = { personId: s.personId, enrolmentId: randomUUID() };
    await c.dispatch(envelope('srs.student.enrolled', {
      ...other, academicYear: '2026/27', modeOfStudy: 'part-time',
    } satisfies StudentEnrolledV1Payload));
    const otherCourse = await registerOnNewCourse(c, other, 'MAT900');

    await c.dispatch(envelope(REQUESTED, requested(s)));

    expect(vlePercent(course, s.personId)).toBe(25);
    expect(vlePercent(otherCourse, s.personId)).toBeUndefined();
  });

  it('1.4 reports a failure, and writes nothing, for a time adjustment with no amount', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'BIO101');
    const r = requested(s);
    delete r.amount;

    await c.dispatch(envelope(REQUESTED, r));

    expect(vlePercent(course, s.personId)).toBeUndefined();
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);
    const [failure] = ctx.stubSrsAck.getFailureCalls();
    expect(failure).toMatchObject({ distributionId: r.distributionId, targetSystem: 'vle' });
    expect(failure!.reason).toMatch(/amount/i);
    expect((await mapRow(r.distributionId))?.statusCode).toBe('failed');
  });

  it('1.5 acknowledges a non-time adjustment without an automatic VLE write', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'ENG101');
    const r = requested(s, { adjustmentTypeCode: 'deadline-extension', scopeCode: 'coursework', amount: { value: 7, unitCode: 'days' } });

    await c.dispatch(envelope(REQUESTED, r));

    expect(vlePercent(course, s.personId)).toBeUndefined();
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(1);
    expect((await mapRow(r.distributionId))?.statusCode).toBe('acknowledged');
  });

  it('1.6 does not apply an adjustment before its valid period starts', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'PHY101');

    await c.dispatch(envelope(REQUESTED, requested(s, { validFrom: '2099-01-01T00:00:00.000Z' })));

    expect(vlePercent(course, s.personId)).toBeUndefined();
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(1);
  });

  it('1.7 handles a redelivered instruction once', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    await registerOnNewCourse(c, s, 'GEO101');
    const r = requested(s);

    await c.dispatch(envelope(REQUESTED, r));
    // Same instruction, new envelope id (the ledger would catch a repeated id).
    await c.dispatch(envelope(REQUESTED, r));

    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(1);
  });

  it('1.8 ignores an instruction addressed to another target', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const r = requested(s, { targetSystem: 'attendance' });

    await c.dispatch(envelope(REQUESTED, r));

    expect(await mapRow(r.distributionId)).toBeUndefined();
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);
  });

  it('1.9 a VLE failure fails the event, acknowledges nothing, and leaves no map row', async () => {
    const failing: VlePlatformDriver = {
      platform: 'stub',
      setTimeAccommodation: () => Promise.reject(new Error('VLE unavailable')),
    };
    const setup = consumer();
    const s = await enrolStudent(setup);
    await registerOnNewCourse(setup, s, 'ART101');
    const r = requested(s);
    const env = envelope(REQUESTED, r);

    await expect(consumer({ driver: failing }).dispatch(env)).rejects.toThrow('VLE unavailable');

    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);
    expect(await mapRow(r.distributionId)).toBeUndefined();
    const [ledger] = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, env.id));
    expect(ledger?.statusCode).toBe('failed');
  });

  it('1.10 never logs the personId or the amount', async () => {
    const lines: string[] = [];
    const capturing = pino({ level: 'debug' }, { write: (line: string) => { lines.push(line); } });
    const setup = consumer();
    const s = await enrolStudent(setup);
    await registerOnNewCourse(setup, s, 'LOG101');
    lines.length = 0;

    await consumer({ logger: capturing }).dispatch(envelope(REQUESTED, requested(s, {
      amount: { value: 33.5, unitCode: 'percent-of-duration' },
    })));

    const output = lines.join('\n');
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toContain(s.personId);
    expect(output).not.toContain('33.5');
  });
});

// ── 2. Withdrawal ────────────────────────────────────────────────────────────

describe('Stage 5 — distribution-withdrawal-requested', () => {
  it('2.1 removes the accommodation, confirms the withdrawal, and records it', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'WD101');
    const r = requested(s);
    await c.dispatch(envelope(REQUESTED, r));
    expect(vlePercent(course, s.personId)).toBe(25);

    await c.dispatch(envelope(WITHDRAWAL, withdrawal(r)));

    expect(vlePercent(course, s.personId)).toBeUndefined();
    expect(ctx.stubSrsAck.getWithdrawalAckCalls()).toEqual([{ adjustmentId: r.adjustmentId, distributionId: r.distributionId, targetSystem: 'vle' }]);
    const row = await mapRow(r.distributionId);
    expect(row?.statusCode).toBe('withdrawn');
    expect(row?.withdrawnAt).not.toBeNull();
    expect(row?.withdrawalAcknowledgedAt).not.toBeNull();
  });

  it('2.2 keeps the remaining adjustments when one is withdrawn', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'WD102');
    const extra = requested(s);
    const breaks = requested(s, { adjustmentTypeCode: 'rest-breaks', amount: { value: 15, unitCode: 'minutes-per-hour' } });
    await c.dispatch(envelope(REQUESTED, extra));
    await c.dispatch(envelope(REQUESTED, breaks));
    expect(vlePercent(course, s.personId)).toBe(50);

    await c.dispatch(envelope(WITHDRAWAL, withdrawal(extra)));

    expect(vlePercent(course, s.personId)).toBe(25);
  });

  it('2.3 confirms a withdrawal even if the instruction never arrived', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    await registerOnNewCourse(c, s, 'WD103');
    const r = requested(s);

    await c.dispatch(envelope(WITHDRAWAL, withdrawal(r)));

    expect(ctx.stubSrsAck.getWithdrawalAckCalls()).toHaveLength(1);
    expect(await mapRow(r.distributionId)).toBeUndefined();
  });

  it('2.4 a late instruction after its withdrawal is not re-applied', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'WD104');
    const r = requested(s);
    await c.dispatch(envelope(REQUESTED, r));
    await c.dispatch(envelope(WITHDRAWAL, withdrawal(r)));

    await c.dispatch(envelope(REQUESTED, r));

    expect(vlePercent(course, s.personId)).toBeUndefined();
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(1);
  });
});

// ── 3. Keeping coverage current ──────────────────────────────────────────────

describe('Stage 5 — coverage as courses and assessments change', () => {
  it('3.1 a course the student joins later gets their adjustments at registration', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    await registerOnNewCourse(c, s, 'COV101');
    await c.dispatch(envelope(REQUESTED, requested(s)));

    const later = await registerOnNewCourse(c, s, 'COV102');

    expect(vlePercent(later, s.personId)).toBe(25);
  });

  it('3.2 reconciliation re-asserts accommodations the VLE has lost', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'COV201');
    await c.dispatch(envelope(REQUESTED, requested(s)));
    ctx.stubVle.stubStore.clearTimeAccommodation(course, s.personId);

    const service = new ReconciliationService(ctx.db, TENANT, undefined, undefined, undefined, log, new StubVleDriver(ctx.stubVleBaseUrl));
    const result = await service.reconcileAdjustmentCoverage();

    expect(result).toMatchObject({ runType: 'adjustment-coverage', driftCount: 1, repairedCount: 1 });
    expect(vlePercent(course, s.personId)).toBe(25);
  });

  it('3.3 reconciliation clears an accommodation once its valid period has ended', async () => {
    const c = consumer();
    const s = await enrolStudent(c);
    const course = await registerOnNewCourse(c, s, 'COV301');
    await c.dispatch(envelope(REQUESTED, requested(s, { validTo: '2099-07-31T00:00:00.000Z' })));
    expect(vlePercent(course, s.personId)).toBe(25);

    const service = new ReconciliationService(ctx.db, TENANT, undefined, undefined, undefined, log, new StubVleDriver(ctx.stubVleBaseUrl));
    await service.reconcileAdjustmentCoverage(new Date('2099-08-01T00:00:00.000Z'));

    expect(vlePercent(course, s.personId)).toBeUndefined();
  });

  it('3.4 reconciliation without a platform driver checks nobody', async () => {
    const service = new ReconciliationService(ctx.db, TENANT, undefined, undefined, undefined, log);
    const result = await service.reconcileAdjustmentCoverage();
    expect(result).toMatchObject({ driftCount: 0, repairedCount: 0 });
  });
});
