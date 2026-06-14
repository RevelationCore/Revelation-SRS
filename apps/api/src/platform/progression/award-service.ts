import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  academicPeriods,
  awards,
  enrolments,
  examBoards,
  moduleOfferings,
  moduleRegistrations,
  moduleResults,
  modules,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES, NotFoundError, ValidationError, RuleNotConfiguredError } from '@revelation-srs/domain';
import type { AwardConferredV1Payload } from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { EnrolmentService } from '../enrolment/service.js';
import type { RulesEngine } from '../rules-engine/engine.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ClassificationRecommendation {
  enrolmentId:        string;
  aggregateMark:      number;
  classificationCode: string;
  algorithm:          string;
  boundariesApplied:  Array<{ code: string; minimumMark: number }>;
}

export interface AwardDto {
  awardId:             string;
  enrolmentId:         string;
  personId:            string;
  examBoardId:         string;
  qualificationCode:   string;
  classificationCode:  string;
  awardDate:           string;
  hearGeneratedAt:     Date | null;
  certificateIssuedAt: Date | null;
  validFrom:           Date;
  validTo:             Date | null;
  recordedAt:          Date;
  recordedUntil:       Date | null;
}

export interface ConferAwardInput {
  examBoardId:        string;
  qualificationCode:  string;
  classificationCode: string;
  awardDate:          string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class AwardService {
  constructor(
    private readonly db:             Db,
    private readonly eventBus:       IntegrationBusPublisher,
    private readonly rules:          RulesEngine,
    private readonly enrolmentService: EnrolmentService,
  ) {}

  /**
   * Calculates a degree classification recommendation for an enrolment.
   *
   * Fetches all ratified (locked) module results across all academic years,
   * computes a weighted aggregate using the configured classification-algorithm,
   * and maps the result to a classification band using classification-boundary.
   *
   * Returns a recommendation only — the award is not recorded until conferAward is called.
   */
  async calculateClassification(
    enrolmentId: string,
    tenantId: string,
  ): Promise<ClassificationRecommendation> {
    const enrolment = await this.#getEnrolment(enrolmentId, tenantId);
    const outcomes = await this.#getRatifiedOutcomes(enrolmentId, tenantId);

    const ctx = { tenantId, programmeId: enrolment.programmeId ?? '' };
    const algorithm = await this.#getAlgorithm(ctx);
    const boundaries = await this.#getBoundaries(ctx);

    const aggregateMark = this.#applyAlgorithm(algorithm, outcomes);
    const classificationCode = this.#classify(aggregateMark, boundaries);

    return {
      enrolmentId,
      aggregateMark,
      classificationCode,
      algorithm,
      boundariesApplied: boundaries,
    };
  }

  /**
   * Formally confers an award on the enrolment.
   *
   * Creates a bitemporal award record, sets hear_generated_at as a stub,
   * and calls EnrolmentService.transitionStatus to graduate the enrolment
   * through the standard path (preserving transition ledger and person status cascade).
   */
  async conferAward(
    enrolmentId: string,
    tenantId: string,
    input: ConferAwardInput,
    actorId: string,
  ): Promise<string> {
    const enrolment = await this.#getEnrolment(enrolmentId, tenantId);
    await this.#ensureRatifiedBoardCoversEnrolment(input.examBoardId, enrolmentId, tenantId);
    const recommendation = await this.calculateClassification(enrolmentId, tenantId);
    if (recommendation.classificationCode !== input.classificationCode) {
      throw new ValidationError(
        `Requested classification '${input.classificationCode}' does not match calculated recommendation '${recommendation.classificationCode}'`,
        [{ field: 'classificationCode', message: 'Classification must match the current calculated recommendation' }],
      );
    }

    const existing = await this.#getCurrentAward(enrolmentId, tenantId);
    if (existing) {
      throw new ValidationError(`Enrolment '${enrolmentId}' already has a conferred award`);
    }

    const now   = new Date();
    const awardId = randomUUID();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(awards).values({
        versionId:           randomUUID(),
        id:                  awardId,
        tenantId:            tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:         enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId:            enrolment.personId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId:         input.examBoardId as `${string}-${string}-${string}-${string}-${string}`,
        qualificationCode:   input.qualificationCode,
        classificationCode:  input.classificationCode,
        awardDate:           input.awardDate,
        hearGeneratedAt:     now,  // stub — full HEAR document generated in Stage 10
        certificateIssuedAt: null,
        hearDocument:        null,
        actorId,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });
    });

    await this.#writeAwardEvidence(tenantId, awardId, recommendation);

    // Graduate the enrolment via the standard transition path to preserve
    // the transition ledger and person status cascade (→ alumnus).
    if (enrolment.statusCode !== 'graduated') {
      await this.enrolmentService.transitionStatus(enrolmentId, tenantId, 'graduated', now, actorId, {});
    }

    if (this.eventBus.isConnected()) {
      const payload: AwardConferredV1Payload = {
        awardId,
        enrolmentId,
        personId:           enrolment.personId,
        examBoardId:        input.examBoardId,
        qualificationCode:  input.qualificationCode,
        classificationCode: input.classificationCode,
        awardDate:          input.awardDate,
      };
      await this.eventBus.publish(
        EVENT_TYPES.AWARD_CONFERRED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }

    return awardId;
  }

  async getCurrentAward(enrolmentId: string, tenantId: string): Promise<AwardDto> {
    await this.#getEnrolment(enrolmentId, tenantId);
    const award = await this.#getCurrentAward(enrolmentId, tenantId);
    if (!award) throw new NotFoundError('Award', enrolmentId);
    return award;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #getEnrolment(enrolmentId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        enrolmentId:  enrolments.id,
        personId:     enrolments.personId,
        programmeId:  enrolments.programmeId,
        statusCode:   enrolments.statusCode,
      }).from(enrolments).where(and(
        eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', enrolmentId);
    return {
      personId:    rows[0].personId,
      programmeId: rows[0].programmeId,
      statusCode:  rows[0].statusCode,
    };
  }

  async #getRatifiedOutcomes(enrolmentId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        aggregateMark: moduleResults.aggregateMark,
        resultCode:    moduleResults.resultCode,
        creditValue:   modules.creditValue,
      })
        .from(moduleResults)
        .innerJoin(moduleRegistrations, eq(moduleResults.moduleRegistrationId, moduleRegistrations.id))
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(modules, eq(moduleOfferings.moduleId, modules.id))
        .where(and(
          eq(moduleResults.tenantId,            tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId,      tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.enrolmentId,   enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId,          tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(modules.tenantId,                  tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleResults.locked,              true),
          isNull(moduleResults.recordedUntil),
          isNull(moduleRegistrations.recordedUntil),
          isNull(modules.recordedUntil),
        )),
    );
    return rows.map((row) => ({
      aggregateMark: Number(row.aggregateMark),
      resultCode:    row.resultCode,
      creditValue:   row.creditValue ?? 0,
    }));
  }

  async #ensureRatifiedBoardCoversEnrolment(examBoardId: string, enrolmentId: string, tenantId: string): Promise<void> {
    const boardRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(examBoards).where(and(
        eq(examBoards.id, examBoardId as `${string}-${string}-${string}-${string}-${string}`),
        eq(examBoards.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    const board = boardRows[0];
    if (!board) throw new NotFoundError('ExamBoard', examBoardId);
    if (!board.ratifiedAt) {
      throw new ValidationError(
        `Exam board '${examBoardId}' must be ratified before conferring an award`,
        [{ field: 'examBoardId', message: 'Board is not ratified' }],
      );
    }

    const coveredRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: moduleRegistrations.id })
        .from(moduleRegistrations)
        .innerJoin(moduleOfferings, eq(moduleRegistrations.moduleOfferingId, moduleOfferings.id))
        .innerJoin(academicPeriods, eq(moduleOfferings.academicPeriodId, academicPeriods.id))
        .where(and(
          eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(academicPeriods.academicYear, board.academicYear),
          ...(board.academicPeriodId ? [eq(moduleOfferings.academicPeriodId, board.academicPeriodId)] : []),
          isNull(moduleRegistrations.recordedUntil),
        ))
        .limit(1),
    );
    if (coveredRows.length === 0) {
      throw new ValidationError(
        `Exam board '${examBoardId}' does not cover enrolment '${enrolmentId}'`,
        [{ field: 'examBoardId', message: 'Board does not cover this enrolment' }],
      );
    }
  }

  async #getCurrentAward(enrolmentId: string, tenantId: string): Promise<AwardDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(awards).where(and(
        eq(awards.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(awards.tenantId,    tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(awards.recordedUntil),
      )).limit(1),
    );
    return rows[0] ? awardToDto(rows[0]) : null;
  }

  async #getAlgorithm(ctx: { tenantId: string; programmeId: string }): Promise<string> {
    try {
      const rule = await this.rules.getRule<{ algorithm: string }>(ctx, 'classification-algorithm', 'undergraduate');
      return rule.algorithm ?? 'weighted-average';
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) return 'weighted-average';
      throw err;
    }
  }

  async #getBoundaries(ctx: { tenantId: string; programmeId: string }): Promise<Array<{ code: string; minimumMark: number }>> {
    try {
      return await this.rules.getClassificationBoundaries(ctx);
    } catch (err) {
      if (err instanceof RuleNotConfiguredError) {
        // Sensible UK HE defaults
        return [
          { code: 'first',        minimumMark: 70 },
          { code: 'upper-second', minimumMark: 60 },
          { code: 'lower-second', minimumMark: 50 },
          { code: 'third',        minimumMark: 40 },
        ];
      }
      throw err;
    }
  }

  #applyAlgorithm(
    algorithm: string,
    outcomes: Array<{ aggregateMark: number; resultCode: string; creditValue: number }>,
  ): number {
    const countable = outcomes.filter((o) => ['pass', 'compensated', 'condoned', 'fail'].includes(o.resultCode));
    if (countable.length === 0) return 0;

    if (algorithm === 'best-of-two-years') {
      // Sort descending by mark; take top 50% of credit volume
      const totalCredits = countable.reduce((s, o) => s + o.creditValue, 0);
      const halfCredits = totalCredits / 2;
      const sorted = [...countable].sort((a, b) => b.aggregateMark - a.aggregateMark);
      let accumulated = 0;
      let weightedSum = 0;
      for (const o of sorted) {
        const take = Math.min(o.creditValue, halfCredits - accumulated);
        if (take <= 0) break;
        weightedSum  += o.aggregateMark * take;
        accumulated  += take;
      }
      return accumulated > 0 ? weightedSum / accumulated : 0;
    }

    // Default: weighted average by credit value
    const totalCredits  = countable.reduce((s, o) => s + o.creditValue, 0);
    const weightedTotal = countable.reduce((s, o) => s + o.aggregateMark * o.creditValue, 0);
    return totalCredits > 0 ? weightedTotal / totalCredits : 0;
  }

  #classify(
    aggregateMark: number,
    boundaries: Array<{ code: string; minimumMark: number }>,
  ): string {
    const sorted = [...boundaries].sort((a, b) => b.minimumMark - a.minimumMark);
    for (const boundary of sorted) {
      if (aggregateMark >= boundary.minimumMark) return boundary.code;
    }
    return 'fail';
  }

  async #writeAwardEvidence(
    tenantId: string,
    awardId: string,
    recommendation: ClassificationRecommendation,
  ): Promise<void> {
    try {
      const boundariesJson = JSON.stringify(recommendation.boundariesApplied);
      await this.db.execute(sql`
        INSERT INTO award_calculation_evidence (
          tenant_id, award_id, algorithm,
          aggregate_mark, classification_code,
          boundaries_applied, outcome_count, total_credit_value,
          rule_snapshot
        ) VALUES (
          ${tenantId}::uuid, ${awardId}::uuid, ${recommendation.algorithm},
          ${recommendation.aggregateMark}, ${recommendation.classificationCode},
          ${boundariesJson}::jsonb, 0, 0,
          '{}'::jsonb
        )
      `);
    } catch {
      // Evidence write failure must not block the award itself
    }
  }
}

// ── Wire helper ───────────────────────────────────────────────────────────────

function awardToDto(row: typeof awards.$inferSelect): AwardDto {
  return {
    awardId:             row.id,
    enrolmentId:         row.enrolmentId,
    personId:            row.personId,
    examBoardId:         row.examBoardId,
    qualificationCode:   row.qualificationCode,
    classificationCode:  row.classificationCode,
    awardDate:           row.awardDate,
    hearGeneratedAt:     row.hearGeneratedAt,
    certificateIssuedAt: row.certificateIssuedAt,
    validFrom:           row.validFrom,
    validTo:             row.validTo,
    recordedAt:          row.recordedAt,
    recordedUntil:       row.recordedUntil,
  };
}
