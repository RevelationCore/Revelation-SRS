import { and, eq, isNull } from 'drizzle-orm';
import { enrolments, persons, staffAssignments, type Db, withTenantContext } from '@revelation-srs/db';

import type { DeliveryService } from '../delivery-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const RESEARCH_PORTAL_FLOW = 'F-SIS-RP-01';

/**
 * F-SIS-RP-01 — student researcher eligibility and supervisor assignments.
 * A snapshot of the research student's current supervisory team, sent when
 * supervisors are approved or the team is closed (e.g. at completion). An
 * empty team means the student no longer has supervision on record.
 */
export async function requestResearchPortalSnapshot(
  delivery: DeliveryService,
  db: Db,
  tenantId: string,
  enrolmentId: string,
  changeKey: string,
): Promise<void> {
  const snapshot = await withTenantContext(db, tenantId, async (tx) => {
    const [enrolment] = await tx
      .select({ personId: enrolments.personId, statusCode: enrolments.statusCode, studentNumber: persons.studentNumber })
      .from(enrolments)
      .leftJoin(persons, and(eq(persons.id, enrolments.personId), eq(persons.tenantId, enrolments.tenantId)))
      .where(and(eq(enrolments.id, enrolmentId as Uuid), eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil)))
      .limit(1);
    if (!enrolment) return null;
    const team = await tx
      .select({ personId: staffAssignments.personId, roleDetailCode: staffAssignments.roleDetailCode, orgOwner: staffAssignments.orgOwner })
      .from(staffAssignments)
      .where(and(
        eq(staffAssignments.enrolmentId, enrolmentId as Uuid),
        eq(staffAssignments.tenantId, tenantId as Uuid),
        eq(staffAssignments.assignmentTypeCode, 'supervisor'),
        isNull(staffAssignments.recordedUntil),
      ));
    return { ...enrolment, team };
  });
  if (!snapshot) return;

  await delivery.request(tenantId, {
    flowCode: RESEARCH_PORTAL_FLOW,
    subjectType: 'enrolment',
    subjectId: enrolmentId,
    personId: snapshot.personId,
    idempotencyKey: changeKey,
    payload: {
      personId: snapshot.personId,
      studentNumber: snapshot.studentNumber,
      enrolmentId,
      enrolmentStatus: snapshot.statusCode,
      supervisors: snapshot.team,
    },
    summary: snapshot.team.length > 0
      ? `Update research portal: ${snapshot.team.length} supervisor(s) (${snapshot.team.map((s) => s.roleDetailCode).join(', ')})`
      : 'Update research portal: no current supervisors',
  });
}
