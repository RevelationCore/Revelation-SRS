import { and, eq } from 'drizzle-orm';

import type { VleDb } from '../../db/client.js';
import { markReceipt } from '../../db/schema/mark-receipt.js';

export interface MarkReceiptRow {
  markId:   string | null;
  rawMark:  string; // Drizzle returns numeric as string
}

export async function getMarkReceipt(
  db:                    VleDb,
  tenantId:              string,
  moduleRegistrationId:  string,
  assessmentComponentId: string,
  sourceReference:       string,
): Promise<MarkReceiptRow | null> {
  const rows = await db
    .select({ markId: markReceipt.markId, rawMark: markReceipt.rawMark })
    .from(markReceipt)
    .where(
      and(
        eq(markReceipt.tenantId,              tenantId),
        eq(markReceipt.moduleRegistrationId,  moduleRegistrationId),
        eq(markReceipt.assessmentComponentId, assessmentComponentId),
        eq(markReceipt.sourceReference,       sourceReference),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export interface MarkReceiptInput {
  moduleRegistrationId:  string;
  assessmentComponentId: string;
  sourceReference:       string;
  rawMark:               number;
  markId:                string | null;
}

export async function upsertMarkReceipt(
  db:       VleDb,
  tenantId: string,
  input:    MarkReceiptInput,
): Promise<void> {
  await db
    .insert(markReceipt)
    .values({
      tenantId,
      moduleRegistrationId:  input.moduleRegistrationId,
      assessmentComponentId: input.assessmentComponentId,
      sourceReference:       input.sourceReference,
      rawMark:               String(input.rawMark),
      ...(input.markId !== null ? { markId: input.markId } : {}),
    })
    .onConflictDoUpdate({
      target: [
        markReceipt.tenantId,
        markReceipt.moduleRegistrationId,
        markReceipt.assessmentComponentId,
        markReceipt.sourceReference,
      ],
      set: {
        rawMark: String(input.rawMark),
        ...(input.markId !== null ? { markId: input.markId } : {}),
      },
    });
}
