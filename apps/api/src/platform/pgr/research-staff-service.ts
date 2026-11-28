import type { RetrievedDocument } from '@revelation-srs/documents';
import {
  businessCases,
  caseDecisions,
  caseEvidenceReferences,
  enrolments,
  examinerAppointments,
  examinerReports,
  pgrExaminationCases,
  pgrProgressReviews,
  pgrReviewMembers,
  personIdentities,
  programmes,
  staffAssignments,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError } from '@revelation-srs/domain';
import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { ApiDocumentStore } from '../documents/document-store.js';

import type { ExaminationService } from './examination-service.js';
import type { ProgressReviewService } from './progress-review-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export type ReportExchange = 'after-all-submitted' | 'after-own-submitted' | 'staff-only';

export interface ResearchScope {
  supervisees: Array<{ enrolmentId: string; assignmentId: string; roleDetailCode: string }>;
  panels: Array<{ memberId: string; reviewId: string; roleCode: string }>;
  examinations: Array<{ appointmentId: string; examinationCaseId: string; examinerRoleCode: string }>;
}

export interface ResearchAssignments {
  supervisees: Array<{ enrolmentId: string; studentName: string | null; programme: string | null; role: string }>;
  panels: Array<{ reviewId: string; studentName: string | null; reviewTypeCode: string; statusCode: string; role: string }>;
  examinations: Array<{ examinationCaseId: string; studentName: string | null; statusCode: string; examinerRoleCode: string; reportSubmitted: boolean }>;
}

/**
 * Supervisor, review panel and examiner self-service (Phase 5 D-40,
 * ADR-025). What a person may see comes only from current records naming
 * them: a current supervision assignment (a nomination alone gives
 * nothing, and an end-dated assignment removes access), a non-recused
 * panel membership, or a non-recused examiner appointment. Supervisors
 * never see examiner reports or preliminary recommendations.
 */
export class ResearchStaffService {
  constructor(
    private readonly db: Db,
    private readonly reviews: ProgressReviewService,
    private readonly examinations: ExaminationService,
    private readonly documents: ApiDocumentStore,
  ) {}

  async resolve(tenantId: string, personId: string): Promise<ResearchScope> {
    const now = clockNow();
    return withTenantContext(this.db, tenantId, async (tx) => {
      const assignments = await tx.select().from(staffAssignments).where(and(
        eq(staffAssignments.tenantId, tenantId as Uuid), eq(staffAssignments.personId, personId as Uuid),
        eq(staffAssignments.assignmentTypeCode, 'supervisor'), isNull(staffAssignments.recordedUntil),
        lte(staffAssignments.validFrom, now), or(isNull(staffAssignments.validTo), gt(staffAssignments.validTo, now)),
      ));
      const members = await tx.select().from(pgrReviewMembers).where(and(
        eq(pgrReviewMembers.tenantId, tenantId as Uuid), eq(pgrReviewMembers.personId, personId as Uuid), isNull(pgrReviewMembers.recusedAt),
      ));
      const appointments = await tx.select().from(examinerAppointments).where(and(
        eq(examinerAppointments.tenantId, tenantId as Uuid), eq(examinerAppointments.personId, personId as Uuid), isNull(examinerAppointments.recusedAt),
      ));
      return {
        supervisees: assignments.map((a) => ({ enrolmentId: a.enrolmentId, assignmentId: a.id, roleDetailCode: a.roleDetailCode })),
        panels: members.map((m) => ({ memberId: m.id, reviewId: m.reviewId, roleCode: m.roleCode })),
        examinations: appointments.map((a) => ({ appointmentId: a.id, examinationCaseId: a.examinationCaseId, examinerRoleCode: a.examinerRoleCode })),
      };
    });
  }

  async assignments(tenantId: string, personId: string): Promise<ResearchAssignments> {
    const scope = await this.resolve(tenantId, personId);
    const reviewRows = scope.panels.length === 0 ? [] : await withTenantContext(this.db, tenantId, (tx) => tx.select().from(pgrProgressReviews)
      .where(inArray(pgrProgressReviews.id, scope.panels.map((p) => p.reviewId) as Uuid[])));
    const examRows = scope.examinations.length === 0 ? [] : await withTenantContext(this.db, tenantId, (tx) => tx.select().from(pgrExaminationCases)
      .where(inArray(pgrExaminationCases.id, scope.examinations.map((e) => e.examinationCaseId) as Uuid[])));
    const enrolmentIds = [...scope.supervisees.map((s) => s.enrolmentId), ...reviewRows.map((r) => r.enrolmentId), ...examRows.map((e) => e.enrolmentId)];
    const students = await this.#students(tenantId, enrolmentIds);
    const status = await this.#caseStatuses(tenantId, [...reviewRows.map((r) => r.businessCaseId), ...examRows.map((e) => e.businessCaseId)]);
    const reports = scope.examinations.length === 0 ? [] : await withTenantContext(this.db, tenantId, (tx) => tx.select({ appointmentId: examinerReports.examinerAppointmentId })
      .from(examinerReports).where(inArray(examinerReports.examinerAppointmentId, scope.examinations.map((e) => e.appointmentId) as Uuid[])));
    return {
      supervisees: scope.supervisees.map((s) => ({ enrolmentId: s.enrolmentId, studentName: students.get(s.enrolmentId)?.name ?? null, programme: students.get(s.enrolmentId)?.programme ?? null, role: s.roleDetailCode })),
      panels: scope.panels.flatMap((p) => {
        const r = reviewRows.find((x) => x.id === p.reviewId);
        return r ? [{ reviewId: r.id, studentName: students.get(r.enrolmentId)?.name ?? null, reviewTypeCode: r.reviewTypeCode, statusCode: status.get(r.businessCaseId) ?? 'open', role: p.roleCode }] : [];
      }),
      examinations: scope.examinations.flatMap((e) => {
        const c = examRows.find((x) => x.id === e.examinationCaseId);
        return c ? [{
          examinationCaseId: c.id, studentName: students.get(c.enrolmentId)?.name ?? null, statusCode: status.get(c.businessCaseId) ?? 'submitted',
          examinerRoleCode: e.examinerRoleCode, reportSubmitted: reports.some((r) => r.appointmentId === e.appointmentId),
        }] : [];
      }),
    };
  }

  /** A supervisee's record as their supervisor sees it: never examiner reports or recommendations. */
  async supervisee(tenantId: string, personId: string, enrolmentId: string) {
    const scope = await this.resolve(tenantId, personId);
    if (!scope.supervisees.some((s) => s.enrolmentId === enrolmentId)) throw new NotFoundError('Supervisee', enrolmentId);
    const now = clockNow();
    const data = await withTenantContext(this.db, tenantId, async (tx) => ({
      team: await tx.select().from(staffAssignments).where(and(
        eq(staffAssignments.tenantId, tenantId as Uuid), eq(staffAssignments.enrolmentId, enrolmentId as Uuid), eq(staffAssignments.assignmentTypeCode, 'supervisor'),
        isNull(staffAssignments.recordedUntil), lte(staffAssignments.validFrom, now), or(isNull(staffAssignments.validTo), gt(staffAssignments.validTo, now)),
      )),
      reviews: await tx.select().from(pgrProgressReviews).where(and(eq(pgrProgressReviews.tenantId, tenantId as Uuid), eq(pgrProgressReviews.enrolmentId, enrolmentId as Uuid))),
      exams: await tx.select().from(pgrExaminationCases).where(and(eq(pgrExaminationCases.tenantId, tenantId as Uuid), eq(pgrExaminationCases.enrolmentId, enrolmentId as Uuid))),
    }));
    const names = await this.#names(tenantId, data.team.map((t) => t.personId));
    const status = await this.#caseStatuses(tenantId, [...data.reviews.map((r) => r.businessCaseId), ...data.exams.map((e) => e.businessCaseId)]);
    const outcomes = await this.#latestDecisions(tenantId, data.reviews.map((r) => r.businessCaseId));
    const milestones = (await this.reviews.listMilestones(tenantId, enrolmentId)).filter((m) => m.publishedAt !== null);
    const examinations = [];
    for (const e of data.exams) {
      const appointments = (await this.examinations.listExaminerAppointments(tenantId, e.id)).filter((a) => a.confirmedAt && !a.recusedAt);
      const examinerNames = await this.#names(tenantId, appointments.map((a) => a.personId));
      const outcome = await this.examinations.getLatestOutcome(tenantId, e.id);
      const corrections = outcome ? await this.examinations.listCorrectionRequirements(tenantId, outcome.outcomeId) : [];
      examinations.push({
        examinationCaseId: e.id, statusCode: status.get(e.businessCaseId) ?? 'submitted',
        examiners: appointments.map((a) => ({ name: examinerNames.get(a.personId) ?? null, examinerRoleCode: a.examinerRoleCode })),
        ratifiedOutcomeCode: outcome?.outcomeCode ?? null,
        correctionDeadlines: corrections.map((c) => ({ deadlineDate: c.deadlineDate, completed: c.completedAt !== null })),
      });
    }
    const student = (await this.#students(tenantId, [enrolmentId])).get(enrolmentId);
    return {
      enrolmentId, studentName: student?.name ?? null, programme: student?.programme ?? null,
      team: data.team.map((t) => ({ name: names.get(t.personId) ?? null, roleDetailCode: t.roleDetailCode, validFrom: t.validFrom })),
      milestones: milestones.map((m) => ({ milestoneTypeCode: m.milestoneTypeCode, achievedDate: m.achievedDate })),
      progressReviews: data.reviews.map((r) => ({
        reviewId: r.id, reviewTypeCode: r.reviewTypeCode, statusCode: status.get(r.businessCaseId) ?? 'open', outcomeCode: outcomes.get(r.businessCaseId) ?? null,
      })),
      examinations,
    };
  }

  /** A supervisor's report for an undecided progress review of their supervisee, added as review evidence. */
  async submitSupervisorReport(tenantId: string, personId: string, reviewId: string, file: { filename: string; mimeType: string; content: Buffer }, actorId: string): Promise<{ evidenceId: string }> {
    const review = await this.reviews.getReview(tenantId, reviewId);
    const scope = await this.resolve(tenantId, personId);
    if (!scope.supervisees.some((s) => s.enrolmentId === review.enrolmentId)) throw new NotFoundError('ProgressReview', reviewId);
    if (review.statusCode !== 'open') throw new ConflictError('This review has already been decided');
    const documentId = await this.#store(tenantId, 'srs-pgr-reviews', reviewId, file, actorId);
    const evidenceId = await this.reviews.recordEvidence(tenantId, reviewId, {
      evidenceRef: `documents:${documentId}`, classificationCode: 'sensitive-academic', sourceSystem: 'supervisor-report', receivedBy: actorId,
    });
    return { evidenceId };
  }

  /** The review and its evidence, for a panel member. */
  async panelReview(tenantId: string, personId: string, reviewId: string) {
    const scope = await this.resolve(tenantId, personId);
    const membership = scope.panels.find((p) => p.reviewId === reviewId);
    if (!membership) throw new NotFoundError('ProgressReview', reviewId);
    const review = await this.reviews.getReview(tenantId, reviewId);
    const evidence = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(caseEvidenceReferences)
      .where(and(eq(caseEvidenceReferences.tenantId, tenantId as Uuid), eq(caseEvidenceReferences.businessCaseId, review.businessCaseId as Uuid))));
    const student = (await this.#students(tenantId, [review.enrolmentId])).get(review.enrolmentId);
    return {
      reviewId, reviewTypeCode: review.reviewTypeCode, statusCode: review.statusCode, studentName: student?.name ?? null,
      memberId: membership.memberId, role: membership.roleCode,
      evidence: evidence.map((e) => ({ evidenceId: e.id, sourceSystem: e.sourceSystem, receivedAt: e.receivedAt, downloadable: e.evidenceRef.startsWith('documents:') })),
    };
  }

  /** A panel member downloads review evidence; the documents library logs the access. */
  async downloadReviewEvidence(tenantId: string, personId: string, reviewId: string, evidenceId: string, actorId: string): Promise<RetrievedDocument> {
    const scope = await this.resolve(tenantId, personId);
    if (!scope.panels.some((p) => p.reviewId === reviewId)) throw new NotFoundError('ProgressReview', reviewId);
    const review = await this.reviews.getReview(tenantId, reviewId);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(caseEvidenceReferences).where(and(
      eq(caseEvidenceReferences.tenantId, tenantId as Uuid), eq(caseEvidenceReferences.id, evidenceId as Uuid), eq(caseEvidenceReferences.businessCaseId, review.businessCaseId as Uuid),
    )).limit(1));
    if (!row?.evidenceRef.startsWith('documents:')) throw new NotFoundError('Evidence', evidenceId);
    return withTenantContext(this.db, tenantId, (tx) => this.documents.adapter(tx).retrieve(tenantId, row.evidenceRef.slice('documents:'.length), actorId));
  }

  async declareReviewConflict(tenantId: string, personId: string, memberId: string, conflictTypeCode: string): Promise<void> {
    const scope = await this.resolve(tenantId, personId);
    if (!scope.panels.some((p) => p.memberId === memberId)) throw new NotFoundError('PgrReviewMember', memberId);
    await this.reviews.declareConflict(tenantId, memberId, conflictTypeCode);
  }

  /** An examiner's view: the thesis, their appointment and co-examiner, their report, and others' per the exchange rule. */
  async examination(tenantId: string, personId: string, examinationCaseId: string) {
    const mine = await this.#appointment(tenantId, personId, examinationCaseId);
    const exam = await this.examinations.getExaminationCase(tenantId, examinationCaseId);
    const thesis = await this.examinations.getThesisSubmission(tenantId, examinationCaseId).catch(() => null);
    const appointments = (await this.examinations.listExaminerAppointments(tenantId, examinationCaseId)).filter((a) => !a.recusedAt);
    const names = await this.#names(tenantId, appointments.map((a) => a.personId));
    const reports = await this.examinations.listExaminerReports(tenantId, examinationCaseId);
    const own = reports.find((r) => r.examinerAppointmentId === mine.appointmentId) ?? null;
    const confirmed = appointments.filter((a) => a.confirmedAt);
    const allIn = confirmed.length > 0 && confirmed.every((a) => reports.some((r) => r.examinerAppointmentId === a.appointmentId));
    const exchange = await this.#exchange(tenantId);
    const showOthers = exchange === 'after-all-submitted' ? allIn : exchange === 'after-own-submitted' ? own !== null : false;
    const student = (await this.#students(tenantId, [exam.enrolmentId])).get(exam.enrolmentId);
    return {
      examinationCaseId, statusCode: exam.statusCode, studentName: student?.name ?? null,
      thesis: thesis && mine.confirmedAt && mine.independenceCheckedAt ? {
        versionNumber: thesis.versionNumber, formatCode: thesis.formatCode, submittedAt: thesis.submittedAt,
        downloadable: thesis.storageRef.startsWith('documents:'), storageRef: thesis.storageRef.startsWith('documents:') ? null : thesis.storageRef,
      } : null,
      appointment: { appointmentId: mine.appointmentId, examinerRoleCode: mine.examinerRoleCode, confirmed: mine.confirmedAt !== null, independenceChecked: mine.independenceCheckedAt !== null, conflictTypeCode: mine.conflictTypeCode },
      coExaminers: appointments.filter((a) => a.appointmentId !== mine.appointmentId).map((a) => ({ name: names.get(a.personId) ?? null, examinerRoleCode: a.examinerRoleCode })),
      ownReport: own ? { reportId: own.reportId, recommendationCode: own.recommendationCode, submittedAt: own.submittedAt } : null,
      reportExchange: exchange,
      otherReports: showOthers
        ? reports.filter((r) => r.examinerAppointmentId !== mine.appointmentId).map((r) => ({ recommendationCode: r.recommendationCode, submittedAt: r.submittedAt }))
        : null,
    };
  }

  /** The thesis goes to an examiner only once their independence is checked and the panel confirmed (ADR-023). */
  async downloadThesis(tenantId: string, personId: string, examinationCaseId: string, actorId: string): Promise<RetrievedDocument> {
    const mine = await this.#appointment(tenantId, personId, examinationCaseId);
    if (!mine.confirmedAt || !mine.independenceCheckedAt) throw new ConflictError('The thesis is released once your appointment is confirmed');
    const thesis = await this.examinations.getThesisSubmission(tenantId, examinationCaseId);
    if (!thesis.storageRef.startsWith('documents:')) throw new NotFoundError('ThesisDocument', examinationCaseId);
    return withTenantContext(this.db, tenantId, (tx) => this.documents.adapter(tx).retrieve(tenantId, thesis.storageRef.slice('documents:'.length), actorId));
  }

  /** An examiner submits their own preliminary report (D-40). */
  async submitReport(tenantId: string, personId: string, examinationCaseId: string, input: { recommendationCode?: string; file: { filename: string; mimeType: string; content: Buffer } }, actorId: string): Promise<{ reportId: string }> {
    const mine = await this.#appointment(tenantId, personId, examinationCaseId);
    const exam = await this.examinations.getExaminationCase(tenantId, examinationCaseId);
    if (exam.statusCode !== 'examiners-confirmed') throw new ConflictError('Reports are submitted once the examination panel is confirmed');
    if ((await this.examinations.listExaminerReports(tenantId, examinationCaseId)).some((r) => r.examinerAppointmentId === mine.appointmentId)) {
      throw new ConflictError('You have already submitted your report');
    }
    const documentId = await this.#store(tenantId, 'srs-pgr-examination', mine.appointmentId, input.file, actorId);
    const reportId = await this.examinations.recordExaminerReport(tenantId, examinationCaseId, {
      examinerAppointmentId: mine.appointmentId, reportRef: `documents:${documentId}`,
      ...(input.recommendationCode ? { recommendationCode: input.recommendationCode } : {}),
      submittedBy: actorId, entryChannelCode: 'examiner-portal',
    });
    return { reportId };
  }

  async declareExaminerConflict(tenantId: string, personId: string, examinationCaseId: string, appointmentId: string, conflictTypeCode: string): Promise<void> {
    const mine = await this.#appointment(tenantId, personId, examinationCaseId);
    if (mine.appointmentId !== appointmentId) throw new NotFoundError('ExaminerAppointment', appointmentId);
    await this.examinations.declareConflict(tenantId, appointmentId, conflictTypeCode);
  }

  async #appointment(tenantId: string, personId: string, examinationCaseId: string) {
    const scope = await this.resolve(tenantId, personId);
    const own = scope.examinations.find((e) => e.examinationCaseId === examinationCaseId);
    if (!own) throw new NotFoundError('Examination', examinationCaseId);
    const appointment = (await this.examinations.listExaminerAppointments(tenantId, examinationCaseId)).find((a) => a.appointmentId === own.appointmentId);
    if (!appointment) throw new NotFoundError('Examination', examinationCaseId);
    return appointment;
  }

  /** Called after the caller's checks (ADR-030): scan with no transaction open, then write. */
  async #store(tenantId: string, ownerService: string, ownerRef: string, file: { filename: string; mimeType: string; content: Buffer }, actorId: string): Promise<string> {
    const scanned = await this.documents.scanUpload({ tenantId, ownerService, ownerRef, filename: file.filename, mimeType: file.mimeType, content: file.content, actorId });
    return withTenantContext(this.db, tenantId, async (tx) => (await this.documents.adapter(tx).store(scanned)).documentId);
  }

  async #names(tenantId: string, personIds: string[]): Promise<Map<string, string>> {
    if (personIds.length === 0) return new Map();
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ personId: personIdentities.personId, first: personIdentities.legalFirstName, family: personIdentities.legalFamilyName })
      .from(personIdentities).where(and(eq(personIdentities.tenantId, tenantId as Uuid), inArray(personIdentities.personId, [...new Set(personIds)] as Uuid[]), isNull(personIdentities.recordedUntil))));
    return new Map(rows.map((r) => [r.personId, `${r.first} ${r.family}`]));
  }

  async #students(tenantId: string, enrolmentIds: string[]): Promise<Map<string, { name: string | null; programme: string | null }>> {
    if (enrolmentIds.length === 0) return new Map();
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ enrolmentId: enrolments.id, personId: enrolments.personId, programmeTitle: programmes.title })
      .from(enrolments).leftJoin(programmes, and(eq(programmes.id, enrolments.programmeId), isNull(programmes.recordedUntil)))
      .where(and(eq(enrolments.tenantId, tenantId as Uuid), inArray(enrolments.id, [...new Set(enrolmentIds)] as Uuid[]), isNull(enrolments.recordedUntil))));
    const names = await this.#names(tenantId, rows.map((r) => r.personId));
    return new Map(rows.map((r) => [r.enrolmentId, { name: names.get(r.personId) ?? null, programme: r.programmeTitle ?? null }]));
  }

  async #caseStatuses(tenantId: string, caseIds: string[]): Promise<Map<string, string>> {
    if (caseIds.length === 0) return new Map();
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: businessCases.id, statusCode: businessCases.statusCode }).from(businessCases)
      .where(and(eq(businessCases.tenantId, tenantId as Uuid), inArray(businessCases.id, caseIds as Uuid[]), isNull(businessCases.recordedUntil))));
    return new Map(rows.map((r) => [r.id, r.statusCode]));
  }

  async #latestDecisions(tenantId: string, caseIds: string[]): Promise<Map<string, string>> {
    if (caseIds.length === 0) return new Map();
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ caseId: caseDecisions.businessCaseId, code: caseDecisions.decisionTypeCode }).from(caseDecisions)
      .where(and(eq(caseDecisions.tenantId, tenantId as Uuid), inArray(caseDecisions.businessCaseId, caseIds as Uuid[]))).orderBy(desc(caseDecisions.decidedAt)));
    const out = new Map<string, string>();
    for (const r of rows) if (!out.has(r.caseId)) out.set(r.caseId, r.code);
    return out;
  }

  async #exchange(tenantId: string): Promise<ReportExchange> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const v = (((row?.configuration?.['pgr'] ?? {}) as Record<string, unknown>)['examinerReports'] as Record<string, unknown> | undefined)?.['exchange'];
    return v === 'after-own-submitted' || v === 'staff-only' ? v : 'after-all-submitted';
  }
}
