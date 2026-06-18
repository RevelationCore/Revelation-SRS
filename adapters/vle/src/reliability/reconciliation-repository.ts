import { and, eq, isNull } from 'drizzle-orm';

import type { VleDb } from '../db/client.js';
import { adjustmentMap }   from '../db/schema/adjustment-map.js';
import { enrolmentMap }    from '../db/schema/enrolment-map.js';
import { markReceipt }     from '../db/schema/mark-receipt.js';
import { reconciliationRun } from '../db/schema/reconciliation.js';

// ─── Enrolment (roster) ──────────────────────────────────────────────────────

export interface UnsyncedEnrolmentRow {
  moduleRegistrationId: string;
  moduleId:             string;
  enrolmentId:          string;
  personId:             string;
  statusCode:           string;
}

export async function findUnsyncedEnrolments(
  db:       VleDb,
  tenantId: string,
): Promise<UnsyncedEnrolmentRow[]> {
  return db
    .select({
      moduleRegistrationId: enrolmentMap.moduleRegistrationId,
      moduleId:             enrolmentMap.moduleId,
      enrolmentId:          enrolmentMap.enrolmentId,
      personId:             enrolmentMap.personId,
      statusCode:           enrolmentMap.statusCode,
    })
    .from(enrolmentMap)
    .where(
      and(
        eq(enrolmentMap.tenantId,        tenantId),
        isNull(enrolmentMap.vleEnrolmentId),
      ),
    );
}

export async function updateEnrolmentVleId(
  db:                   VleDb,
  tenantId:             string,
  moduleRegistrationId: string,
  vleEnrolmentId:       string,
): Promise<void> {
  await db
    .update(enrolmentMap)
    .set({ vleEnrolmentId, syncedAt: new Date() })
    .where(
      and(
        eq(enrolmentMap.tenantId,             tenantId),
        eq(enrolmentMap.moduleRegistrationId, moduleRegistrationId),
      ),
    );
}

// ─── Adjustments ─────────────────────────────────────────────────────────────

export interface AppliedAdjustmentRow {
  adjustmentId:   string;
  distributionId: string;
}

export async function findAppliedAdjustments(
  db:       VleDb,
  tenantId: string,
): Promise<AppliedAdjustmentRow[]> {
  return db
    .select({
      adjustmentId:   adjustmentMap.adjustmentId,
      distributionId: adjustmentMap.distributionId,
    })
    .from(adjustmentMap)
    .where(
      and(
        eq(adjustmentMap.tenantId,    tenantId),
        eq(adjustmentMap.statusCode,  'applied'),
      ),
    );
}

export async function updateAdjustmentAcknowledged(
  db:             VleDb,
  tenantId:       string,
  distributionId: string,
  acknowledgedAt: Date,
): Promise<void> {
  await db
    .update(adjustmentMap)
    .set({ statusCode: 'acknowledged', acknowledgedAt })
    .where(
      and(
        eq(adjustmentMap.tenantId,       tenantId),
        eq(adjustmentMap.distributionId, distributionId),
      ),
    );
}

// ─── Mark receipts ───────────────────────────────────────────────────────────

export interface UnsubmittedMarkRow {
  id:                   string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
  rawMark:              string;
  sourceReference:      string;
}

export async function findUnsubmittedMarks(
  db:       VleDb,
  tenantId: string,
): Promise<UnsubmittedMarkRow[]> {
  return db
    .select({
      id:                    markReceipt.id,
      moduleRegistrationId:  markReceipt.moduleRegistrationId,
      assessmentComponentId: markReceipt.assessmentComponentId,
      rawMark:               markReceipt.rawMark,
      sourceReference:       markReceipt.sourceReference,
    })
    .from(markReceipt)
    .where(
      and(
        eq(markReceipt.tenantId, tenantId),
        isNull(markReceipt.markId),
      ),
    );
}

export async function updateMarkReceiptId(
  db:       VleDb,
  tenantId: string,
  id:       string,
  markId:   string,
): Promise<void> {
  await db
    .update(markReceipt)
    .set({ markId })
    .where(
      and(
        eq(markReceipt.tenantId, tenantId),
        eq(markReceipt.id,       id),
      ),
    );
}

// ─── Reconciliation run ───────────────────────────────────────────────────────

export type ReconciliationRunType = 'roster' | 'adjustments' | 'marks';

export async function insertReconciliationRun(
  db:       VleDb,
  tenantId: string,
  runType:  ReconciliationRunType,
): Promise<string> {
  const rows = await db
    .insert(reconciliationRun)
    .values({ tenantId, runType })
    .returning({ id: reconciliationRun.id });
  return rows[0]!.id;
}

export interface ReconciliationRunCompletion {
  driftCount:    number;
  repairedCount: number;
  errorDetail?:  string;
}

export async function completeReconciliationRun(
  db:         VleDb,
  runId:      string,
  completion: ReconciliationRunCompletion,
): Promise<void> {
  await db
    .update(reconciliationRun)
    .set({
      completedAt:  new Date(),
      driftCount:   completion.driftCount,
      repairedCount: completion.repairedCount,
      ...(completion.errorDetail !== undefined ? { errorDetail: completion.errorDetail } : {}),
    })
    .where(eq(reconciliationRun.id, runId));
}

export interface LastReconciliationRunRow {
  runType:      string;
  completedAt:  Date | null;
  driftCount:   number;
  repairedCount: number;
}

export async function findLastReconciliationRun(
  db:       VleDb,
  tenantId: string,
  runType:  ReconciliationRunType,
): Promise<LastReconciliationRunRow | null> {
  const rows = await db
    .select({
      runType:       reconciliationRun.runType,
      completedAt:   reconciliationRun.completedAt,
      driftCount:    reconciliationRun.driftCount,
      repairedCount: reconciliationRun.repairedCount,
    })
    .from(reconciliationRun)
    .where(
      and(
        eq(reconciliationRun.tenantId, tenantId),
        eq(reconciliationRun.runType,  runType),
      ),
    )
    .orderBy(reconciliationRun.startedAt)
    .limit(1);

  return rows[0] ?? null;
}
