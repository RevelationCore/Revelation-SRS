import { and, eq, inArray } from 'drizzle-orm';

import type { VleDb, VleTx } from '../../db/client.js';
import { adjustmentMap } from '../../db/schema/adjustment-map.js';
import { courseMap } from '../../db/schema/course-map.js';
import { enrolmentMap } from '../../db/schema/enrolment-map.js';
import type { AdjustmentAmount } from '../../vle-platforms/time-accommodation.js';

export type AdjustmentMapStatus = 'pending' | 'applied' | 'acknowledged' | 'failed' | 'withdrawn';

/** Statuses that still count towards the student's desired VLE state. */
export const IN_FORCE_STATUSES: AdjustmentMapStatus[] = ['pending', 'applied', 'acknowledged'];

export interface AdjustmentMapUpsert {
  adjustmentId:       string;
  distributionId:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  amount:             AdjustmentAmount | null;
  validFrom:          Date;
  validTo:            Date | null;
}

export interface AdjustmentMapRow {
  adjustmentId:       string;
  distributionId:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  statusCode:         string;
  amount:             AdjustmentAmount | null;
  validFrom:          Date;
  validTo:            Date | null;
}

export async function getAdjustmentMapping(
  db:             VleTx,
  tenantId:       string,
  distributionId: string,
): Promise<AdjustmentMapRow | null> {
  const rows = await db
    .select()
    .from(adjustmentMap)
    .where(and(eq(adjustmentMap.tenantId, tenantId), eq(adjustmentMap.distributionId, distributionId)))
    .limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Record (or refresh) an instruction. Never moves a row out of a later status. */
export async function recordInstruction(db: VleTx, tenantId: string, row: AdjustmentMapUpsert): Promise<void> {
  await db
    .insert(adjustmentMap)
    .values({
      tenantId,
      adjustmentId:       row.adjustmentId,
      distributionId:     row.distributionId,
      personId:           row.personId,
      enrolmentId:        row.enrolmentId,
      adjustmentTypeCode: row.adjustmentTypeCode,
      scopeCode:          row.scopeCode,
      amountValue:        row.amount ? row.amount.value.toFixed(2) : null,
      amountUnitCode:     row.amount?.unitCode ?? null,
      validFrom:          row.validFrom,
      validTo:            row.validTo,
      statusCode:         'pending',
    })
    .onConflictDoNothing({ target: [adjustmentMap.tenantId, adjustmentMap.distributionId] });
}

export async function setMappingStatus(
  db:             VleTx,
  tenantId:       string,
  distributionId: string,
  statusCode:     AdjustmentMapStatus,
  fields: { appliedAt?: Date; acknowledgedAt?: Date; errorDetail?: string | null; withdrawnAt?: Date; withdrawalAcknowledgedAt?: Date } = {},
): Promise<void> {
  await db
    .update(adjustmentMap)
    .set({ statusCode, ...fields })
    .where(and(eq(adjustmentMap.tenantId, tenantId), eq(adjustmentMap.distributionId, distributionId)));
}

/** Every mapped adjustment for a person that is still in force (any date). */
export async function findInForceAdjustments(db: VleTx, tenantId: string, personId: string): Promise<AdjustmentMapRow[]> {
  const rows = await db
    .select()
    .from(adjustmentMap)
    .where(and(
      eq(adjustmentMap.tenantId, tenantId),
      eq(adjustmentMap.personId, personId),
      inArray(adjustmentMap.statusCode, IN_FORCE_STATUSES),
    ));
  return rows.map(toRow);
}

export async function personHasMappedAdjustments(db: VleTx, tenantId: string, personId: string): Promise<boolean> {
  const rows = await db
    .select({ id: adjustmentMap.id })
    .from(adjustmentMap)
    .where(and(eq(adjustmentMap.tenantId, tenantId), eq(adjustmentMap.personId, personId)))
    .limit(1);
  return rows.length > 0;
}

/** Persons with any adjustment still in force — the coverage reconciliation set. */
export async function findPersonsWithInForceAdjustments(db: VleDb | VleTx, tenantId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ personId: adjustmentMap.personId })
    .from(adjustmentMap)
    .where(and(eq(adjustmentMap.tenantId, tenantId), inArray(adjustmentMap.statusCode, IN_FORCE_STATUSES)));
  return rows.map((r) => r.personId);
}

/** The person's active VLE courses, with the SRS enrolment each belongs to. */
export async function findActiveCoursesForPerson(
  db: VleTx,
  tenantId: string,
  personId: string,
): Promise<Array<{ enrolmentId: string; vleCourseId: string }>> {
  const rows = await db
    .selectDistinct({ enrolmentId: enrolmentMap.enrolmentId, vleCourseId: courseMap.vleCourseId })
    .from(enrolmentMap)
    .innerJoin(courseMap, and(eq(courseMap.tenantId, enrolmentMap.tenantId), eq(courseMap.moduleId, enrolmentMap.moduleId)))
    .where(and(
      eq(enrolmentMap.tenantId, tenantId),
      eq(enrolmentMap.personId, personId),
      eq(enrolmentMap.statusCode, 'active'),
    ));
  return rows;
}

function toRow(r: typeof adjustmentMap.$inferSelect): AdjustmentMapRow {
  return {
    adjustmentId:       r.adjustmentId,
    distributionId:     r.distributionId,
    personId:           r.personId,
    enrolmentId:        r.enrolmentId,
    adjustmentTypeCode: r.adjustmentTypeCode,
    statusCode:         r.statusCode,
    amount:             r.amountValue !== null && r.amountUnitCode !== null
      ? { value: Number(r.amountValue), unitCode: r.amountUnitCode }
      : null,
    validFrom:          r.validFrom,
    validTo:            r.validTo,
  };
}
