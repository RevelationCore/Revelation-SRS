import { createHash } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  enrolments,
  moduleOfferings,
  moduleRegistrations,
  modules,
  persons,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

import type { DeliveryService } from '../delivery-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const TIMETABLING_FLOW = 'F-SIS-TTB-01';

/**
 * Sends one module registration's current state to timetabling (Phase 4
 * D-26; BP-03-006), contract timetable-demand-feed.v1: add when first
 * registered, remove when withdrawn, update otherwise. Keyed by the
 * registration version, so each change is one item and a repeat is not.
 * Pre-registration enrolments send nothing (D-10). Only a student number,
 * no name, contact or adjustment data. A failure here never changes the
 * registration (BR-4): it is the ledger's to retry.
 */
export async function requestTimetableDemand(delivery: DeliveryService, db: Db, tenantId: string, moduleRegistrationId: string): Promise<void> {
  const t = tenantId as Uuid;
  const facts = await withTenantContext(db, tenantId, async (tx) => {
    const versions = await tx.select().from(moduleRegistrations)
      .where(and(eq(moduleRegistrations.tenantId, t), eq(moduleRegistrations.id, moduleRegistrationId as Uuid)))
      .orderBy(asc(moduleRegistrations.recordedAt));
    const current = versions.find((v) => v.recordedUntil === null);
    if (!current) return null;
    const [ctx] = await tx.select({
      moduleCode: modules.code, academicYear: academicPeriods.academicYear, periodCode: academicPeriods.periodCode,
      enrolmentStatus: enrolments.statusCode, studentNumber: persons.studentNumber, personId: persons.id,
    }).from(moduleOfferings)
      .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
      .innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
      .innerJoin(enrolments, and(eq(enrolments.id, current.enrolmentId), isNull(enrolments.recordedUntil)))
      .innerJoin(persons, eq(persons.id, enrolments.personId))
      .where(and(eq(moduleOfferings.tenantId, t), eq(moduleOfferings.id, current.moduleOfferingId))).limit(1);
    return ctx ? { current, first: versions.length === 1, ...ctx } : null;
  });
  if (!facts || facts.enrolmentStatus === 'pre-registration') return;
  const { current } = facts;
  const action = current.statusCode === 'withdrawn' ? 'remove' : facts.first ? 'add' : 'update';
  await delivery.request(tenantId, {
    flowCode: TIMETABLING_FLOW, subjectType: 'module_registration', subjectId: current.id, personId: facts.personId,
    idempotencyKey: `ttb-demand:${current.id}:${current.versionId}`,
    payload: {
      kind: 'registration', action, moduleRegistrationId: current.id, studentNumber: facts.studentNumber, moduleOfferingId: current.moduleOfferingId,
      moduleCode: facts.moduleCode, academicYear: facts.academicYear, periodCode: facts.periodCode,
      registrationStatusCode: current.statusCode, effectiveFrom: current.validFrom.toISOString(),
    },
    summary: `${action === 'add' ? 'Add' : action === 'remove' ? 'Remove' : 'Update'} ${facts.studentNumber ?? 'student'} ${action === 'remove' ? 'from' : 'on'} ${facts.moduleCode} ${facts.periodCode}`,
  });
}

export interface SnapshotResult { periodCode: string; offerings: number; created: number; unchanged: number }

/**
 * The full roster of each offering in a period, for reconciliation with
 * the timetabling system (D-26; BP-03-006 A3). One item per offering, state
 * sync; an unchanged roster is not re-sent. Acknowledging it with a count
 * that differs from the payload records a count mismatch.
 */
export async function runTimetableDemandSnapshot(delivery: DeliveryService, db: Db, tenantId: string, academicPeriodId: string): Promise<SnapshotResult> {
  const t = tenantId as Uuid;
  const { period, rows } = await withTenantContext(db, tenantId, async (tx) => {
    const [period] = await tx.select().from(academicPeriods).where(and(eq(academicPeriods.tenantId, t), eq(academicPeriods.id, academicPeriodId as Uuid))).limit(1);
    if (!period) throw new NotFoundError('AcademicPeriod', academicPeriodId);
    const offerings = await tx.select({ id: moduleOfferings.id, code: modules.code }).from(moduleOfferings)
      .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
      .where(and(eq(moduleOfferings.tenantId, t), eq(moduleOfferings.academicPeriodId, period.id)));
    const regs = await tx.select({ offeringId: moduleRegistrations.moduleOfferingId, recordedAt: moduleRegistrations.recordedAt, studentNumber: persons.studentNumber, enrolmentStatus: enrolments.statusCode })
      .from(moduleRegistrations)
      .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrations.moduleOfferingId))
      .innerJoin(enrolments, and(eq(enrolments.id, moduleRegistrations.enrolmentId), isNull(enrolments.recordedUntil)))
      .innerJoin(persons, eq(persons.id, enrolments.personId))
      .where(and(eq(moduleRegistrations.tenantId, t), eq(moduleOfferings.academicPeriodId, period.id), eq(moduleRegistrations.statusCode, 'registered'), isNull(moduleRegistrations.recordedUntil)));
    return { period, rows: offerings.map((o) => ({ ...o, regs: regs.filter((r) => r.offeringId === o.id && r.enrolmentStatus !== 'pre-registration') })) };
  });

  let created = 0;
  let unchanged = 0;
  for (const o of rows) {
    const studentNumbers = o.regs.map((r) => r.studentNumber).filter((n): n is string => Boolean(n)).sort();
    const highWaterMark = o.regs.reduce<Date | null>((m, r) => (!m || r.recordedAt > m ? r.recordedAt : m), null);
    const payload = {
      kind: 'snapshot', moduleOfferingId: o.id, moduleCode: o.code, academicYear: period.academicYear, periodCode: period.periodCode,
      studentNumbers, count: studentNumbers.length, highWaterMark: highWaterMark?.toISOString() ?? null,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(studentNumbers)).digest('hex').slice(0, 32);
    const items = await delivery.listItems(tenantId, { flowCode: TIMETABLING_FLOW, subjectId: o.id });
    const latest = items.at(-1);
    if (latest && createHash('sha256').update(JSON.stringify((latest.payload as { studentNumbers?: string[] }).studentNumbers ?? [])).digest('hex').slice(0, 32) === fingerprint) {
      unchanged += 1;
      continue;
    }
    await delivery.request(tenantId, {
      flowCode: TIMETABLING_FLOW, subjectType: 'module_offering', subjectId: o.id,
      idempotencyKey: `ttb-snapshot:${o.id}:${fingerprint}:${items.length}`, payload,
      summary: `${o.code} ${period.periodCode}: roster of ${studentNumbers.length} student(s) for reconciliation`,
    });
    created += 1;
  }
  return { periodCode: period.periodCode, offerings: rows.length, created, unchanged };
}
