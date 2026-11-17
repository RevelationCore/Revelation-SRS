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
import { EVENT_TYPES, NotFoundError, ValidationError } from '@revelation-srs/domain';
import type { AwardConferredV1Payload } from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { EnrolmentService } from '../enrolment/service.js';
import { approvedCreditFor } from '../curriculum/academic-exception-service.js';
import { RuleTrace, type RuleVersionCitation, type RulesEngine } from '../rules-engine/engine.js';
import { clockNow } from '../clock.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ClassificationRecommendation {
  enrolmentId:        string;
  aggregateMark:      number;
  classificationCode: string;
  algorithm:          string;
  boundariesApplied:  Array<{ code: string; minimumMark: number }>;
  outcomeCount:       number;
  totalCreditValue:   number;
  /** Credit passed, compensated or condoned, plus approved recognised credit. */
  earnedCredits:      number;
  recognisedCredits:  number;
  /** award-credit-requirement for the qualification, or null when unconfigured. */
  requiredCredits:    number | null;
  /** The mark sits within classification-discretion-zone below the next boundary up. */
  inDiscretionZone:   boolean;
  discretionZone:     { widthPercent: number; nextBoundaryCode: string; nextBoundaryMark: number } | null;
  /** Every rule the calculation used (D-35). */
  ruleVersions:       RuleVersionCitation[];
}

export interface AwardDto {
  awardId:             string;
  enrolmentId:         string;
  personId:            string;
  examBoardId:         string | null;
  sourceCaseId:        string | null;
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

export interface ConferResearchAwardInput {
  qualificationCode: string;
  awardDate:         string;
  sourceCaseId:      string;
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
   * Returns a recommendation only — the award is recorded when a recommendation is conferred (ConfermentService).
   */
  async calculateClassification(
    enrolmentId: string,
    tenantId: string,
    qualificationCode?: string,
  ): Promise<ClassificationRecommendation> {
    const enrolment = await this.#getEnrolment(enrolmentId, tenantId);
    const outcomes = await this.#getRatifiedOutcomes(enrolmentId, tenantId);

    const trace = new RuleTrace();
    const ctx = { tenantId, programmeId: enrolment.programmeId ?? '' };
    const algorithm = await this.#getAlgorithm(ctx, trace);
    const boundaries = await this.#getBoundaries(ctx, trace);

    const aggregateMark = this.#applyAlgorithm(algorithm, outcomes);
    const classificationCode = this.#classify(aggregateMark, boundaries);

    const recognised = (await approvedCreditFor(this.db, tenantId, enrolmentId)).reduce((sum, c) => sum + c.creditValue, 0);
    const earnedCredits = outcomes.filter((o) => ['pass', 'compensated', 'condoned'].includes(o.resultCode)).reduce((sum, o) => sum + o.creditValue, 0) + recognised;
    const creditRule = await this.rules.getOptionalRule<Record<string, unknown>>(
      ctx, 'award-credit-requirement', [...(qualificationCode ? [qualificationCode] : []), 'default'], trace,
    );
    const requiredCredits = creditRule ? Number(creditRule['requiredCredits'] ?? creditRule['credits'] ?? 0) : null;

    // The discretion zone: within widthPercent marks below the next boundary up (D-35).
    const zoneRule = await this.rules.getOptionalRule<Record<string, unknown>>(ctx, 'classification-discretion-zone', ['undergraduate', 'default'], trace);
    const width = zoneRule ? Number(zoneRule['widthPercent'] ?? zoneRule['width'] ?? 0) : 0;
    const next = [...boundaries].sort((a, b) => a.minimumMark - b.minimumMark).find((b) => b.minimumMark > aggregateMark) ?? null;
    const discretionZone = zoneRule && next ? { widthPercent: width, nextBoundaryCode: next.code, nextBoundaryMark: next.minimumMark } : null;

    return {
      enrolmentId,
      aggregateMark,
      classificationCode,
      algorithm,
      boundariesApplied: boundaries,
      outcomeCount: outcomes.length,
      totalCreditValue: outcomes.reduce((sum, o) => sum + o.creditValue, 0),
      earnedCredits,
      recognisedCredits: recognised,
      requiredCredits,
      inDiscretionZone: discretionZone !== null && next !== null && next.minimumMark - aggregateMark <= width,
      discretionZone,
      ruleVersions: trace.entries,
    };
  }

  /**
   * Writes a recommendation's classification evidence in the caller's
   * transaction (D-35), so the evidence and the recommendation stand or
   * fall together. The award is linked at conferment.
   */
  async writeClassificationEvidence(tx: Pick<Db, 'execute'>, tenantId: string, recommendationId: string, c: ClassificationRecommendation): Promise<void> {
    await tx.execute(sql`
      INSERT INTO award_calculation_evidence (
        tenant_id, award_id, award_recommendation_id, algorithm,
        aggregate_mark, classification_code,
        boundaries_applied, outcome_count, total_credit_value,
        rule_snapshot, rule_versions
      ) VALUES (
        ${tenantId}::uuid, NULL, ${recommendationId}::uuid, ${c.algorithm},
        ${c.aggregateMark}, ${c.classificationCode},
        ${JSON.stringify(c.boundariesApplied)}::jsonb, ${c.outcomeCount}, ${c.totalCreditValue},
        ${JSON.stringify({
          earnedCredits: c.earnedCredits, recognisedCredits: c.recognisedCredits, requiredCredits: c.requiredCredits,
          inDiscretionZone: c.inDiscretionZone, discretionZone: c.discretionZone,
        })}::jsonb, ${JSON.stringify(c.ruleVersions)}::jsonb
      )
    `);
  }

  /** The evidence a recommendation was made on, if any. */
  async getRecommendationEvidence(tenantId: string, recommendationId: string): Promise<(ClassificationRecommendation & { awardId: string | null; calculatedAt: Date }) | null> {
    const rows = (await withTenantContext(this.db, tenantId, (tx) => tx.execute(sql`
      SELECT award_id, algorithm, aggregate_mark::float AS aggregate_mark, classification_code, boundaries_applied,
             outcome_count, total_credit_value::float AS total_credit_value, rule_snapshot, rule_versions, calculated_at
      FROM award_calculation_evidence
      WHERE tenant_id = ${tenantId}::uuid AND award_recommendation_id = ${recommendationId}::uuid
      ORDER BY calculated_at DESC LIMIT 1
    `))) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    const snap = (row['rule_snapshot'] ?? {}) as Partial<ClassificationRecommendation>;
    return {
      enrolmentId: '',
      awardId: (row['award_id'] as string | null) ?? null,
      aggregateMark: row['aggregate_mark'] as number,
      classificationCode: row['classification_code'] as string,
      algorithm: row['algorithm'] as string,
      boundariesApplied: row['boundaries_applied'] as Array<{ code: string; minimumMark: number }>,
      outcomeCount: Number(row['outcome_count']),
      totalCreditValue: row['total_credit_value'] as number,
      earnedCredits: snap.earnedCredits ?? 0,
      recognisedCredits: snap.recognisedCredits ?? 0,
      requiredCredits: snap.requiredCredits ?? null,
      inDiscretionZone: snap.inDiscretionZone ?? false,
      discretionZone: snap.discretionZone ?? null,
      ruleVersions: (row['rule_versions'] ?? []) as RuleVersionCitation[],
      calculatedAt: new Date(row['calculated_at'] as string),
    };
  }

  /**
   * Records an award conferred from a board recommendation (BPR-D14).
   * The recommendation and conferment are recorded by the caller; this
   * writes the award, graduates the enrolment and publishes the event.
   * Safe to repeat: an award already recorded with the same ID is returned.
   */
  async recordConferredAward(
    enrolmentId: string,
    tenantId: string,
    input: Omit<ConferAwardInput, 'examBoardId'> & { examBoardId: string | null; awardId: string },
    actorId: string,
    /** The recommendation whose classification evidence the award is linked to. */
    evidenceRecommendationId: string | null,
  ): Promise<string> {
    const existing = await this.#getCurrentAward(enrolmentId, tenantId);
    if (existing?.awardId === input.awardId) return input.awardId;
    if (existing) throw new ValidationError(`Enrolment '${enrolmentId}' already has a conferred award`);
    const enrolment = await this.#getEnrolment(enrolmentId, tenantId);
    return this.#recordAward(enrolmentId, enrolment, tenantId, input, actorId, evidenceRecommendationId, input.awardId);
  }

  /** Throws unless the exam board is ratified and covers the enrolment. */
  async assertRatifiedBoardCoversEnrolment(examBoardId: string, enrolmentId: string, tenantId: string): Promise<void> {
    await this.#ensureRatifiedBoardCoversEnrolment(examBoardId, enrolmentId, tenantId);
  }

  async #recordAward(
    enrolmentId: string,
    enrolment: { personId: string; statusCode: string },
    tenantId: string,
    input: Omit<ConferAwardInput, 'examBoardId'> & { examBoardId: string | null },
    actorId: string,
    evidenceRecommendationId: string | null,
    requestedAwardId?: string,
  ): Promise<string> {
    const now   = clockNow();
    const awardId = requestedAwardId ?? randomUUID();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(awards).values({
        versionId:           randomUUID(),
        id:                  awardId,
        tenantId:            tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:         enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId:            enrolment.personId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId:         (input.examBoardId ?? null) as `${string}-${string}-${string}-${string}-${string}` | null,
        sourceCaseId:        null,
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
      if (evidenceRecommendationId) {
        await tx.execute(sql`UPDATE award_calculation_evidence SET award_id = ${awardId}::uuid
          WHERE tenant_id = ${tenantId}::uuid AND award_recommendation_id = ${evidenceRecommendationId}::uuid`);
      }
    });

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
        examBoardId:        input.examBoardId ?? '',
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

  /**
   * Confers a research (PGR) award. Additive to conferAward, not a
   * modification of it — research degrees are pass/fail, not classified,
   * and have no exam board; the authorising evidence is a PGR completion
   * case (BP-06-006) instead. Still drives the same graduation cascade and
   * guards against double-conferral.
   */
  async conferResearchAward(
    enrolmentId: string,
    tenantId: string,
    input: ConferResearchAwardInput,
    actorId: string,
  ): Promise<string> {
    const enrolment = await this.#getEnrolment(enrolmentId, tenantId);

    const existing = await this.#getCurrentAward(enrolmentId, tenantId);
    if (existing) {
      throw new ValidationError(`Enrolment '${enrolmentId}' already has a conferred award`);
    }

    const now     = clockNow();
    const awardId = randomUUID();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(awards).values({
        versionId:           randomUUID(),
        id:                  awardId,
        tenantId:            tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:         enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId:            enrolment.personId as `${string}-${string}-${string}-${string}-${string}`,
        examBoardId:         null,
        sourceCaseId:        input.sourceCaseId as `${string}-${string}-${string}-${string}-${string}`,
        qualificationCode:   input.qualificationCode,
        classificationCode:  'pass',
        awardDate:           input.awardDate,
        hearGeneratedAt:     null, // research awards do not generate a HEAR document
        certificateIssuedAt: null,
        hearDocument:        null,
        actorId,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });
    });

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
        sourceCaseId:       input.sourceCaseId,
        qualificationCode:  input.qualificationCode,
        classificationCode: 'pass',
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

  async #getAlgorithm(ctx: { tenantId: string; programmeId: string }, trace: RuleTrace): Promise<string> {
    const rule = await this.rules.getRuleOrDefault<{ algorithm?: string }>(ctx, 'classification-algorithm', 'undergraduate', { algorithm: 'weighted-average' }, trace);
    return rule.algorithm ?? 'weighted-average';
  }

  async #getBoundaries(ctx: { tenantId: string; programmeId: string }, trace: RuleTrace): Promise<Array<{ code: string; minimumMark: number }>> {
    // Unconfigured: the usual UK HE boundaries, recorded as built-in defaults (D-35).
    const rule = await this.rules.getRuleOrDefault<{ boundaries: Array<{ code: string; minimumMark: number }> }>(ctx, 'classification-boundary', 'undergraduate', {
      boundaries: [
        { code: 'first',        minimumMark: 70 },
        { code: 'upper-second', minimumMark: 60 },
        { code: 'lower-second', minimumMark: 50 },
        { code: 'third',        minimumMark: 40 },
      ],
    }, trace);
    return rule.boundaries;
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

}

// ── Wire helper ───────────────────────────────────────────────────────────────

function awardToDto(row: typeof awards.$inferSelect): AwardDto {
  return {
    awardId:             row.id,
    enrolmentId:         row.enrolmentId,
    personId:            row.personId,
    examBoardId:         row.examBoardId,
    sourceCaseId:        row.sourceCaseId,
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
