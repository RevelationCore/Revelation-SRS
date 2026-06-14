import { randomUUID } from 'node:crypto';

import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
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
  progressionDecisions,
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

import type { AwardService } from '../progression/award-service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';
import type { ValueSetService } from '../value-sets/service.js';

export interface DeferBoardInput {
  reason?: string;
}

export interface RecordQuorumInput {
  memberCount: number;
}

export interface CreateExamBoardInput {
  boardTypeCode: string;
  academicYear: string;
  academicPeriodId?: string;
  meetingDate?: string;
}

export interface ExamBoardDto {
  examBoardId:      string;
  boardTypeCode:    string;
  academicYear:     string;
  academicPeriodId: string | null;
  meetingDate:      string | null;
  ratifiedAt:       Date | null;
  deferredAt:       Date | null;
  deferralReason:   string | null;
  quorumCount:      number | null;
  quorumRecordedAt: Date | null;
  actorId:          string;
  createdAt:        Date;
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
  id:               string;
  tenantId:         string;
  boardTypeCode:    string;
  academicYear:     string;
  academicPeriodId: string | null;
  meetingDate:      string | null;
  ratifiedAt:       Date | null;
  deferredAt:       Date | null;
  deferralReason:   string | null;
  quorumCount:      number | null;
  quorumRecordedAt: Date | null;
  actorId:          string;
  createdAt:        Date;
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
    private readonly db:             Db,
    private readonly eventBus:       IntegrationBusPublisher,
    private readonly valueSets:      ValueSetService,
    private readonly awardService?:  AwardService,
    private readonly featureFlags?:  FeatureFlagService,
  ) {}

  async createExamBoard(tenantId: string, input: CreateExamBoardInput, actorId: string): Promise<string> {
    await this.#validateBoardType(tenantId, input.boardTypeCode);
    if (input.academicPeriodId) {
      const academicPeriodYear = await this.#ensureAcademicPeriod(input.academicPeriodId, tenantId);
      if (academicPeriodYear !== input.academicYear) {
        throw new ValidationError(
          `Academic period '${input.academicPeriodId}' belongs to '${academicPeriodYear}', not '${input.academicYear}'`,
          [{ field: 'academicPeriodId', message: 'Academic period must belong to the board academic year' }],
        );
      }
    }

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

    if (board.ratifiedAt) {
      throw new ValidationError(
        `Exam board '${examBoardId}' has already been ratified; data packs cannot be regenerated after ratification`,
        [{ field: 'examBoardId', message: 'Board is already ratified' }],
      );
    }

    const sourceTransactionTime = new Date();
    const dataPackId = randomUUID();
    const candidates = await this.#buildCandidateProfiles(board, tenantId, sourceTransactionTime);
    let packVersion = 1;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${examBoardId}:data-pack`}))`);

      const previousRows = await tx.select().from(examBoardDataPacks).where(and(
        eq(examBoardDataPacks.examBoardId, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoardDataPacks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(examBoardDataPacks.supersededById),
      )).limit(1);
      const previousPack = previousRows[0] ? dataPackToDto(previousRows[0]) : null;
      packVersion = previousPack ? previousPack.packVersion + 1 : 1;

      await tx.insert(examBoardDataPacks).values({
        id: dataPackId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId: examBoardId as `${string}-${string}-${string}-${string}-${string}`,
        packVersion,
        supersededById: previousPack
          ? previousPack.dataPackId as `${string}-${string}-${string}-${string}-${string}`
          : null,
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

        await tx.update(examBoardDataPacks)
          .set({ supersededById: null })
          .where(and(
            eq(examBoardDataPacks.id, dataPackId),
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

  /** Returns the candidate profile for a specific data pack. */
  async getCandidateProfileByPack(dataPackId: string, enrolmentId: string, tenantId: string): Promise<CandidateProfileDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoardCandidateProfiles).where(and(
        eq(examBoardCandidateProfiles.dataPackId, dataPackId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoardCandidateProfiles.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoardCandidateProfiles.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('ExamBoardCandidateProfile', enrolmentId);
    return profileRowToDto(row);
  }

  /** Returns the candidate profile from the current (non-superseded) data pack. */
  async getCandidateProfile(examBoardId: string, enrolmentId: string, tenantId: string): Promise<CandidateProfileDto> {
    const pack = await this.getDataPack(examBoardId, tenantId);
    return this.getCandidateProfileByPack(pack.dataPackId, enrolmentId, tenantId);
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

  async deferBoard(examBoardId: string, tenantId: string, actorId: string, input: DeferBoardInput): Promise<void> {
    const deferralEnabled = await this.#evaluateBooleanFlag(tenantId, 'exam-board.deferral.enabled', false);
    if (!deferralEnabled) {
      throw new ValidationError(
        'Board deferral is not enabled for this tenant',
        [{ field: 'examBoardId', message: 'Set exam-board.deferral.enabled flag to on to allow deferrals' }],
      );
    }

    const board = await this.#getBoard(examBoardId, tenantId);
    if (board.ratifiedAt) {
      throw new ValidationError('A ratified board cannot be deferred', [
        { field: 'examBoardId', message: 'Board is already ratified' },
      ]);
    }
    if (board.deferredAt) {
      throw new ValidationError('Board is already deferred', [
        { field: 'examBoardId', message: 'Board has already been deferred; reopen it first' },
      ]);
    }

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(examBoards)
        .set({ deferredAt: new Date(), deferralReason: input.reason ?? null })
        .where(and(
          eq(examBoards.id, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
          eq(examBoards.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ));
    });
  }

  async reopenBoard(examBoardId: string, tenantId: string, actorId: string): Promise<void> {
    const board = await this.#getBoard(examBoardId, tenantId);
    if (board.ratifiedAt) {
      throw new ValidationError('A ratified board cannot be re-opened', [
        { field: 'examBoardId', message: 'Board is already ratified' },
      ]);
    }
    if (!board.deferredAt) {
      throw new ValidationError('Board is not deferred', [
        { field: 'examBoardId', message: 'Only a deferred board can be re-opened' },
      ]);
    }

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(examBoards)
        .set({ deferredAt: null, deferralReason: null })
        .where(and(
          eq(examBoards.id, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
          eq(examBoards.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ));
    });
  }

  async recordQuorum(examBoardId: string, tenantId: string, memberCount: number, actorId: string): Promise<void> {
    const board = await this.#getBoard(examBoardId, tenantId);
    if (board.ratifiedAt) {
      throw new ValidationError('Quorum cannot be recorded on a ratified board', [
        { field: 'examBoardId', message: 'Board is already ratified' },
      ]);
    }
    if (memberCount < 1) {
      throw new ValidationError('Member count must be at least 1', [
        { field: 'memberCount', message: 'Quorum count must be a positive integer' },
      ]);
    }

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(examBoards)
        .set({ quorumCount: memberCount, quorumRecordedAt: new Date() })
        .where(and(
          eq(examBoards.id, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
          eq(examBoards.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ));
    });
  }

  async ratifyBoard(examBoardId: string, tenantId: string, actorId: string): Promise<void> {
    const board = await this.#getBoard(examBoardId, tenantId);
    if (board.ratifiedAt) {
      throw new ValidationError('Exam board has already been ratified', [
        { field: 'examBoardId', message: 'Board is already ratified' },
      ]);
    }

    if (board.deferredAt) {
      throw new ValidationError('A deferred board cannot be ratified; reopen it first', [
        { field: 'examBoardId', message: 'Board is deferred' },
      ]);
    }

    // Always fetch — needed for the event payload regardless of flag state
    const externalExaminerConfirmedAt = await this.#getLatestExternalExaminerSignoffAt(examBoardId, tenantId);

    // Stage 4: external-examiner.required is now flag-controlled (default on for UK statutory compliance)
    const externalExaminerRequired = await this.#evaluateBooleanFlag(
      tenantId, 'exam-board.external-examiner.required', true,
    );
    if (externalExaminerRequired && !externalExaminerConfirmedAt) {
      throw new ValidationError('External examiner sign-off is required before ratification', [
        { field: 'externalExaminerSignoff', message: 'External examiner sign-off is required before ratification' },
      ]);
    }

    // Stage 4: quorum guard — only enforced when flag is on
    const quorumRequired = await this.#evaluateBooleanFlag(tenantId, 'exam-board.quorum.required', false);
    if (quorumRequired && board.quorumCount === null) {
      throw new ValidationError('Quorum must be recorded before ratification', [
        { field: 'quorumCount', message: 'Record a quorum count first (POST /exam-boards/:id/quorum)' },
      ]);
    }

    const coveredResults = await this.#getCoveredModuleResults(board, tenantId);
    const moduleResultIds = coveredResults.map((result) => result.moduleResultId);
    const moduleRegistrationIds = coveredResults.map((result) => result.moduleRegistrationId);
    const coveredProgressionDecisions = await this.#getCoveredProgressionDecisions(board, tenantId);
    const progressionDecisionIds = coveredProgressionDecisions.map((decision) => decision.progressionDecisionId);
    const ratifiedAt = new Date();
    let lockedMarkCount = 0;
    let lockedProgressionCount = 0;

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

      if (progressionDecisionIds.length > 0) {
        const lockedProgression = await tx.update(progressionDecisions)
          .set({
            locked: true,
            examBoardId,
          })
          .where(and(
            eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            inArray(progressionDecisions.id, progressionDecisionIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
            isNull(progressionDecisions.recordedUntil),
          ))
          .returning({ id: progressionDecisions.id });
        lockedProgressionCount = lockedProgression.length;
      }
    });

    if (!this.eventBus.isConnected()) return;

    const ratifiedPayload: GovernanceExamBoardRatifiedV1Payload = {
      examBoardId,
      boardTypeCode: board.boardTypeCode,
      academicYear: board.academicYear,
      ratifiedAt: ratifiedAt.toISOString(),
      externalExaminerConfirmedAt: externalExaminerConfirmedAt?.toISOString() ?? '',
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
      lockedEntityTypes: progressionDecisionIds.length > 0
        ? ['module_result', 'mark', 'progression_decision']
        : ['module_result', 'mark'],
      lockedCount: coveredResults.length + lockedMarkCount + lockedProgressionCount,
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

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #buildCandidateProfiles(
    board: BoardRow,
    tenantId: string,
    sourceTransactionTime: Date,
  ): Promise<Array<{ enrolmentId: string; personId: string; profileData: Record<string, unknown> }>> {
    const registrations = await this.#getBoardRegistrations(board, tenantId, sourceTransactionTime);
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
      const [results, markRows, adjustments, ecs, misconduct, recommendation] = await Promise.all([
        this.#getModuleResults(registrationIds, tenantId, sourceTransactionTime),
        this.#getMarks(registrationIds, tenantId, sourceTransactionTime),
        this.#getAdjustmentIndicators(enrolmentId, tenantId, boardContextDate, sourceTransactionTime),
        this.#getEcFlags(enrolmentId, moduleOfferingIds, tenantId, sourceTransactionTime),
        this.#getMisconductFlags(enrolmentId, tenantId, sourceTransactionTime),
        this.#getClassificationRecommendation(enrolmentId, tenantId),
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
          preBoardRecommendation: recommendation,
        },
      });
    }

    return profiles;
  }

  async #getClassificationRecommendation(enrolmentId: string, tenantId: string): Promise<Record<string, unknown>> {
    if (!this.awardService) {
      return { type: 'not-available', reason: 'Classification service not configured' };
    }
    try {
      const rec = await this.awardService.calculateClassification(enrolmentId, tenantId);
      return {
        type:               'calculated',
        aggregateMark:      rec.aggregateMark,
        classificationCode: rec.classificationCode,
        algorithm:          rec.algorithm,
        boundariesApplied:  rec.boundariesApplied,
        note:               'Pre-board recommendation only — not ratified',
      };
    } catch {
      return { type: 'not-evaluated', reason: 'Insufficient data to calculate recommendation' };
    }
  }

  async #getBoardRegistrations(board: BoardRow, tenantId: string, asOf?: Date): Promise<CandidateRegistration[]> {
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
          eq(enrolments.statusCode, 'enrolled'),
          inArray(moduleRegistrations.statusCode, ['registered', 'completed']),
          this.#currentAt(moduleRegistrations.recordedAt, moduleRegistrations.recordedUntil, asOf),
          this.#currentAt(enrolments.recordedAt, enrolments.recordedUntil, asOf),
          this.#currentAt(personIdentities.recordedAt, personIdentities.recordedUntil, asOf),
        )),
    );
    return rows;
  }

  /**
   * Returns the module results covered by this board for ratification locking.
   *
   * Scopes by the academic period's academic year (matching the board's year) rather
   * than enrolments.academicYearOfEntry, so returning students whose modules fall
   * in the board's year are correctly included regardless of their enrollment year.
   */
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
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .where(and(
          eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.academicYear, board.academicYear),
          ...(board.academicPeriodId ? [eq(moduleOfferings.academicPeriodId, board.academicPeriodId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          isNull(moduleResults.recordedUntil),
          isNull(moduleRegistrations.recordedUntil),
        )),
    );

    return rows.map((row) => ({
      moduleResultId: row.moduleResultId,
      moduleRegistrationId: row.moduleRegistrationId,
      aggregateMark: Number(row.aggregateMark),
      resultCode: row.resultCode,
    }));
  }

  async #getCoveredProgressionDecisions(board: BoardRow, tenantId: string): Promise<Array<{ progressionDecisionId: string }>> {
    const registrations = await this.#getBoardRegistrations(board, tenantId);
    const enrolmentIds = [...new Set(registrations.map((registration) => registration.enrolmentId))];
    if (enrolmentIds.length === 0) return [];

    return withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ progressionDecisionId: progressionDecisions.id }).from(progressionDecisions).where(and(
        eq(progressionDecisions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        eq(progressionDecisions.academicYear, board.academicYear),
        inArray(progressionDecisions.enrolmentId, enrolmentIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
        isNull(progressionDecisions.recordedUntil),
      )),
    );
  }

  async #getModuleResults(moduleRegistrationIds: string[], tenantId: string, asOf?: Date): Promise<Array<Record<string, unknown>>> {
    if (moduleRegistrationIds.length === 0) return [];
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleResults).where(and(
        eq(moduleResults.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        inArray(moduleResults.moduleRegistrationId, moduleRegistrationIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
        this.#currentAt(moduleResults.recordedAt, moduleResults.recordedUntil, asOf),
      )),
    );
    return rows.map((row) => ({
      moduleResultId: row.id,
      moduleRegistrationId: row.moduleRegistrationId,
      aggregateMark: Number(row.aggregateMark),
      resultCode: row.resultCode,
      locked: row.locked,
      calculatedAt: row.calculatedAt.toISOString(),
    }));
  }

  async #getMarks(moduleRegistrationIds: string[], tenantId: string, asOf?: Date): Promise<Array<Record<string, unknown>>> {
    if (moduleRegistrationIds.length === 0) return [];
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
          inArray(marks.moduleRegistrationId, moduleRegistrationIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
          this.#currentAt(marks.recordedAt, marks.recordedUntil, asOf),
        )),
    );
    return rows.map((row) => ({
      ...row,
      rawMark: Number(row.rawMark),
      adjustedMark: Number(row.adjustedMark),
    }));
  }

  async #getAdjustmentIndicators(enrolmentId: string, tenantId: string, activeAt: Date, asOf?: Date): Promise<Array<Record<string, unknown>>> {
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
          this.#currentAt(reasonableAdjustments.recordedAt, reasonableAdjustments.recordedUntil, asOf),
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

  async #getEcFlags(enrolmentId: string, moduleOfferingIds: string[], tenantId: string, asOf?: Date): Promise<Array<Record<string, unknown>>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(exceptionalCircumstances).where(and(
        eq(exceptionalCircumstances.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(exceptionalCircumstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        this.#currentAt(exceptionalCircumstances.recordedAt, exceptionalCircumstances.recordedUntil, asOf),
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

  async #getMisconductFlags(enrolmentId: string, tenantId: string, asOf?: Date): Promise<Array<Record<string, unknown>>> {
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
          this.#currentAt(misconductOutcomes.recordedAt, misconductOutcomes.recordedUntil, asOf),
          this.#currentAt(misconductCaseReferences.recordedAt, misconductCaseReferences.recordedUntil, asOf),
        )),
    );
    const effects = await this.#getMisconductEffects(rows.map((row) => row.misconductOutcomeId), tenantId, asOf);
    return rows.map((row) => ({
      ...row,
      penaltyEffects: effects.filter((effect) => effect.misconductOutcomeId === row.misconductOutcomeId),
    }));
  }

  async #getMisconductEffects(outcomeIds: string[], tenantId: string, asOf?: Date): Promise<Array<Record<string, unknown>>> {
    if (outcomeIds.length === 0) return [];
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(misconductPenaltyEffects).where(and(
        eq(misconductPenaltyEffects.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        inArray(misconductPenaltyEffects.misconductOutcomeId, outcomeIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
        this.#currentAt(misconductPenaltyEffects.recordedAt, misconductPenaltyEffects.recordedUntil, asOf),
      )),
    );
    return rows.map((row) => ({
      penaltyEffectId: row.id,
      misconductOutcomeId: row.misconductOutcomeId,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      penaltyDetail: row.penaltyDetail,
    }));
  }

  #currentAt(recordedAt: unknown, recordedUntil: unknown, asOf?: Date) {
    if (!asOf) return isNull(recordedUntil as never);
    return and(
      lte(recordedAt as never, asOf),
      or(isNull(recordedUntil as never), gt(recordedUntil as never, asOf)),
    );
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

  async #ensureAcademicPeriod(academicPeriodId: string, tenantId: string): Promise<string> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ academicYear: academicPeriods.academicYear }).from(academicPeriods).where(and(
        eq(academicPeriods.id, academicPeriodId as `${string}-${string}-${string}-${string}-${string}`),
        eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (rows.length === 0) throw new NotFoundError('AcademicPeriod', academicPeriodId);
    return rows[0]!.academicYear;
  }

  async #evaluateBooleanFlag(tenantId: string, flagKey: string, fallback: boolean): Promise<boolean> {
    if (!this.featureFlags) return fallback;
    try {
      const flag = await this.featureFlags.getFlagByKey(flagKey);
      if (!flag) return fallback;
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, { tenantId });
      return result.value === true || result.variantKey === 'on';
    } catch {
      return fallback;
    }
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
    examBoardId:      row.id,
    boardTypeCode:    row.boardTypeCode,
    academicYear:     row.academicYear,
    academicPeriodId: row.academicPeriodId,
    meetingDate:      row.meetingDate,
    ratifiedAt:       row.ratifiedAt,
    deferredAt:       row.deferredAt,
    deferralReason:   row.deferralReason,
    quorumCount:      row.quorumCount,
    quorumRecordedAt: row.quorumRecordedAt,
    actorId:          row.actorId,
    createdAt:        row.createdAt,
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

function profileRowToDto(row: typeof examBoardCandidateProfiles.$inferSelect): CandidateProfileDto {
  return {
    candidateProfileId: row.id,
    dataPackId: row.dataPackId,
    enrolmentId: row.enrolmentId,
    personId: row.personId,
    profileData: row.profileData as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}
