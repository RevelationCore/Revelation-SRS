import { and, eq, isNull } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import {
  adjustmentCaseEvidence,
  type AdjustmentCaseEvidence,
} from '../db/schema/adjustment.js';

export interface CreateEvidenceInput {
  adjustmentCaseId: string;
  documentId:       string;
  evidenceTypeCode: string;
  uploadedBy:       string;
}

export async function createEvidence(
  tx:       WellbeingTx,
  tenantId: string,
  input:    CreateEvidenceInput,
): Promise<string> {
  const [row] = await tx.insert(adjustmentCaseEvidence).values({
    tenantId,
    adjustmentCaseId: input.adjustmentCaseId,
    documentId:       input.documentId,
    evidenceTypeCode: input.evidenceTypeCode,
    uploadedBy:        input.uploadedBy,
  }).returning({ id: adjustmentCaseEvidence.id });

  if (!row) throw new Error('Failed to record adjustment case evidence');
  return row.id;
}

export async function listEvidence(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<AdjustmentCaseEvidence[]> {
  return tx
    .select()
    .from(adjustmentCaseEvidence)
    .where(
      and(
        eq(adjustmentCaseEvidence.tenantId, tenantId),
        eq(adjustmentCaseEvidence.adjustmentCaseId, caseId),
        isNull(adjustmentCaseEvidence.deletedAt),
      ),
    )
    .orderBy(adjustmentCaseEvidence.uploadedAt);
}

export async function findEvidence(
  tx:         WellbeingTx,
  tenantId:   string,
  caseId:     string,
  evidenceId: string,
): Promise<AdjustmentCaseEvidence | null> {
  const rows = await tx
    .select()
    .from(adjustmentCaseEvidence)
    .where(
      and(
        eq(adjustmentCaseEvidence.tenantId, tenantId),
        eq(adjustmentCaseEvidence.adjustmentCaseId, caseId),
        eq(adjustmentCaseEvidence.id, evidenceId),
        isNull(adjustmentCaseEvidence.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function softDeleteEvidence(
  tx:         WellbeingTx,
  tenantId:   string,
  evidenceId: string,
): Promise<void> {
  await tx
    .update(adjustmentCaseEvidence)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(adjustmentCaseEvidence.tenantId, tenantId),
        eq(adjustmentCaseEvidence.id, evidenceId),
      ),
    );
}
