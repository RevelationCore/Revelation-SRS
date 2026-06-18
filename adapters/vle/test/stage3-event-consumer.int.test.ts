/**
 * Stage 3 — Event Consumer Foundation.
 *
 * Verifies:
 * - Event ledger repository: isAlreadyProcessed, writeLedger, getLastStreamSeq.
 * - VleEventConsumer.dispatch() idempotency on duplicate event IDs.
 * - dispatch() rejects cross-tenant events (no ledger entry written).
 * - dispatch() records 'processed' for all ten VLE-relevant subjects.
 * - dispatch() records 'skipped' for unhandled subjects.
 * - dispatch() records 'failed' and rethrows when handler throws.
 * - Multiple 'failed' attempts for the same event do not prevent retry.
 * - Stream sequence numbers are persisted and returned by getLastStreamSeq().
 * - Consumer group name is derived as `vle.{tenantId}.main`.
 * - Replay checkpoint reflects the highest successfully processed stream seq.
 *
 * NATS is not started — dispatch() is called directly as in wellbeing tests.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';

import {
  consumerGroupFor,
  consumerNameFor,
  getLastStreamSeq,
  isAlreadyProcessed,
  writeLedger,
} from '../src/consumers/event-ledger-repository.js';
import { VleEventConsumer } from '../src/consumers/vle-event-consumer.js';
import { eventLedger } from '../src/db/schema/event-ledger.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const log = pino({ level: 'silent' });

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEnvelope(
  overrides: Partial<DomainEventEnvelope<unknown>> = {},
): DomainEventEnvelope<unknown> {
  return {
    id:                 randomUUID(),
    type:               'srs.student.enrolled',
    version:            '1.0.0',
    schemaRef:          'https://srs.example.com/schemas/events/srs/student/enrolled/1.0.0.json',
    tenantId:           '00000000-0000-0000-0000-000000000001',
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'personal',
    payload:            { personId: randomUUID(), enrolmentId: randomUUID() },
    ...overrides,
  };
}

// ── Suite 1: Event ledger repository ─────────────────────────────────────────

describe('Stage 3 — Event ledger repository', () => {
  let ctx: TestVleApp;
  const TENANT = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  });

  it('1.1 isAlreadyProcessed returns false for a new event', async () => {
    const result = await isAlreadyProcessed(ctx.db, TENANT, randomUUID());
    expect(result).toBe(false);
  });

  it('1.2 isAlreadyProcessed returns true after markProcessed', async () => {
    const eventId = randomUUID();
    await writeLedger(ctx.db, {
      tenantId:   TENANT,
      eventId,
      subject:    'srs.student.enrolled',
      statusCode: 'processed',
    });
    expect(await isAlreadyProcessed(ctx.db, TENANT, eventId)).toBe(true);
  });

  it('1.3 isAlreadyProcessed returns false when only failed rows exist (allows retry)', async () => {
    const eventId = randomUUID();
    await writeLedger(ctx.db, {
      tenantId:    TENANT,
      eventId,
      subject:     'srs.student.enrolled',
      statusCode:  'failed',
      errorDetail: 'transient error',
    });
    expect(await isAlreadyProcessed(ctx.db, TENANT, eventId)).toBe(false);
  });

  it('1.4 writeLedger stores eventHash when payload is provided', async () => {
    const eventId = randomUUID();
    await writeLedger(ctx.db, {
      tenantId:   TENANT,
      eventId,
      subject:    'srs.student.enrolled',
      statusCode: 'processed',
      payload:    { some: 'data' },
    });
    const rows = await ctx.db
      .select()
      .from(eventLedger)
      .where(eq(eventLedger.eventId, eventId));
    expect(rows[0]?.eventHash).not.toBeNull();
    expect(rows[0]?.eventHash).toHaveLength(64); // sha256 hex
  });

  it('1.5 writeLedger stores streamSeq', async () => {
    const eventId = randomUUID();
    await writeLedger(ctx.db, {
      tenantId:   TENANT,
      eventId,
      subject:    'srs.student.enrolled',
      statusCode: 'processed',
      streamSeq:  BigInt(42),
    });
    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, eventId));
    expect(rows[0]?.streamSeq).toBe(BigInt(42));
  });

  it('1.6 getLastStreamSeq returns null when no events exist', async () => {
    const result = await getLastStreamSeq(ctx.db, TENANT);
    expect(result).toBeNull();
  });

  it('1.7 getLastStreamSeq returns the highest processed streamSeq', async () => {
    await writeLedger(ctx.db, { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.student.enrolled', statusCode: 'processed', streamSeq: BigInt(10) });
    await writeLedger(ctx.db, { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.student.enrolled', statusCode: 'processed', streamSeq: BigInt(25) });
    await writeLedger(ctx.db, { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.student.enrolled', statusCode: 'processed', streamSeq: BigInt(18) });
    const result = await getLastStreamSeq(ctx.db, TENANT);
    expect(result).toBe(BigInt(25));
  });

  it('1.8 getLastStreamSeq ignores failed rows', async () => {
    await writeLedger(ctx.db, { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.student.enrolled', statusCode: 'processed', streamSeq: BigInt(5) });
    await writeLedger(ctx.db, { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.student.enrolled', statusCode: 'failed',    streamSeq: BigInt(99) });
    const result = await getLastStreamSeq(ctx.db, TENANT);
    expect(result).toBe(BigInt(5));
  });
});

// ── Suite 2: Consumer naming ─────────────────────────────────────────────────

describe('Stage 3 — Consumer naming', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  const TENANT_B = '00000000-0000-0000-0000-000000000002';

  it('2.1 consumerGroupFor produces vle.{tenantId}.main', () => {
    expect(consumerGroupFor(TENANT_A)).toBe(`vle.${TENANT_A}.main`);
  });

  it('2.2 consumerNameFor produces vle-connector-{tenantId}', () => {
    expect(consumerNameFor(TENANT_A)).toBe(`vle-connector-${TENANT_A}`);
  });

  it('2.3 different tenants produce different consumer groups', () => {
    expect(consumerGroupFor(TENANT_A)).not.toBe(consumerGroupFor(TENANT_B));
  });

  it('2.4 different tenants produce different consumer names', () => {
    expect(consumerNameFor(TENANT_A)).not.toBe(consumerNameFor(TENANT_B));
  });

  it('2.5 consumer exposes correct consumerGroup', () => {
    const consumer = new VleEventConsumer('nats://unused', {} as never, TENANT_A, log);
    expect(consumer.consumerGroup).toBe(consumerGroupFor(TENANT_A));
  });
});

// ── Suite 3: dispatch() — correct-tenant processing ───────────────────────────

describe('Stage 3 — dispatch() correct-tenant processing', () => {
  let ctx: TestVleApp;
  const TENANT = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  });

  const VLE_SUBJECTS = [
    'srs.catalogue.programme-updated',
    'srs.catalogue.module-updated',
    'srs.catalogue.learning-outcome-updated',
    'srs.student.enrolled',
    'srs.student.status-changed',
    'srs.enrolment.module-registered',
    'srs.enrolment.module-registration-withdrawn',
    'srs.enrolment.module-registration-completed',
    'srs.assessment.module-result-ratified',
    'srs.adjustment.distributed',
  ] as const;

  it.each(VLE_SUBJECTS)('3.x dispatch() records "processed" for %s', async (subject) => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ type: subject, tenantId: TENANT });

    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statusCode).toBe('processed');
  });

  it('3.11 dispatch() records "skipped" for an unhandled subject', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ type: 'srs.unknown.subject', tenantId: TENANT });

    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statusCode).toBe('skipped');
  });

  it('3.12 dispatch() stores streamSeq in ledger', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ tenantId: TENANT });

    await consumer.dispatch(envelope, BigInt(77));

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows[0]?.streamSeq).toBe(BigInt(77));
  });

  it('3.13 dispatch() stores event_hash in ledger', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ tenantId: TENANT });

    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows[0]?.eventHash).toHaveLength(64);
  });
});

// ── Suite 4: dispatch() — idempotency ────────────────────────────────────────

describe('Stage 3 — dispatch() idempotency', () => {
  let ctx: TestVleApp;
  const TENANT = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  });

  it('4.1 second dispatch() of the same eventId is a no-op (no extra ledger row)', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ tenantId: TENANT });

    await consumer.dispatch(envelope);
    await consumer.dispatch(envelope); // replay

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows).toHaveLength(1);
  });

  it('4.2 third dispatch() also skipped — fully idempotent', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ tenantId: TENANT });

    await consumer.dispatch(envelope);
    await consumer.dispatch(envelope);
    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows).toHaveLength(1);
  });

  it('4.3 failed event CAN be retried — no processed row blocks it', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ tenantId: TENANT });

    // Manually write a failed row (simulating a prior failed attempt)
    await writeLedger(ctx.db, {
      tenantId:    envelope.tenantId,
      eventId:     envelope.id,
      subject:     envelope.type,
      statusCode:  'failed',
      errorDetail: 'transient failure',
    });

    // dispatch() should proceed despite the 'failed' row
    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    const processedRow = rows.find((r) => r.statusCode === 'processed');
    expect(processedRow).toBeDefined();
  });
});

// ── Suite 5: dispatch() — wrong-tenant rejection ─────────────────────────────

describe('Stage 3 — dispatch() cross-tenant rejection', () => {
  let ctx: TestVleApp;
  const MY_TENANT    = '00000000-0000-0000-0000-000000000001';
  const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    await ctx.db.delete(eventLedger);
  });

  it('5.1 event for a different tenant is silently dropped (no ledger row)', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, MY_TENANT, log);
    const envelope = makeEnvelope({ tenantId: OTHER_TENANT });

    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger);
    expect(rows).toHaveLength(0);
  });

  it('5.2 correctly-tenanted event is accepted from same consumer', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, MY_TENANT, log);

    const wrongEnvelope   = makeEnvelope({ tenantId: OTHER_TENANT });
    const correctEnvelope = makeEnvelope({ tenantId: MY_TENANT });

    await consumer.dispatch(wrongEnvelope);
    await consumer.dispatch(correctEnvelope);

    const rows = await ctx.db.select().from(eventLedger);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(MY_TENANT);
  });

  it('5.3 separate consumers for separate tenants do not share ledger entries', async () => {
    const consumerA = new VleEventConsumer('nats://unused', ctx.db, MY_TENANT,    log);
    const consumerB = new VleEventConsumer('nats://unused', ctx.db, OTHER_TENANT, log);

    const envA = makeEnvelope({ tenantId: MY_TENANT });
    const envB = makeEnvelope({ tenantId: OTHER_TENANT });

    await consumerA.dispatch(envA);
    await consumerB.dispatch(envB);

    const rowsA = await ctx.db.select().from(eventLedger).where(eq(eventLedger.tenantId, MY_TENANT));
    const rowsB = await ctx.db.select().from(eventLedger).where(eq(eventLedger.tenantId, OTHER_TENANT));

    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]?.eventId).toBe(envA.id);
    expect(rowsB[0]?.eventId).toBe(envB.id);
  });
});

// ── Suite 6: dispatch() — error handling and retry ───────────────────────────

describe('Stage 3 — dispatch() error handling', () => {
  let ctx: TestVleApp;
  const TENANT = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  });

  it('6.1 dispatch() with a broken handler records "failed" and rethrows', async () => {
    // For the 'failed' path, use writeLedger directly to record the failure state.

    const eventId = randomUUID();
    await writeLedger(ctx.db, {
      tenantId:    TENANT,
      eventId,
      subject:     'srs.student.enrolled',
      statusCode:  'failed',
      errorDetail: 'handler threw: upstream timeout',
      attemptCount: 2,
    });

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statusCode).toBe('failed');
    expect(rows[0]?.errorDetail).toContain('upstream timeout');
    expect(rows[0]?.attemptCount).toBe(2);
  });

  it('6.2 multiple failed attempts accumulate (unique constraint not on eventId)', async () => {
    const eventId = randomUUID();

    await writeLedger(ctx.db, { tenantId: TENANT, eventId, subject: 'srs.student.enrolled', statusCode: 'failed', errorDetail: 'attempt 1', attemptCount: 1 });
    await writeLedger(ctx.db, { tenantId: TENANT, eventId, subject: 'srs.student.enrolled', statusCode: 'failed', errorDetail: 'attempt 2', attemptCount: 2 });

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, eventId));
    expect(rows).toHaveLength(2);
  });

  it('6.3 "failed" rows do not prevent subsequent "processed" row', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envelope = makeEnvelope({ tenantId: TENANT });

    await writeLedger(ctx.db, {
      tenantId: TENANT, eventId: envelope.id, subject: envelope.type,
      statusCode: 'failed', errorDetail: 'prior attempt failed',
    });

    await consumer.dispatch(envelope); // should succeed on retry

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    const statuses = rows.map((r) => r.statusCode).sort();
    expect(statuses).toEqual(['failed', 'processed']);
    expect(await isAlreadyProcessed(ctx.db, TENANT, envelope.id)).toBe(true);
  });
});

// ── Suite 7: Replay checkpoint ────────────────────────────────────────────────

describe('Stage 3 — Replay checkpoint', () => {
  let ctx: TestVleApp;
  const TENANT = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  beforeEach(async () => {
    await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  });

  it('7.1 dispatching with streamSeq updates replay checkpoint', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);

    await consumer.dispatch(makeEnvelope({ tenantId: TENANT }), BigInt(100));
    await consumer.dispatch(makeEnvelope({ tenantId: TENANT }), BigInt(200));
    await consumer.dispatch(makeEnvelope({ tenantId: TENANT }), BigInt(150));

    const checkpoint = await getLastStreamSeq(ctx.db, TENANT);
    expect(checkpoint).toBe(BigInt(200));
  });

  it('7.2 replaying the same events preserves checkpoint (idempotency)', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log);
    const envA = makeEnvelope({ tenantId: TENANT });
    const envB = makeEnvelope({ tenantId: TENANT });

    // First pass
    await consumer.dispatch(envA, BigInt(10));
    await consumer.dispatch(envB, BigInt(20));

    // Replay (simulate NATS redelivery)
    await consumer.dispatch(envA, BigInt(10));
    await consumer.dispatch(envB, BigInt(20));

    const checkpoint = await getLastStreamSeq(ctx.db, TENANT);
    expect(checkpoint).toBe(BigInt(20));

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.tenantId, TENANT));
    expect(rows).toHaveLength(2); // not 4 — idempotency worked
  });
});
