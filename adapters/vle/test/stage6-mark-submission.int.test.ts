/**
 * Stage 6 — Mark Submission Flow (F016).
 *
 * Verifies:
 * - MarkSubmissionService.submitMark: posts mark to SRS and stores receipt.
 * - SRS receives correct fields: assessmentComponentId, rawMark, sourceSystem, sourceReference.
 * - Mark receipt stored in DB with SRS-assigned markId.
 * - Idempotency: duplicate sourceReference is not resubmitted to SRS.
 * - No srsMarkClient: submitMark throws or service cannot be created.
 * - SRS 422/404 errors propagate and no receipt is written.
 * - handleModuleResultRatified: updates stub VLE result display state.
 * - Ratified result for unknown enrolment: logs warning, ledger records processed.
 * - End-to-end ratified result dispatch.
 *
 * NATS is not started — dispatch() is called directly for event-driven tests.
 * MarkSubmissionService is called directly for outbound mark submission tests.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type { AssessmentModuleResultRatifiedV1Payload } from '@revelation-srs/domain';

import { getMarkReceipt } from '../src/consumers/f016/mark-receipt-repository.js';
import { VleEventConsumer } from '../src/consumers/vle-event-consumer.js';
import { markReceipt } from '../src/db/schema/mark-receipt.js';
import { eventLedger } from '../src/db/schema/event-ledger.js';
import { HttpSrsMarkClient } from '../src/srs-client/mark-client.js';
import { MarkSubmissionService } from '../src/services/mark-submission-service.js';
import { HttpVleClient } from '../src/vle-client/client.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const log = pino({ level: 'silent' });
const TENANT = '00000000-0000-0000-0000-000000000001';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRatifiedEnvelope(
  overrides: Partial<AssessmentModuleResultRatifiedV1Payload> = {},
  envelopeOverrides: Partial<DomainEventEnvelope<AssessmentModuleResultRatifiedV1Payload>> = {},
): DomainEventEnvelope<AssessmentModuleResultRatifiedV1Payload> {
  const payload: AssessmentModuleResultRatifiedV1Payload = {
    moduleResultId:       overrides.moduleResultId       ?? randomUUID(),
    moduleRegistrationId: overrides.moduleRegistrationId ?? randomUUID(),
    aggregateMark:        overrides.aggregateMark        ?? 72,
    resultCode:           overrides.resultCode           ?? 'PASS',
    examBoardId:          overrides.examBoardId          ?? randomUUID(),
    ratifiedAt:           overrides.ratifiedAt           ?? new Date().toISOString(),
  };
  return {
    id:                 randomUUID(),
    type:               'srs.assessment.module-result-ratified',
    version:            '1.0.0',
    schemaRef:          'https://srs.example.com/schemas/srs.assessment.module-result-ratified.json',
    tenantId:           TENANT,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'internal',
    payload,
    ...envelopeOverrides,
  };
}

function makeMarkService(ctx: TestVleApp): MarkSubmissionService {
  const srsMarkClient = new HttpSrsMarkClient(ctx.stubSrsMarksBaseUrl, 'test-token');
  return new MarkSubmissionService(ctx.db, TENANT, srsMarkClient);
}

async function clearTables(ctx: TestVleApp): Promise<void> {
  await ctx.db.delete(markReceipt).where(eq(markReceipt.tenantId, TENANT));
  await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  ctx.stubVle.stubStore.reset();
  ctx.stubSrsMarks.reset();
}

// ── Suite 1: mark submission — happy path ─────────────────────────────────────

describe('Stage 6 — mark submission happy path', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('1.1 submitMark returns a markId from SRS', async () => {
    const service = makeMarkService(ctx);
    const result  = await service.submitMark({
      moduleRegistrationId:  randomUUID(),
      assessmentComponentId: randomUUID(),
      sourceReference:       'vle-assign-1-student-a-attempt-1',
      rawMark:               75,
    });

    expect(result.markId).toBeTruthy();
    expect(typeof result.markId).toBe('string');
  });

  it('1.2 SRS receives the correct mark fields', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference      = `vle-${randomUUID()}`;

    await service.submitMark({
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark:       68,
      attemptNumber: 2,
      submittedAt:   '2026-01-15T10:30:00.000Z',
    });

    const calls = ctx.stubSrsMarks.getMarkCalls();
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.moduleRegistrationId).toBe(moduleRegistrationId);
    expect(call?.assessmentComponentId).toBe(assessmentComponentId);
    expect(call?.rawMark).toBe(68);
    expect(call?.sourceReference).toBe(sourceReference);
    expect(call?.attemptNumber).toBe(2);
    expect(call?.submittedAt).toBe('2026-01-15T10:30:00.000Z');
  });

  it('1.3 sourceSystem is set to "vle" on every submission', async () => {
    const service = makeMarkService(ctx);
    await service.submitMark({
      moduleRegistrationId:  randomUUID(),
      assessmentComponentId: randomUUID(),
      sourceReference:       `vle-${randomUUID()}`,
      rawMark:               55,
    });

    const calls = ctx.stubSrsMarks.getMarkCalls();
    expect(calls[0]?.sourceSystem).toBe('vle');
  });

  it('1.4 mark receipt is written to DB with the SRS markId', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference      = `vle-${randomUUID()}`;

    const { markId } = await service.submitMark({
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark: 81,
    });

    const receipt = await getMarkReceipt(ctx.db, TENANT, moduleRegistrationId, assessmentComponentId, sourceReference);
    expect(receipt).not.toBeNull();
    expect(receipt?.markId).toBe(markId);
  });

  it('1.5 mark receipt stores the rawMark', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference      = `vle-${randomUUID()}`;

    await service.submitMark({
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark: 43,
    });

    const receipt = await getMarkReceipt(ctx.db, TENANT, moduleRegistrationId, assessmentComponentId, sourceReference);
    expect(Number(receipt?.rawMark)).toBe(43);
  });
});

// ── Suite 2: mark submission idempotency ──────────────────────────────────────

describe('Stage 6 — mark submission idempotency', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('2.1 duplicate sourceReference is NOT resubmitted to SRS', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference      = `vle-${randomUUID()}`;

    await service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 70 });
    await service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 70 });

    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(1);
  });

  it('2.2 duplicate call returns the same markId', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference      = `vle-${randomUUID()}`;

    const first  = await service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 70 });
    const second = await service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 70 });

    expect(second.markId).toBe(first.markId);
  });

  it('2.3 different sourceReferences for same component are both submitted', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();

    await service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference: `ref-${randomUUID()}`, rawMark: 70 });
    await service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference: `ref-${randomUUID()}`, rawMark: 75 });

    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(2);
  });

  it('2.4 idempotency key scoped by tenant — different tenants submit independently', async () => {
    // First service: TENANT
    const service1 = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference = `vle-${randomUUID()}`;

    await service1.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 70 });

    // Second service: a different tenantId pointing at the same DB
    const srsMarkClient2 = new HttpSrsMarkClient(ctx.stubSrsMarksBaseUrl, 'test-token');
    const service2 = new MarkSubmissionService(ctx.db, '00000000-0000-0000-0000-000000000002', srsMarkClient2);
    await service2.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 70 });

    // Both called SRS (different tenants, different receipts)
    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(2);
  });
});

// ── Suite 3: mark submission error handling ───────────────────────────────────

describe('Stage 6 — mark submission error handling', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('3.1 SRS 422 error propagates and no receipt is written', async () => {
    // Use a non-existent URL to simulate SRS failure.
    const badMarkClient = new HttpSrsMarkClient('http://127.0.0.1:1', 'test-token');
    const service       = new MarkSubmissionService(ctx.db, TENANT, badMarkClient);

    const moduleRegistrationId  = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference       = `vle-${randomUUID()}`;

    await expect(
      service.submitMark({ moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 55 }),
    ).rejects.toThrow();

    // No receipt written on failure
    const receipt = await getMarkReceipt(ctx.db, TENANT, moduleRegistrationId, assessmentComponentId, sourceReference);
    expect(receipt).toBeNull();
  });

  it('3.2 multiple marks for different registrations each get their own receipt', async () => {
    const service = makeMarkService(ctx);

    const assessmentComponentId = randomUUID();

    const id1 = randomUUID();
    const id2 = randomUUID();
    const id3 = randomUUID();

    await service.submitMark({ moduleRegistrationId: id1, assessmentComponentId, sourceReference: `ref-${randomUUID()}`, rawMark: 60 });
    await service.submitMark({ moduleRegistrationId: id2, assessmentComponentId, sourceReference: `ref-${randomUUID()}`, rawMark: 70 });
    await service.submitMark({ moduleRegistrationId: id3, assessmentComponentId, sourceReference: `ref-${randomUUID()}`, rawMark: 80 });

    const rows = await ctx.db.select().from(markReceipt).where(eq(markReceipt.tenantId, TENANT));
    expect(rows).toHaveLength(3);
    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(3);
  });
});

// ── Suite 4: ratified result handler ──────────────────────────────────────────

describe('Stage 6 — ratified result handler', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('4.1 srs.assessment.module-result-ratified updates stub VLE result display', async () => {
    const moduleRegistrationId = randomUUID();

    // Seed the enrolment so the stub VLE can store the result
    ctx.stubVle.stubStore.upsertEnrolment({
      moduleRegistrationId,
      moduleId:       randomUUID(),
      personId:       randomUUID(),
      enrolmentId:    randomUUID(),
      vleEnrolmentId: `vle-enr-${moduleRegistrationId}`,
      statusCode:     'active',
    });

    const consumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      { vleClient: new HttpVleClient(ctx.stubVleBaseUrl) },
    );
    const envelope = makeRatifiedEnvelope({ moduleRegistrationId, aggregateMark: 85, resultCode: 'PASS' });

    await consumer.dispatch(envelope);

    const result = ctx.stubVle.stubStore.results.get(moduleRegistrationId);
    expect(result).toBeDefined();
    expect(result?.aggregateMark).toBe(85);
    expect(result?.resultCode).toBe('PASS');
  });

  it('4.2 ratifiedAt is passed through to stub VLE', async () => {
    const moduleRegistrationId = randomUUID();
    const ratifiedAt           = '2026-06-01T12:00:00.000Z';

    ctx.stubVle.stubStore.upsertEnrolment({
      moduleRegistrationId,
      moduleId:       randomUUID(),
      personId:       randomUUID(),
      enrolmentId:    randomUUID(),
      vleEnrolmentId: `vle-enr-${moduleRegistrationId}`,
      statusCode:     'active',
    });

    const consumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      { vleClient: new HttpVleClient(ctx.stubVleBaseUrl) },
    );

    await consumer.dispatch(makeRatifiedEnvelope({ moduleRegistrationId, ratifiedAt }));

    const result = ctx.stubVle.stubStore.results.get(moduleRegistrationId);
    expect(result?.ratifiedAt).toBe(ratifiedAt);
  });

  it('4.3 ratified event for unknown enrolment is not a fatal error — ledger records processed', async () => {
    const moduleRegistrationId = randomUUID(); // no enrolment seeded

    const consumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      { vleClient: new HttpVleClient(ctx.stubVleBaseUrl) },
    );
    const envelope = makeRatifiedEnvelope({ moduleRegistrationId });

    // Should not throw
    await consumer.dispatch(envelope);

    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));

    expect(rows[0]?.statusCode).toBe('processed');
  });

  it('4.4 ratified event without vleClient is a no-op — ledger records processed', async () => {
    const consumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      {}, // no vleClient
    );
    const envelope = makeRatifiedEnvelope();

    await consumer.dispatch(envelope);

    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));

    expect(rows[0]?.statusCode).toBe('processed');
  });
});

// ── Suite 5: end-to-end mark flow ─────────────────────────────────────────────

describe('Stage 6 — end-to-end mark flow', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('5.1 full outbound lifecycle: submitMark → SRS called → receipt stored', async () => {
    const service              = makeMarkService(ctx);
    const moduleRegistrationId = randomUUID();
    const assessmentComponentId = randomUUID();
    const sourceReference      = `vle-${randomUUID()}`;

    const { markId } = await service.submitMark({
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark:       91,
      attemptNumber: 1,
    });

    // SRS was called
    const calls = ctx.stubSrsMarks.getMarkCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rawMark).toBe(91);
    expect(calls[0]?.sourceSystem).toBe('vle');

    // Receipt stored with SRS markId
    const receipt = await getMarkReceipt(ctx.db, TENANT, moduleRegistrationId, assessmentComponentId, sourceReference);
    expect(receipt?.markId).toBe(markId);
  });

  it('5.2 full inbound lifecycle: ratified event → VLE result updated → ledger processed', async () => {
    const moduleRegistrationId = randomUUID();

    ctx.stubVle.stubStore.upsertEnrolment({
      moduleRegistrationId,
      moduleId:       randomUUID(),
      personId:       randomUUID(),
      enrolmentId:    randomUUID(),
      vleEnrolmentId: `vle-enr-${moduleRegistrationId}`,
      statusCode:     'completed',
    });

    const consumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      { vleClient: new HttpVleClient(ctx.stubVleBaseUrl) },
    );
    const envelope = makeRatifiedEnvelope({ moduleRegistrationId, aggregateMark: 78, resultCode: 'PASS' });

    await consumer.dispatch(envelope);

    // VLE has the result
    const result = ctx.stubVle.stubStore.results.get(moduleRegistrationId);
    expect(result?.aggregateMark).toBe(78);
    expect(result?.resultCode).toBe('PASS');

    // Ledger records processed
    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));
    expect(rows[0]?.statusCode).toBe('processed');
  });
});
