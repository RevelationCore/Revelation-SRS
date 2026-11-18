import {
  businessCases,
  caseDecisions,
  caseEvidenceReferences,
  progressionDecisions,
  reenrolmentConfirmations,
  reenrolmentPeriods,
  studentStatusCases,
  tenants,
  ukviComplianceAlerts,
  type Db,
  type ReenrolmentConfirmation,
  type ReenrolmentPeriod,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';

import type { BusinessCaseService } from '../cases/business-case-service.js';
import { addWorkingDaysFor } from '../calendar/working-days.js';
import { clockNow } from '../clock.js';
import { type EnrolmentSubject, subjectsForEnrolments } from '../enrolment/subjects.js';
import type { NotificationService } from '../notifications/notification-service.js';
import { type StatusCaseService, isSponsoredEnrolment } from '../status-cases/status-case-service.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { RegistrationLapseHandler } from './service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const NON_REGISTRATION_PROCESS_ID = 'BP-02-011';
const LAPSE = 'lapsed-registration';
const confirmationRef = (id: string) => `reenrolment_confirmation:${id}`;
const CONTACT = 'contact-attempt';
const WRITTEN = 'written-non-continuation';

/** Why a case needs a closer look before anyone decides non-registration (D-9). */
export type ReviewFlag = 'results-pending' | 'open-status-request' | 'approved-interruption' | 'sponsored';
export type NonRegistrationOutcome = 'registered-late' | 'referred' | 'non-registration';

export interface ContactAttemptDto { evidenceId: string; channelCode: string; reference: string; contactedAt: Date; contactedBy: string }

export interface NonRegistrationCaseDto {
  caseId: string;
  statusCode: string;
  enrolmentId: string;
  confirmationId: string;
  academicYear: string;
  periodClosesAt: Date;
  openedAt: Date;
  flags: ReviewFlag[];
  contactAttempts: ContactAttemptDto[];
  writtenNonContinuation: { reference: string; receivedAt: Date } | null;
  outcome: { outcomeCode: NonRegistrationOutcome; decidedBy: string; decidedAt: Date; effectiveAt: Date; reasonText: string | null; policyVersion: string | null; statusCaseId: string | null } | null;
  /** When the earliest non-registration decision is allowed, unless the student confirmed in writing. */
  decisionAllowedFrom: Date | null;
  /** UKVI must be told within 10 working days of the enrolment period ending. */
  ukviReportDueBy: Date | null;
  subject: EnrolmentSubject | undefined;
}

export interface NonRegistrationPolicy { minContactAttempts: number; noticeDays: number }

const DAY_MS = 86_400_000;

/**
 * Failure to register (BP-02-011; D-9). Every lapsed registration opens a
 * case. The registry records each attempt to contact the student; the case
 * ends in a late registration, a referral to the student's own interruption
 * or withdrawal request, or a non-registration decision. A non-registration
 * decision only opens an institution-initiated withdrawal case, which someone
 * else decides, so withdrawing a student for not registering takes two people.
 */
export class NonRegistrationService implements RegistrationLapseHandler {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly businessCases: BusinessCaseService,
    private readonly statusCases: StatusCaseService,
    private readonly notifications?: NotificationService,
  ) {}

  /** Opens a case for each lapsed confirmation (idempotent), and raises a UKVI alert for a sponsored student. */
  async lapsed(tenantId: string, period: ReenrolmentPeriod, confirmations: ReenrolmentConfirmation[], actorId: string): Promise<string[]> {
    const opened: string[] = [];
    for (const confirmation of confirmations) {
      if (await this.#caseIdForConfirmation(tenantId, confirmation.id)) continue;
      const flags = await this.#flags(tenantId, confirmation.enrolmentId, period.academicYear);
      const caseId = await this.businessCases.openCase(tenantId, {
        subjectType: 'enrolment', subjectId: confirmation.enrolmentId, processId: NON_REGISTRATION_PROCESS_ID,
        statusCode: flags.length > 0 ? 'under-review' : 'open', ownerId: actorId,
      }, actorId);
      await this.businessCases.addEvidence(caseId, tenantId, {
        evidenceRef: confirmationRef(confirmation.id), classificationCode: 'operational', sourceSystem: 'srs', sourceReference: LAPSE, receivedBy: actorId,
      });
      if (flags.includes('sponsored')) {
        await withTenantContext(this.db, tenantId, (tx) => tx.insert(ukviComplianceAlerts).values({
          tenantId: tenantId as Uuid, enrolmentId: confirmation.enrolmentId as Uuid, casReference: null,
          alertTypeCode: 'non-enrolment', triggeredAt: period.closesAt,
        }).onConflictDoNothing());
      }
      opened.push(caseId);
    }
    return opened;
  }

  /** A late assisted registration closes the student's open case. */
  async confirmedLate(tenantId: string, confirmationId: string, actorId: string): Promise<void> {
    const caseId = await this.#caseIdForConfirmation(tenantId, confirmationId);
    if (!caseId) return;
    const current = await this.businessCases.getCurrentCase(caseId, tenantId);
    if (!current || !['open', 'under-review'].includes(current.statusCode)) return;
    await this.businessCases.recordDecision(caseId, tenantId, { decisionTypeCode: 'registered-late', authorityActorId: actorId, effectiveAt: clockNow() });
    await this.businessCases.advanceCaseStatus(caseId, tenantId, 'closed', actorId);
    await this.#resolveUkviAlert(tenantId, current.subjectId, actorId);
  }

  async listCases(tenantId: string, opts: { open?: boolean; enrolmentId?: string } = {}): Promise<NonRegistrationCaseDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: businessCases.id }).from(businessCases).where(and(
      eq(businessCases.tenantId, tenantId as Uuid), eq(businessCases.processId, NON_REGISTRATION_PROCESS_ID), isNull(businessCases.recordedUntil),
      ...(opts.open ? [inArray(businessCases.statusCode, ['open', 'under-review'])] : []),
      ...(opts.enrolmentId ? [eq(businessCases.subjectId, opts.enrolmentId as Uuid)] : []),
    )).orderBy(asc(businessCases.validFrom)));
    return this.#dtos(tenantId, rows.map((r) => r.id));
  }

  async getCase(tenantId: string, caseId: string): Promise<NonRegistrationCaseDto> {
    const [dto] = await this.#dtos(tenantId, [caseId]);
    if (!dto) throw new NotFoundError('Non-registration case', caseId);
    return dto;
  }

  /**
   * Records an attempt to contact the student. A portal contact sends the
   * student a notification and points at it; other channels point at the
   * reference the registry gives (an email ID, a letter reference, a call note).
   */
  async recordContact(tenantId: string, caseId: string, input: { channelCode: string; reference?: string; message?: string }, actorId: string): Promise<NonRegistrationCaseDto> {
    const dto = await this.#openCase(tenantId, caseId);
    if (!(await this.valueSets.validateFieldValue('non_registration_case', 'contact_channel_code', input.channelCode, tenantId))) {
      throw new ValidationError(`Invalid contact channel '${input.channelCode}'`);
    }
    let reference = input.reference?.trim() ?? '';
    if (input.channelCode === 'portal') {
      if (!this.notifications || !dto.subject?.personId) throw new ValidationError('Portal notifications are not available for this student');
      const sent = await this.notifications.deliver(tenantId, {
        personId: dto.subject.personId, category: 'registration',
        title: `You have not registered for ${dto.academicYear}`,
        body: input.message?.trim() || `Our records show you have not registered for ${dto.academicYear}. Please contact the registry as soon as possible: if we do not hear from you, your studies may be ended.`,
        linkUrl: '/registration',
      });
      reference = `notification:${sent.id}`;
    }
    if (!reference) throw new ValidationError('Give a reference for the contact (for example the email or letter reference)');
    await this.businessCases.addEvidence(caseId, tenantId, {
      evidenceRef: reference, classificationCode: 'operational', sourceSystem: input.channelCode, sourceReference: CONTACT, receivedBy: actorId,
    });
    return this.getCase(tenantId, caseId);
  }

  /** The student has said in writing they will not continue: lifts the contact minimums. */
  async recordWrittenNonContinuation(tenantId: string, caseId: string, input: { reference: string }, actorId: string): Promise<NonRegistrationCaseDto> {
    await this.#openCase(tenantId, caseId);
    if (!input.reference.trim()) throw new ValidationError('Give a reference to the student\'s written statement');
    await this.businessCases.addEvidence(caseId, tenantId, {
      evidenceRef: input.reference.trim(), classificationCode: 'personal', sourceSystem: 'student', sourceReference: WRITTEN, receivedBy: actorId,
    });
    return this.getCase(tenantId, caseId);
  }

  /** The student has asked to interrupt or withdraw themselves: the case is closed and their request takes over. */
  async refer(tenantId: string, caseId: string, input: { statusCaseId: string }, actorId: string): Promise<NonRegistrationCaseDto> {
    const dto = await this.#openCase(tenantId, caseId);
    const statusCase = await this.statusCases.getCase(tenantId, input.statusCaseId);
    if (statusCase.enrolmentId !== dto.enrolmentId || statusCase.initiatedByCode !== 'student' || !['interruption', 'withdrawal'].includes(statusCase.caseTypeCode)) {
      throw new ValidationError('Refer only to the student\'s own interruption or withdrawal request for this enrolment');
    }
    await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: 'referred', authorityActorId: actorId, reasonText: `status-case:${statusCase.statusCaseId}`, effectiveAt: clockNow(),
    });
    await this.businessCases.advanceCaseStatus(caseId, tenantId, 'closed', actorId);
    return this.getCase(tenantId, caseId);
  }

  /**
   * Decides the student has not registered. Needs the contact minimums (or the
   * student's written statement), a reason and the policy applied. The
   * effective date defaults to the period's close and may not precede the
   * student's last engagement. Opens a withdrawal case for someone else to decide.
   */
  async decideNonRegistration(tenantId: string, caseId: string, input: {
    reason: string; policyVersion: string; effectiveDate?: string; lastEngagementDate?: string;
  }, actorId: string): Promise<NonRegistrationCaseDto> {
    const dto = await this.#openCase(tenantId, caseId);
    if (!input.reason.trim()) throw new ValidationError('Give the reason for the non-registration decision');
    if (!input.policyVersion.trim()) throw new ValidationError('Give the version of the regulations applied');
    if (!dto.writtenNonContinuation) {
      const policy = await this.policy(tenantId);
      if (dto.contactAttempts.length < policy.minContactAttempts) {
        throw new ConflictError(`At least ${policy.minContactAttempts} contact attempts must be recorded first (${dto.contactAttempts.length} so far)`);
      }
      if (dto.decisionAllowedFrom && clockNow() < dto.decisionAllowedFrom) {
        throw new ConflictError(`The student must be given ${policy.noticeDays} days from the first contact: decide on or after ${dto.decisionAllowedFrom.toISOString().slice(0, 10)}`);
      }
    }
    const effectiveDate = input.effectiveDate ?? dto.periodClosesAt.toISOString().slice(0, 10);
    if (input.lastEngagementDate && effectiveDate < input.lastEngagementDate) {
      throw new ValidationError('The effective date cannot be before the student\'s last recorded engagement');
    }
    const decisionId = await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: 'non-registration', authorityActorId: actorId, policyVersion: input.policyVersion.trim(),
      reasonCode: 'non-registration', reasonText: input.reason.trim(), effectiveAt: new Date(`${effectiveDate}T00:00:00Z`),
    });
    await this.statusCases.openCase(tenantId, dto.enrolmentId, {
      caseTypeCode: 'withdrawal', initiatedByCode: 'institution', reasonCategoryCode: 'non-registration',
      requestedEffectiveDate: effectiveDate, institutionalOutcomeRef: `case-decision:${decisionId}`,
    }, actorId);
    await this.businessCases.advanceCaseStatus(caseId, tenantId, 'decided', actorId);
    return this.getCase(tenantId, caseId);
  }

  async policy(tenantId: string): Promise<NonRegistrationPolicy> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const c = row?.configuration ?? {};
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d);
    return { minContactAttempts: num(c['nonRegistrationMinContactAttempts'], 2), noticeDays: num(c['nonRegistrationNoticeDays'], 14) };
  }

  /** The person a case is about, for ownership checks. */
  async personForCase(tenantId: string, caseId: string): Promise<string | null> {
    return (await this.getCase(tenantId, caseId)).subject?.personId ?? null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #openCase(tenantId: string, caseId: string): Promise<NonRegistrationCaseDto> {
    const dto = await this.getCase(tenantId, caseId);
    if (!['open', 'under-review'].includes(dto.statusCode)) throw new ConflictError('This case has already been resolved');
    return dto;
  }

  async #caseIdForConfirmation(tenantId: string, confirmationId: string): Promise<string | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ caseId: caseEvidenceReferences.businessCaseId }).from(caseEvidenceReferences)
      .where(and(eq(caseEvidenceReferences.tenantId, tenantId as Uuid), eq(caseEvidenceReferences.sourceReference, LAPSE),
        eq(caseEvidenceReferences.evidenceRef, confirmationRef(confirmationId)))).limit(1));
    return row?.caseId ?? null;
  }

  async #flags(tenantId: string, enrolmentId: string, academicYear: string): Promise<ReviewFlag[]> {
    const flags: ReviewFlag[] = [];
    const id = enrolmentId as Uuid;
    const t = tenantId as Uuid;
    const { latest, cases } = await withTenantContext(this.db, tenantId, async (tx) => ({
      latest: (await tx.select({ locked: progressionDecisions.locked }).from(progressionDecisions)
        .where(and(eq(progressionDecisions.tenantId, t), eq(progressionDecisions.enrolmentId, id), isNull(progressionDecisions.recordedUntil), lt(progressionDecisions.academicYear, academicYear)))
        .orderBy(desc(progressionDecisions.academicYear)).limit(1))[0],
      cases: await tx.select({ type: studentStatusCases.caseTypeCode, status: studentStatusCases.statusCode }).from(studentStatusCases)
        .where(and(eq(studentStatusCases.tenantId, t), eq(studentStatusCases.enrolmentId, id))),
    }));
    if (latest && !latest.locked) flags.push('results-pending');
    if (cases.some((c) => c.status === 'requested' && c.type !== 'leaver-closure')) flags.push('open-status-request');
    if (cases.some((c) => c.status === 'approved' && c.type === 'interruption')) flags.push('approved-interruption');
    if (await isSponsoredEnrolment(this.db, tenantId, enrolmentId)) flags.push('sponsored');
    return flags;
  }

  async #resolveUkviAlert(tenantId: string, enrolmentId: string, actorId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, (tx) => tx.update(ukviComplianceAlerts).set({ resolvedAt: clockNow(), resolvedBy: actorId }).where(and(
      eq(ukviComplianceAlerts.tenantId, tenantId as Uuid), eq(ukviComplianceAlerts.enrolmentId, enrolmentId as Uuid),
      eq(ukviComplianceAlerts.alertTypeCode, 'non-enrolment'), isNull(ukviComplianceAlerts.resolvedAt),
    )));
  }

  async #dtos(tenantId: string, caseIds: string[]): Promise<NonRegistrationCaseDto[]> {
    if (caseIds.length === 0) return [];
    const ids = caseIds as Uuid[];
    const t = tenantId as Uuid;
    const policy = await this.policy(tenantId);
    const data = await withTenantContext(this.db, tenantId, async (tx) => {
      const cases = await tx.select().from(businessCases).where(and(
        eq(businessCases.tenantId, t), inArray(businessCases.id, ids), eq(businessCases.processId, NON_REGISTRATION_PROCESS_ID), isNull(businessCases.recordedUntil),
      ));
      const evidence = await tx.select().from(caseEvidenceReferences)
        .where(and(eq(caseEvidenceReferences.tenantId, t), inArray(caseEvidenceReferences.businessCaseId, ids))).orderBy(asc(caseEvidenceReferences.receivedAt));
      const decisions = await tx.select().from(caseDecisions)
        .where(and(eq(caseDecisions.tenantId, t), inArray(caseDecisions.businessCaseId, ids))).orderBy(desc(caseDecisions.decidedAt));
      const confirmationIds = evidence.filter((e) => e.sourceReference === LAPSE).map((e) => e.evidenceRef.slice('reenrolment_confirmation:'.length) as Uuid);
      const confirmations = confirmationIds.length === 0 ? [] : await tx.select({ id: reenrolmentConfirmations.id, period: reenrolmentPeriods })
        .from(reenrolmentConfirmations)
        .innerJoin(reenrolmentPeriods, eq(reenrolmentPeriods.id, reenrolmentConfirmations.reenrolmentPeriodId))
        .where(and(eq(reenrolmentConfirmations.tenantId, t), inArray(reenrolmentConfirmations.id, confirmationIds), isNull(reenrolmentConfirmations.recordedUntil)));
      const subjects = await subjectsForEnrolments(tx, tenantId, [...new Set(cases.map((c) => c.subjectId))]);
      // A case's first version is when it was opened.
      const firsts = await tx.select({ id: businessCases.id, recordedAt: businessCases.recordedAt }).from(businessCases)
        .where(and(eq(businessCases.tenantId, t), inArray(businessCases.id, ids))).orderBy(asc(businessCases.recordedAt));
      return { cases, evidence, decisions, confirmations, subjects, firsts };
    });
    const periodFor = new Map(data.confirmations.map((c) => [c.id, c.period]));
    const openedAt = new Map<string, Date>();
    for (const f of data.firsts) if (!openedAt.has(f.id)) openedAt.set(f.id, f.recordedAt);

    const out: NonRegistrationCaseDto[] = [];
    for (const c of data.cases) {
      const evidence = data.evidence.filter((e) => e.businessCaseId === c.id);
      const link = evidence.find((e) => e.sourceReference === LAPSE);
      if (!link) continue;
      const confirmationId = link.evidenceRef.slice('reenrolment_confirmation:'.length);
      const period = periodFor.get(confirmationId);
      if (!period) continue;
      const contactAttempts = evidence.filter((e) => e.sourceReference === CONTACT).map((e) => ({
        evidenceId: e.id, channelCode: e.sourceSystem, reference: e.evidenceRef, contactedAt: e.receivedAt, contactedBy: e.receivedBy,
      }));
      const written = evidence.find((e) => e.sourceReference === WRITTEN);
      const decision = data.decisions.find((d) => d.businessCaseId === c.id);
      const first = contactAttempts[0];
      const flags = ['open', 'under-review'].includes(c.statusCode) ? await this.#flags(tenantId, c.subjectId, period.academicYear) : [];
      out.push({
        caseId: c.id, statusCode: c.statusCode, enrolmentId: c.subjectId, confirmationId,
        academicYear: period.academicYear, periodClosesAt: period.closesAt, openedAt: openedAt.get(c.id) ?? c.recordedAt,
        flags, contactAttempts,
        writtenNonContinuation: written ? { reference: written.evidenceRef, receivedAt: written.receivedAt } : null,
        outcome: decision ? {
          outcomeCode: decision.decisionTypeCode as NonRegistrationOutcome, decidedBy: decision.authorityActorId, decidedAt: decision.decidedAt,
          effectiveAt: decision.effectiveAt, reasonText: decision.reasonText, policyVersion: decision.policyVersion,
          statusCaseId: await this.#withdrawalFor(tenantId, c.subjectId, decision.id),
        } : null,
        decisionAllowedFrom: first ? new Date(first.contactedAt.getTime() + policy.noticeDays * DAY_MS) : null,
        ukviReportDueBy: flags.includes('sponsored') || (await this.#hasUkviAlert(tenantId, c.subjectId)) ? await addWorkingDaysFor(this.db, tenantId, period.closesAt, 10) : null,
        subject: data.subjects.get(c.subjectId),
      });
    }
    return out;
  }

  async #withdrawalFor(tenantId: string, enrolmentId: string, decisionId: string): Promise<string | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: studentStatusCases.id }).from(studentStatusCases).where(and(
      eq(studentStatusCases.tenantId, tenantId as Uuid), eq(studentStatusCases.enrolmentId, enrolmentId as Uuid),
      eq(studentStatusCases.institutionalOutcomeRef, `case-decision:${decisionId}`),
    )).limit(1));
    return row?.id ?? null;
  }

  async #hasUkviAlert(tenantId: string, enrolmentId: string): Promise<boolean> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: ukviComplianceAlerts.id }).from(ukviComplianceAlerts).where(and(
      eq(ukviComplianceAlerts.tenantId, tenantId as Uuid), eq(ukviComplianceAlerts.enrolmentId, enrolmentId as Uuid), eq(ukviComplianceAlerts.alertTypeCode, 'non-enrolment'),
    )).limit(1));
    return Boolean(row);
  }
}
