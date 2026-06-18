import { and, eq } from 'drizzle-orm';

import type { VleDb, VleTx } from '../../db/client.js';
import { enrolmentMap } from '../../db/schema/enrolment-map.js';

export interface EnrolmentMapRow {
  moduleRegistrationId: string;
  moduleId:             string;
  enrolmentId:          string;
  personId:             string;
  vleEnrolmentId:       string | null;
  statusCode:           string;
}

/** Returns the enrolment map row for a module registration, or null. */
export async function getEnrolmentMapping(
  db:                   VleDb | VleTx,
  tenantId:             string,
  moduleRegistrationId: string,
): Promise<EnrolmentMapRow | null> {
  const rows = await db
    .select()
    .from(enrolmentMap)
    .where(
      and(
        eq(enrolmentMap.tenantId,             tenantId),
        eq(enrolmentMap.moduleRegistrationId, moduleRegistrationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Upserts the connector-side enrolment map record. */
export async function upsertEnrolmentMapping(
  db:       VleDb | VleTx,
  tenantId: string,
  row: {
    moduleRegistrationId: string;
    moduleId:             string;
    enrolmentId:          string;
    personId:             string;
    vleEnrolmentId?:      string | null;
    statusCode:           string;
  },
): Promise<void> {
  await db
    .insert(enrolmentMap)
    .values({ tenantId, ...row })
    .onConflictDoUpdate({
      target: [enrolmentMap.tenantId, enrolmentMap.moduleRegistrationId],
      set: {
        vleEnrolmentId: row.vleEnrolmentId ?? null,
        statusCode:     row.statusCode,
        syncedAt:       new Date(),
      },
    });
}

/** Updates the status of an existing enrolment map record. */
export async function updateEnrolmentStatus(
  db:                   VleDb | VleTx,
  tenantId:             string,
  moduleRegistrationId: string,
  statusCode:           string,
): Promise<void> {
  await db
    .update(enrolmentMap)
    .set({ statusCode, syncedAt: new Date() })
    .where(
      and(
        eq(enrolmentMap.tenantId,             tenantId),
        eq(enrolmentMap.moduleRegistrationId, moduleRegistrationId),
      ),
    );
}
