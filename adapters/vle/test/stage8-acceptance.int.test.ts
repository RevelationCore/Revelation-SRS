/**
 * Stage 8 — Contract Tests and Acceptance Review.
 *
 * Confirms Phase 9 exit criteria before Phase 10:
 * - Boundary: VLE connector imports no SRS internal packages.
 * - Event contract: subscribed subjects match the Stage 0 baseline; unapproved events absent.
 * - Golden-path: F015, F059, and F016 each produce the expected side-effects end-to-end.
 * - Combined scenario: all three flows work together in a single coherent sequence.
 * - Health: HealthService reflects real event counts after processing.
 * - Resilience: VLE outage records failure; reconciliation repairs drift on recovery.
 *
 * NATS is not started — dispatch() is called directly.
 * VLE and SRS calls target the in-process stub servers.
 */

import { execSync }     from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import { dirname }      from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';
import { pino }    from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type {
  AdjustmentDistributedV1Payload,
  AssessmentModuleResultRatifiedV1Payload,
  CatalogueModuleUpdatedV1Payload,
  EnrolmentModuleRegisteredV1Payload,
  EnrolmentModuleRegistrationWithdrawnV1Payload,
  StudentEnrolledV1Payload,
} from '@revelation-srs/domain';

import { VleEventConsumer }     from '../src/consumers/vle-event-consumer.js';
import { VLE_SUBSCRIBED_SUBJECTS } from '../src/consumers/handlers.js';
import { adjustmentMap }        from '../src/db/schema/adjustment-map.js';
import { courseMap }            from '../src/db/schema/course-map.js';
import { enrolmentMap }         from '../src/db/schema/enrolment-map.js';
import { eventLedger }          from '../src/db/schema/event-ledger.js';
import { markReceipt }          from '../src/db/schema/mark-receipt.js';
import { reconciliationRun }    from '../src/db/schema/reconciliation.js';
import { studentEnrolmentMap }  from '../src/db/schema/student-enrolment-map.js';
import { HealthService }             from '../src/reliability/health-service.js';
import { ReconciliationService }     from '../src/reliability/reconciliation-service.js';
import { HttpSrsAcknowledgementClient } from '../src/srs-client/acknowledgement-client.js';
import { HttpSrsMarkClient }            from '../src/srs-client/mark-client.js';
import { MarkSubmissionService }        from '../src/services/mark-submission-service.js';
import { HttpVleClient }               from '../src/vle-client/client.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log       = pino({ level: 'silent' });
const TENANT    = '00000000-0000-0000-0000-000000000001';
const OTHER     = '00000000-0000-0000-0000-000000000002';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEnvelope<T>(
  type:    string,
  payload: T,
  overrides: Partial<DomainEventEnvelope<T>> = {},
): DomainEventEnvelope<T> {
  return {
    id:                 crypto.randomUUID(),
    type,
    version:            '1.0.0',
    schemaRef:          `https://srs.example.com/schemas/${type}.json`,
    tenantId:           TENANT,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      crypto.randomUUID(),
    causationId:        crypto.randomUUID(),
    source:             'srs-core',
    dataClassification: 'internal',
    payload,
    ...overrides,
  };
}

function makeFullConsumer(ctx: TestVleApp): VleEventConsumer {
  return new VleEventConsumer(
    'nats://unused', ctx.db, TENANT, log,
    {
      vleClient:    new HttpVleClient(ctx.stubVleBaseUrl),
      srsAckClient: new HttpSrsAcknowledgementClient(ctx.stubSrsAckBaseUrl, 'test-token'),
    },
  );
}

async function clearAllTables(ctx: TestVleApp): Promise<void> {
  await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  await ctx.db.delete(courseMap).where(eq(courseMap.tenantId, TENANT));
  await ctx.db.delete(enrolmentMap).where(eq(enrolmentMap.tenantId, TENANT));
  await ctx.db.delete(studentEnrolmentMap).where(eq(studentEnrolmentMap.tenantId, TENANT));
  await ctx.db.delete(adjustmentMap).where(eq(adjustmentMap.tenantId, TENANT));
  await ctx.db.delete(markReceipt).where(eq(markReceipt.tenantId, TENANT));
  await ctx.db.delete(reconciliationRun).where(eq(reconciliationRun.tenantId, TENANT));
  ctx.stubVle.stubStore.reset();
  ctx.stubSrsAck.reset();
  ctx.stubSrsMarks.reset();
}

// ── Suite 1: Boundary compliance ──────────────────────────────────────────────

describe('Stage 8 — boundary compliance', () => {
  const pkgPath     = join(__dirname, '../package.json');
  const tsconfigPath = join(__dirname, '../tsconfig.json');
  const srcDir      = join(__dirname, '../src');

  it('1.1 package.json has no @revelation-srs/api dependency', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect('@revelation-srs/api' in allDeps).toBe(false);
  });

  it('1.2 package.json has no @revelation-srs/db dependency', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect('@revelation-srs/db' in allDeps).toBe(false);
  });

  it('1.3 tsconfig.json references only packages/domain (not api, db, or apps)', () => {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
      references?: { path: string }[];
    };
    const refs = (tsconfig.references ?? []).map(r => r.path);
    expect(refs.every(r => !r.includes('packages/api') && !r.includes('packages/db') && !r.includes('apps/'))).toBe(true);
    expect(refs.some(r => r.includes('packages/domain'))).toBe(true);
  });

  it('1.4 no source file imports from @revelation-srs/api or @revelation-srs/db', () => {
    let output = '';
    try {
      output = execSync(
        `grep -r "@revelation-srs/api\\|@revelation-srs/db" --include="*.ts" "${srcDir}"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch {
      // grep exits 1 when no match found — that is the expected success case
      output = '';
    }
    expect(output.trim()).toBe('');
  });
});

// ── Suite 2: Event contract compliance ────────────────────────────────────────

const STAGE_0_SUBJECTS = [
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

describe('Stage 8 — event contract compliance (static)', () => {
  it('2.1 VLE_SUBSCRIBED_SUBJECTS contains all 10 subjects from Stage 0 baseline', () => {
    for (const subject of STAGE_0_SUBJECTS) {
      expect(VLE_SUBSCRIBED_SUBJECTS).toContain(subject);
    }
    expect(VLE_SUBSCRIBED_SUBJECTS).toHaveLength(STAGE_0_SUBJECTS.length);
  });

  it('2.2 srs.adjustment.approved is NOT in VLE_SUBSCRIBED_SUBJECTS', () => {
    expect(VLE_SUBSCRIBED_SUBJECTS).not.toContain('srs.adjustment.approved');
  });
});

describe('Stage 8 — event contract compliance (dispatch)', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearAllTables(ctx));

  it('2.3 dispatching srs.adjustment.approved records "skipped" in ledger', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log, {});
    const envelope = makeEnvelope('srs.adjustment.approved', { adjustmentId: crypto.randomUUID() });
    await consumer.dispatch(envelope);

    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.eventId, envelope.id));
    expect(rows[0]?.statusCode).toBe('skipped');
  });

  it('2.4 dispatching srs.adjustment.distributed with non-VLE targetSystem creates no adjustment_map row', async () => {
    const consumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log, {});
    const payload: AdjustmentDistributedV1Payload = {
      adjustmentId:       crypto.randomUUID(),
      distributionId:     crypto.randomUUID(),
      targetSystem:       'library-system', // not 'vle'
      distributedAt:      new Date().toISOString(),
      personId:           crypto.randomUUID(),
      enrolmentId:        crypto.randomUUID(),
      adjustmentTypeCode: 'EXTRA_TIME',
      scopeCode:          'MODULE',
      validFrom:          '2026-01-01T00:00:00.000Z',
    };
    await consumer.dispatch(makeEnvelope('srs.adjustment.distributed', payload));

    const rows = await ctx.db.select().from(adjustmentMap).where(eq(adjustmentMap.tenantId, TENANT));
    expect(rows).toHaveLength(0);
  });
});

// ── Suite 3: Golden-path scenarios ────────────────────────────────────────────

describe('Stage 8 — golden-path scenarios', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearAllTables(ctx));

  it('3.1 F015: module-updated + student-enrolled + module-registered provisions VLE course and enrolment', async () => {
    const consumer = makeFullConsumer(ctx);

    const moduleId             = crypto.randomUUID();
    const personId             = crypto.randomUUID();
    const enrolmentId          = crypto.randomUUID();
    const moduleRegistrationId = crypto.randomUUID();

    const modulePayload: CatalogueModuleUpdatedV1Payload = {
      moduleId, code: 'CS101', title: 'Intro to Computing', creditValue: 20, effectiveDate: '2026-09-01',
    };
    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', modulePayload));

    const enrolledPayload: StudentEnrolledV1Payload = {
      personId, enrolmentId, academicYear: '2026/27', modeOfStudy: 'full-time',
    };
    await consumer.dispatch(makeEnvelope('srs.student.enrolled', enrolledPayload));

    const registeredPayload: EnrolmentModuleRegisteredV1Payload = {
      enrolmentId, moduleRegistrationId,
      moduleOfferingId: crypto.randomUUID(),
      moduleId, academicPeriodId: crypto.randomUUID(),
      registrationDate: '2026-09-15',
    };
    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', registeredPayload));

    // VLE has the course
    expect(ctx.stubVle.stubStore.courses.has(moduleId)).toBe(true);

    // VLE has the enrolment
    const enrolment = ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId);
    expect(enrolment).toBeDefined();
    expect(enrolment?.vleEnrolmentId).toBe(`vle-enr-${moduleRegistrationId}`);

    // All events recorded as processed
    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.tenantId, TENANT));
    expect(rows.every(r => r.statusCode === 'processed')).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('3.2 F059: adjustment-distributed → VLE applied → SRS acknowledged', async () => {
    const consumer = makeFullConsumer(ctx);
    const adjustmentId   = crypto.randomUUID();
    const distributionId = crypto.randomUUID();

    const payload: AdjustmentDistributedV1Payload = {
      adjustmentId, distributionId,
      targetSystem:       'vle',
      distributedAt:      new Date().toISOString(),
      personId:           crypto.randomUUID(),
      enrolmentId:        crypto.randomUUID(),
      adjustmentTypeCode: 'EXTRA_TIME',
      scopeCode:          'ALL_ASSESSMENTS',
      validFrom:          '2026-01-01T00:00:00.000Z',
    };
    await consumer.dispatch(makeEnvelope('srs.adjustment.distributed', payload));

    // VLE received the adjustment
    expect(ctx.stubVle.stubStore.adjustments.has(distributionId)).toBe(true);

    // SRS was acknowledged
    const ackCalls = ctx.stubSrsAck.getAckCalls();
    expect(ackCalls).toHaveLength(1);
    expect(ackCalls[0]?.adjustmentId).toBe(adjustmentId);
    expect(ackCalls[0]?.distributionId).toBe(distributionId);
    expect(ackCalls[0]?.targetSystem).toBe('vle');

    // adjustment_map records acknowledged
    const mapRow = await ctx.db
      .select({ statusCode: adjustmentMap.statusCode })
      .from(adjustmentMap)
      .where(and(eq(adjustmentMap.tenantId, TENANT), eq(adjustmentMap.distributionId, distributionId)));
    expect(mapRow[0]?.statusCode).toBe('acknowledged');
  });

  it('3.3 F016 outbound + inbound: mark submitted → SRS mark created; result ratified → VLE updated', async () => {
    const moduleRegistrationId  = crypto.randomUUID();
    const assessmentComponentId = crypto.randomUUID();
    const sourceReference       = `vle-${crypto.randomUUID()}`;

    // Seed enrolment in stub VLE so ratified result can be set
    ctx.stubVle.stubStore.upsertEnrolment({
      moduleRegistrationId,
      moduleId:       crypto.randomUUID(),
      personId:       crypto.randomUUID(),
      enrolmentId:    crypto.randomUUID(),
      vleEnrolmentId: `vle-enr-${moduleRegistrationId}`,
      statusCode:     'active',
    });

    // Outbound: submit mark via MarkSubmissionService
    const srsMarkClient = new HttpSrsMarkClient(ctx.stubSrsMarksBaseUrl, 'test-token');
    const markService   = new MarkSubmissionService(ctx.db, TENANT, srsMarkClient);
    const { markId }    = await markService.submitMark({
      moduleRegistrationId, assessmentComponentId, sourceReference, rawMark: 72,
    });
    expect(markId).toBeTruthy();
    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(1);

    // Inbound: module-result-ratified updates VLE display state
    const consumer = makeFullConsumer(ctx);
    const ratifiedPayload: AssessmentModuleResultRatifiedV1Payload = {
      moduleResultId:       crypto.randomUUID(),
      moduleRegistrationId, aggregateMark: 72, resultCode: 'PASS',
      examBoardId:          crypto.randomUUID(),
      ratifiedAt:           new Date().toISOString(),
    };
    await consumer.dispatch(makeEnvelope('srs.assessment.module-result-ratified', ratifiedPayload));

    const result = ctx.stubVle.stubStore.results.get(moduleRegistrationId);
    expect(result?.aggregateMark).toBe(72);
    expect(result?.resultCode).toBe('PASS');
  });

  it('3.4 combined scenario: enrol → adjust → mark → ratify (all three flows in one sequence)', async () => {
    const consumer = makeFullConsumer(ctx);

    const personId             = crypto.randomUUID();
    const enrolmentId          = crypto.randomUUID();
    const moduleId             = crypto.randomUUID();
    const moduleRegistrationId = crypto.randomUUID();
    const assessmentComponentId = crypto.randomUUID();
    const adjustmentId         = crypto.randomUUID();
    const distributionId       = crypto.randomUUID();

    // F015 — provision
    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'LAW301', title: 'Contract Law', creditValue: 15, effectiveDate: '2026-09-01',
    } satisfies CatalogueModuleUpdatedV1Payload));

    await consumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2026/27', modeOfStudy: 'part-time',
    } satisfies StudentEnrolledV1Payload));

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleId,
      moduleOfferingId:  crypto.randomUUID(),
      academicPeriodId:  crypto.randomUUID(),
      registrationDate:  '2026-09-20',
    } satisfies EnrolmentModuleRegisteredV1Payload));

    expect(ctx.stubVle.stubStore.courses.has(moduleId)).toBe(true);
    expect(ctx.stubVle.stubStore.enrolments.has(moduleRegistrationId)).toBe(true);

    // F059 — adjustment
    await consumer.dispatch(makeEnvelope('srs.adjustment.distributed', {
      adjustmentId, distributionId,
      targetSystem:       'vle',
      distributedAt:      new Date().toISOString(),
      personId, enrolmentId,
      adjustmentTypeCode: 'EXTRA_TIME',
      scopeCode:          'ALL_ASSESSMENTS',
      validFrom:          '2026-01-01T00:00:00.000Z',
    } satisfies AdjustmentDistributedV1Payload));

    expect(ctx.stubVle.stubStore.adjustments.has(distributionId)).toBe(true);
    expect(ctx.stubSrsAck.getAckCalls()).toHaveLength(1);

    // F016 outbound — mark submission
    const srsMarkClient = new HttpSrsMarkClient(ctx.stubSrsMarksBaseUrl, 'test-token');
    const markService   = new MarkSubmissionService(ctx.db, TENANT, srsMarkClient);
    const { markId }    = await markService.submitMark({
      moduleRegistrationId, assessmentComponentId,
      sourceReference: `law301-${moduleRegistrationId}-1`,
      rawMark: 68,
    });
    expect(markId).toBeTruthy();

    // F016 inbound — ratified result
    await consumer.dispatch(makeEnvelope('srs.assessment.module-result-ratified', {
      moduleResultId:       crypto.randomUUID(),
      moduleRegistrationId, aggregateMark: 68, resultCode: 'PASS',
      examBoardId:          crypto.randomUUID(),
      ratifiedAt:           new Date().toISOString(),
    } satisfies AssessmentModuleResultRatifiedV1Payload));

    const result = ctx.stubVle.stubStore.results.get(moduleRegistrationId);
    expect(result?.aggregateMark).toBe(68);
    expect(result?.resultCode).toBe('PASS');

    // All events were processed
    const ledgerRows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.tenantId, TENANT));
    expect(ledgerRows.every(r => r.statusCode === 'processed')).toBe(true);
    // 5 events: module-updated, student-enrolled, module-registered, adjustment-distributed, ratified
    expect(ledgerRows).toHaveLength(5);
  });

  it('3.5 module-registration-withdrawn sets enrolment status to withdrawn in VLE', async () => {
    const consumer = makeFullConsumer(ctx);

    const personId             = crypto.randomUUID();
    const enrolmentId          = crypto.randomUUID();
    const moduleId             = crypto.randomUUID();
    const moduleRegistrationId = crypto.randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'ENG101', title: 'Engineering Maths', creditValue: 20, effectiveDate: '2026-09-01',
    } satisfies CatalogueModuleUpdatedV1Payload));

    await consumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2026/27', modeOfStudy: 'full-time',
    } satisfies StudentEnrolledV1Payload));

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleId,
      moduleOfferingId:  crypto.randomUUID(),
      academicPeriodId:  crypto.randomUUID(),
      registrationDate:  '2026-09-01',
    } satisfies EnrolmentModuleRegisteredV1Payload));

    expect(ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId)?.statusCode).toBe('active');

    const withdrawnPayload: EnrolmentModuleRegistrationWithdrawnV1Payload = {
      enrolmentId, moduleRegistrationId,
      moduleOfferingId: crypto.randomUUID(),
      withdrawnAt:      new Date().toISOString(),
    };
    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registration-withdrawn', withdrawnPayload));

    expect(ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId)?.statusCode).toBe('withdrawn');
  });
});

// ── Suite 4: Health and observability ─────────────────────────────────────────

describe('Stage 8 — health and observability', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearAllTables(ctx));

  it('4.1 health report reflects real event counts after processing', async () => {
    const consumer = makeFullConsumer(ctx);
    const health   = new HealthService(ctx.db);

    // Process 3 events
    for (let i = 0; i < 3; i++) {
      await consumer.dispatch(makeEnvelope('srs.catalogue.programme-updated', { programmeId: crypto.randomUUID() }));
    }

    const report = await health.getReport(TENANT);
    expect(report.totalProcessed).toBe(3);
    expect(report.totalFailed).toBe(0);
    expect(report.lastProcessedAt).not.toBeNull();
  });

  it('4.2 VLE write failure records "failed" in ledger and health shows degraded state', async () => {
    // Consumer pointing at a broken VLE URL
    const badConsumer = new VleEventConsumer(
      'nats://unused', ctx.db, TENANT, log,
      { vleClient: new HttpVleClient('http://127.0.0.1:1') }, // unreachable
    );

    const payload: CatalogueModuleUpdatedV1Payload = {
      moduleId:     crypto.randomUUID(),
      code:         'FAIL101',
      title:        'Failure Course',
      creditValue:  10,
      effectiveDate: '2026-09-01',
    };

    await expect(
      badConsumer.dispatch(makeEnvelope('srs.catalogue.module-updated', payload)),
    ).rejects.toThrow();

    // Ledger records 'failed'
    const rows = await ctx.db
      .select({ statusCode: eventLedger.statusCode })
      .from(eventLedger)
      .where(eq(eventLedger.tenantId, TENANT));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statusCode).toBe('failed');

    // Health report shows failure count
    const report = await new HealthService(ctx.db).getReport(TENANT);
    expect(report.totalFailed).toBe(1);
    expect(report.totalProcessed).toBe(0);
  });

  it('4.3 reconciliation run appears in health report after repair', async () => {
    // Seed an unsynced enrolment
    await ctx.db.insert(enrolmentMap).values({
      tenantId: TENANT, moduleRegistrationId: crypto.randomUUID(),
      moduleId: crypto.randomUUID(), enrolmentId: crypto.randomUUID(),
      personId: crypto.randomUUID(), statusCode: 'active',
    });

    const svc = new ReconciliationService(
      ctx.db, TENANT,
      new HttpVleClient(ctx.stubVleBaseUrl),
      undefined, undefined, log,
    );
    await svc.reconcileRoster();

    const report = await new HealthService(ctx.db).getReport(TENANT);
    expect(report.lastReconciliation).not.toBeNull();
    expect(report.lastReconciliation?.runType).toBe('roster');
    expect(report.lastReconciliation?.driftCount).toBe(1);
    expect(report.lastReconciliation?.repairedCount).toBe(1);
  });

  it('4.4 cross-tenant events are not counted in health report for the tenant', async () => {
    const consumer = makeFullConsumer(ctx);

    // Dispatch for TENANT
    await consumer.dispatch(makeEnvelope('srs.catalogue.programme-updated', { programmeId: crypto.randomUUID() }));

    // Dispatch for OTHER (cross-tenant — should be silently dropped)
    const otherConsumer = new VleEventConsumer('nats://unused', ctx.db, OTHER, log, {});
    await otherConsumer.dispatch(makeEnvelope(
      'srs.catalogue.programme-updated',
      { programmeId: crypto.randomUUID() },
      { tenantId: OTHER },
    ));

    // TENANT health only counts TENANT events
    const tenantReport = await new HealthService(ctx.db).getReport(TENANT);
    expect(tenantReport.totalProcessed).toBe(1);

    // OTHER health counts OTHER events
    const otherReport = await new HealthService(ctx.db).getReport(OTHER);
    expect(otherReport.totalProcessed).toBe(1);
  });
});

// ── Suite 5: Resilience and recovery ──────────────────────────────────────────

describe('Stage 8 — resilience and recovery', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearAllTables(ctx));

  it('5.1 duplicate event (same eventId) is idempotent: processed only once', async () => {
    const consumer = makeFullConsumer(ctx);
    const envelope = makeEnvelope('srs.catalogue.programme-updated', { programmeId: crypto.randomUUID() });

    await consumer.dispatch(envelope);
    await consumer.dispatch(envelope); // second dispatch with same id

    const rows = await ctx.db
      .select()
      .from(eventLedger)
      .where(and(eq(eventLedger.tenantId, TENANT), eq(eventLedger.eventId, envelope.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statusCode).toBe('processed');
  });

  it('5.2 duplicate mark submission (same sourceReference) posts to SRS only once', async () => {
    const srsMarkClient = new HttpSrsMarkClient(ctx.stubSrsMarksBaseUrl, 'test-token');
    const service       = new MarkSubmissionService(ctx.db, TENANT, srsMarkClient);
    const opts = {
      moduleRegistrationId:  crypto.randomUUID(),
      assessmentComponentId: crypto.randomUUID(),
      sourceReference:       `vle-${crypto.randomUUID()}`,
      rawMark:               65,
    };

    const first  = await service.submitMark(opts);
    const second = await service.submitMark(opts);

    expect(ctx.stubSrsMarks.getMarkCalls()).toHaveLength(1);
    expect(second.markId).toBe(first.markId);
  });

  it('5.3 reconciliation after VLE outage repairs unsynced enrolments when VLE recovers', async () => {
    const personId             = crypto.randomUUID();
    const enrolmentId          = crypto.randomUUID();
    const moduleId             = crypto.randomUUID();
    const moduleRegistrationId = crypto.randomUUID();

    // Step 1a: module-updated WITH vleClient → course_map populated (VLE was up)
    const fullConsumer  = makeFullConsumer(ctx);
    const noVleConsumer = new VleEventConsumer('nats://unused', ctx.db, TENANT, log, {});

    await fullConsumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'PHY101', title: 'Physics', creditValue: 20, effectiveDate: '2026-09-01',
    } satisfies CatalogueModuleUpdatedV1Payload));

    // Step 1b: student-enrolled (works without VLE)
    await noVleConsumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2026/27', modeOfStudy: 'full-time',
    } satisfies StudentEnrolledV1Payload));

    // Step 1c: module-registered WITHOUT vleClient → enrolment_map row with null vleEnrolmentId
    // (VLE was down by the time this event arrived)
    await noVleConsumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleId,
      moduleOfferingId:  crypto.randomUUID(),
      academicPeriodId:  crypto.randomUUID(),
      registrationDate:  '2026-09-01',
    } satisfies EnrolmentModuleRegisteredV1Payload));

    // enrolment_map exists but vleEnrolmentId is null
    const mapBefore = await ctx.db
      .select({ vleEnrolmentId: enrolmentMap.vleEnrolmentId })
      .from(enrolmentMap)
      .where(and(eq(enrolmentMap.tenantId, TENANT), eq(enrolmentMap.moduleRegistrationId, moduleRegistrationId)));
    expect(mapBefore[0]?.vleEnrolmentId).toBeNull();

    // Step 2: VLE recovers — reconciliation repairs the roster
    const svc = new ReconciliationService(
      ctx.db, TENANT,
      new HttpVleClient(ctx.stubVleBaseUrl),
      undefined, undefined, log,
    );
    const result = await svc.reconcileRoster();

    expect(result.driftCount).toBeGreaterThanOrEqual(1);
    expect(result.repairedCount).toBeGreaterThanOrEqual(1);

    // enrolment_map now has a vleEnrolmentId
    const mapAfter = await ctx.db
      .select({ vleEnrolmentId: enrolmentMap.vleEnrolmentId })
      .from(enrolmentMap)
      .where(and(eq(enrolmentMap.tenantId, TENANT), eq(enrolmentMap.moduleRegistrationId, moduleRegistrationId)));
    expect(mapAfter[0]?.vleEnrolmentId).toBe(`vle-enr-${moduleRegistrationId}`);
  });
});
