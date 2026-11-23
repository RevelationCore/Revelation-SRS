import { type Db, type TenantScopedDb } from '@revelation-srs/db';
import { sql } from 'drizzle-orm';

import type { DeliveryService } from '../delivery-service.js';
import { DELIVERY_FLOWS } from '../flows.js';

import { IAM_FLOW, requestAccountAccess } from './access.js';
import { onEnrolmentChanged } from './enrolment-flows.js';
import { ITSM_FLOW, requestItsmSnapshot } from './person-flows.js';

export interface MergeForNotices {
  mergeId: string;
  survivorPersonId: string;
  mergedPersonId: string;
  effectiveAt: Date;
}

export interface MergeNoticePlan {
  /** Flows that had delivered something about either person. */
  flows: string[];
  iamInstruction: 'rebind' | 'ended' | null;
}

/**
 * ADR-031 items 8 and 9 (BL-357), in the merge's transaction: every outbound
 * flow that has delivered something about either person is told of the merge
 * with a person-merged notice (a minor version of its contract), so the
 * target can link its two records. IAM instead gets an account instruction:
 * - only the merged person has an account: rebind it to the survivor;
 * - both have accounts (the proposal confirmed it): end the merged person's,
 *   with reason merged.
 * HESA, UCAS, SLC and UKVI are not ledger targets: regulatory corrections
 * are BL-419.
 */
export async function requestMergeNotices(delivery: DeliveryService, tx: TenantScopedDb, tenantId: string, merge: MergeForNotices): Promise<MergeNoticePlan> {
  const delivered = await tx.execute(sql`SELECT DISTINCT flow_code, person_id::text AS person_id FROM delivery_item
    WHERE tenant_id = ${tenantId}::uuid AND status_code = 'delivered'
      AND person_id IN (${merge.survivorPersonId}::uuid, ${merge.mergedPersonId}::uuid)`) as unknown as Array<{ flow_code: string; person_id: string }>;
  const flows = [...new Set(delivered.map((d) => d.flow_code))].filter((f) => DELIVERY_FLOWS.some((d) => d.flowCode === f)).sort();
  const numbers = await tx.execute(sql`SELECT id::text AS id, student_number FROM person
    WHERE tenant_id = ${tenantId}::uuid AND id IN (${merge.survivorPersonId}::uuid, ${merge.mergedPersonId}::uuid)`) as unknown as Array<{ id: string; student_number: string | null }>;
  const numberOf = (id: string) => numbers.find((n) => n.id === id)?.student_number ?? null;
  const effectiveAt = merge.effectiveAt.toISOString();

  for (const flowCode of flows.filter((f) => f !== IAM_FLOW)) {
    await delivery.requestIn(tx, tenantId, {
      flowCode, subjectType: 'person-merge', subjectId: merge.mergeId, personId: merge.survivorPersonId,
      idempotencyKey: `person-merged:${merge.mergeId}`,
      payload: {
        messageType: 'person-merged', mergeId: merge.mergeId,
        survivorPersonId: merge.survivorPersonId, mergedPersonId: merge.mergedPersonId,
        survivorStudentNumber: numberOf(merge.survivorPersonId), mergedStudentNumber: numberOf(merge.mergedPersonId), effectiveAt,
      },
      summary: `Records ${numberOf(merge.mergedPersonId) ?? merge.mergedPersonId} and ${numberOf(merge.survivorPersonId) ?? merge.survivorPersonId} are the same person; keep ${numberOf(merge.survivorPersonId) ?? merge.survivorPersonId}`,
    });
  }

  const hasAccount = (personId: string) => delivered.some((d) => d.flow_code === IAM_FLOW && d.person_id === personId);
  let iamInstruction: MergeNoticePlan['iamInstruction'] = null;
  if (hasAccount(merge.mergedPersonId)) {
    iamInstruction = hasAccount(merge.survivorPersonId) ? 'ended' : 'rebind';
    await delivery.requestIn(tx, tenantId, {
      flowCode: IAM_FLOW, subjectType: 'person', subjectId: merge.mergedPersonId, personId: merge.mergedPersonId,
      idempotencyKey: `person-merged:${merge.mergeId}:iam`,
      payload: {
        contractVersion: 2, contractMinorVersion: 1, instruction: iamInstruction, personId: merge.mergedPersonId,
        studentNumber: numberOf(merge.mergedPersonId), successorPersonId: merge.survivorPersonId, mergeId: merge.mergeId,
        ...(iamInstruction === 'ended' ? { accessLevel: 'ended', endReason: 'merged' } : {}),
        effectiveFrom: effectiveAt,
      },
      summary: iamInstruction === 'rebind'
        ? `Bind the account of ${numberOf(merge.mergedPersonId) ?? merge.mergedPersonId} to ${numberOf(merge.survivorPersonId) ?? merge.survivorPersonId} (records merged)`
        : `End the account of ${numberOf(merge.mergedPersonId) ?? merge.mergedPersonId}: merged into ${numberOf(merge.survivorPersonId) ?? merge.survivorPersonId}, who keeps theirs`,
    });
  }
  return { flows, iamInstruction };
}

/**
 * After the merge commits: the flows' own producers send fresh snapshots for
 * the survivor (its recomputed account, its service-desk context, and each
 * enrolment it now holds), then connected items are dispatched.
 */
export async function requestPostMergeSnapshots(delivery: DeliveryService, db: Db, tenantId: string, merge: MergeForNotices, plan: MergeNoticePlan, movedEnrolmentIds: string[]): Promise<void> {
  const key = `person-merged:${merge.mergeId}:snapshot`;
  if (plan.flows.includes(IAM_FLOW)) await requestAccountAccess(delivery, db, tenantId, { personId: merge.survivorPersonId, changeKey: `${key}:iam` });
  if (plan.flows.includes(ITSM_FLOW)) await requestItsmSnapshot(delivery, db, tenantId, merge.survivorPersonId, `${key}:itsm`);
  for (const enrolmentId of movedEnrolmentIds) {
    await onEnrolmentChanged(delivery, db, tenantId, { enrolmentId, changeKey: `${key}:enrolment:${enrolmentId}`, effectiveFrom: merge.effectiveAt });
  }
  await delivery.dispatchTenant(tenantId);
}
