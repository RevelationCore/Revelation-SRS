/**
 * Stage 4 — Course Provisioning Flow (F015).
 *
 * Verifies:
 * - toVleAccessState: SRS status codes → VLE access states.
 * - handleStudentEnrolled: seeds the student-enrolment map.
 * - handleModuleUpdated: upserts a VLE course and records the course map.
 * - handleModuleRegistered: creates a VLE enrolment when personId and course are known.
 * - handleModuleRegistered: graceful no-op when personId is missing.
 * - handleModuleRegistered: graceful no-op when course mapping is missing.
 * - handleStudentStatusChanged: updates all VLE enrolments for an enrolment.
 * - handleModuleRegistrationWithdrawn: withdraws a VLE enrolment.
 * - handleModuleRegistrationCompleted: completes a VLE enrolment.
 * - VleEventConsumer.dispatch() end-to-end for the full F015 provisioning sequence.
 * - canWrite=false (no vleClient) does not prevent local DB state from being recorded.
 *
 * NATS is not started — dispatch() is called directly.
 * All VLE HTTP calls target the in-process stub VLE listening on a real TCP port.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';

import { toVleAccessState } from '../src/consumers/f015/access-state.js';
import { getCourseMapping } from '../src/consumers/f015/course-map-repository.js';
import { getEnrolmentMapping } from '../src/consumers/f015/enrolment-map-repository.js';
import { getPersonIdForEnrolment } from '../src/consumers/f015/student-enrolment-repository.js';
import { VleEventConsumer } from '../src/consumers/vle-event-consumer.js';
import { courseMap } from '../src/db/schema/course-map.js';
import { enrolmentMap } from '../src/db/schema/enrolment-map.js';
import { eventLedger } from '../src/db/schema/event-ledger.js';
import { studentEnrolmentMap } from '../src/db/schema/student-enrolment-map.js';
import { HttpVleClient } from '../src/vle-client/client.js';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

const log = pino({ level: 'silent' });

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = '00000000-0000-0000-0000-000000000001';

function makeEnvelope<T>(
  type:    string,
  payload: T,
  overrides: Partial<DomainEventEnvelope<T>> = {},
): DomainEventEnvelope<T> {
  return {
    id:                 randomUUID(),
    type,
    version:            '1.0.0',
    schemaRef:          `https://srs.example.com/schemas/${type}.json`,
    tenantId:           TENANT,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'personal',
    payload,
    ...overrides,
  };
}

function makeConsumer(ctx: TestVleApp, vleUrl?: string): VleEventConsumer {
  const vleClient = vleUrl ? new HttpVleClient(vleUrl) : undefined;
  return new VleEventConsumer(
    'nats://localhost:4222',
    ctx.db,
    ctx.tenantId,
    log,
    { vleClient },
  );
}

async function clearTables(ctx: TestVleApp): Promise<void> {
  await ctx.db.delete(eventLedger).where(eq(eventLedger.tenantId, TENANT));
  await ctx.db.delete(courseMap).where(eq(courseMap.tenantId, TENANT));
  await ctx.db.delete(enrolmentMap).where(eq(enrolmentMap.tenantId, TENANT));
  await ctx.db.delete(studentEnrolmentMap).where(eq(studentEnrolmentMap.tenantId, TENANT));
  ctx.stubVle.stubStore.reset();
}

// ── Suite 1: access-state mapping ────────────────────────────────────────────

describe('Stage 4 — toVleAccessState', () => {
  it('1.1 maps active → active', () => {
    expect(toVleAccessState('active')).toBe('active');
  });

  it('1.2 maps suspended → suspended', () => {
    expect(toVleAccessState('suspended')).toBe('suspended');
  });

  it('1.3 maps interrupted → suspended', () => {
    expect(toVleAccessState('interrupted')).toBe('suspended');
  });

  it('1.4 maps withdrawn → withdrawn', () => {
    expect(toVleAccessState('withdrawn')).toBe('withdrawn');
  });

  it('1.5 maps completed → completed', () => {
    expect(toVleAccessState('completed')).toBe('completed');
  });

  it('1.6 unknown status defaults to suspended (safe deny)', () => {
    expect(toVleAccessState('deferred')).toBe('suspended');
  });
});

// ── Suite 2: student.enrolled — seed enrolment map ───────────────────────────

describe('Stage 4 — handleStudentEnrolled', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('2.1 seeds the student-enrolment map on dispatch', async () => {
    const consumer   = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const personId   = randomUUID();
    const enrolmentId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.student.enrolled', { personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time' }));

    const found = await getPersonIdForEnrolment(ctx.db, TENANT, enrolmentId);
    expect(found).toBe(personId);
  });

  it('2.2 idempotent — duplicate enrolled event does not throw', async () => {
    const consumer   = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const personId   = randomUUID();
    const enrolmentId = randomUUID();
    const envelope   = makeEnvelope('srs.student.enrolled', { personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time' });

    await consumer.dispatch(envelope);
    // Same event ID — second dispatch is idempotency-skipped
    await consumer.dispatch(envelope);

    const found = await getPersonIdForEnrolment(ctx.db, TENANT, enrolmentId);
    expect(found).toBe(personId);
  });

  it('2.3 event is recorded as processed in the ledger', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const personId  = randomUUID();
    const envelope  = makeEnvelope('srs.student.enrolled', { personId, enrolmentId: randomUUID(), academicYear: '2025/26', modeOfStudy: 'full-time' });

    await consumer.dispatch(envelope);

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.eventId, envelope.id));
    expect(rows[0]?.statusCode).toBe('processed');
  });
});

// ── Suite 3: catalogue.module-updated — upsert course ────────────────────────

describe('Stage 4 — handleModuleUpdated', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('3.1 creates a VLE course and records the course map', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'CS101', title: 'Intro to CS', creditValue: 15, effectiveDate: '2025-09-01',
    }));

    const mapping = await getCourseMapping(ctx.db, TENANT, moduleId);
    expect(mapping).not.toBeNull();
    expect(mapping?.vleCourseId).toMatch(/vle-course-/);

    const stubCourse = ctx.stubVle.stubStore.courses.get(moduleId);
    expect(stubCourse?.code).toBe('CS101');
    expect(stubCourse?.title).toBe('Intro to CS');
  });

  it('3.2 upserts — updating the same module does not create a duplicate', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'CS101', title: 'Old Title', creditValue: 15, effectiveDate: '2025-09-01',
    }));
    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'CS101', title: 'New Title', creditValue: 20, effectiveDate: '2025-09-01',
    }));

    const rows = await ctx.db.select().from(courseMap).where(and(eq(courseMap.tenantId, TENANT), eq(courseMap.moduleId, moduleId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('New Title');
  });

  it('3.3 without vleClient — no VLE write, no course map', async () => {
    const consumer = makeConsumer(ctx); // no vleClient
    const moduleId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'CS999', title: 'Ghost Module', creditValue: null, effectiveDate: '2025-09-01',
    }));

    const mapping = await getCourseMapping(ctx.db, TENANT, moduleId);
    expect(mapping).toBeNull();

    const stubCourse = ctx.stubVle.stubStore.courses.get(moduleId);
    expect(stubCourse).toBeUndefined();
  });
});

// ── Suite 4: enrolment.module-registered ─────────────────────────────────────

describe('Stage 4 — handleModuleRegistered', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  async function seedCourseAndPerson(consumer: VleEventConsumer, overrides?: { moduleId?: string; personId?: string; enrolmentId?: string }) {
    const moduleId    = overrides?.moduleId    ?? randomUUID();
    const personId    = overrides?.personId    ?? randomUUID();
    const enrolmentId = overrides?.enrolmentId ?? randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'X100', title: 'Test Module', creditValue: 10, effectiveDate: '2025-09-01',
    }));
    await consumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time',
    }));

    return { moduleId, personId, enrolmentId };
  }

  it('4.1 creates VLE enrolment and records enrolment map when course and person are known', async () => {
    const consumer               = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleRegistrationId   = randomUUID();
    const { moduleId, personId, enrolmentId } = await seedCourseAndPerson(consumer);

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId, academicPeriodId: randomUUID(), registrationDate: '2025-09-15',
    }));

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping).not.toBeNull();
    expect(mapping?.personId).toBe(personId);
    expect(mapping?.statusCode).toBe('active');
    expect(mapping?.vleEnrolmentId).toMatch(/vle-enr-/);

    const stubEnrolment = ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId);
    expect(stubEnrolment?.personId).toBe(personId);
    expect(stubEnrolment?.statusCode).toBe('active');
  });

  it('4.2 no-op when personId is not in the student-enrolment map', async () => {
    const consumer             = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleId             = randomUUID();
    const moduleRegistrationId = randomUUID();
    const enrolmentId          = randomUUID(); // never seeded via student.enrolled

    // Only seed the course, not the person
    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'X200', title: 'Orphan Module', creditValue: 5, effectiveDate: '2025-09-01',
    }));

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId, academicPeriodId: randomUUID(), registrationDate: '2025-09-15',
    }));

    // Event processed (not failed), but no enrolment map row written
    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.subject, 'srs.enrolment.module-registered'));
    expect(rows[0]?.statusCode).toBe('processed');

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping).toBeNull();
  });

  it('4.3 no-op when course mapping is missing', async () => {
    const consumer             = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleRegistrationId = randomUUID();
    const personId             = randomUUID();
    const enrolmentId          = randomUUID();
    const moduleId             = randomUUID(); // no course seeded

    // Seed the person
    await consumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time',
    }));

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId, academicPeriodId: randomUUID(), registrationDate: '2025-09-15',
    }));

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping).toBeNull();
  });

  it('4.4 without vleClient — records local enrolment map when personId and course known', async () => {
    const consumerWithVle    = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const consumerWithoutVle = makeConsumer(ctx); // no VLE writes

    const moduleRegistrationId = randomUUID();
    const { moduleId, enrolmentId } = await seedCourseAndPerson(consumerWithVle);

    await consumerWithoutVle.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId, academicPeriodId: randomUUID(), registrationDate: '2025-09-15',
    }));

    // Local DB row should exist (null vleEnrolmentId since no VLE call)
    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping).not.toBeNull();
    expect(mapping?.vleEnrolmentId).toBeNull();

    // But stub VLE should have no enrolment
    const stubEnrolment = ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId);
    expect(stubEnrolment).toBeUndefined();
  });
});

// ── Suite 5: student.status-changed ──────────────────────────────────────────

describe('Stage 4 — handleStudentStatusChanged', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  async function provisionEnrolment(consumer: VleEventConsumer): Promise<{
    moduleId: string;
    moduleRegistrationId: string;
    enrolmentId: string;
    personId: string;
  }> {
    const moduleId             = randomUUID();
    const personId             = randomUUID();
    const enrolmentId          = randomUUID();
    const moduleRegistrationId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'Z100', title: 'Status Test Module', creditValue: 10, effectiveDate: '2025-09-01',
    }));
    await consumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time',
    }));
    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId, academicPeriodId: randomUUID(), registrationDate: '2025-09-15',
    }));

    return { moduleId, moduleRegistrationId, enrolmentId, personId };
  }

  it('5.1 updates VLE enrolment status to suspended on status-changed', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const { enrolmentId, personId, moduleRegistrationId } = await provisionEnrolment(consumer);

    await consumer.dispatch(makeEnvelope('srs.student.status-changed', {
      personId, enrolmentId, previousStatus: 'active', newStatus: 'suspended', effectiveDate: '2025-11-01',
    }));

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping?.statusCode).toBe('suspended');

    const stubEnrolment = ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId);
    expect(stubEnrolment?.statusCode).toBe('suspended');
  });

  it('5.2 maps interrupted → suspended in the VLE', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const { enrolmentId, personId, moduleRegistrationId } = await provisionEnrolment(consumer);

    await consumer.dispatch(makeEnvelope('srs.student.status-changed', {
      personId, enrolmentId, previousStatus: 'active', newStatus: 'interrupted', effectiveDate: '2025-11-01',
    }));

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping?.statusCode).toBe('suspended');
  });

  it('5.3 no-op when no enrolment registrations exist for the enrolment', async () => {
    const consumer    = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const personId    = randomUUID();
    const enrolmentId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.student.enrolled', { personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time' }));
    await consumer.dispatch(makeEnvelope('srs.student.status-changed', {
      personId, enrolmentId, previousStatus: 'active', newStatus: 'withdrawn', effectiveDate: '2025-11-01',
    }));

    // Should be recorded as processed, not failed
    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.subject, 'srs.student.status-changed'));
    expect(rows[0]?.statusCode).toBe('processed');
  });
});

// ── Suite 6: module-registration-withdrawn / completed ───────────────────────

describe('Stage 4 — handleModuleRegistrationWithdrawn and Completed', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  async function provisionEnrolment(consumer: VleEventConsumer): Promise<{
    moduleId: string; moduleRegistrationId: string; enrolmentId: string; personId: string;
  }> {
    const moduleId             = randomUUID();
    const personId             = randomUUID();
    const enrolmentId          = randomUUID();
    const moduleRegistrationId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', { moduleId, code: 'W100', title: 'Withdraw Test', creditValue: 10, effectiveDate: '2025-09-01' }));
    await consumer.dispatch(makeEnvelope('srs.student.enrolled', { personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time' }));
    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', { enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId, academicPeriodId: randomUUID(), registrationDate: '2025-09-15' }));

    return { moduleId, moduleRegistrationId, enrolmentId, personId };
  }

  it('6.1 withdrawal sets enrolment status to withdrawn in DB and VLE', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const { moduleRegistrationId, enrolmentId } = await provisionEnrolment(consumer);

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registration-withdrawn', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), withdrawnAt: '2025-10-01',
    }));

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping?.statusCode).toBe('withdrawn');

    const stubEnrolment = ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId);
    expect(stubEnrolment?.statusCode).toBe('withdrawn');
  });

  it('6.2 completion sets enrolment status to completed in DB and VLE', async () => {
    const consumer = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const { moduleRegistrationId, enrolmentId } = await provisionEnrolment(consumer);

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registration-completed', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), completedAt: '2025-05-30',
    }));

    const mapping = await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId);
    expect(mapping?.statusCode).toBe('completed');

    const stubEnrolment = ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId);
    expect(stubEnrolment?.statusCode).toBe('completed');
  });

  it('6.3 withdrawal is a no-op when no enrolment map row exists', async () => {
    const consumer             = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleRegistrationId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registration-withdrawn', {
      enrolmentId: randomUUID(), moduleRegistrationId, moduleOfferingId: randomUUID(), withdrawnAt: '2025-10-01',
    }));

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.subject, 'srs.enrolment.module-registration-withdrawn'));
    expect(rows[0]?.statusCode).toBe('processed');
  });

  it('6.4 completion is a no-op when no enrolment map row exists', async () => {
    const consumer             = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleRegistrationId = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registration-completed', {
      enrolmentId: randomUUID(), moduleRegistrationId, moduleOfferingId: randomUUID(), completedAt: '2025-05-30',
    }));

    const rows = await ctx.db.select().from(eventLedger).where(eq(eventLedger.subject, 'srs.enrolment.module-registration-completed'));
    expect(rows[0]?.statusCode).toBe('processed');
  });
});

// ── Suite 7: full provisioning sequence ──────────────────────────────────────

describe('Stage 4 — full F015 provisioning sequence', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());
  beforeEach(() => clearTables(ctx));

  it('7.1 full lifecycle: enrol → register → status change → withdraw', async () => {
    const consumer             = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const moduleId             = randomUUID();
    const personId             = randomUUID();
    const enrolmentId          = randomUUID();
    const moduleRegistrationId = randomUUID();

    // 1. Module appears in catalogue
    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated', {
      moduleId, code: 'FULL101', title: 'Full Lifecycle Test', creditValue: 20, effectiveDate: '2025-09-01',
    }));

    // 2. Student enrols
    await consumer.dispatch(makeEnvelope('srs.student.enrolled', {
      personId, enrolmentId, academicYear: '2025/26', modeOfStudy: 'full-time',
    }));

    // 3. Module registration
    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registered', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), moduleId,
      academicPeriodId: randomUUID(), registrationDate: '2025-09-15',
    }));

    // Assert: VLE has course and enrolment, local maps populated
    expect(ctx.stubVle.stubStore.courses.get(moduleId)?.code).toBe('FULL101');
    expect(ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId)?.statusCode).toBe('active');
    expect(await getCourseMapping(ctx.db, TENANT, moduleId)).not.toBeNull();
    expect((await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId))?.statusCode).toBe('active');

    // 4. Student status changes to suspended
    await consumer.dispatch(makeEnvelope('srs.student.status-changed', {
      personId, enrolmentId, previousStatus: 'active', newStatus: 'suspended', effectiveDate: '2025-11-01',
    }));
    expect(ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId)?.statusCode).toBe('suspended');

    // 5. Student withdraws from the module
    await consumer.dispatch(makeEnvelope('srs.enrolment.module-registration-withdrawn', {
      enrolmentId, moduleRegistrationId, moduleOfferingId: randomUUID(), withdrawnAt: '2025-11-15',
    }));
    expect(ctx.stubVle.stubStore.enrolments.get(moduleRegistrationId)?.statusCode).toBe('withdrawn');
    expect((await getEnrolmentMapping(ctx.db, TENANT, moduleRegistrationId))?.statusCode).toBe('withdrawn');

    // All events should be processed
    const ledger = await ctx.db.select().from(eventLedger).where(eq(eventLedger.tenantId, TENANT));
    expect(ledger.every(r => r.statusCode === 'processed')).toBe(true);
  });

  it('7.2 events for a different tenant are silently dropped', async () => {
    const consumer   = makeConsumer(ctx, ctx.stubVleBaseUrl);
    const otherTenant = '00000000-0000-0000-0000-000000000002';
    const moduleId   = randomUUID();

    await consumer.dispatch(makeEnvelope('srs.catalogue.module-updated',
      { moduleId, code: 'XT999', title: 'Other Tenant Module', creditValue: 5, effectiveDate: '2025-09-01' },
      { tenantId: otherTenant },
    ));

    // Nothing written to ledger (cross-tenant drop)
    const ledger = await ctx.db.select().from(eventLedger);
    expect(ledger).toHaveLength(0);

    // No VLE course created
    expect(ctx.stubVle.stubStore.courses.get(moduleId)).toBeUndefined();
  });
});
