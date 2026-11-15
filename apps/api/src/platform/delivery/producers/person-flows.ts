import { and, desc, eq, isNull } from 'drizzle-orm';
import { enrolments, personIdentities, persons, type Db, withTenantContext } from '@revelation-srs/db';

import type { DeliveryService } from '../delivery-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const ITSM_FLOW = 'F-SIS-ITSM-01';
export const OIV_FLOW = 'F-SIS-OIV-01';

/**
 * F-SIS-ITSM-01 — student identity and account data for incident context.
 * A per-person snapshot (who, how to reach them institutionally, and their
 * enrolments' statuses) so the service desk can see a student's context.
 * Sent when the person is created, their identity changes, or an enrolment
 * changes; a newer snapshot supersedes an undelivered older one. No date of
 * birth, gender, nationality or other personal detail an incident does not
 * need.
 */
export async function requestItsmSnapshot(delivery: DeliveryService, db: Db, tenantId: string, personId: string, changeKey: string): Promise<void> {
  const snapshot = await withTenantContext(db, tenantId, async (tx) => {
    const [person] = await tx
      .select({
        studentNumber: persons.studentNumber,
        personStatus: persons.personStatusCode,
        legalFirstName: personIdentities.legalFirstName,
        legalFamilyName: personIdentities.legalFamilyName,
        preferredName: personIdentities.preferredName,
        emailInstitutional: personIdentities.emailInstitutional,
      })
      .from(persons)
      .leftJoin(personIdentities, and(
        eq(personIdentities.personId, persons.id),
        eq(personIdentities.tenantId, persons.tenantId),
        isNull(personIdentities.recordedUntil),
      ))
      .where(and(eq(persons.id, personId as Uuid), eq(persons.tenantId, tenantId as Uuid)))
      .orderBy(desc(personIdentities.validFrom))
      .limit(1);
    if (!person) return null;
    const enrolmentRows = await tx
      .select({ enrolmentId: enrolments.id, statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(and(eq(enrolments.personId, personId as Uuid), eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil)));
    return { ...person, enrolments: enrolmentRows };
  });
  if (!snapshot) return;

  const name = `${snapshot.preferredName ?? snapshot.legalFirstName ?? ''} ${snapshot.legalFamilyName ?? ''}`.trim();
  await delivery.request(tenantId, {
    flowCode: ITSM_FLOW,
    subjectType: 'person',
    subjectId: personId,
    personId,
    idempotencyKey: changeKey,
    payload: {
      personId,
      studentNumber: snapshot.studentNumber,
      displayName: name,
      emailInstitutional: snapshot.emailInstitutional,
      personStatus: snapshot.personStatus,
      enrolments: snapshot.enrolments,
    },
    summary: `Update service-desk record: ${snapshot.personStatus}, ${snapshot.enrolments.length} enrolment(s)`,
  });
}

/**
 * F-SIS-OIV-01 — identity verification request. One item per check (not
 * state sync: each check is its own request). Carries the identity data a
 * verification provider needs. The provider's outcome comes back through
 * POST /students/:id/identity-verifications/:checkId/completion, which also
 * marks this item delivered.
 */
export async function requestIdentityVerification(
  delivery: DeliveryService,
  db: Db,
  tenantId: string,
  personId: string,
  verificationCheckId: string,
): Promise<void> {
  const [identity] = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        studentNumber: persons.studentNumber,
        legalFirstName: personIdentities.legalFirstName,
        legalFamilyName: personIdentities.legalFamilyName,
        dateOfBirth: personIdentities.dateOfBirth,
      })
      .from(persons)
      .leftJoin(personIdentities, and(
        eq(personIdentities.personId, persons.id),
        eq(personIdentities.tenantId, persons.tenantId),
        isNull(personIdentities.recordedUntil),
      ))
      .where(and(eq(persons.id, personId as Uuid), eq(persons.tenantId, tenantId as Uuid)))
      .orderBy(desc(personIdentities.validFrom))
      .limit(1),
  );
  if (!identity) return;
  await delivery.request(tenantId, {
    flowCode: OIV_FLOW,
    subjectType: 'identity_verification_check',
    subjectId: verificationCheckId,
    personId,
    idempotencyKey: `verification-requested:${verificationCheckId}`,
    payload: {
      verificationCheckId,
      personId,
      studentNumber: identity.studentNumber,
      legalFirstName: identity.legalFirstName,
      legalFamilyName: identity.legalFamilyName,
      dateOfBirth: identity.dateOfBirth,
    },
    summary: `Verify identity of ${identity.legalFirstName ?? ''} ${identity.legalFamilyName ?? ''} (check ${verificationCheckId.slice(0, 8)})`.replace(/\s+/g, ' '),
  });
}
