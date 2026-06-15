/**
 * Stage 2 — SRS Context Ingestion integration tests.
 *
 * Tests call routeToHandler() directly (no NATS required).
 * The WellbeingEventConsumer.dispatch() wrapper is exercised for idempotency.
 * All handlers are tested within a real Postgres transaction against a
 * Testcontainers database.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import { EVENT_TYPES } from '@revelation-srs/domain';

import { withWellbeingTenantContext } from '../src/db/client.js';
import { routeToHandler, WellbeingEventConsumer } from '../src/consumers/consumer.js';
import { CONSUMER_GROUP, isAlreadyProcessed, markProcessed } from '../src/repositories/event-log-repository.js';
import { getProjection } from '../src/repositories/projection-repository.js';
import { earlyWarningAlerts } from '../src/db/schema/wellbeing-case.js';
import { enrolmentPersonMap, moduleRegPersonMap } from '../src/db/schema/event-tracking.js';
import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';
import { eq, and } from 'drizzle-orm';
import pino from 'pino';

let ctx: TestWellbeingApp;

// Fixed IDs used across multiple tests
const PERSON_ID    = '00000000-0000-0001-0000-000000000001';
const ENROLMENT_ID = '00000000-0000-0001-0001-000000000001';
const MOD_REG_ID   = '00000000-0000-0001-0002-000000000001';
const MODULE_ID    = 'COMP1001';

// ── Test envelope factory ─────────────────────────────────────────────────────

function makeEnvelope<T>(
  type:    string,
  payload: T,
  tenantId?: string,
): DomainEventEnvelope<T> {
  return {
    id:                 randomUUID(),
    type,
    version:            '1.0.0',
    schemaRef:          `https://schemas.srs.ac.uk/events/${type}/v1.0.0`,
    tenantId:           tenantId ?? ctx.tenantId,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'personal',
    payload,
  };
}

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('Stage 2 — idempotency: duplicate events are skipped', () => {
  it('first dispatch records the event in event_log', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.STUDENT_ENROLLED, {
      personId:    PERSON_ID,
      enrolmentId: ENROLMENT_ID,
      academicYear: '2025/26',
      modeOfStudy: 'full-time',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
      await markProcessed(tx, {
        eventId:       envelope.id,
        subject:       envelope.type,
        tenantId:      envelope.tenantId,
        consumerGroup: CONSUMER_GROUP,
        payload:       envelope,
      });
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      const already = await isAlreadyProcessed(tx, envelope.id, CONSUMER_GROUP);
      expect(already).toBe(true);
    });
  });

  it('WellbeingEventConsumer.dispatch() skips a replayed event without mutating state', async () => {
    const log = pino({ level: 'silent' });
    const dispatcher = new WellbeingEventConsumer('nats://unused', ctx.db, log);

    const envelope = makeEnvelope(EVENT_TYPES.STUDENT_STATUS_CHANGED, {
      personId:       PERSON_ID,
      enrolmentId:    ENROLMENT_ID,
      previousStatus: 'active',
      newStatus:      'intermitting',
      effectiveDate:  '2026-01-01',
    });

    // First dispatch
    await dispatcher.dispatch(envelope);

    // Capture projection state after first dispatch
    const after1 = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );

    // Second dispatch — must be a no-op (idempotency)
    await dispatcher.dispatch(envelope);

    const after2 = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );

    expect(after2?.lastUpdatedAt?.toISOString()).toBe(after1?.lastUpdatedAt?.toISOString());
  });
});

// ── srs.student.enrolled ──────────────────────────────────────────────────────

describe('Stage 2 — handleStudentEnrolled', () => {
  const personId2    = '00000000-0000-0001-0000-000000000002';
  const enrolmentId2 = '00000000-0000-0001-0001-000000000002';

  it('creates a projection row and enrolment map entry', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.STUDENT_ENROLLED, {
      personId:    personId2,
      enrolmentId: enrolmentId2,
      academicYear: '2025/26',
      modeOfStudy: 'part-time',
      programmeId: 'PROG-CS',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, personId2),
    );

    expect(proj).not.toBeNull();
    expect((proj!.activeEnrolmentIds as string[]).includes(enrolmentId2)).toBe(true);
    expect((proj!.personData as Record<string, unknown>)['modeOfStudy']).toBe('part-time');

    // Enrolment map
    const mapRows = await ctx.db
      .select()
      .from(enrolmentPersonMap)
      .where(
        and(
          eq(enrolmentPersonMap.tenantId, ctx.tenantId),
          eq(enrolmentPersonMap.enrolmentId, enrolmentId2),
        ),
      );
    expect(mapRows.length).toBe(1);
    expect(mapRows[0]!.personId).toBe(personId2);
  });
});

// ── srs.student.status-changed ────────────────────────────────────────────────

describe('Stage 2 — handleStudentStatusChanged', () => {
  it('updates enrolment_status in the projection', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.STUDENT_STATUS_CHANGED, {
      personId:       PERSON_ID,
      enrolmentId:    ENROLMENT_ID,
      previousStatus: 'active',
      newStatus:      'dormant',
      effectiveDate:  '2026-02-01',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    expect(proj?.enrolmentStatus).toBe('dormant');
  });
});

// ── srs.student.disability-declaration-updated ────────────────────────────────

describe('Stage 2 — handleDisabilityDeclarationUpdated', () => {
  it('updates disability_declaration_status in the projection', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.STUDENT_DISABILITY_DECLARATION_UPDATED, {
      personId:               PERSON_ID,
      declarationId:          randomUUID(),
      disabilityCategoryCode: 'visual-impairment',
      declarationStatusCode:  'declared',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    expect(proj?.disabilityDeclarationStatus).toBe('declared');
  });
});

// ── srs.enrolment.module-registered ──────────────────────────────────────────

describe('Stage 2 — handleModuleRegistered', () => {
  it('adds moduleId to active_module_codes and creates module_reg_person_map', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.ENROLMENT_MODULE_REGISTERED, {
      enrolmentId:          ENROLMENT_ID,
      moduleRegistrationId: MOD_REG_ID,
      moduleOfferingId:     randomUUID(),
      moduleId:             MODULE_ID,
      academicPeriodId:     randomUUID(),
      registrationDate:     '2025-09-01',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    expect((proj!.activeModuleCodes as string[]).includes(MODULE_ID)).toBe(true);

    const mapRows = await ctx.db
      .select()
      .from(moduleRegPersonMap)
      .where(
        and(
          eq(moduleRegPersonMap.tenantId, ctx.tenantId),
          eq(moduleRegPersonMap.moduleRegistrationId, MOD_REG_ID),
        ),
      );
    expect(mapRows.length).toBe(1);
    expect(mapRows[0]!.personId).toBe(PERSON_ID);
    expect(mapRows[0]!.moduleId).toBe(MODULE_ID);
  });

  it('silently skips when enrolled event has not yet been processed', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.ENROLMENT_MODULE_REGISTERED, {
      enrolmentId:          randomUUID(), // unknown enrolment
      moduleRegistrationId: randomUUID(),
      moduleOfferingId:     randomUUID(),
      moduleId:             'UNKNOWN-MOD',
      academicPeriodId:     randomUUID(),
      registrationDate:     '2025-09-01',
    });

    // Should not throw
    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await expect(routeToHandler(tx, envelope)).resolves.toBeUndefined();
    });
  });
});

// ── srs.enrolment.module-registration-withdrawn ───────────────────────────────

describe('Stage 2 — handleModuleRegistrationWithdrawn', () => {
  it('removes moduleId from active_module_codes', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.ENROLMENT_MODULE_REGISTRATION_WITHDRAWN, {
      enrolmentId:          ENROLMENT_ID,
      moduleRegistrationId: MOD_REG_ID,
      moduleOfferingId:     randomUUID(),
      withdrawnAt:          '2025-10-01',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    expect((proj!.activeModuleCodes as string[]).includes(MODULE_ID)).toBe(false);
  });
});

// ── srs.assessment.mark-received ─────────────────────────────────────────────

describe('Stage 2 — handleMarkReceived', () => {
  it('updates latest_marks in the projection', async () => {
    const assessmentComponentId = randomUUID();
    const envelope = makeEnvelope(EVENT_TYPES.ASSESSMENT_MARK_RECEIVED, {
      markId:               randomUUID(),
      moduleRegistrationId: MOD_REG_ID,
      assessmentComponentId,
      rawMark:              72,
      adjustedMark:         72,
      attemptNumber:        1,
      penaltyApplied:       false,
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    const marks = proj!.latestMarks as Record<string, unknown>;
    expect(marks[MOD_REG_ID]).toBeDefined();
    expect((marks[MOD_REG_ID] as Record<string, unknown>)['rawMark']).toBe(72);
  });
});

// ── srs.adjustment.approved ───────────────────────────────────────────────────

describe('Stage 2 — handleAdjustmentApproved', () => {
  it('stores last approved adjustment in personData', async () => {
    const adjustmentId = randomUUID();
    const envelope = makeEnvelope(EVENT_TYPES.ADJUSTMENT_APPROVED, {
      adjustmentId,
      enrolmentId:        ENROLMENT_ID,
      personId:           PERSON_ID,
      adjustmentTypeCode: 'extra-time',
      scopeCode:          'all-assessments',
      validFrom:          '2025-09-01',
      validTo:            '2026-06-30',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    const pd = proj!.personData as Record<string, Record<string, unknown>>;
    expect(pd['lastApprovedAdjustment']?.['adjustmentId']).toBe(adjustmentId);
    expect(pd['lastApprovedAdjustment']?.['adjustmentTypeCode']).toBe('extra-time');
  });
});

// ── srs.adjustment.distributed ───────────────────────────────────────────────

describe('Stage 2 — handleAdjustmentDistributed', () => {
  it('is a no-op on the projection (no personId in payload)', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.ADJUSTMENT_DISTRIBUTED, {
      adjustmentId:   randomUUID(),
      distributionId: randomUUID(),
      targetSystem:   'vle-adapter',
      distributedAt:  new Date().toISOString(),
    });

    // Should not throw and should not mutate the projection
    const before = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const after = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );

    expect(after?.lastUpdatedAt?.toISOString()).toBe(before?.lastUpdatedAt?.toISOString());
  });
});

// ── srs.adjustment.expired ────────────────────────────────────────────────────

describe('Stage 2 — handleAdjustmentExpired', () => {
  it('records expiry timestamp in personData', async () => {
    const expiredAt = '2026-06-30T00:00:00Z';
    const envelope = makeEnvelope(EVENT_TYPES.ADJUSTMENT_EXPIRED, {
      adjustmentId: randomUUID(),
      enrolmentId:  ENROLMENT_ID,
      personId:     PERSON_ID,
      expiredAt,
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    const pd = proj!.personData as Record<string, unknown>;
    expect(pd['lastExpiredAdjustmentAt']).toBe(envelope.occurredAt);
  });
});

// ── srs.circumstances.exceptional-circumstances-flagged ──────────────────────

describe('Stage 2 — handleEcFlagged', () => {
  it('records EC flag details in personData', async () => {
    const ecId = randomUUID();
    const envelope = makeEnvelope(EVENT_TYPES.CIRCUMSTANCES_EC_FLAGGED, {
      exceptionalCircumstancesId: ecId,
      enrolmentId:                ENROLMENT_ID,
      personId:                   PERSON_ID,
      outcomeCode:                'deferred-assessment',
      determinationDate:          '2026-02-14',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    const pd = proj!.personData as Record<string, Record<string, unknown>>;
    expect(pd['lastEcFlag']?.['exceptionalCircumstancesId']).toBe(ecId);
    expect(pd['lastEcFlag']?.['outcomeCode']).toBe('deferred-assessment');
  });
});

// ── srs.circumstances.exceptional-circumstances-updated ──────────────────────

describe('Stage 2 — handleEcUpdated', () => {
  it('is a no-op on the projection (no personId in payload)', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.CIRCUMSTANCES_EC_UPDATED, {
      exceptionalCircumstancesId: randomUUID(),
      previousOutcomeCode:        'pending',
      newOutcomeCode:             'deferred-assessment',
    });

    await expect(
      withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
        await routeToHandler(tx, envelope);
      }),
    ).resolves.toBeUndefined();
  });
});

// ── srs.regulatory.ukvi-visa-status-updated ───────────────────────────────────

describe('Stage 2 — handleUkviVisaStatusUpdated', () => {
  it('stores UKVI visa status in personData', async () => {
    const envelope = makeEnvelope(EVENT_TYPES.REGULATORY_UKVI_VISA_STATUS_UPDATED, {
      enrolmentId:   ENROLMENT_ID,
      casReference:  'CAS-2025-001',
      statusCode:    'curtailed',
      effectiveDate: '2026-03-01',
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    const pd = proj!.personData as Record<string, Record<string, unknown>>;
    expect(pd['ukviVisaStatus']?.['statusCode']).toBe('curtailed');
    expect(pd['ukviVisaStatus']?.['casReference']).toBe('CAS-2025-001');
  });
});

// ── srs.regulatory.ukvi-compliance-alert-raised ───────────────────────────────

describe('Stage 2 — handleUkviComplianceAlertRaised', () => {
  it('creates an early_warning_alert record and updates projection', async () => {
    const triggeredAt = new Date().toISOString();
    const envelope = makeEnvelope(EVENT_TYPES.REGULATORY_UKVI_COMPLIANCE_ALERT, {
      enrolmentId:   ENROLMENT_ID,
      alertTypeCode: 'attendance-below-threshold',
      casReference:  'CAS-2025-001',
      triggeredAt,
    });

    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    // Verify early_warning_alert was created
    const alerts = await ctx.db
      .select()
      .from(earlyWarningAlerts)
      .where(
        and(
          eq(earlyWarningAlerts.tenantId, ctx.tenantId),
          eq(earlyWarningAlerts.personId, PERSON_ID),
          eq(earlyWarningAlerts.alertSourceCode, 'ukvi'),
        ),
      );
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0]!.triageStatusCode).toBe('pending');
    expect(alerts[0]!.sourceEventId).toBe(envelope.id);

    // Verify projection was updated
    const proj = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, PERSON_ID),
    );
    const pd = proj!.personData as Record<string, Record<string, unknown>>;
    expect(pd['latestUkviAlert']?.['alertTypeCode']).toBe('attendance-below-threshold');
  });
});

// ── Cross-tenant isolation ────────────────────────────────────────────────────

describe('Stage 2 — cross-tenant isolation', () => {
  it('projection event for tenant 2 does not appear in tenant 1 context', async () => {
    const personId3    = '00000000-0000-0001-0000-000000000003';
    const enrolmentId3 = '00000000-0000-0001-0001-000000000003';

    const envelope = makeEnvelope(
      EVENT_TYPES.STUDENT_ENROLLED,
      { personId: personId3, enrolmentId: enrolmentId3, academicYear: '2025/26', modeOfStudy: 'full-time' },
      ctx.secondTenantId,
    );

    // Process as tenant 2
    await withWellbeingTenantContext(ctx.db, ctx.secondTenantId, async (tx) => {
      await routeToHandler(tx, envelope);
    });

    // Projection must be visible under tenant 2
    const proj2 = await withWellbeingTenantContext(ctx.db, ctx.secondTenantId, async (tx) =>
      getProjection(tx, ctx.secondTenantId, personId3),
    );
    expect(proj2).not.toBeNull();

    // Same personId must not appear under tenant 1 (different UUID keys, but belt-and-braces check)
    const proj1 = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, personId3),
    );
    expect(proj1).toBeNull();
  });
});

// ── Replay produces same state ────────────────────────────────────────────────

describe('Stage 2 — replay idempotency: replaying an event set produces the same projection', () => {
  const replayPersonId    = '00000000-0000-0001-0000-000000000004';
  const replayEnrolmentId = '00000000-0000-0001-0001-000000000004';

  // Envelopes are created lazily inside tests (ctx is not yet available at module parse time).
  let enrolledEnvelope: DomainEventEnvelope<unknown>;
  let statusEnvelope:   DomainEventEnvelope<unknown>;

  beforeAll(() => {
    enrolledEnvelope = makeEnvelope(EVENT_TYPES.STUDENT_ENROLLED, {
      personId:     replayPersonId,
      enrolmentId:  replayEnrolmentId,
      academicYear: '2025/26',
      modeOfStudy:  'full-time',
    });
    statusEnvelope = makeEnvelope(EVENT_TYPES.STUDENT_STATUS_CHANGED, {
      personId:       replayPersonId,
      enrolmentId:    replayEnrolmentId,
      previousStatus: 'active',
      newStatus:      'suspended',
      effectiveDate:  '2026-01-01',
    });
  });

  it('applies two events and captures projection state', async () => {
    const log        = pino({ level: 'silent' });
    const dispatcher = new WellbeingEventConsumer('nats://unused', ctx.db, log);

    await dispatcher.dispatch(enrolledEnvelope);
    await dispatcher.dispatch(statusEnvelope);

    const snap1 = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, replayPersonId),
    );
    expect(snap1?.enrolmentStatus).toBe('suspended');
  });

  it('replaying the same events produces identical projection state', async () => {
    const log        = pino({ level: 'silent' });
    const dispatcher = new WellbeingEventConsumer('nats://unused', ctx.db, log);

    // Replay both events — idempotency should suppress both
    await dispatcher.dispatch(enrolledEnvelope);
    await dispatcher.dispatch(statusEnvelope);

    const snap2 = await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) =>
      getProjection(tx, ctx.tenantId, replayPersonId),
    );
    expect(snap2?.enrolmentStatus).toBe('suspended');
  });
});
