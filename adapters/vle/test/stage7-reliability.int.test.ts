/**
 * Stage 7 — Reliability, Replay, Reconciliation, Observability.
 *
 * Verifies:
 * - withRetry: exponential backoff, eventual success, exhaustion.
 * - ReconciliationService.reconcileRoster: syncs enrolments with null vleEnrolmentId to VLE.
 * - ReconciliationService.reconcileAdjustments: re-sends SRS ack for 'applied' distributions.
 * - ReconciliationService.reconcileMarks: resubmits mark receipts with null markId to SRS.
 * - HealthService.getReport: aggregates event ledger and reconciliation run counts.
 *
 * NATS is not started — services are called directly.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { adjustmentMap }     from '../src/db/schema/adjustment-map.js';
import { enrolmentMap }      from '../src/db/schema/enrolment-map.js';
import { eventLedger }       from '../src/db/schema/event-ledger.js';
import { markReceipt }       from '../src/db/schema/mark-receipt.js';
import { reconciliationRun } from '../src/db/schema/reconciliation.js';
import { HealthService }         from '../src/reliability/health-service.js';
import { ReconciliationService } from '../src/reliability/reconciliation-service.js';
import { withRetry }             from '../src/reliability/retry-policy.js';
import { HttpSrsAcknowledgementClient } from '../src/srs-client/acknowledgement-client.js';
import { HttpSrsMarkClient }            from '../src/srs-client/mark-client.js';
import { HttpVleClient }                from '../src/vle-client/client.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const log    = pino({ level: 'silent' });
const TENANT = '00000000-0000-0000-0000-000000000001';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function clearTables(ctx: TestVleApp): Promise<void> {
  await ctx.db.delete(enrolmentMap).where(eq(enrolmentMap.tenantId, TENANT));
  await ctx.db.delete(adjustmentMap).where(eq(adjustmentMap.tenantId, TENANT));
  await ctx.db.delete(markReceipt).where(eq(markReceipt.tenantId, TENANT));
  await ctx.db.delete(reconciliationRun).where(eq(reconciliationRun.tenantId, TENANT));
  await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  ctx.stubVle.stubStore.reset();
  ctx.stubSrsAck.reset();
  ctx.stubSrsMarks.reset();
}

async function seedEnrolmentRow(
  ctx: TestVleApp,
  overrides: Partial<{ moduleRegistrationId: string; moduleId: string; vleEnrolmentId: string | null }> = {},
): Promise<{ moduleRegistrationId: string; moduleId: string; enrolmentId: string; personId: string }> {
  const moduleRegistrationId = overrides.moduleRegistrationId ?? randomUUID();
  const moduleId             = overrides.moduleId             ?? randomUUID();
  const enrolmentId          = randomUUID();
  const personId             = randomUUID();

  await ctx.db.insert(enrolmentMap).values({
    tenantId: TENANT,
    moduleRegistrationId,
    moduleId,
    enrolmentId,
    personId,
    ...(overrides.vleEnrolmentId !== undefined
      ? overrides.vleEnrolmentId !== null ? { vleEnrolmentId: overrides.vleEnrolmentId } : {}
      : {}),
    statusCode: 'active',
  });

  return { moduleRegistrationId, moduleId, enrolmentId, personId };
}

async function seedAdjustmentRow(
  ctx:        TestVleApp,
  statusCode: 'pending' | 'applied' | 'acknowledged' | 'failed' = 'applied',
): Promise<{ adjustmentId: string; distributionId: string }> {
  const adjustmentId   = randomUUID();
  const distributionId = randomUUID();

  await ctx.db.insert(adjustmentMap).values({
    tenantId:           TENANT,
    adjustmentId,
    distributionId,
    personId:           randomUUID(),
    enrolmentId:        randomUUID(),
    adjustmentTypeCode: 'EXTRA_TIME',
    scopeCode:          'MODULE',
    validFrom:          new Date(),
    statusCode,
  });

  return { adjustmentId, distributionId };
}

async function seedMarkRow(
  ctx:    TestVleApp,
  markId: string | null = null,
): Promise<{ id: string; moduleRegistrationId: string; assessmentComponentId: string; sourceReference: string }> {
  const moduleRegistrationId  = randomUUID();
  const assessmentComponentId = randomUUID();
  const sourceReference       = `vle-${randomUUID()}`;

  const rows = await ctx.db
    .insert(markReceipt)
    .values({
      tenantId: TENANT,
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark: '75',
      ...(markId !== null ? { markId } : {}),
    })
    .returning({ id: markReceipt.id });

  return { id: rows[0]!.id, moduleRegistrationId, assessmentComponentId, sourceReference };
}

function makeRosterService(ctx: TestVleApp): ReconciliationService {
  const vleClient = new HttpVleClient(ctx.stubVleBaseUrl);
  return new ReconciliationService(ctx.db, TENANT, vleClient, undefined, undefined, log);
}

function makeAdjustmentService(ctx: TestVleApp): ReconciliationService {
  const srsAckClient = new HttpSrsAcknowledgementClient(ctx.stubSrsAckBaseUrl, 'test-token');
  return new ReconciliationService(ctx.db, TENANT, undefined, srsAckClient, undefined, log);
}

function makeMarkService(ctx: TestVleApp): ReconciliationService {
  const srsMarkClient = new HttpSrsMarkClient(ctx.stubSrsMarksBaseUrl, 'test-token');
  return new ReconciliationService(ctx.db, TENANT, undefined, undefined, srsMarkClient, log);
}

// ── Suite 1: retry policy ──────────────────────────────────────────────────────

describe('Stage 7 — retry policy', () => {
  it('1.1 returns value immediately when fn succeeds on first attempt', async () => {
    const result = await withRetry(
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => 'ok',
      { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 },
    );
    expect(result).toBe('ok');
  });

  it('1.2 retries on failure and succeeds on subsequent attempt', async () => {
    let calls = 0;
    const result = await withRetry(
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'success';
      },
      { maxAttempts: 5, initialDelayMs: 0, backoffFactor: 1 },
    );
    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('1.3 rethrows original error after exhausting all attempts', async () => {
    const boom = new Error('permanent failure');
    await expect(
      // eslint-disable-next-line @typescript-eslint/require-await
      withRetry(async () => { throw boom; }, { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 }),
    ).rejects.toBe(boom);
  });

  it('1.4 calls fn exactly maxAttempts times before giving up', async () => {
    let calls = 0;
    await withRetry(
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => { calls++; throw new Error('always fails'); },
      { maxAttempts: 4, initialDelayMs: 0, backoffFactor: 1 },
    ).catch(() => {/* expected */});
    expect(calls).toBe(4);
  });

  it('1.5 with maxAttempts=1, does not retry on failure', async () => {
    let calls = 0;
    await withRetry(
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => { calls++; throw new Error('fail'); },
      { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 2 },
    ).catch(() => {/* expected */});
    expect(calls).toBe(1);
  });
});

// ── Suite 2: roster reconciliation ────────────────────────────────────────────

describe('Stage 7 — roster reconciliation', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('2.1 finds enrolment rows with null vleEnrolmentId and calls upsertEnrolment', async () => {
    await seedEnrolmentRow(ctx);
    await seedEnrolmentRow(ctx);
    const service = makeRosterService(ctx);
    const result  = await service.reconcileRoster();
    expect(result.driftCount).toBe(2);
    expect(ctx.stubVle.stubStore.enrolments.size).toBe(2);
  });

  it('2.2 enrolment_map row is updated with vleEnrolmentId after reconciliation', async () => {
    const { moduleRegistrationId } = await seedEnrolmentRow(ctx);
    await makeRosterService(ctx).reconcileRoster();

    const rows = await ctx.db
      .select({ vleEnrolmentId: enrolmentMap.vleEnrolmentId })
      .from(enrolmentMap)
      .where(
        and(
          eq(enrolmentMap.tenantId,             TENANT),
          eq(enrolmentMap.moduleRegistrationId, moduleRegistrationId),
        ),
      );

    expect(rows[0]?.vleEnrolmentId).toBeTruthy();
    expect(rows[0]?.vleEnrolmentId).toBe(`vle-enr-${moduleRegistrationId}`);
  });

  it('2.3 already-synced enrolments (non-null vleEnrolmentId) are not in drift count', async () => {
    await seedEnrolmentRow(ctx, { vleEnrolmentId: 'existing-vle-id' });
    await seedEnrolmentRow(ctx); // unsynced
    const result = await makeRosterService(ctx).reconcileRoster();
    expect(result.driftCount).toBe(1);
    expect(result.repairedCount).toBe(1);
  });

  it('2.4 reconciliation run is persisted in vle_reconciliation_run', async () => {
    await seedEnrolmentRow(ctx);
    const { runId } = await makeRosterService(ctx).reconcileRoster();

    const rows = await ctx.db
      .select()
      .from(reconciliationRun)
      .where(eq(reconciliationRun.id, runId));

    expect(rows[0]).toBeDefined();
    expect(rows[0]?.runType).toBe('roster');
    expect(rows[0]?.completedAt).not.toBeNull();
    expect(rows[0]?.driftCount).toBe(1);
    expect(rows[0]?.repairedCount).toBe(1);
  });

  it('2.5 without vleClient, drift is counted but no repairs are made', async () => {
    await seedEnrolmentRow(ctx);
    await seedEnrolmentRow(ctx);
    const service = new ReconciliationService(ctx.db, TENANT, undefined, undefined, undefined, log);
    const result  = await service.reconcileRoster();
    expect(result.driftCount).toBe(2);
    expect(result.repairedCount).toBe(0);
    expect(ctx.stubVle.stubStore.enrolments.size).toBe(0);
  });

  it('2.6 repaired enrolments do not appear in subsequent drift', async () => {
    await seedEnrolmentRow(ctx);
    const service = makeRosterService(ctx);
    await service.reconcileRoster();
    const second = await service.reconcileRoster();
    expect(second.driftCount).toBe(0);
    expect(second.repairedCount).toBe(0);
  });
});

// ── Suite 3: adjustment reconciliation ────────────────────────────────────────

describe('Stage 7 — adjustment reconciliation', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('3.1 finds applied adjustments and calls srsAckClient.acknowledgeDistribution', async () => {
    const { adjustmentId, distributionId } = await seedAdjustmentRow(ctx, 'applied');
    await makeAdjustmentService(ctx).reconcileAdjustments();

    const calls = ctx.stubSrsAck.getAckCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.adjustmentId).toBe(adjustmentId);
    expect(calls[0]?.distributionId).toBe(distributionId);
  });

  it('3.2 adjustment_map is updated to acknowledged after reconciliation', async () => {
    const { distributionId } = await seedAdjustmentRow(ctx, 'applied');
    await makeAdjustmentService(ctx).reconcileAdjustments();

    const rows = await ctx.db
      .select({ statusCode: adjustmentMap.statusCode, acknowledgedAt: adjustmentMap.acknowledgedAt })
      .from(adjustmentMap)
      .where(
        and(
          eq(adjustmentMap.tenantId,       TENANT),
          eq(adjustmentMap.distributionId, distributionId),
        ),
      );

    expect(rows[0]?.statusCode).toBe('acknowledged');
    expect(rows[0]?.acknowledgedAt).not.toBeNull();
  });

  it('3.3 already-acknowledged adjustments are not in drift count', async () => {
    await seedAdjustmentRow(ctx, 'acknowledged');
    await seedAdjustmentRow(ctx, 'applied');
    const result = await makeAdjustmentService(ctx).reconcileAdjustments();
    expect(result.driftCount).toBe(1);
    expect(result.repairedCount).toBe(1);
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(1);
  });

  it('3.4 reconciliation run records correct drift and repaired counts', async () => {
    await seedAdjustmentRow(ctx, 'applied');
    await seedAdjustmentRow(ctx, 'applied');
    const { runId } = await makeAdjustmentService(ctx).reconcileAdjustments();

    const rows = await ctx.db
      .select()
      .from(reconciliationRun)
      .where(eq(reconciliationRun.id, runId));

    expect(rows[0]?.driftCount).toBe(2);
    expect(rows[0]?.repairedCount).toBe(2);
    expect(rows[0]?.runType).toBe('adjustments');
  });

  it('3.5 without srsAckClient, drift is counted but no acks are sent', async () => {
    await seedAdjustmentRow(ctx, 'applied');
    const service = new ReconciliationService(ctx.db, TENANT, undefined, undefined, undefined, log);
    const result  = await service.reconcileAdjustments();
    expect(result.driftCount).toBe(1);
    expect(result.repairedCount).toBe(0);
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(0);
  });
});

// ── Suite 4: mark reconciliation ──────────────────────────────────────────────

describe('Stage 7 — mark reconciliation', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('4.1 finds receipts with null markId and calls srsMarkClient.submitMark', async () => {
    const { moduleRegistrationId, assessmentComponentId } = await seedMarkRow(ctx, null);
    await makeMarkService(ctx).reconcileMarks();

    const calls = ctx.stubSrsMarks.getMarkCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.moduleRegistrationId).toBe(moduleRegistrationId);
    expect(calls[0]?.assessmentComponentId).toBe(assessmentComponentId);
    expect(calls[0]?.rawMark).toBe(75);
    expect(calls[0]?.sourceSystem).toBe('vle');
  });

  it('4.2 mark_receipt is updated with SRS markId after reconciliation', async () => {
    const { id } = await seedMarkRow(ctx, null);
    await makeMarkService(ctx).reconcileMarks();

    const rows = await ctx.db
      .select({ markId: markReceipt.markId })
      .from(markReceipt)
      .where(
        and(
          eq(markReceipt.tenantId, TENANT),
          eq(markReceipt.id,       id),
        ),
      );

    expect(rows[0]?.markId).toBeTruthy();
    expect(typeof rows[0]?.markId).toBe('string');
  });

  it('4.3 receipts with an existing markId are not resubmitted', async () => {
    const existingMarkId = randomUUID();
    await seedMarkRow(ctx, existingMarkId); // already submitted
    await seedMarkRow(ctx, null);            // needs submission
    const result = await makeMarkService(ctx).reconcileMarks();
    expect(result.driftCount).toBe(1);
    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(1);
  });

  it('4.4 reconciliation run records correct counts', async () => {
    await seedMarkRow(ctx, null);
    await seedMarkRow(ctx, null);
    const { runId } = await makeMarkService(ctx).reconcileMarks();

    const rows = await ctx.db
      .select()
      .from(reconciliationRun)
      .where(eq(reconciliationRun.id, runId));

    expect(rows[0]?.driftCount).toBe(2);
    expect(rows[0]?.repairedCount).toBe(2);
    expect(rows[0]?.runType).toBe('marks');
  });

  it('4.5 multiple mark receipts are each processed independently', async () => {
    const row1 = await seedMarkRow(ctx, null);
    const row2 = await seedMarkRow(ctx, null);
    const row3 = await seedMarkRow(ctx, null);
    await makeMarkService(ctx).reconcileMarks();

    for (const { id } of [row1, row2, row3]) {
      const rows = await ctx.db
        .select({ markId: markReceipt.markId })
        .from(markReceipt)
        .where(and(eq(markReceipt.tenantId, TENANT), eq(markReceipt.id, id)));
      expect(rows[0]?.markId).toBeTruthy();
    }

    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(3);
  });
});

// ── Suite 5: health service ────────────────────────────────────────────────────

describe('Stage 7 — health service', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('5.1 reports zero counts when no ledger entries exist for tenant', async () => {
    const service = new HealthService(ctx.db);
    const report  = await service.getReport(TENANT);
    expect(report.totalProcessed).toBe(0);
    expect(report.totalFailed).toBe(0);
    expect(report.recentFailed).toBe(0);
    expect(report.lastProcessedAt).toBeNull();
    expect(report.lastReconciliation).toBeNull();
  });

  it('5.2 reports total processed and failed counts from event ledger', async () => {
    await ctx.db.insert(eventLedger).values([
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'processed' },
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'processed' },
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'failed'    },
    ]);

    const service = new HealthService(ctx.db);
    const report  = await service.getReport(TENANT);
    expect(report.totalProcessed).toBe(2);
    expect(report.totalFailed).toBe(1);
  });

  it('5.3 recentFailed counts only failures from the last 24 hours', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
    await ctx.db.insert(eventLedger).values([
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'failed', processedAt: oldDate },
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'failed' }, // now
    ]);

    const service = new HealthService(ctx.db);
    const report  = await service.getReport(TENANT);
    expect(report.recentFailed).toBe(1);
    expect(report.totalFailed).toBe(2);
  });

  it('5.4 lastProcessedAt reflects the most recent processed ledger entry', async () => {
    const t1 = new Date(Date.now() - 10_000);
    const t2 = new Date(Date.now() - 5_000);
    await ctx.db.insert(eventLedger).values([
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'processed', processedAt: t1 },
      { tenantId: TENANT, eventId: randomUUID(), subject: 'srs.test', statusCode: 'processed', processedAt: t2 },
    ]);

    const service = new HealthService(ctx.db);
    const report  = await service.getReport(TENANT);
    expect(report.lastProcessedAt).not.toBeNull();
    expect(report.lastProcessedAt!.getTime()).toBeCloseTo(t2.getTime(), -2);
  });

  it('5.5 lastReconciliation reflects the most recent reconciliation run', async () => {
    await ctx.db.insert(reconciliationRun).values({
      tenantId:      TENANT,
      runType:       'roster',
      completedAt:   new Date(),
      driftCount:    3,
      repairedCount: 3,
    });

    const service = new HealthService(ctx.db);
    const report  = await service.getReport(TENANT);
    expect(report.lastReconciliation).not.toBeNull();
    expect(report.lastReconciliation?.runType).toBe('roster');
    expect(report.lastReconciliation?.driftCount).toBe(3);
    expect(report.lastReconciliation?.repairedCount).toBe(3);
  });
});
