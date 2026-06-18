import { and, eq } from 'drizzle-orm';

import type { VleTx } from '../../db/client.js';
import { adjustmentMap } from '../../db/schema/adjustment-map.js';

export interface AdjustmentMapUpsert {
  adjustmentId:       string;
  distributionId:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  validFrom:          Date;
  validTo:            Date | null;
  statusCode:         'pending' | 'applied' | 'acknowledged' | 'failed';
  appliedAt:          Date | null;
  acknowledgedAt:     Date | null;
}

export async function getAdjustmentMapping(
  db:             VleTx,
  tenantId:       string,
  distributionId: string,
): Promise<{ statusCode: string } | null> {
  const rows = await db
    .select({ statusCode: adjustmentMap.statusCode })
    .from(adjustmentMap)
    .where(
      and(
        eq(adjustmentMap.tenantId,       tenantId),
        eq(adjustmentMap.distributionId, distributionId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function upsertAdjustmentMapping(
  db:       VleTx,
  tenantId: string,
  row:      AdjustmentMapUpsert,
): Promise<void> {
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
      validFrom:          row.validFrom,
      statusCode:         row.statusCode,
      ...(row.validTo       !== null ? { validTo:       row.validTo       } : {}),
      ...(row.appliedAt     !== null ? { appliedAt:     row.appliedAt     } : {}),
      ...(row.acknowledgedAt !== null ? { acknowledgedAt: row.acknowledgedAt } : {}),
    })
    .onConflictDoUpdate({
      target: [adjustmentMap.tenantId, adjustmentMap.distributionId],
      set: {
        statusCode:    row.statusCode,
        ...(row.appliedAt     !== null ? { appliedAt:     row.appliedAt     } : {}),
        ...(row.acknowledgedAt !== null ? { acknowledgedAt: row.acknowledgedAt } : {}),
      },
    });
}
