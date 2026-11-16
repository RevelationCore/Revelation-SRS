import { enrolments, personIdentities, persons, programmes, type withTenantContext } from '@revelation-srs/db';
import { and, eq, isNull } from 'drizzle-orm';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type Tx = Parameters<Parameters<typeof withTenantContext>[2]>[0];

/**
 * Who a case or proposal is about: enough for someone acting on a worklist
 * to recognise the student without access to the full student record
 * (minimum necessary data, ADR-017).
 */
export interface EnrolmentSubject {
  personId: string;
  studentNumber: string;
  studentName: string;
  programmeCode: string | null;
  programmeTitle: string | null;
}

/** The subject of each enrolment, keyed by enrolment ID; unknown enrolments get a placeholder. */
export async function subjectsForEnrolments(tx: Tx, tenantId: string, enrolmentIds: string[]): Promise<Map<string, EnrolmentSubject>> {
  const subjects = new Map<string, EnrolmentSubject>();
  for (const enrolmentId of new Set(enrolmentIds)) {
    const [row] = await tx.select({
      personId: persons.id, studentNumber: persons.studentNumber,
      firstName: personIdentities.legalFirstName, familyName: personIdentities.legalFamilyName,
      programmeCode: programmes.code, programmeTitle: programmes.title,
    }).from(enrolments)
      .innerJoin(persons, eq(persons.id, enrolments.personId))
      .leftJoin(personIdentities, and(eq(personIdentities.personId, persons.id), isNull(personIdentities.recordedUntil), isNull(personIdentities.validTo)))
      .leftJoin(programmes, and(eq(programmes.id, enrolments.programmeId), isNull(programmes.recordedUntil), isNull(programmes.validTo)))
      .where(and(eq(enrolments.id, enrolmentId as Uuid), eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil)))
      .limit(1);
    subjects.set(enrolmentId, row
      ? {
        personId: row.personId, studentNumber: row.studentNumber,
        studentName: row.firstName ? `${row.firstName} ${row.familyName ?? ''}`.trim() : row.studentNumber,
        programmeCode: row.programmeCode ?? null, programmeTitle: row.programmeTitle ?? null,
      }
      : { personId: '', studentNumber: '', studentName: `Enrolment ${enrolmentId}`, programmeCode: null, programmeTitle: null });
  }
  return subjects;
}
