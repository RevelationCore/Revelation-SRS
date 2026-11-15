import { createHash } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  persons,
  enrolments,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { DeliveryService } from '../delivery-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const ESTATES_FLOW = 'F-SIS-EST-01';
export const SURVEY_FLOW = 'F-SIS-SETS-01';
export const CURRICULUM_FLOW = 'F-SIS-CM-01';
export const EXTRACT_FLOWS = [ESTATES_FLOW, SURVEY_FLOW, CURRICULUM_FLOW] as const;

export interface ExtractRunResult {
  flowCode:   string;
  periodCode: string;
  offerings:  number;
  /** Items recorded; an offering whose figures have not changed since the last run is not re-sent. */
  created:    number;
  unchanged:  number;
}

interface OfferingFacts {
  moduleOfferingId: string;
  moduleCode:       string;
  moduleTitle:      string;
  capacity:         number | null;
  registrations:    Array<{ statusCode: string; studentNumber: string | null; resultCode: string | null }>;
}

/**
 * Aggregate extracts per module offering in an academic period, for flows
 * that report on cohorts rather than one student's change:
 *
 *   F-SIS-EST-01  registered students against capacity (occupancy planning)
 *   F-SIS-SETS-01 the roster of registered students (survey distribution)
 *   F-SIS-CM-01   registration and result counts (curriculum review)
 *
 * Run on demand for a period. One item per offering, state sync: a later
 * run supersedes an undelivered earlier one, and an offering whose figures
 * are unchanged since its last item is not re-sent. The roster is the only
 * payload with student identifiers (student numbers), as survey distribution
 * needs them; the other two carry counts only.
 */
export async function runExtract(
  delivery: DeliveryService,
  db: Db,
  tenantId: string,
  flowCode: string,
  academicPeriodId: string,
): Promise<ExtractRunResult> {
  if (!(EXTRACT_FLOWS as readonly string[]).includes(flowCode)) {
    throw new ValidationError(`${flowCode} is not an extract flow`);
  }
  const { periodCode, offerings } = await loadOfferings(db, tenantId, academicPeriodId);

  let created = 0;
  let unchanged = 0;
  for (const o of offerings) {
    const active = o.registrations.filter((r) => r.statusCode === 'registered' || r.statusCode === 'completed');
    const countBy = (key: 'statusCode' | 'resultCode') => o.registrations.reduce<Record<string, number>>((acc, r) => {
      const k = r[key];
      if (k) acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const base = { moduleOfferingId: o.moduleOfferingId, moduleCode: o.moduleCode, moduleTitle: o.moduleTitle, academicPeriodCode: periodCode };

    const { payload, summary } = flowCode === ESTATES_FLOW
      ? {
          payload: { ...base, registered: active.length, capacity: o.capacity, occupancy: o.capacity ? Math.round((active.length / o.capacity) * 1000) / 10 : null },
          summary: `${o.moduleCode} ${periodCode}: ${active.length} registered${o.capacity ? ` of ${o.capacity} (${Math.round((active.length / o.capacity) * 100)}%)` : ''}`,
        }
      : flowCode === SURVEY_FLOW
        ? {
            payload: { ...base, studentNumbers: active.map((r) => r.studentNumber).filter((n): n is string => Boolean(n)).sort() },
            summary: `${o.moduleCode} ${periodCode}: survey roster of ${active.length} student(s)`,
          }
        : {
            payload: { ...base, registrationsByStatus: countBy('statusCode'), resultsByCode: countBy('resultCode') },
            summary: `${o.moduleCode} ${periodCode}: ${o.registrations.length} registration(s), ${Object.values(countBy('resultCode')).reduce((a, b) => a + b, 0)} result(s)`,
          };

    // Compare with the offering's latest item, not any earlier one, so a
    // change that later reverts is still sent.
    const fingerprint = digest(payload);
    const items = await delivery.listItems(tenantId, { flowCode, subjectId: o.moduleOfferingId });
    const latest = items.at(-1);
    if (latest && digest(latest.payload) === fingerprint) {
      unchanged += 1;
      continue;
    }
    await delivery.request(tenantId, {
      flowCode,
      subjectType: 'module_offering',
      subjectId: o.moduleOfferingId,
      idempotencyKey: `${flowCode}:${o.moduleOfferingId}:${fingerprint}:${items.length}`,
      payload,
      summary,
    });
    created += 1;
  }
  return { flowCode, periodCode, offerings: offerings.length, created, unchanged };
}

/** Order-independent: jsonb does not preserve key order. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]));
  }
  return value;
}

function digest(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex').slice(0, 32);
}

async function loadOfferings(db: Db, tenantId: string, academicPeriodId: string): Promise<{ periodCode: string; offerings: OfferingFacts[] }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [period] = await tx.select({ periodCode: academicPeriods.periodCode, academicYear: academicPeriods.academicYear })
      .from(academicPeriods)
      .where(and(eq(academicPeriods.id, academicPeriodId as Uuid), eq(academicPeriods.tenantId, tenantId as Uuid)))
      .limit(1);
    if (!period) throw new NotFoundError('AcademicPeriod', academicPeriodId);

    const offeringRows = await tx
      .select({ id: moduleOfferings.id, capacity: moduleOfferings.capacity, moduleCode: modules.code, moduleTitle: modules.title })
      .from(moduleOfferings)
      .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), eq(modules.tenantId, moduleOfferings.tenantId), isNull(modules.recordedUntil)))
      .where(and(eq(moduleOfferings.academicPeriodId, academicPeriodId as Uuid), eq(moduleOfferings.tenantId, tenantId as Uuid)));

    const offerings: OfferingFacts[] = [];
    for (const o of offeringRows) {
      const regs = await tx
        .select({ statusCode: moduleRegistrations.statusCode, studentNumber: persons.studentNumber, resultCode: moduleResults.resultCode })
        .from(moduleRegistrations)
        .leftJoin(enrolments, and(eq(enrolments.id, moduleRegistrations.enrolmentId), eq(enrolments.tenantId, moduleRegistrations.tenantId), isNull(enrolments.recordedUntil)))
        .leftJoin(persons, and(eq(persons.id, enrolments.personId), eq(persons.tenantId, moduleRegistrations.tenantId)))
        .leftJoin(moduleResults, and(eq(moduleResults.moduleRegistrationId, moduleRegistrations.id), eq(moduleResults.tenantId, moduleRegistrations.tenantId), isNull(moduleResults.recordedUntil)))
        .where(and(eq(moduleRegistrations.moduleOfferingId, o.id), eq(moduleRegistrations.tenantId, tenantId as Uuid), isNull(moduleRegistrations.recordedUntil)));
      offerings.push({ moduleOfferingId: o.id, moduleCode: o.moduleCode, moduleTitle: o.moduleTitle, capacity: o.capacity, registrations: regs });
    }
    offerings.sort((a, b) => a.moduleCode.localeCompare(b.moduleCode));
    return { periodCode: `${period.academicYear} ${period.periodCode}`, offerings };
  });
}
