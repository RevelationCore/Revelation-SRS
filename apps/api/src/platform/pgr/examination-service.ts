import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  examinerAppointments,
  examinerReports,
  pgrExaminationCases,
  pgrExaminationOutcomes,
  thesisCorrectionRequirements,
  thesisSubmissions,
  vivaEvents,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const CORRECTIONS_REQUIRED_OUTCOMES = new Set(['pass-minor-corrections', 'pass-major-corrections', 'resubmission']);

/**
 * PGR thesis submission and examination (BP-05-010, BPR-D12, ADR-023).
 *
 * pgr_examination_case extends the shared business_case primitive. Follows
 * ADR-020's staged-authority pattern: immutable submitted thesis version
 * → examiner nomination + chair approval → examiner reports → viva →
 * ratified, immutable outcome. The case's own status is advanced through
 * submitted → examiners-confirmed → viva-held → <outcome code>, mirroring
 * ProgressReviewService's "final status is the outcome" convention.
 */

export interface SubmitThesisInput {
  enrolmentId:            string;
  ownerId:                string;
  formatCode:             'traditional' | 'practice-based' | 'published-work';
  declarationConfirmed:   boolean;
  storageRef:             string;
  restricted?:            boolean;
  restrictionReasonText?: string;
  restrictionReviewDate?: string;
}

export interface NominateExaminerInput {
  personId:          string;
  examinerRoleCode:  'internal' | 'external';
}

export interface RecordExaminerReportInput {
  examinerAppointmentId: string;
  reportRef:              string;
  recommendationCode?:    string;
}

export interface RecordVivaInput {
  heldAt:                  string;
  jointRecommendationText: string;
}

export interface RatifyOutcomeInput {
  outcomeCode:         'pass' | 'pass-minor-corrections' | 'pass-major-corrections' | 'resubmission' | 'fail';
  correctionsDeadline?: string;
}

export interface ExaminationCaseDto {
  examinationCaseId: string;
  businessCaseId:    string;
  enrolmentId:       string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         Date;
}

export interface ThesisSubmissionDto {
  submissionId:           string;
  examinationCaseId:      string;
  versionNumber:          number;
  formatCode:             string;
  declarationConfirmed:   boolean;
  restricted:             boolean;
  restrictionReasonText:  string | null;
  restrictionReviewDate:  string | null;
  storageRef:             string;
  submittedAt:            Date;
}

export interface ExaminerAppointmentDto {
  appointmentId:          string;
  examinationCaseId:      string;
  personId:               string;
  examinerRoleCode:       string;
  independenceCheckedAt:  Date | null;
  conflictTypeCode:       string | null;
  recusedAt:              Date | null;
  confirmedAt:            Date | null;
}

export interface ExaminerReportDto {
  reportId:              string;
  examinationCaseId:     string;
  examinerAppointmentId: string;
  reportRef:             string;
  recommendationCode:    string | null;
  submittedAt:           Date;
}

export interface VivaEventDto {
  vivaEventId:             string;
  examinationCaseId:       string;
  heldAt:                  Date;
  jointRecommendationText: string;
  recordedAt:              Date;
}

export interface ExaminationOutcomeDto {
  outcomeId:         string;
  examinationCaseId: string;
  outcomeCode:       string;
  decidedBy:         string;
  decidedAt:         Date;
}

export interface CorrectionRequirementDto {
  requirementId: string;
  outcomeId:     string;
  deadlineDate:  string;
  completedAt:   Date | null;
  completedBy:   string | null;
}

export class ExaminationService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
    private readonly valueSets: ValueSetService,
  ) {}

  async submitThesis(tenantId: string, input: SubmitThesisInput, actorId: string): Promise<{ examinationCaseId: string; submissionId: string }> {
    if (!input.declarationConfirmed) {
      throw new ValidationError('Thesis declarations must be confirmed before submission');
    }
    const isValidFormat = await this.valueSets.validateFieldValue('thesis_submission', 'format_code', input.formatCode, tenantId);
    if (isValidFormat === false) {
      throw new ValidationError(`Invalid thesis format '${input.formatCode}'`);
    }

    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'enrolment',
      subjectId:   input.enrolmentId,
      processId:   'BP-05-010',
      statusCode:  'submitted',
      ownerId:     input.ownerId,
    }, actorId);

    const examinationCaseId = randomUUID();
    const submissionId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrExaminationCases).values({
        id:             examinationCaseId,
        tenantId:       tenantId as Uuid,
        businessCaseId: businessCaseId as Uuid,
        enrolmentId:    input.enrolmentId as Uuid,
        createdAt:      clockNow(),
      });
      await tx.insert(thesisSubmissions).values({
        id:                    submissionId,
        tenantId:              tenantId as Uuid,
        examinationCaseId:     examinationCaseId as Uuid,
        versionNumber:         1,
        formatCode:            input.formatCode,
        declarationConfirmed:  input.declarationConfirmed,
        restricted:            input.restricted ?? false,
        restrictionReasonText: input.restrictionReasonText ?? null,
        restrictionReviewDate: input.restrictionReviewDate ?? null,
        storageRef:            input.storageRef,
        submittedBy:           actorId,
        submittedAt:           clockNow(),
      });
    });
    return { examinationCaseId, submissionId };
  }

  async nominateExaminer(tenantId: string, examinationCaseId: string, input: NominateExaminerInput, actorId: string): Promise<string> {
    const examinationCase = await this.#getCase(tenantId, examinationCaseId);
    if (examinationCase.statusCode !== 'submitted') {
      throw new ValidationError(`Cannot nominate examiners for a case in status '${examinationCase.statusCode}'`);
    }
    const isValidRole = await this.valueSets.validateFieldValue('examiner_appointment', 'examiner_role_code', input.examinerRoleCode, tenantId);
    if (isValidRole === false) {
      throw new ValidationError(`Invalid examiner role '${input.examinerRoleCode}'`);
    }

    const appointmentId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(examinerAppointments).values({
        id:                    appointmentId,
        tenantId:              tenantId as Uuid,
        examinationCaseId:     examinationCaseId as Uuid,
        personId:              input.personId as Uuid,
        examinerRoleCode:      input.examinerRoleCode,
        independenceCheckedAt: null,
        conflictTypeCode:      null,
        recusedAt:             null,
        confirmedAt:           null,
        nominatedBy:           actorId,
        nominatedAt:           clockNow(),
      });
    });
    return appointmentId;
  }

  async recordIndependenceCheck(tenantId: string, appointmentId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(examinerAppointments)
        .set({ independenceCheckedAt: clockNow() })
        .where(and(
          eq(examinerAppointments.id, appointmentId as Uuid),
          eq(examinerAppointments.tenantId, tenantId as Uuid),
        ))
        .returning({ id: examinerAppointments.id });
      if (!updated[0]) throw new NotFoundError('ExaminerAppointment', appointmentId);
    });
  }

  async declareConflict(tenantId: string, appointmentId: string, conflictTypeCode: string): Promise<void> {
    const isValidConflict = await this.valueSets.validateFieldValue('examiner_appointment', 'conflict_type_code', conflictTypeCode, tenantId);
    if (isValidConflict === false) {
      throw new ValidationError(`Invalid conflict type '${conflictTypeCode}'`);
    }
    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(examinerAppointments)
        .set({ conflictTypeCode })
        .where(and(
          eq(examinerAppointments.id, appointmentId as Uuid),
          eq(examinerAppointments.tenantId, tenantId as Uuid),
        ))
        .returning({ id: examinerAppointments.id });
      if (!updated[0]) throw new NotFoundError('ExaminerAppointment', appointmentId);
    });
  }

  async recuseExaminer(tenantId: string, appointmentId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(examinerAppointments)
        .set({ recusedAt: clockNow() })
        .where(and(
          eq(examinerAppointments.id, appointmentId as Uuid),
          eq(examinerAppointments.tenantId, tenantId as Uuid),
        ))
        .returning({ id: examinerAppointments.id });
      if (!updated[0]) throw new NotFoundError('ExaminerAppointment', appointmentId);
    });
  }

  /**
   * Independent Chair approval of the nominated panel (BP-05-010 step 3).
   * Requires every non-recused nominee to have a recorded independence
   * check and no unresolved conflict.
   */
  async approveExaminerPanel(tenantId: string, examinationCaseId: string, actorId: string): Promise<void> {
    const examinationCase = await this.#getCase(tenantId, examinationCaseId);
    if (examinationCase.statusCode !== 'submitted') {
      throw new ValidationError(`Cannot approve an examiner panel for a case in status '${examinationCase.statusCode}'`);
    }

    const appointments = await this.listExaminerAppointments(tenantId, examinationCaseId);
    const active = appointments.filter((a) => !a.recusedAt);
    if (active.length === 0) {
      throw new ValidationError(`Examination case '${examinationCaseId}' has no nominated examiners to approve`);
    }
    if (active.some((a) => !a.independenceCheckedAt)) {
      throw new ValidationError('Every nominated examiner must have a recorded independence check before approval');
    }
    if (active.some((a) => a.conflictTypeCode)) {
      throw new ValidationError('Every declared conflict must be resolved (recused) before approval');
    }

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      for (const appointment of active) {
        await tx.update(examinerAppointments)
          .set({ confirmedAt: now })
          .where(and(
            eq(examinerAppointments.id, appointment.appointmentId as Uuid),
            eq(examinerAppointments.tenantId, tenantId as Uuid),
          ));
      }
    });

    await this.businessCases.recordDecision(examinationCase.businessCaseId, tenantId, {
      decisionTypeCode: 'examiners-approved',
      authorityActorId: actorId,
      effectiveAt:      now,
    });
    await this.businessCases.advanceCaseStatus(examinationCase.businessCaseId, tenantId, 'examiners-confirmed', actorId);
  }

  async recordExaminerReport(tenantId: string, examinationCaseId: string, input: RecordExaminerReportInput): Promise<string> {
    const examinationCase = await this.#getCase(tenantId, examinationCaseId);
    if (examinationCase.statusCode !== 'examiners-confirmed') {
      throw new ValidationError('Examiner reports can only be recorded once the panel is confirmed');
    }
    if (input.recommendationCode) {
      const isValidRecommendation = await this.valueSets.validateFieldValue('examiner_report', 'recommendation_code', input.recommendationCode, tenantId);
      if (isValidRecommendation === false) {
        throw new ValidationError(`Invalid recommendation code '${input.recommendationCode}'`);
      }
    }

    const reportId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(examinerReports).values({
        id:                     reportId,
        tenantId:               tenantId as Uuid,
        examinationCaseId:      examinationCaseId as Uuid,
        examinerAppointmentId:  input.examinerAppointmentId as Uuid,
        reportRef:              input.reportRef,
        recommendationCode:     input.recommendationCode ?? null,
        submittedAt:            clockNow(),
      });
    });
    return reportId;
  }

  /**
   * Records the held viva and joint recommendation. Requires every
   * confirmed examiner to have submitted at least one report first.
   */
  async recordViva(tenantId: string, examinationCaseId: string, input: RecordVivaInput, actorId: string): Promise<string> {
    const examinationCase = await this.#getCase(tenantId, examinationCaseId);
    if (examinationCase.statusCode !== 'examiners-confirmed') {
      throw new ValidationError('A viva can only be recorded once the panel is confirmed');
    }

    const appointments = await this.listExaminerAppointments(tenantId, examinationCaseId);
    const confirmed = appointments.filter((a) => a.confirmedAt && !a.recusedAt);
    const reports = await this.listExaminerReports(tenantId, examinationCaseId);
    const reportedAppointmentIds = new Set(reports.map((r) => r.examinerAppointmentId));
    if (confirmed.some((a) => !reportedAppointmentIds.has(a.appointmentId))) {
      throw new ValidationError('Every confirmed examiner must submit a report before the viva can be recorded');
    }

    const vivaEventId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(vivaEvents).values({
        id:                      vivaEventId,
        tenantId:                tenantId as Uuid,
        examinationCaseId:       examinationCaseId as Uuid,
        heldAt:                  new Date(input.heldAt),
        jointRecommendationText: input.jointRecommendationText,
        recordedBy:              actorId,
        recordedAt:              clockNow(),
      });
    });

    await this.businessCases.advanceCaseStatus(examinationCase.businessCaseId, tenantId, 'viva-held', actorId);
    return vivaEventId;
  }

  /**
   * Ratifies the outcome. Immutable once created — any later amendment
   * must go through a linked correction case, never an edit here. If the
   * outcome requires corrections, a deadlined requirement is created.
   */
  async ratifyOutcome(tenantId: string, examinationCaseId: string, input: RatifyOutcomeInput, actorId: string): Promise<string> {
    const examinationCase = await this.#getCase(tenantId, examinationCaseId);
    if (examinationCase.statusCode !== 'viva-held') {
      throw new ValidationError('An outcome can only be ratified once the viva has been held');
    }

    const outcomeSet = await this.valueSets.getValueSet('pgr-examination-outcome-code', tenantId);
    if (!outcomeSet || !outcomeSet.members.some((m) => m.code === input.outcomeCode)) {
      throw new ValidationError(`Invalid PGR examination outcome '${input.outcomeCode}'`);
    }
    if (CORRECTIONS_REQUIRED_OUTCOMES.has(input.outcomeCode) && !input.correctionsDeadline) {
      throw new ValidationError(`Outcome '${input.outcomeCode}' requires a corrections deadline`);
    }

    const outcomeId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrExaminationOutcomes).values({
        id:                outcomeId,
        tenantId:          tenantId as Uuid,
        examinationCaseId: examinationCaseId as Uuid,
        outcomeCode:       input.outcomeCode,
        decidedBy:         actorId,
        decidedAt:         now,
      });

      if (CORRECTIONS_REQUIRED_OUTCOMES.has(input.outcomeCode)) {
        await tx.insert(thesisCorrectionRequirements).values({
          id:           randomUUID(),
          tenantId:     tenantId as Uuid,
          outcomeId:    outcomeId as Uuid,
          deadlineDate: input.correctionsDeadline!,
          completedAt:  null,
          completedBy:  null,
          createdAt:    now,
        });
      }
    });

    await this.businessCases.recordDecision(examinationCase.businessCaseId, tenantId, {
      decisionTypeCode: input.outcomeCode,
      authorityActorId: actorId,
      effectiveAt:      now,
    });
    await this.businessCases.advanceCaseStatus(examinationCase.businessCaseId, tenantId, input.outcomeCode, actorId);

    return outcomeId;
  }

  async recordCorrectionsComplete(tenantId: string, requirementId: string, actorId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(thesisCorrectionRequirements)
        .set({ completedAt: clockNow(), completedBy: actorId })
        .where(and(
          eq(thesisCorrectionRequirements.id, requirementId as Uuid),
          eq(thesisCorrectionRequirements.tenantId, tenantId as Uuid),
          isNull(thesisCorrectionRequirements.completedAt),
        ))
        .returning({ id: thesisCorrectionRequirements.id });
      if (!updated[0]) throw new NotFoundError('ThesisCorrectionRequirement', requirementId);
    });
  }

  async getExaminationCase(tenantId: string, examinationCaseId: string): Promise<ExaminationCaseDto> {
    return this.#getCase(tenantId, examinationCaseId);
  }

  async getThesisSubmission(tenantId: string, examinationCaseId: string): Promise<ThesisSubmissionDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(thesisSubmissions).where(and(
        eq(thesisSubmissions.tenantId, tenantId as Uuid),
        eq(thesisSubmissions.examinationCaseId, examinationCaseId as Uuid),
      )).orderBy(desc(thesisSubmissions.versionNumber)).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('ThesisSubmission', examinationCaseId);
    return submissionToDto(row);
  }

  async listExaminerAppointments(tenantId: string, examinationCaseId: string): Promise<ExaminerAppointmentDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examinerAppointments).where(and(
        eq(examinerAppointments.tenantId, tenantId as Uuid),
        eq(examinerAppointments.examinationCaseId, examinationCaseId as Uuid),
      )),
    );
    return rows.map(appointmentToDto);
  }

  async listExaminerReports(tenantId: string, examinationCaseId: string): Promise<ExaminerReportDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examinerReports).where(and(
        eq(examinerReports.tenantId, tenantId as Uuid),
        eq(examinerReports.examinationCaseId, examinationCaseId as Uuid),
      )),
    );
    return rows.map(reportToDto);
  }

  async getViva(tenantId: string, examinationCaseId: string): Promise<VivaEventDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(vivaEvents).where(and(
        eq(vivaEvents.tenantId, tenantId as Uuid),
        eq(vivaEvents.examinationCaseId, examinationCaseId as Uuid),
      )).limit(1),
    );
    return rows[0] ? vivaToDto(rows[0]) : null;
  }

  async getLatestOutcome(tenantId: string, examinationCaseId: string): Promise<ExaminationOutcomeDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrExaminationOutcomes).where(and(
        eq(pgrExaminationOutcomes.tenantId, tenantId as Uuid),
        eq(pgrExaminationOutcomes.examinationCaseId, examinationCaseId as Uuid),
      )).limit(1),
    );
    return rows[0] ? outcomeToDto(rows[0]) : null;
  }

  async listCorrectionRequirements(tenantId: string, outcomeId: string): Promise<CorrectionRequirementDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(thesisCorrectionRequirements).where(and(
        eq(thesisCorrectionRequirements.tenantId, tenantId as Uuid),
        eq(thesisCorrectionRequirements.outcomeId, outcomeId as Uuid),
      )),
    );
    return rows.map(requirementToDto);
  }

  async #getCase(tenantId: string, examinationCaseId: string): Promise<ExaminationCaseDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrExaminationCases).where(and(
        eq(pgrExaminationCases.id, examinationCaseId as Uuid),
        eq(pgrExaminationCases.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('PgrExaminationCase', examinationCaseId);

    const businessCase = await this.businessCases.getCurrentCase(row.businessCaseId, tenantId);
    if (!businessCase) throw new NotFoundError('BusinessCase', row.businessCaseId);

    return {
      examinationCaseId: row.id,
      businessCaseId:    row.businessCaseId,
      enrolmentId:       row.enrolmentId,
      statusCode:        businessCase.statusCode,
      ownerId:           businessCase.ownerId,
      createdAt:         row.createdAt,
    };
  }
}

function submissionToDto(row: typeof thesisSubmissions.$inferSelect): ThesisSubmissionDto {
  return {
    submissionId:          row.id,
    examinationCaseId:     row.examinationCaseId,
    versionNumber:         row.versionNumber,
    formatCode:            row.formatCode,
    declarationConfirmed:  row.declarationConfirmed,
    restricted:            row.restricted,
    restrictionReasonText: row.restrictionReasonText,
    restrictionReviewDate: row.restrictionReviewDate,
    storageRef:            row.storageRef,
    submittedAt:           row.submittedAt,
  };
}

function appointmentToDto(row: typeof examinerAppointments.$inferSelect): ExaminerAppointmentDto {
  return {
    appointmentId:         row.id,
    examinationCaseId:     row.examinationCaseId,
    personId:              row.personId,
    examinerRoleCode:      row.examinerRoleCode,
    independenceCheckedAt: row.independenceCheckedAt,
    conflictTypeCode:      row.conflictTypeCode,
    recusedAt:             row.recusedAt,
    confirmedAt:           row.confirmedAt,
  };
}

function reportToDto(row: typeof examinerReports.$inferSelect): ExaminerReportDto {
  return {
    reportId:              row.id,
    examinationCaseId:     row.examinationCaseId,
    examinerAppointmentId: row.examinerAppointmentId,
    reportRef:             row.reportRef,
    recommendationCode:    row.recommendationCode,
    submittedAt:           row.submittedAt,
  };
}

function vivaToDto(row: typeof vivaEvents.$inferSelect): VivaEventDto {
  return {
    vivaEventId:             row.id,
    examinationCaseId:       row.examinationCaseId,
    heldAt:                  row.heldAt,
    jointRecommendationText: row.jointRecommendationText,
    recordedAt:              row.recordedAt,
  };
}

function outcomeToDto(row: typeof pgrExaminationOutcomes.$inferSelect): ExaminationOutcomeDto {
  return {
    outcomeId:         row.id,
    examinationCaseId: row.examinationCaseId,
    outcomeCode:       row.outcomeCode,
    decidedBy:         row.decidedBy,
    decidedAt:         row.decidedAt,
  };
}

function requirementToDto(row: typeof thesisCorrectionRequirements.$inferSelect): CorrectionRequirementDto {
  return {
    requirementId: row.id,
    outcomeId:     row.outcomeId,
    deadlineDate:  row.deadlineDate,
    completedAt:   row.completedAt,
    completedBy:   row.completedBy,
  };
}
