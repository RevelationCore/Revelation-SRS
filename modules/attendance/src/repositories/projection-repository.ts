import { and, eq } from 'drizzle-orm';

import type { AttendanceTx } from '../db/client.js';
import { enrolmentPersonMap, moduleRegistrationMap } from '../db/schema/event-log.js';

/** Upsert the enrolment → person mapping. */
export async function upsertEnrolmentMap(
  tx:          AttendanceTx,
  tenantId:    string,
  enrolmentId: string,
  personId:    string,
): Promise<void> {
  await tx
    .insert(enrolmentPersonMap)
    .values({ tenantId, enrolmentId, personId })
    .onConflictDoNothing();
}

/** Resolve personId from enrolmentId using the local lookup map. */
export async function findPersonIdByEnrolmentId(
  tx:          AttendanceTx,
  tenantId:    string,
  enrolmentId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ personId: enrolmentPersonMap.personId })
    .from(enrolmentPersonMap)
    .where(
      and(
        eq(enrolmentPersonMap.tenantId, tenantId),
        eq(enrolmentPersonMap.enrolmentId, enrolmentId),
      ),
    )
    .limit(1);
  return rows[0]?.personId ?? null;
}

/** Upsert a module registration → person mapping. */
export async function upsertModuleRegistrationMap(
  tx:                   AttendanceTx,
  tenantId:             string,
  moduleRegistrationId: string,
  enrolmentId:          string,
  personId:             string,
  moduleId:             string,
): Promise<void> {
  await tx
    .insert(moduleRegistrationMap)
    .values({ tenantId, moduleRegistrationId, enrolmentId, personId, moduleId, statusCode: 'registered' })
    .onConflictDoUpdate({
      target: [moduleRegistrationMap.tenantId, moduleRegistrationMap.moduleRegistrationId],
      set:    { statusCode: 'registered', updatedAt: new Date() },
    });
}

/** Mark a module registration as withdrawn or completed in the local map. */
export async function updateModuleRegistrationStatus(
  tx:                   AttendanceTx,
  tenantId:             string,
  moduleRegistrationId: string,
  statusCode:           string,
): Promise<void> {
  await tx
    .update(moduleRegistrationMap)
    .set({ statusCode, updatedAt: new Date() })
    .where(
      and(
        eq(moduleRegistrationMap.tenantId, tenantId),
        eq(moduleRegistrationMap.moduleRegistrationId, moduleRegistrationId),
      ),
    );
}

/** Resolve enrolmentId/personId/moduleId from moduleRegistrationId using the local lookup map. */
export async function findByModuleRegistrationId(
  tx:                   AttendanceTx,
  tenantId:             string,
  moduleRegistrationId: string,
): Promise<{ personId: string; enrolmentId: string; moduleId: string; statusCode: string } | null> {
  const rows = await tx
    .select({
      personId:    moduleRegistrationMap.personId,
      enrolmentId: moduleRegistrationMap.enrolmentId,
      moduleId:    moduleRegistrationMap.moduleId,
      statusCode:  moduleRegistrationMap.statusCode,
    })
    .from(moduleRegistrationMap)
    .where(
      and(
        eq(moduleRegistrationMap.tenantId, tenantId),
        eq(moduleRegistrationMap.moduleRegistrationId, moduleRegistrationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
