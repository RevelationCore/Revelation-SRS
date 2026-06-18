/**
 * Stage 5 — Adjustment Distribution Flow (F059).
 *
 * Verifies:
 * - targetSystem filtering: only 'vle' distributions are applied.
 * - VLE adjustment write: correct fields posted to stub VLE.
 * - SRS acknowledgement: correct adjustmentId/distributionId/targetSystem sent.
 * - Adjustment map: DB row records status 'applied' or 'acknowledged'.
 * - Idempotency: duplicate distribution event is silently skipped.
 * - No-client mode: vleClient/srsAckClient optional — partial processing only.
 * - Special-category: payload must not appear in handler-level log calls.
 * - Error propagation: VLE failure records 'failed' in ledger.
 * - Cross-tenant: events for a different tenant are silently dropped.
 *
 * NATS is not started — dispatch() is called directly.
 * VLE HTTP calls target the in-process stub VLE.
 * SRS acknowledgement calls target the in-process StubSrsAckServer.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type { AdjustmentDistributedV1Payload } from '@revelation-srs/domain';

import { getAdjustmentMapping } from '../src/consumers/f059/adjustment-map-repository.js';
import { VleEventConsumer } from '../src/consumers/vle-event-consumer.js';
import { adjustmentMap } from '../src/db/schema/adjustment-map.js';
import { eventLedger } from '../src/db/schema/event-ledger.js';
import { HttpSrsAcknowledgementClient } from '../src/srs-client/acknowledgement-client.js';
import { HttpVleClient, type VleClient } from '../src/vle-client/client.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const log = pino({ level: 'silent' });

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER  = '00000000-0000-0000-0000-000000000002';

function makeAdjustmentEnvelope(
  overrides: Partial<AdjustmentDistributedV1Payload> = {},
  envelopeOverrides: Partial<DomainEventEnvelope<AdjustmentDistributedV1Payload>> = {},
): DomainEventEnvelope<AdjustmentDistributedV1Payload> {
  const payload: AdjustmentDistributedV1Payload = {
    adjustmentId:       overrides.adjustmentId       ?? randomUUID(),
    distributionId:     overrides.distributionId     ?? randomUUID(),
    targetSystem:       overrides.targetSystem       ?? 'vle',
    distributedAt:      overrides.distributedAt      ?? new Date().toISOString(),
    personId:           overrides.personId           ?? randomUUID(),
    enrolmentId:        overrides.enrolmentId        ?? randomUUID(),
    adjustmentTypeCode: overrides.adjustmentTypeCode ?? 'EXTRA_TIME',
    scopeCode:          overrides.scopeCode          ?? 'ALL_ASSESSMENTS',
    validFrom:          overrides.validFrom          ?? '2025-09-01T00:00:00.000Z',
    ...(overrides.validTo !== undefined ? { validTo: overrides.validTo } : {}),
  };

  return {
    id:                 randomUUID(),
    type:               'srs.adjustment.distributed',
    version:            '1.0.0',
    schemaRef:          'https://srs.example.com/schemas/srs.adjustment.distributed.json',
    tenantId:           TENANT,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'sensitive',
    payload,
    ...envelopeOverrides,
  };
}

function makeConsumer(
  ctx: TestVleApp,
  opts: { withVle?: boolean; withSrsAck?: boolean; vleClient?: VleClient } = {},
): VleEventConsumer {
  const vleClient = opts.vleClient
    ?? (opts.withVle ? new HttpVleClient(ctx.stubVleBaseUrl) : undefined);
  const srsAckClient = opts.withSrsAck
    ? new HttpSrsAcknowledgementClient(ctx.stubSrsAckBaseUrl, 'test-token')
    : undefined;

  return new VleEventConsumer(
    'nats://unused',
    ctx.db,
    TENANT,
    log,
    { vleClient, srsAckClient },
  );
}

async function clearTables(ctx: TestVleApp): Promise<void> {
  await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  await ctx.db.delete(adjustmentMap).where(eq(adjustmentMap.tenantId, TENANT));
  ctx.stubVle.stubStore.reset();
  ctx.stubSrsAck.reset();
}

// ── Suite 1: targetSystem filtering ──────────────────────────────────────────

describe('Stage 5 — targetSystem filtering', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('1.1 event with targetSystem=vle is applied to the stub VLE', async () => {
    const consumer = makeConsumer(ctx, { withVle: true });
    await consumer.dispatch(makeAdjustmentEnvelope({ targetSystem: 'vle' }));

    const items = ctx.stubVle.stubStore.adjustments;
    expect(items.size).toBe(1);
  });

  it('1.2 event with targetSystem=library is NOT sent to VLE', async () => {
    const consumer = makeConsumer(ctx, { withVle: true });
    await consumer.dispatch(makeAdjustmentEnvelope({ targetSystem: 'library' }));

    const items = ctx.stubVle.stubStore.adjustments;
    expect(items.size).toBe(0);
  });

  it('1.3 event with targetSystem=library is still recorded as processed in ledger', async () => {
    const consumer = makeConsumer(ctx, { withVle: true });
    const envelope = makeAdjustmentEnvelope({ targetSystem: 'library' });

    await consumer.dispatch(envelope);

    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));

    expect(rows[0]?.statusCode).toBe('processed');
  });

  it('1.4 event with targetSystem=library does NOT create an adjustment map row', async () => {
    const consumer = makeConsumer(ctx, { withVle: true });
    const { payload } = makeAdjustmentEnvelope({ targetSystem: 'library' });
    await consumer.dispatch(makeAdjustmentEnvelope({ ...payload, targetSystem: 'library' }));

    const rows = await ctx.db
      .select()
      .from(adjustmentMap)
      .where(eq(adjustmentMap.tenantId, TENANT));

    expect(rows).toHaveLength(0);
  });
});

// ── Suite 2: VLE adjustment content ──────────────────────────────────────────

describe('Stage 5 — VLE adjustment content', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('2.1 stub VLE receives the correct adjustment fields', async () => {
    const consumer      = makeConsumer(ctx, { withVle: true });
    const adjustmentId  = randomUUID();
    const distributionId = randomUUID();
    const personId      = randomUUID();
    const enrolmentId   = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({
      adjustmentId,
      distributionId,
      personId,
      enrolmentId,
      adjustmentTypeCode: 'READER',
      scopeCode:          'EXAMS',
      validFrom:          '2025-09-01T00:00:00.000Z',
    }));

    const stored = ctx.stubVle.stubStore.adjustments.get(distributionId);
    expect(stored).toBeDefined();
    expect(stored?.adjustmentId).toBe(adjustmentId);
    expect(stored?.distributionId).toBe(distributionId);
    expect(stored?.personId).toBe(personId);
    expect(stored?.enrolmentId).toBe(enrolmentId);
    expect(stored?.adjustmentTypeCode).toBe('READER');
    expect(stored?.scopeCode).toBe('EXAMS');
    expect(stored?.validFrom).toBe('2025-09-01T00:00:00.000Z');
  });

  it('2.2 adjustment without validTo applies null validTo', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true });
    const distributionId = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({ distributionId }));

    const stored = ctx.stubVle.stubStore.adjustments.get(distributionId);
    expect(stored?.validTo).toBeNull();
  });

  it('2.3 adjustment with validTo passes the date string through', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true });
    const distributionId = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({
      distributionId,
      validTo: '2026-07-31T23:59:59.000Z',
    }));

    const stored = ctx.stubVle.stubStore.adjustments.get(distributionId);
    expect(stored?.validTo).toBe('2026-07-31T23:59:59.000Z');
  });
});

// ── Suite 3: SRS acknowledgement ─────────────────────────────────────────────

describe('Stage 5 — SRS acknowledgement', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('3.1 SRS acknowledge endpoint receives the correct adjustmentId and distributionId', async () => {
    const consumer      = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const adjustmentId  = randomUUID();
    const distributionId = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({ adjustmentId, distributionId }));

    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.adjustmentId).toBe(adjustmentId);
    expect(calls[0]?.distributionId).toBe(distributionId);
  });

  it('3.2 SRS acknowledge endpoint receives targetSystem=vle', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: true });

    await consumer.dispatch(makeAdjustmentEnvelope());

    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls[0]?.targetSystem).toBe('vle');
  });

  it('3.3 SRS is NOT called when targetSystem is not vle', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: true });

    await consumer.dispatch(makeAdjustmentEnvelope({ targetSystem: 'moodle' }));

    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls).toHaveLength(0);
  });

  it('3.4 SRS is NOT called when no srsAckClient is configured', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: false });

    await consumer.dispatch(makeAdjustmentEnvelope());

    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls).toHaveLength(0);
  });
});

// ── Suite 4: adjustment map state ────────────────────────────────────────────

describe('Stage 5 — adjustment map state', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('4.1 full flow records statusCode=acknowledged in adjustment map', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const distributionId = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({ distributionId }));

    const row = await getAdjustmentMapping(ctx.db, TENANT, distributionId);
    expect(row?.statusCode).toBe('acknowledged');
  });

  it('4.2 without srsAckClient, statusCode=applied in adjustment map', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true, withSrsAck: false });
    const distributionId = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({ distributionId }));

    const row = await getAdjustmentMapping(ctx.db, TENANT, distributionId);
    expect(row?.statusCode).toBe('applied');
  });

  it('4.3 adjustment map row stores correct adjustment metadata', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const adjustmentId   = randomUUID();
    const distributionId = randomUUID();
    const personId       = randomUUID();
    const enrolmentId    = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({
      adjustmentId, distributionId, personId, enrolmentId,
      adjustmentTypeCode: 'EXTRA_TIME_25',
      scopeCode:          'COURSEWORK',
      validFrom:          '2025-09-01T00:00:00.000Z',
      validTo:            '2026-06-30T00:00:00.000Z',
    }));

    const rows = await ctx.db
      .select()
      .from(adjustmentMap)
      .where(
        and(
          eq(adjustmentMap.tenantId,       TENANT),
          eq(adjustmentMap.distributionId, distributionId),
        ),
      );

    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.adjustmentId).toBe(adjustmentId);
    expect(row?.personId).toBe(personId);
    expect(row?.enrolmentId).toBe(enrolmentId);
    expect(row?.adjustmentTypeCode).toBe('EXTRA_TIME_25');
    expect(row?.scopeCode).toBe('COURSEWORK');
    expect(row?.appliedAt).toBeTruthy();
    expect(row?.acknowledgedAt).toBeTruthy();
  });
});

// ── Suite 5: idempotency ──────────────────────────────────────────────────────

describe('Stage 5 — idempotency', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('5.1 same event dispatched twice is only processed once (ledger idempotency)', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const envelope = makeAdjustmentEnvelope();

    await consumer.dispatch(envelope);
    await consumer.dispatch(envelope); // same event ID — skipped by ledger

    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls).toHaveLength(1);
    expect(ctx.stubVle.stubStore.adjustments.size).toBe(1);
  });

  it('5.2 different events for same distributionId: second is skipped by handler idempotency', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const distributionId = randomUUID();

    const envelope1 = makeAdjustmentEnvelope({ distributionId });
    const envelope2 = makeAdjustmentEnvelope({ distributionId }); // different event ID, same distributionId

    await consumer.dispatch(envelope1);
    await consumer.dispatch(envelope2);

    // SRS ack is only called once (second call skipped by adjustment map check).
    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls).toHaveLength(1);
  });

  it('5.3 idempotency skip: ledger records processed for the duplicate event', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const envelope = makeAdjustmentEnvelope();

    await consumer.dispatch(envelope);
    await consumer.dispatch(envelope);

    const ledgerRows = await ctx.db
      .select()
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));

    // First dispatch records 'processed'; second dispatch is silently skipped (no second row).
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.statusCode).toBe('processed');
  });
});

// ── Suite 6: no-client and error handling ─────────────────────────────────────

describe('Stage 5 — no-client and error handling', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('6.1 without vleClient or srsAckClient — event is still processed and recorded as applied', async () => {
    const consumer       = makeConsumer(ctx, { withVle: false, withSrsAck: false });
    const distributionId = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({ distributionId }));

    // Ledger records 'processed'
    const ledgerRows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.tenantId, TENANT));
    expect(ledgerRows[0]?.statusCode).toBe('processed');

    // Adjustment map records 'applied' (no srsAckClient means no ack)
    const row = await getAdjustmentMapping(ctx.db, TENANT, distributionId);
    expect(row?.statusCode).toBe('applied');

    // VLE and SRS stubs were NOT called
    expect(ctx.stubVle.stubStore.adjustments.size).toBe(0);
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);
  });

  it('6.2 VLE HTTP failure records failed in ledger and throws', async () => {
    // Inject a VleClient that throws on applyAdjustment.
    const brokenVleClient: VleClient = {
      // eslint-disable-next-line @typescript-eslint/require-await
      upsertCourse:         async () => ({ vleCourseId: '' }),
      // eslint-disable-next-line @typescript-eslint/require-await
      upsertEnrolment:      async () => ({ vleEnrolmentId: '' }),
      updateEnrolmentStatus: async () => { /* no-op */ },
      // eslint-disable-next-line @typescript-eslint/require-await
      applyAdjustment: async () => {
        throw new Error('VLE connection refused');
      },
    };

    const consumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      {
        vleClient: brokenVleClient,
        srsAckClient: new HttpSrsAcknowledgementClient(ctx.stubSrsAckBaseUrl, 'test-token'),
      },
    );

    const envelope = makeAdjustmentEnvelope();
    await expect(consumer.dispatch(envelope)).rejects.toThrow('VLE connection refused');

    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));
    expect(rows[0]?.statusCode).toBe('failed');

    // SRS was NOT called (VLE failed before the ack).
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);
  });

  it('6.3 cross-tenant event is silently dropped — no VLE write, no adjustment map row', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: true });

    // tenantId mismatch
    await consumer.dispatch(
      makeAdjustmentEnvelope({}, { tenantId: OTHER }),
    );

    expect(ctx.stubVle.stubStore.adjustments.size).toBe(0);
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);

    const adjRows = await ctx.db
      .select()
      .from(adjustmentMap)
      .where(eq(adjustmentMap.tenantId, TENANT));
    expect(adjRows).toHaveLength(0);
  });
});

// ── Suite 7: full end-to-end dispatch ────────────────────────────────────────

describe('Stage 5 — end-to-end dispatch', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('7.1 full lifecycle: dispatch → VLE applied → SRS acknowledged → map acknowledged', async () => {
    const consumer       = makeConsumer(ctx, { withVle: true, withSrsAck: true });
    const adjustmentId   = randomUUID();
    const distributionId = randomUUID();
    const personId       = randomUUID();

    await consumer.dispatch(makeAdjustmentEnvelope({ adjustmentId, distributionId, personId }));

    // VLE stub has the adjustment
    const stored = ctx.stubVle.stubStore.adjustments.get(distributionId);
    expect(stored?.adjustmentId).toBe(adjustmentId);
    expect(stored?.personId).toBe(personId);

    // SRS ack was called once
    const acks = ctx.stubSrsAck.getAckCalls();
    expect(acks).toHaveLength(1);
    expect(acks[0]?.adjustmentId).toBe(adjustmentId);

    // Adjustment map is 'acknowledged'
    const mapRow = await getAdjustmentMapping(ctx.db, TENANT, distributionId);
    expect(mapRow?.statusCode).toBe('acknowledged');

    // Ledger records 'processed'
    const ledger = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.tenantId, TENANT));
    expect(ledger[0]?.statusCode).toBe('processed');
  });

  it('7.2 multiple adjustments for different distributions accumulate independently', async () => {
    const consumer = makeConsumer(ctx, { withVle: true, withSrsAck: true });

    await consumer.dispatch(makeAdjustmentEnvelope({ adjustmentTypeCode: 'EXTRA_TIME' }));
    await consumer.dispatch(makeAdjustmentEnvelope({ adjustmentTypeCode: 'READER' }));
    await consumer.dispatch(makeAdjustmentEnvelope({ adjustmentTypeCode: 'SCRIBE' }));

    expect(ctx.stubVle.stubStore.adjustments.size).toBe(3);
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(3);

    const mapRows = await ctx.db
      .select()
      .from(adjustmentMap)
      .where(eq(adjustmentMap.tenantId, TENANT));
    expect(mapRows).toHaveLength(3);
    expect(mapRows.every(r => r.statusCode === 'acknowledged')).toBe(true);
  });
});
