import { randomUUID } from 'node:crypto';

import {
  casCases,
  enrolmentStatusTransitions,
  programmes,
  statusCaseAssessments,
  statusCaseConditions,
  studentStatusCases,
  ukviVisaStatuses,
  type Db,
  type StatusCaseAssessment,
  type StatusCaseCondition,
  type StudentStatusCase,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';

import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { EnrolmentService } from '../enrolment/service.js';
import { type EnrolmentSubject, subjectsForEnrolments } from '../enrolment/subjects.js';
import { deterministicUuid } from '../platform-controls/governed-review.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export type StatusCaseType = 'interruption' | 'suspension' | 'return' | 'withdrawal' | 'transfer' | 'leaver-closure';

const PROCESS_ID: Record<StatusCaseType, string> = {
  interruption: 'BP-02-007',
  suspension: 'BP-02-007',
  return: 'BP-02-008',
  withdrawal: 'BP-02-009',
  transfer: 'BP-02-006',
  'leaver-closure': 'BP-02-012',
};

/** Enrolment statuses each case type may start from. */
const STARTS_FROM: Record<StatusCaseType, string[]> = {
  interruption: ['enrolled'],
  suspension: ['enrolled'],
  return: ['intermitting', 'suspended'],
  withdrawal: ['pre-registration', 'enrolled', 'intermitting', 'suspended'],
  transfer: ['enrolled'],
  'leaver-closure': ['withdrawn', 'graduated'],
};

/** Enrolment status an approval moves to (transfer and closure keep it). */
const TARGET_STATUS: Partial<Record<StatusCaseType, 'intermitting' | 'suspended' | 'enrolled' | 'withdrawn'>> = {
  interruption: 'intermitting',
  suspension: 'suspended',
  return: 'enrolled',
  withdrawal: 'withdrawn',
};

/** Case types a student may request for themselves; the others are institutional. */
export const STUDENT_REQUESTABLE: StatusCaseType[] = ['interruption', 'return', 'withdrawal', 'transfer'];

export interface OpenStatusCaseInput {
  caseTypeCode: StatusCaseType;
  initiatedByCode: 'student' | 'institution';
  reasonCategoryCode?: string;
  requestedEffectiveDate: string;
  expectedReturnDate?: string;
  destinationProgrammeId?: string;
  destinationModeOfStudyCode?: string;
  relatedCaseId?: string;
  institutionalOutcomeRef?: string;
}

export interface StatusCaseConditionDto {
  conditionId: string;
  statusCaseId: string;
  conditionTypeCode: string;
  description: string;
  dueDate: string | null;
  statusCode: string;
  evidenceRef: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

export interface StatusCaseAssessmentDto {
  assessmentId: string;
  assessorRoleCode: string;
  outcomeCode: string;
  note: string | null;
  assessedBy: string;
  assessedAt: Date;
}

export interface StatusCaseRequestOptions {
  enrolmentStatusCode: string;
  requestableTypes: StatusCaseType[];
  openCaseId: string | null;
  returnFrom: {
    statusCaseId: string; caseTypeCode: string; approvedEffectiveDate: string | null; approvedReturnDate: string | null;
    outstandingConditions: StatusCaseConditionDto[];
  } | null;
  /** Only whether the student is on a Student visa, never visa details (ADR-017). */
  sponsored: boolean;
}

export interface StatusCaseDto {
  statusCaseId: string;
  businessCaseId: string;
  enrolmentId: string;
  personId: string;
  caseTypeCode: string;
  initiatedByCode: string;
  reasonCategoryCode: string | null;
  requestedEffectiveDate: string;
  expectedReturnDate: string | null;
  destinationProgrammeId: string | null;
  destinationModeOfStudyCode: string | null;
  relatedCaseId: string | null;
  institutionalOutcomeRef: string | null;
  statusCode: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  approvedEffectiveDate: string | null;
  approvedReturnDate: string | null;
  enrolmentStatusTransitionId: string | null;
  createdBy: string;
  createdAt: Date;
  assessments: StatusCaseAssessmentDto[];
  conditions: StatusCaseConditionDto[];
  /** For a return: the open conditions of the interruption it ends. */
  outstandingReturnConditions: StatusCaseConditionDto[];
}

/**
 * Governed changes to a student's study status (BPR-D04). The enrolment
 * changes only when a case is approved, and the approval applies the change
 * first: if the change is refused the case stays open.
 */
/** Changes a sponsor must report to UKVI for a sponsored student. */
const SPONSOR_REPORTABLE: StatusCaseType[] = ['interruption', 'suspension', 'withdrawal', 'transfer'];

/**
 * Whether the enrolment is sponsored on a Student visa: it has a UKVI visa
 * status or a CAS record. Only this yes/no leaves the compliance area
 * (minimum necessary data, ADR-017, ADR-022).
 */
export async function isSponsoredEnrolment(db: Db, tenantId: string, enrolmentId: string): Promise<boolean> {
  return withTenantContext(db, tenantId, async (tx) => {
    const id = enrolmentId as Uuid;
    const t = tenantId as Uuid;
    const [visa] = await tx.select({ id: ukviVisaStatuses.id }).from(ukviVisaStatuses)
      .where(and(eq(ukviVisaStatuses.tenantId, t), eq(ukviVisaStatuses.enrolmentId, id))).limit(1);
    if (visa) return true;
    // A CAS case is the one CAS record (D-16); a withdrawn one never sponsored the student.
    const [cas] = await tx.select({ id: casCases.id }).from(casCases).where(and(
      eq(casCases.tenantId, t), eq(casCases.enrolmentId, id), isNull(casCases.recordedUntil), ne(casCases.statusCode, 'withdrawn'),
    )).limit(1);
    return Boolean(cas);
  });
}

export class StatusCaseService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly enrolments: EnrolmentService,
    private readonly businessCases: BusinessCaseService,
  ) {}

  async openCase(tenantId: string, enrolmentId: string, input: OpenStatusCaseInput, actorId: string): Promise<StatusCaseDto> {
    await this.#code(tenantId, 'student_status_case', 'case_type_code', input.caseTypeCode);
    await this.#code(tenantId, 'student_status_case', 'initiated_by_code', input.initiatedByCode);
    if (input.reasonCategoryCode) await this.#code(tenantId, 'student_status_case', 'reason_category_code', input.reasonCategoryCode);

    const enrolment = await this.enrolments.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    const type = input.caseTypeCode;
    if (!STARTS_FROM[type].includes(enrolment.statusCode)) {
      throw new ValidationError(`A ${type} case cannot start from an enrolment that is ${enrolment.statusCode}`);
    }
    if (type === 'interruption' && !input.expectedReturnDate) {
      throw new ValidationError('An interruption needs an expected return date (BP-02-007 BR-1: time-bound)');
    }
    if (input.expectedReturnDate && input.expectedReturnDate <= input.requestedEffectiveDate) {
      throw new ValidationError('The expected return date must be after the effective date');
    }
    if (type === 'suspension' && input.initiatedByCode !== 'institution') {
      throw new ValidationError('A required suspension is initiated by the institution');
    }
    if ((type === 'suspension' || (type === 'withdrawal' && input.initiatedByCode === 'institution')) && !input.institutionalOutcomeRef) {
      throw new ValidationError('An institutional suspension or withdrawal must reference the authorising process outcome');
    }
    if (type === 'transfer') {
      if (!input.destinationProgrammeId && !input.destinationModeOfStudyCode) {
        throw new ValidationError('A transfer needs a destination programme or mode of study');
      }
      if (input.destinationProgrammeId) await this.#requireProgramme(tenantId, input.destinationProgrammeId);
      if (input.destinationModeOfStudyCode) await this.#code(tenantId, 'enrolment', 'mode_of_study_code', input.destinationModeOfStudyCode);
    }

    let relatedCaseId = input.relatedCaseId ?? null;
    if (type === 'return') {
      const related = relatedCaseId
        ? await this.#row(tenantId, relatedCaseId)
        : await this.#latestApprovedBreak(tenantId, enrolmentId);
      if (!related || related.enrolmentId !== enrolmentId || !['interruption', 'suspension'].includes(related.caseTypeCode) || related.statusCode !== 'approved') {
        throw new ValidationError('A return must follow an approved interruption or suspension of this enrolment');
      }
      relatedCaseId = related.id;
    }

    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'enrolment', subjectId: enrolmentId, processId: PROCESS_ID[type], statusCode: 'open', ownerId: actorId,
    }, actorId);

    const id = randomUUID();
    try {
      await withTenantContext(this.db, tenantId, (tx) => tx.insert(studentStatusCases).values({
        id: id,
        tenantId: tenantId as Uuid,
        businessCaseId: businessCaseId as Uuid,
        enrolmentId: enrolmentId as Uuid,
        personId: enrolment.personId as Uuid,
        caseTypeCode: type,
        initiatedByCode: input.initiatedByCode,
        reasonCategoryCode: input.reasonCategoryCode ?? null,
        requestedEffectiveDate: input.requestedEffectiveDate,
        expectedReturnDate: input.expectedReturnDate ?? null,
        destinationProgrammeId: (input.destinationProgrammeId ?? null) as Uuid | null,
        destinationModeOfStudyCode: input.destinationModeOfStudyCode ?? null,
        relatedCaseId: relatedCaseId as Uuid | null,
        institutionalOutcomeRef: input.institutionalOutcomeRef ?? null,
        createdBy: actorId,
      }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('This enrolment already has an open status case');
      throw error;
    }
    return this.getCase(tenantId, id);
  }

  async getCase(tenantId: string, statusCaseId: string): Promise<StatusCaseDto> {
    const row = await this.#row(tenantId, statusCaseId);
    if (!row) throw new NotFoundError('StudentStatusCase', statusCaseId);
    return this.#dto(tenantId, row);
  }

  async listForEnrolment(tenantId: string, enrolmentId: string): Promise<StatusCaseDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentStatusCases)
      .where(and(eq(studentStatusCases.tenantId, tenantId as Uuid), eq(studentStatusCases.enrolmentId, enrolmentId as Uuid)))
      .orderBy(desc(studentStatusCases.createdAt)));
    return Promise.all(rows.map((r) => this.#dto(tenantId, r)));
  }

  /**
   * What can be requested on an enrolment now (D-2): the case types its status
   * allows (only the student-requestable ones for a student), whether a case is
   * already open, the approved break a return would end (with its open
   * conditions), and whether the student is sponsored. The portal shows only
   * these, so the rules live here rather than in each client.
   */
  async requestOptions(tenantId: string, enrolmentId: string, forStudent: boolean): Promise<StatusCaseRequestOptions> {
    const enrolment = await this.enrolments.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    const cases = await this.listForEnrolment(tenantId, enrolmentId);
    const open = cases.find((c) => c.statusCode === 'requested') ?? null;
    const lastBreak = await this.#latestApprovedBreak(tenantId, enrolmentId);
    const returnable = lastBreak && (!forStudent || lastBreak.caseTypeCode === 'interruption') ? lastBreak : null;
    const candidates = (forStudent ? STUDENT_REQUESTABLE : (Object.keys(STARTS_FROM) as StatusCaseType[]))
      .filter((t) => STARTS_FROM[t].includes(enrolment.statusCode))
      .filter((t) => t !== 'return' || returnable !== null);
    return {
      enrolmentStatusCode: enrolment.statusCode,
      requestableTypes: open ? [] : candidates,
      openCaseId: open?.statusCaseId ?? null,
      returnFrom: returnable ? {
        statusCaseId: returnable.id, caseTypeCode: returnable.caseTypeCode,
        approvedEffectiveDate: returnable.approvedEffectiveDate, approvedReturnDate: returnable.approvedReturnDate,
        outstandingConditions: (await this.#conditions(tenantId, returnable.id)).filter((c) => c.statusCode === 'open'),
      } : null,
      sponsored: await isSponsoredEnrolment(this.db, tenantId, enrolmentId),
    };
  }

  /** Who each enrolment's case is about, for worklist readers without student-record access. */
  async subjects(tenantId: string, enrolmentIds: string[]): Promise<Map<string, EnrolmentSubject>> {
    return withTenantContext(this.db, tenantId, (tx) => subjectsForEnrolments(tx, tenantId, enrolmentIds));
  }

  /** Worklist: cases awaiting a decision, oldest first. */
  async listOpen(tenantId: string): Promise<StatusCaseDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentStatusCases)
      .where(and(eq(studentStatusCases.tenantId, tenantId as Uuid), eq(studentStatusCases.statusCode, 'requested')))
      .orderBy(studentStatusCases.createdAt));
    return Promise.all(rows.map((r) => this.#dto(tenantId, r)));
  }

  async addAssessment(tenantId: string, statusCaseId: string, input: { assessorRoleCode: string; outcomeCode: string; note?: string }, actorId: string): Promise<StatusCaseDto> {
    const row = await this.#requireOpen(tenantId, statusCaseId);
    await this.#code(tenantId, 'status_case_assessment', 'assessor_role_code', input.assessorRoleCode);
    await this.#code(tenantId, 'status_case_assessment', 'outcome_code', input.outcomeCode);
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(statusCaseAssessments).values({
      tenantId: tenantId as Uuid, statusCaseId: row.id, assessorRoleCode: input.assessorRoleCode,
      outcomeCode: input.outcomeCode, note: input.note ?? null, assessedBy: actorId,
    }));
    return this.getCase(tenantId, statusCaseId);
  }

  /** Conditions can be set while the case is open or as part of an approval (e.g. return conditions). */
  async addCondition(tenantId: string, statusCaseId: string, input: { conditionTypeCode: string; description: string; dueDate?: string }, actorId: string): Promise<StatusCaseDto> {
    const row = await this.#row(tenantId, statusCaseId);
    if (!row) throw new NotFoundError('StudentStatusCase', statusCaseId);
    if (!['requested', 'approved'].includes(row.statusCode)) {
      throw new ConflictError(`Conditions cannot be added to a ${row.statusCode} case`);
    }
    await this.#code(tenantId, 'status_case_condition', 'condition_type_code', input.conditionTypeCode);
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(statusCaseConditions).values({
      tenantId: tenantId as Uuid, statusCaseId: row.id, conditionTypeCode: input.conditionTypeCode,
      description: input.description, dueDate: input.dueDate ?? null, createdBy: actorId,
    }));
    return this.getCase(tenantId, statusCaseId);
  }

  async resolveCondition(tenantId: string, conditionId: string, input: { statusCode: 'met' | 'waived'; note?: string; evidenceRef?: string }, actorId: string): Promise<StatusCaseConditionDto> {
    const [condition] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(statusCaseConditions)
      .where(and(eq(statusCaseConditions.id, conditionId as Uuid), eq(statusCaseConditions.tenantId, tenantId as Uuid))).limit(1));
    if (!condition) throw new NotFoundError('StatusCaseCondition', conditionId);
    if (condition.statusCode !== 'open') throw new ConflictError(`This condition is already ${condition.statusCode}`);
    if (input.statusCode === 'waived' && !input.note) throw new ValidationError('Waiving a condition needs a reason');
    const [updated] = await withTenantContext(this.db, tenantId, (tx) => tx.update(statusCaseConditions).set({
      statusCode: input.statusCode, resolvedBy: actorId, resolvedAt: clockNow(),
      resolutionNote: input.note ?? null, evidenceRef: input.evidenceRef ?? condition.evidenceRef,
    }).where(eq(statusCaseConditions.id, condition.id)).returning());
    return conditionDto(updated!);
  }

  /** The requester (or registry) withdraws an undecided case. */
  async withdrawCase(tenantId: string, statusCaseId: string, actorId: string): Promise<StatusCaseDto> {
    const row = await this.#requireOpen(tenantId, statusCaseId);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(studentStatusCases)
      .set({ statusCode: 'withdrawn', updatedAt: clockNow() }).where(eq(studentStatusCases.id, row.id)));
    await this.businessCases.advanceCaseStatus(row.businessCaseId, tenantId, 'withdrawn', actorId);
    return this.getCase(tenantId, statusCaseId);
  }

  async decide(tenantId: string, statusCaseId: string, input: {
    decisionCode: 'approved' | 'rejected';
    reason: string;
    effectiveDate?: string;
    returnDate?: string;
  }, actorId: string): Promise<StatusCaseDto> {
    const row = await this.#requireOpen(tenantId, statusCaseId);
    if (row.createdBy === actorId) {
      throw new ConflictError('The person who opened a status case cannot decide it');
    }
    const now = clockNow();

    if (input.decisionCode === 'rejected') {
      await withTenantContext(this.db, tenantId, (tx) => tx.update(studentStatusCases).set({
        statusCode: 'rejected', decidedBy: actorId, decidedAt: now, decisionReason: input.reason, updatedAt: now,
      }).where(eq(studentStatusCases.id, row.id)));
      await this.#recordDecision(tenantId, row, 'rejected', input.reason, actorId, now);
      return this.getCase(tenantId, statusCaseId);
    }

    const type = row.caseTypeCode as StatusCaseType;
    const effectiveDate = input.effectiveDate ?? row.requestedEffectiveDate;
    const returnDate = input.returnDate ?? row.expectedReturnDate;
    if (type === 'interruption' && !returnDate) throw new ValidationError('An approved interruption needs a return date');
    if (returnDate && returnDate <= effectiveDate) throw new ValidationError('The return date must be after the effective date');

    if (type === 'return' && row.relatedCaseId) {
      const open = (await this.#conditions(tenantId, row.relatedCaseId)).filter((c) => c.statusCode === 'open');
      if (open.length > 0) {
        throw new ConflictError(`Return conditions are not yet met: ${open.map((c) => c.description).join('; ')}`);
      }
    }
    if (type === 'leaver-closure') {
      const open = (await this.#conditions(tenantId, row.id)).filter((c) => c.statusCode === 'open');
      if (open.length > 0) throw new ConflictError(`Closure items are still open: ${open.map((c) => c.description).join('; ')}`);
    }

    // Advice the decision depends on (BP-02-006 steps 3-4; Phase 1 decisions, risk 1).
    const assessments = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(statusCaseAssessments)
      .where(eq(statusCaseAssessments.statusCaseId, row.id)));
    if (type === 'transfer' && row.destinationProgrammeId
      && !assessments.some((a) => a.assessorRoleCode === 'destination-academic' && a.outcomeCode === 'supports')) {
      throw new ConflictError('A transfer to another programme needs the destination programme\'s support before it is approved');
    }
    if (SPONSOR_REPORTABLE.includes(type) && await isSponsoredEnrolment(this.db, tenantId, row.enrolmentId)
      && !assessments.some((a) => a.assessorRoleCode === 'compliance')) {
      throw new ConflictError('This student is sponsored on a Student visa: record UKVI compliance advice before deciding (the change must be reported to UKVI)');
    }

    // Apply the change first. If the enrolment refuses it, the case stays open.
    const transitionId = type === 'leaver-closure' ? null : deterministicUuid(`status-case:${row.id}`);
    if (transitionId && !(await this.#transitionExists(tenantId, transitionId))) {
      const validFrom = new Date(`${effectiveDate}T00:00:00Z`);
      const options = { transitionId, reasonCode: row.reasonCategoryCode ?? type, reasonText: `Status case ${row.id}` };
      if (type === 'transfer') {
        await this.enrolments.changeStudyArrangement(row.enrolmentId, tenantId, {
          programmeId: row.destinationProgrammeId, modeOfStudyCode: row.destinationModeOfStudyCode,
        }, validFrom, actorId, { ...options, reasonCode: 'transfer' });
      } else {
        await this.enrolments.transitionStatus(row.enrolmentId, tenantId, TARGET_STATUS[type]!, validFrom, actorId, options);
      }
    }

    await withTenantContext(this.db, tenantId, (tx) => tx.update(studentStatusCases).set({
      statusCode: 'approved', decidedBy: actorId, decidedAt: now, decisionReason: input.reason,
      approvedEffectiveDate: effectiveDate, approvedReturnDate: returnDate ?? null,
      enrolmentStatusTransitionId: transitionId, updatedAt: now,
    }).where(eq(studentStatusCases.id, row.id)));
    await this.#recordDecision(tenantId, row, 'approved', input.reason, actorId, now);
    return this.getCase(tenantId, statusCaseId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #recordDecision(tenantId: string, row: StudentStatusCase, outcome: string, reason: string, actorId: string, at: Date) {
    await this.businessCases.recordDecision(row.businessCaseId, tenantId, {
      decisionTypeCode: `${row.caseTypeCode}-${outcome}`, authorityActorId: actorId, reasonText: reason, effectiveAt: at,
    });
    await this.businessCases.advanceCaseStatus(row.businessCaseId, tenantId, outcome === 'approved' ? 'decided' : 'closed', actorId);
  }

  async #transitionExists(tenantId: string, id: string): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: enrolmentStatusTransitions.id })
      .from(enrolmentStatusTransitions).where(eq(enrolmentStatusTransitions.id, id as Uuid)).limit(1));
    return rows.length > 0;
  }

  async #requireOpen(tenantId: string, statusCaseId: string): Promise<StudentStatusCase> {
    const row = await this.#row(tenantId, statusCaseId);
    if (!row) throw new NotFoundError('StudentStatusCase', statusCaseId);
    if (row.statusCode !== 'requested') throw new ConflictError(`This case is already ${row.statusCode}`);
    return row;
  }

  async #row(tenantId: string, id: string): Promise<StudentStatusCase | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentStatusCases)
      .where(and(eq(studentStatusCases.id, id as Uuid), eq(studentStatusCases.tenantId, tenantId as Uuid))).limit(1));
    return rows[0] ?? null;
  }

  async #latestApprovedBreak(tenantId: string, enrolmentId: string): Promise<StudentStatusCase | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(studentStatusCases)
      .where(and(
        eq(studentStatusCases.tenantId, tenantId as Uuid),
        eq(studentStatusCases.enrolmentId, enrolmentId as Uuid),
        eq(studentStatusCases.statusCode, 'approved'),
      ))
      .orderBy(desc(studentStatusCases.decidedAt)));
    return rows.find((r) => r.caseTypeCode === 'interruption' || r.caseTypeCode === 'suspension') ?? null;
  }

  async #conditions(tenantId: string, statusCaseId: string): Promise<StatusCaseConditionDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(statusCaseConditions)
      .where(and(eq(statusCaseConditions.tenantId, tenantId as Uuid), eq(statusCaseConditions.statusCaseId, statusCaseId as Uuid)))
      .orderBy(statusCaseConditions.createdAt));
    return rows.map(conditionDto);
  }

  async #dto(tenantId: string, row: StudentStatusCase): Promise<StatusCaseDto> {
    const [assessments, conditions] = await Promise.all([
      withTenantContext(this.db, tenantId, (tx) => tx.select().from(statusCaseAssessments)
        .where(and(eq(statusCaseAssessments.tenantId, tenantId as Uuid), eq(statusCaseAssessments.statusCaseId, row.id)))
        .orderBy(statusCaseAssessments.assessedAt)),
      this.#conditions(tenantId, row.id),
    ]);
    const outstanding = row.caseTypeCode === 'return' && row.relatedCaseId
      ? (await this.#conditions(tenantId, row.relatedCaseId)).filter((c) => c.statusCode === 'open')
      : [];
    return {
      statusCaseId: row.id,
      businessCaseId: row.businessCaseId,
      enrolmentId: row.enrolmentId,
      personId: row.personId,
      caseTypeCode: row.caseTypeCode,
      initiatedByCode: row.initiatedByCode,
      reasonCategoryCode: row.reasonCategoryCode,
      requestedEffectiveDate: row.requestedEffectiveDate,
      expectedReturnDate: row.expectedReturnDate,
      destinationProgrammeId: row.destinationProgrammeId,
      destinationModeOfStudyCode: row.destinationModeOfStudyCode,
      relatedCaseId: row.relatedCaseId,
      institutionalOutcomeRef: row.institutionalOutcomeRef,
      statusCode: row.statusCode,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      decisionReason: row.decisionReason,
      approvedEffectiveDate: row.approvedEffectiveDate,
      approvedReturnDate: row.approvedReturnDate,
      enrolmentStatusTransitionId: row.enrolmentStatusTransitionId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      assessments: assessments.map(assessmentDto),
      conditions,
      outstandingReturnConditions: outstanding,
    };
  }

  async #requireProgramme(tenantId: string, programmeId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: programmes.id }).from(programmes)
      .where(and(eq(programmes.id, programmeId as Uuid), eq(programmes.tenantId, tenantId as Uuid))).limit(1));
    if (!rows[0]) throw new NotFoundError('Programme', programmeId);
  }

  async #code(tenantId: string, entity: string, field: string, value: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field, message: 'Value is not active in the configured value set' }]);
    }
  }
}

function conditionDto(c: StatusCaseCondition): StatusCaseConditionDto {
  return {
    conditionId: c.id, statusCaseId: c.statusCaseId, conditionTypeCode: c.conditionTypeCode, description: c.description,
    dueDate: c.dueDate, statusCode: c.statusCode, evidenceRef: c.evidenceRef, resolvedBy: c.resolvedBy,
    resolvedAt: c.resolvedAt, resolutionNote: c.resolutionNote,
  };
}

function assessmentDto(a: StatusCaseAssessment): StatusCaseAssessmentDto {
  return { assessmentId: a.id, assessorRoleCode: a.assessorRoleCode, outcomeCode: a.outcomeCode, note: a.note, assessedBy: a.assessedBy, assessedAt: a.assessedAt };
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ('code' in e && (e).code === '23505') return true;
  }
  return false;
}
