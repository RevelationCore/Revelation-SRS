import { and, eq } from 'drizzle-orm';

import type { VleDb, VleTx } from '../../db/client.js';
import { studentEnrolmentMap } from '../../db/schema/student-enrolment-map.js';

/** Looks up the personId for a given enrolmentId. Returns null if not seeded yet. */
export async function getPersonIdForEnrolment(
  db:          VleDb | VleTx,
  tenantId:    string,
  enrolmentId: string,
): Promise<string | null> {
  const rows = await db
    .select({ personId: studentEnrolmentMap.personId })
    .from(studentEnrolmentMap)
    .where(
      and(
        eq(studentEnrolmentMap.tenantId,    tenantId),
        eq(studentEnrolmentMap.enrolmentId, enrolmentId),
      ),
    )
    .limit(1);
  return rows[0]?.personId ?? null;
}

/** Records the enrolmentId → personId mapping on first sight of student.enrolled. */
export async function upsertStudentEnrolment(
  db:          VleDb | VleTx,
  tenantId:    string,
  enrolmentId: string,
  personId:    string,
): Promise<void> {
  await db
    .insert(studentEnrolmentMap)
    .values({ tenantId, enrolmentId, personId })
    .onConflictDoNothing();
}
