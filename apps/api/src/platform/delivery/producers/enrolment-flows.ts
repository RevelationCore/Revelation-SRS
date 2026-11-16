import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  enrolments,
  persons,
  progressionDecisions,
  studentEmploymentLinks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';

import type { DeliveryService } from '../delivery-service.js';
import { clockNow } from '../../clock.js';

import { requestLibraryAccess } from './library.js';
import { requestItsmSnapshot } from './person-flows.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const CRM_FLOW = 'F-SIS-CRM-01';
export const ACCOMMODATION_FLOW = 'F-SIS-ACC-01';
export const CMS_FLOW = 'F-SIS-CMS-01';
export const HR_FLOW = 'F-SIS-HR-01';

export interface EnrolmentChange {
  enrolmentId: string;
  /** Identifies the change; a repeat records nothing new. */
  changeKey:   string;
  /** Library access takes effect from here (enrolment start or transition date). */
  effectiveFrom?: Date;
}

/**
 * The outbound flows that follow an enrolment. Each carries a SNAPSHOT of
 * the enrolment's current state, not the change alone, so a later item can
 * safely supersede an undelivered earlier one (state sync) without losing
 * anything: the target always receives the whole picture.
 *
 *   F-SIS-LIB-01  library access: grant / suspend / revoke
 *   F-SIS-CRM-01  enrolment status and latest progression decision
 *   F-SIS-ACC-01  enrolment status, mode of study and programme
 *   F-SIS-CMS-01  cohort and programme for content personalisation
 *   F-SIS-ITSM-01 the person's service-desk snapshot (their enrolments changed)
 */
export async function onEnrolmentChanged(
  delivery: DeliveryService,
  db: Db,
  tenantId: string,
  change: EnrolmentChange,
  /** Which flows changed: enrolment status affects all three; progression only CRM. */
  flows: { library: boolean; crm: boolean; accommodation: boolean; cms?: boolean; itsm?: boolean } = { library: true, crm: true, accommodation: true },
): Promise<void> {
  const snapshot = await loadSnapshot(db, tenantId, change.enrolmentId);
  if (!snapshot) return;

  if (flows.library) {
    await requestLibraryAccess(delivery, db, tenantId, {
      personId: snapshot.personId,
      enrolmentId: change.enrolmentId,
      statusCode: snapshot.enrolmentStatus,
      effectiveFrom: change.effectiveFrom ?? new Date(`${snapshot.startDate}T00:00:00.000Z`),
      changeKey: change.changeKey,
    });
  }

  if (flows.crm) {
    const progression = snapshot.progression
      ? `; progression ${snapshot.progression.academicYear} ${snapshot.progression.decisionCode}${snapshot.progression.ratified ? ' (ratified)' : ' (provisional)'}`
      : '';
    await delivery.request(tenantId, {
      flowCode: CRM_FLOW,
      subjectType: 'enrolment',
      subjectId: change.enrolmentId,
      personId: snapshot.personId,
      idempotencyKey: change.changeKey,
      payload: {
        personId: snapshot.personId,
        studentNumber: snapshot.studentNumber,
        enrolmentId: change.enrolmentId,
        programmeId: snapshot.programmeId,
        enrolmentStatus: snapshot.enrolmentStatus,
        progression: snapshot.progression,
      },
      summary: `Update CRM: enrolment ${snapshot.enrolmentStatus}${progression}`,
    });
  }

  if (flows.cms ?? flows.accommodation) {
    await delivery.request(tenantId, {
      flowCode: CMS_FLOW,
      subjectType: 'enrolment',
      subjectId: change.enrolmentId,
      personId: snapshot.personId,
      idempotencyKey: change.changeKey,
      payload: {
        personId: snapshot.personId,
        enrolmentId: change.enrolmentId,
        programmeId: snapshot.programmeId,
        enrolmentStatus: snapshot.enrolmentStatus,
        modeOfStudy: snapshot.modeOfStudy,
        yearOfStudy: snapshot.progression?.yearOfStudy ?? null,
      },
      summary: `Update content audience: ${snapshot.modeOfStudy} student, enrolment ${snapshot.enrolmentStatus}${snapshot.progression ? `, year ${snapshot.progression.yearOfStudy}` : ''}`,
    });
  }

  // F-SIS-HR-01: an employed student's study status changed. HR reviews the
  // roles under its own policy; the SRS does not end employment.
  if (flows.accommodation && snapshot.enrolmentStatus !== 'enrolled') {
    const today = clockNow().toISOString().slice(0, 10);
    const links = await withTenantContext(db, tenantId, (tx) =>
      tx.select({ ref: studentEmploymentLinks.hrEmploymentReference, role: studentEmploymentLinks.roleTypeCode, endDate: studentEmploymentLinks.endDate })
        .from(studentEmploymentLinks)
        .where(and(eq(studentEmploymentLinks.tenantId, tenantId as Uuid), eq(studentEmploymentLinks.personId, snapshot.personId as Uuid))),
    );
    const active = links.filter((l) => l.endDate === null || l.endDate >= today);
    if (active.length > 0) {
      await delivery.request(tenantId, {
        flowCode: HR_FLOW,
        subjectType: 'person',
        subjectId: snapshot.personId,
        personId: snapshot.personId,
        idempotencyKey: change.changeKey,
        payload: {
          personId: snapshot.personId,
          studentNumber: snapshot.studentNumber,
          enrolmentId: change.enrolmentId,
          enrolmentStatus: snapshot.enrolmentStatus,
          hrEmploymentReferences: active.map((l) => l.ref),
        },
        summary: `Review employment ${active.map((l) => `${l.ref} (${l.role})`).join(', ')}: study status now ${snapshot.enrolmentStatus}`,
      });
    }
  }

  if (flows.itsm ?? flows.accommodation) {
    await requestItsmSnapshot(delivery, db, tenantId, snapshot.personId, change.changeKey);
  }

  if (flows.accommodation) {
    await delivery.request(tenantId, {
      flowCode: ACCOMMODATION_FLOW,
      subjectType: 'enrolment',
      subjectId: change.enrolmentId,
      personId: snapshot.personId,
      idempotencyKey: change.changeKey,
      payload: {
        personId: snapshot.personId,
        studentNumber: snapshot.studentNumber,
        enrolmentId: change.enrolmentId,
        programmeId: snapshot.programmeId,
        enrolmentStatus: snapshot.enrolmentStatus,
        modeOfStudy: snapshot.modeOfStudy,
        startDate: snapshot.startDate,
      },
      summary: `Update accommodation record: enrolment ${snapshot.enrolmentStatus} (${snapshot.modeOfStudy}) from ${snapshot.startDate}`,
    });
  }
}

interface EnrolmentSnapshot {
  personId:        string;
  studentNumber:   string | null;
  programmeId:     string | null;
  enrolmentStatus: string;
  modeOfStudy:     string;
  startDate:       string;
  progression:     { academicYear: string; yearOfStudy: string; decisionCode: string; ratified: boolean } | null;
}

async function loadSnapshot(db: Db, tenantId: string, enrolmentId: string): Promise<EnrolmentSnapshot | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        personId: enrolments.personId,
        programmeId: enrolments.programmeId,
        statusCode: enrolments.statusCode,
        modeOfStudy: enrolments.modeOfStudyCode,
        startDate: enrolments.startDate,
        studentNumber: persons.studentNumber,
      })
      .from(enrolments)
      .leftJoin(persons, and(eq(persons.id, enrolments.personId), eq(persons.tenantId, enrolments.tenantId)))
      .where(and(
        eq(enrolments.id, enrolmentId as Uuid),
        eq(enrolments.tenantId, tenantId as Uuid),
        isNull(enrolments.recordedUntil),
      ))
      .orderBy(desc(enrolments.validFrom))
      .limit(1);
    if (!row) return null;

    const [decision] = await tx
      .select({
        academicYear: progressionDecisions.academicYear,
        yearOfStudy: progressionDecisions.yearOfStudy,
        decisionCode: progressionDecisions.decisionCode,
        locked: progressionDecisions.locked,
      })
      .from(progressionDecisions)
      .where(and(
        eq(progressionDecisions.enrolmentId, enrolmentId as Uuid),
        eq(progressionDecisions.tenantId, tenantId as Uuid),
        isNull(progressionDecisions.recordedUntil),
      ))
      .orderBy(desc(progressionDecisions.academicYear))
      .limit(1);

    return {
      personId: row.personId,
      studentNumber: row.studentNumber,
      programmeId: row.programmeId,
      enrolmentStatus: row.statusCode,
      modeOfStudy: row.modeOfStudy,
      startDate: String(row.startDate),
      progression: decision
        ? { academicYear: decision.academicYear, yearOfStudy: decision.yearOfStudy, decisionCode: decision.decisionCode, ratified: decision.locked }
        : null,
    };
  });
}
