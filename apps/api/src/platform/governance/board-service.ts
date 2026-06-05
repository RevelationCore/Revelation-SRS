import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  academicPeriods,
  adjustmentDistributions,
  assessmentComponents,
  enrolments,
  examBoardCandidateProfiles,
  examBoardDataPacks,
  examBoardMemberAttendance,
  examBoards,
  exceptionalCircumstances,
  externalExaminerSignoffs,
  marks,
  misconductCaseReferences,
  misconductOutcomes,
  misconductPenaltyEffects,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  personIdentities,
  persons,
  reasonableAdjustments,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES, NotFoundError, ValidationError } from '@revelation-srs/domain';
import type {
  AssessmentModuleResultRatifiedV1Payload,
  GovernanceExamBoardDataPackReadyV1Payload,
  GovernanceExamBoardRatifiedV1Payload,
  GovernanceRecordLockedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';

export interface CreateExamBoardInput {
  boardTypeCode: string;
  academicYear: string;
  academicPeriodId?: string;
  meetingDate?: string;
}

export interface ExamBoardDto {
  examBoardId: string;
  boardTypeCode: string;
  academicYear: string;
  academicPeriodId: string | null;
  meetingDate: string | null;
  ratifiedAt: Date | null;
  actorId: string;
  createdAt: Date;
}

export interface DataPackDto {
  dataPackId: string;
  examBoardId: string;
  packVersion: number;
  supersededById: string | null;
  sourceTransactionTime: Date;
  candidateCount: number;
  generatedAt: Date;
  generatedBy: string;
}

export interface CandidateProfileDto {
  candidateProfileId: string;
  dataPackId: string;
  enrolmentId: string;
  personId: string;
  profileData: Record<string, unknown>;
  createdAt: Date;
}

export interface AttendanceDto {
  attendanceId: string;
  examBoardId: string;
  actorId: string;
  roleCode: string;
  attendedAt: Date;
}

export interface SignoffDto {
  signoffId: string;
  examBoardId: string;
  actorId: string;
  commentary: string | null;
  signedOffAt: Date;
}

interface BoardRow {
  id: string;
  tenantId: string;
  boardTypeCode: string;
  academicYear: string;
  academicPeriodId: string | null;
  meetingDate: string | null;
  ratifiedAt: Date | null;
  actorId: string;
  createdAt: Date;
}

interface CandidateRegistration {
  enrolmentId: string;
  personId: string;
  studentNumber: string;
  legalFirstName: string;
  legalFamilyName: string;
  moduleRegistrationId: string;
  moduleOfferingId: string;
  academicPeriodId: string;
  registrationStatusCode: string;
}

interface CoveredModuleResult {
  moduleResultId: string;
  moduleRegistrationId: string;
  aggregateMark: number;
  resultCode: string;
}

export class BoardService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
  ) {}

  async createExamBoard(tenantId: string, input: CreateExamBoardInput, actorId: string): Promise<string> {
    await this.#validateBoardType(tenantId, input.boardTypeCode);
    if (input.academicPeriodId) await this.#ensureAcademicPeriod(input.academicPeriodId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(examBoards).values({
        id: randomUUID(),
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        boardTypeCode: input.boardTypeCode,
        academicYear: input.academicYear,
        academicPeriodId: (input.academicPeriodId ?? null) as `${string}-${string}-${string}-${string}-${string}` | null,
        meetingDate: input.meetingDate ?? null,
        ratifiedAt: null,
        actorId,
        createdAt: new Date(),
      }).returning({ id: examBoards.id }),
    );

    return rows[0]!.id;
  }

  async getExamBoard(examBoardId: string, tenantId: string): Promise<ExamBoardDto> {
    const board = await this.#getBoard(examBoardId, tenantId);
    return boardToDto(board);
  }

  async generateDataPack(examBoardId: string, tenantId: string, actorId: string): Promise<string> {
    const board = await this.#getBoard(examBoardId, tenantId);
    const sourceTransactionTime = new Date();
    const previousPack = await this.#getCurrentDataPack(examBoardId, tenantId);
    const packVersion = previousPack ? previousPack.packVersion + 1 : 1;
    const dataPackId = randomUUID();
    const candidates = await this.#buildCandidateProfiles(board, tenantId, sourceTransactionTime);

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(examBoardDataPacks).values({
        id: dataPackId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId: examBoardId as `${string}-${string}-${string}-${string}-${string}`,
        packVersion,
        supersededById: null,
        sourceTransactionTime,
        candidateCount: candidates.length,
        generatedAt: sourceTransactionTime,
        generatedBy: actorId,
      });

      if (previousPack) {
        await tx.update(examBoardDataPacks)
          .set({ supersededById: dataPackId })
          .where(and(
            eq(examBoardDataPacks.id, previousPack.dataPackId as `${string}-${string}-${string}-${string}-${string}`),
            eq(examBoardDataPacks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ));
      }

      if (candidates.length > 0) {
        await tx.insert(examBoardCandidateProfiles).values(candidates.map((candidate) => ({
          id: randomUUID(),
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          dataPackId,
          enrolmentId: candidate.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
          personId: candidate.personId as `${string}-${string}-${string}-${string}-${string}`,
          profileData: candidate.profileData,
          createdAt: sourceTransactionTime,
        })));
      }
    });

    if (this.eventBus.isConnected()) {
      const payload: GovernanceExamBoardDataPackReadyV1Payload = {
        examBoardId,
        dataPackId,
        boardTypeCode: board.boardTypeCode,
        academicYear: board.academicYear,
        candidateCount: candidates.length,
        packVersion,
      };
      await this.eventBus.publish(EVENT_TYPES.GOVERNANCE_EXAM_BOARD_DATA_PACK_READY, '1.0.0', tenantId, actorId, 'standard', payload);
    }

    return dataPackId;
  }

  async getDataPack(examBoardId: string, tenantId: string): Promise<DataPackDto> {
    await this.#getBoard(examBoardId, tenantId);
    const pack = await this.#getCurrentDataPack(examBoardId, tenantId);
    if (!pack) throw new NotFoundError('ExamBoardDataPack', examBoardId);
    return pack;
  }

  async getCandidateProfile(examBoardId: string, enrolmentId: string, tenantId: string): Promise<CandidateProfileDto> {
    const pack = await this.getDataPack(examBoardId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoardCandidateProfiles).where(and(
        eq(examBoardCandidateProfiles.dataPackId, pack.dataPackId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoardCandidateProfiles.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoardCandidateProfiles.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('ExamBoardCandidateProfile', enrolmentId);
    return {
      candidateProfileId: row.id,
      dataPackId: row.dataPackId,
      enrolmentId: row.enrolmentId,
      personId: row.personId,
      profileData: row.profileData as Record<string, unknown>,
      createdAt: row.createdAt,
    };
  }

  async recordMemberAttendance(examBoardId: string, tenantId: string, actorId: string, roleCode: string): Promise<string> {
    await this.#getBoard(examBoardId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(examBoardMemberAttendance).values({
        id: randomUUID(),
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId: examBoardId as `${string}-${string}-${string}-${string}-${string}`,
        actorId,
        roleCode,
        attendedAt: new Date(),
      }).returning({ id: examBoardMemberAttendance.id }),
    );
    return rows[0]!.id;
  }

  async recordExternalExaminerSignoff(examBoardId: string, tenantId: string, actorId: string, commentary?: string): Promise<string> {
    await this.#getBoard(examBoardId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(externalExaminerSignoffs).values({
        id: randomUUID(),
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId: examBoardId as `${string}-${string}-${string}-${string}-${string}`,
        actorId,
        commentary: commentary ?? null,
        signedOffAt: new Date(),
      }).returning({ id: externalExaminerSignoffs.id }),
    );
    return rows[0]!.id;
  }

  async ratifyBoard(examBoardId: string, tenantId: string, actorId: string): Promise<void> {
    const board = await this.#getBoard(examBoardId, tenantId);
    if (board.ratifiedAt) {
      throw new ValidationError('Exam board has already been ratified', [
        { field: 'examBoardId', message: 'Board is already ratified' },
      ]);
    }

    const externalExaminerConfirmedAt = await this.#getLatestExternalExaminerSignoffAt(examBoardId, tenantId);
    if (!externalExaminerConfirmedAt) {
      throw new ValidationError('External examiner sign-off is required before ratification', [
        { field: 'externalExaminerSignoff', message: 'External examiner sign-off is required before ratification' },
      ]);
    }

    const coveredResults = await this.#getCoveredModuleResults(board, tenantId);
    const moduleResultIds = coveredResults.map((result) => result.moduleResultId);
    const moduleRegistrationIds = coveredResults.map((result) => result.moduleRegistrationId);
    const ratifiedAt = new Date();
    let lockedMarkCount = 0;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(examBoards)
        .set({ ratifiedAt })
        .where(and(
          eq(examBoards.id, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
          eq(examBoards.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ));

      if (moduleResultIds.length > 0) {
        await tx.update(moduleResults)
          .set({ locked: true })
          .where(and(
            eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            inArray(moduleResults.id, moduleResultIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
            isNull(moduleResults.recordedUntil),
          ));
      }

      if (moduleRegistrationIds.length > 0) {
        const lockedMarks = await tx.update(marks)
          .set({ locked: true })
          .where(and(
            eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            inArray(marks.moduleRegistrationId, moduleRegistrationIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
            isNull(marks.recordedUntil),
          ))
          .returning({ id: marks.id });
        lockedMarkCount = lockedMarks.length;
      }
    });

    if (!this.eventBus.isConnected()) return;

    const ratifiedPayload: GovernanceExamBoardRatifiedV1Payload = {
      examBoardId,
      boardTypeCode: board.boardTypeCode,
      academicYear: board.academicYear,
      ratifiedAt: ratifiedAt.toISOString(),
      externalExaminerConfirmedAt: externalExaminerConfirmedAt.toISOString(),
    };
    await this.eventBus.publish(
      EVENT_TYPES.GOVERNANCE_EXAM_BOARD_RATIFIED,
      '1.0.0',
      tenantId,
      actorId,
      'standard',
      ratifiedPayload,
    );

    const lockedPayload: GovernanceRecordLockedV1Payload = {
      examBoardId,
      lockedEntityTypes: ['module_result', 'mark'],
      lockedCount: coveredResults.length + lockedMarkCount,
    };
    await this.eventBus.publish(
      EVENT_TYPES.GOVERNANCE_RECORD_LOCKED,
      '1.0.0',
      tenantId,
      actorId,
      'standard',
      lockedPayload,
    );

    for (const result of coveredResults) {
      const payload: AssessmentModuleResultRatifiedV1Payload = {
        moduleResultId: result.moduleResultId,
        moduleRegistrationId: result.moduleRegistrationId,
        aggregateMark: result.aggregateMark,
        resultCode: result.resultCode,
        examBoardId,
        ratifiedAt: ratifiedAt.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ASSESSMENT_MODULE_RESULT_RATIFIED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }
  }

  async #buildCandidateProfiles(
    board: BoardRow,
    tenantId: string,
    sourceTransactionTime: Date,
  ): Promise<Array<{ enrolmentId: string; personId: string; profileData: Record<string, unknown> }>> {
    const registrations = await this.#getBoardRegistrations(board, tenantId);
    const boardContextDate = board.meetingDate ? new Date(`${board.meetingDate}T00:00:00.000Z`) : sourceTransactionTime;
    const byEnrolment = new Map<string, CandidateRegistration[]>();
    for (const registration of registrations) {
      const existing = byEnrolment.get(registration.enrolmentId) ?? [];
      existing.push(registration);
      byEnrolment.set(registration.enrolmentId, existing);
    }

    const profiles: Array<{ enrolmentId: string; personId: string; profileData: Record<string, unknown> }> = [];
    for (const [enrolmentId, rows] of byEnrolment.entries()) {
      const candidate = rows[0]!;
      const registrationIds = rows.map((row) => row.moduleRegistrationId);
      const moduleOfferingIds = rows.map((row) => row.moduleOfferingId);
      const [results, markRows, adjustments, ecs, misconduct] = await Promise.all([
        this.#getModuleResults(registrationIds, tenantId),
        this.#getMarks(registrationIds, tenantId),
        this.#getAdjustmentIndicators(enrolmentId, tenantId, boardContextDate),
        this.#getEcFlags(enrolmentId, moduleOfferingIds, tenantId),
        this.#getMisconductFlags(enrolmentId, tenantId),
      ]);

      profiles.push({
        enrolmentId,
        personId: candidate.personId,
        profileData: {
          board: {
            examBoardId: board.id,
            boardTypeCode: board.boardTypeCode,
            academicYear: board.academicYear,
            academicPeriodId: board.academicPeriodId,
            sourceTransactionTime: sourceTransactionTime.toISOString(),
          },
          candidate: {
            enrolmentId,
            personId: candidate.personId,
            studentNumber: candidate.studentNumber,
            legalFirstName: candidate.legalFirstName,
            legalFamilyName: candidate.legalFamilyName,
          },
          moduleRegistrations: rows.map((row) => ({
            moduleRegistrationId: row.moduleRegistrationId,
            moduleOfferingId: row.moduleOfferingId,
            academicPeriodId: row.academicPeriodId,
            statusCode: row.registrationStatusCode,
            moduleResult: results.find((result) => result.moduleRegistrationId === row.moduleRegistrationId) ?? null,
            marks: markRows.filter((mark) => mark.moduleRegistrationId === row.moduleRegistrationId),
          })),
          adjustments,
          exceptionalCircumstances: ecs,
          misconduct,
          preBoardRecommendation: {
            type: 'not-evaluated',
            reason: 'Classification and progression recommendation is implemented in later Phase 5 stages',
          },
        },
      });
    }

    return profiles;
  }

  async #getBoardRegistrations(board: BoardRow, tenantId: string): Promise<CandidateRegistration[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        enrolmentId: enrolments.id,
        personId: enrolments.personId,
        studentNumber: persons.studentNumber,
        legalFirstName: personIdentities.legalFirstName,
        legalFamilyName: personIdentities.legalFamilyName,
        moduleRegistrationId: moduleRegistrations.id,
        moduleOfferingId: moduleRegistrations.moduleOfferingId,
        academicPeriodId: moduleOfferings.academicPeriodId,
        registrationStatusCode: moduleRegistrations.statusCode,
      })
        .from(moduleRegistrations)
        .innerJoin(enrolments, eq(moduleRegistrations.enrolmentId, enrolments.id))
        .innerJoin(persons, eq(enrolments.personId, persons.id))
        .innerJoin(personIdentities, eq(persons.id, personIdentities.personId))
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .where(and(
          eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(personIdentities.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.academicYear, board.academicYear),
          ...(board.academicPeriodId ? [eq(moduleOfferings.academicPeriodId, board.academicPeriodId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          isNull(moduleRegistrations.recordedUntil),
          isNull(enrolments.recordedUntil),
          isNull(personIdentities.recordedUntil),
        )),
    );
    return rows;
  }

  async #getCoveredModuleResults(board: BoardRow, tenantId: string): Promise<CoveredModuleResult[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        moduleResultId: moduleResults.id,
        moduleRegistrationId: moduleResults.moduleRegistrationId,
        aggregateMark: moduleResults.aggregateMark,
        resultCode: moduleResults.resultCode,
      })
        .from(moduleResults)
        .innerJoin(moduleRegistrations, eq(moduleResults.moduleRegistrationId, moduleRegistrations.id))
        .innerJoin(enrolments, eq(moduleRegistrations.enrolmentId, enrolments.id))
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .where(and(
          eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(enrolments.academicYearOfEntry, board.academicYear),
          ...(board.academicPeriodId ? [eq(moduleOfferings.academicPeriodId, board.academicPeriodId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          isNull(moduleResults.recordedUntil),
          isNull(moduleRegistrations.recordedUntil),
          isNull(enrolments.recordedUntil),
        )),
    );

    return rows.map((row) => ({
      moduleResultId: row.moduleResultId,
      moduleRegistrationId: row.moduleRegistrationId,
      aggregateMark: Number(row.aggregateMark),
      resultCode: row.resultCode,
    }));
  }

  async #getModuleResults(moduleRegistrationIds: string[], tenantId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleResults).where(and(
        eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(moduleResults.recordedUntil),
      )),
    );
    return rows.filter((row) => moduleRegistrationIds.includes(row.moduleRegistrationId)).map((row) => ({
      moduleResultId: row.id,
      moduleRegistrationId: row.moduleRegistrationId,
      aggregateMark: Number(row.aggregateMark),
      resultCode: row.resultCode,
      locked: row.locked,
      calculatedAt: row.calculatedAt.toISOString(),
    }));
  }

  async #getMarks(moduleRegistrationIds: string[], tenantId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        markId: marks.id,
        moduleRegistrationId: marks.moduleRegistrationId,
        assessmentComponentId: marks.assessmentComponentId,
        componentTypeCode: assessmentComponents.componentTypeCode,
        title: assessmentComponents.title,
        rawMark: marks.rawMark,
        adjustedMark: marks.adjustedMark,
        attemptNumber: marks.attemptNumber,
        penaltyApplied: marks.penaltyApplied,
        locked: marks.locked,
      })
        .from(marks)
        .innerJoin(assessmentComponents, eq(marks.assessmentComponentId, assessmentComponents.id))
        .where(and(
          eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(assessmentComponents.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(marks.recordedUntil),
        )),
    );
    return rows.filter((row) => moduleRegistrationIds.includes(row.moduleRegistrationId)).map((row) => ({
      ...row,
      rawMark: Number(row.rawMark),
      adjustedMark: Number(row.adjustedMark),
    }));
  }

  async #getAdjustmentIndicators(enrolmentId: string, tenantId: string, activeAt: Date): Promise<Array<Record<string, unknown>>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        adjustmentId: reasonableAdjustments.id,
        adjustmentTypeCode: reasonableAdjustments.adjustmentTypeCode,
        scopeCode: reasonableAdjustments.scopeCode,
        validFrom: reasonableAdjustments.validFrom,
        validTo: reasonableAdjustments.validTo,
        distributionId: adjustmentDistributions.id,
        targetSystem: adjustmentDistributions.targetSystem,
        statusCode: adjustmentDistributions.statusCode,
      })
        .from(reasonableAdjustments)
        .leftJoin(adjustmentDistributions, and(
          eq(adjustmentDistributions.adjustmentId, reasonableAdjustments.id),
          eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ))
        .where(and(
          eq(reasonableAdjustments.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(reasonableAdjustments.recordedUntil),
        )),
    );
    const byAdjustment = new Map<string, {
      adjustmentId: string;
      adjustmentTypeCode: string;
      scopeCode: string;
      distributionStatuses: Array<Record<string, unknown>>;
    }>();
    for (const row of rows.filter((candidate) => candidate.validFrom <= activeAt && (candidate.validTo === null || candidate.validTo > activeAt))) {
      const existing = byAdjustment.get(row.adjustmentId) ?? {
        adjustmentId: row.adjustmentId,
        adjustmentTypeCode: row.adjustmentTypeCode,
        scopeCode: row.scopeCode,
        distributionStatuses: [],
      };
      if (row.distributionId) {
        existing.distributionStatuses.push({
          distributionId: row.distributionId,
          targetSystem: row.targetSystem,
          statusCode: row.statusCode,
        });
      }
      byAdjustment.set(row.adjustmentId, existing);
    }
    return [...byAdjustment.values()];
  }

  async #getEcFlags(enrolmentId: string, moduleOfferingIds: string[], tenantId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(exceptionalCircumstances).where(and(
        eq(exceptionalCircumstances.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(exceptionalCircumstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(exceptionalCircumstances.recordedUntil),
      )),
    );
    return rows
      .filter((row) => row.moduleOfferingId === null || moduleOfferingIds.includes(row.moduleOfferingId))
      .map((row) => ({
        exceptionalCircumstancesId: row.id,
        moduleOfferingId: row.moduleOfferingId,
        outcomeCode: row.outcomeCode,
        determinationDate: row.determinationDate,
      }));
  }

  async #getMisconductFlags(enrolmentId: string, tenantId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        misconductCaseId: misconductCaseReferences.id,
        misconductOutcomeId: misconductOutcomes.id,
        caseReference: misconductCaseReferences.caseReference,
        caseStatusCode: misconductCaseReferences.caseStatusCode,
        penaltyCode: misconductOutcomes.penaltyCode,
        effectiveDate: misconductOutcomes.effectiveDate,
      })
        .from(misconductOutcomes)
        .innerJoin(misconductCaseReferences, eq(misconductOutcomes.misconductCaseId, misconductCaseReferences.id))
        .where(and(
          eq(misconductOutcomes.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(misconductOutcomes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(misconductCaseReferences.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(misconductOutcomes.recordedUntil),
          isNull(misconductCaseReferences.recordedUntil),
        )),
    );
    const effects = await this.#getMisconductEffects(rows.map((row) => row.misconductOutcomeId), tenantId);
    return rows.map((row) => ({
      ...row,
      penaltyEffects: effects.filter((effect) => effect.misconductOutcomeId === row.misconductOutcomeId),
    }));
  }

  async #getMisconductEffects(outcomeIds: string[], tenantId: string): Promise<Array<Record<string, unknown>>> {
    if (outcomeIds.length === 0) return [];
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(misconductPenaltyEffects).where(and(
        eq(misconductPenaltyEffects.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(misconductPenaltyEffects.recordedUntil),
      )),
    );
    return rows.filter((row) => outcomeIds.includes(row.misconductOutcomeId)).map((row) => ({
      penaltyEffectId: row.id,
      misconductOutcomeId: row.misconductOutcomeId,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      penaltyDetail: row.penaltyDetail,
    }));
  }

  async #getBoard(examBoardId: string, tenantId: string): Promise<BoardRow> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoards).where(and(
        eq(examBoards.id, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoards.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('ExamBoard', examBoardId);
    return rows[0];
  }

  async #getLatestExternalExaminerSignoffAt(examBoardId: string, tenantId: string): Promise<Date | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ signedOffAt: externalExaminerSignoffs.signedOffAt }).from(externalExaminerSignoffs).where(and(
        eq(externalExaminerSignoffs.examBoardId, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
        eq(externalExaminerSignoffs.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )),
    );
    return rows.reduce<Date | null>((latest, row) => {
      if (!latest || row.signedOffAt > latest) return row.signedOffAt;
      return latest;
    }, null);
  }

  async #getCurrentDataPack(examBoardId: string, tenantId: string): Promise<DataPackDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoardDataPacks).where(and(
        eq(examBoardDataPacks.examBoardId, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoardDataPacks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(examBoardDataPacks.supersededById),
      )).limit(1),
    );
    return rows[0] ? dataPackToDto(rows[0]) : null;
  }

  async #ensureAcademicPeriod(academicPeriodId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: academicPeriods.id }).from(academicPeriods).where(and(
        eq(academicPeriods.id, academicPeriodId as `${string}-${string}-${string}-${string}-${string}`),
        eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (rows.length === 0) throw new NotFoundError('AcademicPeriod', academicPeriodId);
  }

  async #validateBoardType(tenantId: string, boardTypeCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue('exam_board', 'board_type_code', boardTypeCode, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${boardTypeCode}' for exam_board.board_type_code`,
        [{ field: 'boardTypeCode', message: 'Value is not active in the configured value set' }],
      );
    }
  }
}

function boardToDto(row: BoardRow): ExamBoardDto {
  return {
    examBoardId: row.id,
    boardTypeCode: row.boardTypeCode,
    academicYear: row.academicYear,
    academicPeriodId: row.academicPeriodId,
    meetingDate: row.meetingDate,
    ratifiedAt: row.ratifiedAt,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

function dataPackToDto(row: typeof examBoardDataPacks.$inferSelect): DataPackDto {
  return {
    dataPackId: row.id,
    examBoardId: row.examBoardId,
    packVersion: row.packVersion,
    supersededById: row.supersededById,
    sourceTransactionTime: row.sourceTransactionTime,
    candidateCount: row.candidateCount,
    generatedAt: row.generatedAt,
    generatedBy: row.generatedBy,
  };
}
