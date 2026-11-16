import { randomUUID } from 'node:crypto';

import {
  awardConferments,
  awardRecommendations,
  progressionDecisions,
  reassessmentPlans,
  type AwardConferment,
  type AwardRecommendation,
  type Db,
  type ReassessmentPlan,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { EnrolmentService } from '../enrolment/service.js';
import { deterministicUuid } from '../platform-controls/governed-review.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { AwardService } from './award-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/** Plan types each progression decision can lead to. */
const PLANS_FOR_DECISION: Record<string, string[]> = {
  resit: ['resit-without-attendance', 'referral', 'repeat-module', 'deferral', 'additional-attempt'],
  'repeat-year': ['repeat-stage', 'additional-attempt'],
};

export interface RecommendAwardInput {
  awardTypeCode: 'standard' | 'exit' | 'aegrotat' | 'posthumous';
  qualificationCode: string;
  classificationCode: string;
  examBoardId?: string;
  discretionReason?: string;
  authorityRef?: string;
}

export interface ConferAwardInput {
  confermentDate: string;
  authorityRef: string;
}

export interface ReassessmentPlanInput {
  planTypeCode: string;
  moduleRegistrationId?: string;
  assessmentComponentId?: string;
  academicPeriodId?: string;
  dueDate?: string;
  markCap?: number;
}

/**
 * Award recommendation and conferment, and reassessment plans (BPR-D14).
 * The board recommends against the calculated classification; a delegated
 * authority who is not the recommender confers, which records the
 * immutable conferment and creates the award.
 */
export class ConfermentService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly enrolments: EnrolmentService,
    private readonly awards: AwardService,
  ) {}

  // ── Award recommendation and conferment ────────────────────────────────────

  async recommend(tenantId: string, enrolmentId: string, input: RecommendAwardInput, actorId: string): Promise<AwardRecommendation> {
    await this.#code(tenantId, 'award_recommendation', 'award_type_code', input.awardTypeCode);
    const enrolment = await this.enrolments.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

    // Every award is confirmed by a ratified award board (BP-06-003 step 1).
    if (!input.examBoardId) throw new ValidationError('An award recommendation needs the recommending exam board');
    await this.awards.assertRatifiedBoardCoversEnrolment(input.examBoardId, enrolmentId, tenantId);

    let calculated: { classificationCode: string; aggregateMark: number } | null = null;
    if (input.awardTypeCode === 'standard' || input.awardTypeCode === 'exit') {
      calculated = await this.awards.calculateClassification(enrolmentId, tenantId);
      if (calculated.classificationCode !== input.classificationCode && !input.discretionReason) {
        throw new ValidationError(
          `The calculated classification is '${calculated.classificationCode}'; recommending '${input.classificationCode}' needs a discretion reason`,
          [{ field: 'discretionReason', message: 'Required when the recommendation differs from the calculation' }],
        );
      }
    } else if (!input.authorityRef) {
      throw new ValidationError(`A ${input.awardTypeCode} award must cite the policy authority that allows it (BP-06-003 A1)`);
    }

    try {
      const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(awardRecommendations).values({
        tenantId: tenantId as Uuid,
        enrolmentId: enrolmentId as Uuid,
        personId: enrolment.personId as Uuid,
        examBoardId: (input.examBoardId ?? null) as Uuid | null,
        awardTypeCode: input.awardTypeCode,
        qualificationCode: input.qualificationCode,
        classificationCode: input.classificationCode,
        calculatedClassificationCode: calculated?.classificationCode ?? null,
        aggregateMark: calculated?.aggregateMark ?? null,
        discretionReason: calculated && calculated.classificationCode !== input.classificationCode ? input.discretionReason! : null,
        authorityRef: input.authorityRef ?? null,
        recommendedBy: actorId,
      }).returning());
      return row!;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('This enrolment already has an open award recommendation');
      throw error;
    }
  }

  /**
   * Confers a recommended award. The conferment is append-only; the award
   * ID is derived from the recommendation, so repeating a conferment that
   * was interrupted finds the award it already created.
   */
  async confer(tenantId: string, recommendationId: string, input: ConferAwardInput, actorId: string): Promise<{ recommendation: AwardRecommendation; conferment: AwardConferment }> {
    const recommendation = await this.#recommendation(tenantId, recommendationId);
    if (recommendation.statusCode !== 'recommended') throw new ConflictError(`This recommendation is already ${recommendation.statusCode}`);
    if (recommendation.recommendedBy === actorId) {
      throw new ConflictError('The person who recommended an award cannot confer it');
    }

    const awardId = deterministicUuid(`award-conferment:${recommendation.id}`);
    const evidence = recommendation.calculatedClassificationCode !== null
      ? await this.awards.calculateClassification(recommendation.enrolmentId, tenantId)
      : null;
    await this.awards.recordConferredAward(recommendation.enrolmentId, tenantId, {
      awardId,
      examBoardId: recommendation.examBoardId,
      qualificationCode: recommendation.qualificationCode,
      classificationCode: recommendation.classificationCode,
      awardDate: input.confermentDate,
    }, actorId, evidence);

    const now = clockNow();
    const conferment = await withTenantContext(this.db, tenantId, async (tx) => {
      const [created] = await tx.insert(awardConferments).values({
        id: randomUUID(),
        tenantId: tenantId as Uuid,
        recommendationId: recommendation.id,
        awardId: awardId as Uuid,
        confermentDate: input.confermentDate,
        authorityRef: input.authorityRef,
        conferredBy: actorId,
        conferredAt: now,
      }).returning();
      await tx.update(awardRecommendations).set({ statusCode: 'conferred' }).where(eq(awardRecommendations.id, recommendation.id));
      return created!;
    });
    return { recommendation: await this.#recommendation(tenantId, recommendationId), conferment };
  }

  async withdrawRecommendation(tenantId: string, recommendationId: string, reason: string): Promise<AwardRecommendation> {
    const recommendation = await this.#recommendation(tenantId, recommendationId);
    if (recommendation.statusCode !== 'recommended') throw new ConflictError(`This recommendation is already ${recommendation.statusCode}`);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(awardRecommendations)
      .set({ statusCode: 'withdrawn', withdrawnReason: reason }).where(eq(awardRecommendations.id, recommendation.id)).returning());
    return row!;
  }

  async listForEnrolment(tenantId: string, enrolmentId: string): Promise<Array<AwardRecommendation & { conferment: AwardConferment | null }>> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const recs = await tx.select().from(awardRecommendations)
        .where(and(eq(awardRecommendations.tenantId, tenantId as Uuid), eq(awardRecommendations.enrolmentId, enrolmentId as Uuid)))
        .orderBy(desc(awardRecommendations.recommendedAt));
      const conferments = await tx.select().from(awardConferments).where(eq(awardConferments.tenantId, tenantId as Uuid));
      return recs.map((r) => ({ ...r, conferment: conferments.find((c) => c.recommendationId === r.id) ?? null }));
    });
  }

  // ── Reassessment plans ─────────────────────────────────────────────────────

  async createPlan(tenantId: string, progressionDecisionId: string, input: ReassessmentPlanInput, actorId: string): Promise<ReassessmentPlan> {
    await this.#code(tenantId, 'reassessment_plan', 'plan_type_code', input.planTypeCode);
    const [decision] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(progressionDecisions).where(and(
      eq(progressionDecisions.id, progressionDecisionId as Uuid),
      eq(progressionDecisions.tenantId, tenantId as Uuid),
      isNull(progressionDecisions.recordedUntil),
    )).limit(1));
    if (!decision) throw new NotFoundError('ProgressionDecision', progressionDecisionId);
    if (!decision.locked) throw new ConflictError('A reassessment plan follows a ratified progression decision; this one is not yet ratified');
    const allowed = PLANS_FOR_DECISION[decision.decisionCode] ?? [];
    if (!allowed.includes(input.planTypeCode)) {
      throw new ValidationError(`A '${decision.decisionCode}' decision cannot lead to a '${input.planTypeCode}' plan`);
    }
    const moduleLevel = input.planTypeCode !== 'repeat-stage';
    if (moduleLevel && !input.moduleRegistrationId) throw new ValidationError('A module-level reassessment plan needs the module registration');

    const prior = await withTenantContext(this.db, tenantId, (tx) => tx.select({ attempt: reassessmentPlans.attemptNumber, type: reassessmentPlans.planTypeCode })
      .from(reassessmentPlans).where(and(
        eq(reassessmentPlans.tenantId, tenantId as Uuid),
        eq(reassessmentPlans.enrolmentId, decision.enrolmentId),
        ...(input.moduleRegistrationId ? [eq(reassessmentPlans.moduleRegistrationId, input.moduleRegistrationId as Uuid)] : []),
      )));
    // A deferral keeps first-attempt treatment (BP-06-002 A1): it does not consume an attempt.
    const used = prior.filter((p) => p.type !== 'deferral').reduce((max, p) => Math.max(max, p.attempt), 1);
    const attemptNumber = input.planTypeCode === 'deferral' ? Math.max(2, used) : used + 1;

    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(reassessmentPlans).values({
      tenantId: tenantId as Uuid,
      enrolmentId: decision.enrolmentId,
      progressionDecisionId: decision.id,
      planTypeCode: input.planTypeCode,
      moduleRegistrationId: (input.moduleRegistrationId ?? null) as Uuid | null,
      assessmentComponentId: (input.assessmentComponentId ?? null) as Uuid | null,
      academicPeriodId: (input.academicPeriodId ?? null) as Uuid | null,
      attemptNumber,
      markCap: input.planTypeCode === 'deferral' ? null : (input.markCap ?? null),
      dueDate: input.dueDate ?? null,
      createdBy: actorId,
    }).returning());
    return row!;
  }

  /** Records how a plan ended; the plan is kept, never overwritten. */
  async closePlan(tenantId: string, planId: string, input: { statusCode: 'completed' | 'expired' | 'cancelled'; note?: string }, actorId: string): Promise<ReassessmentPlan> {
    const [plan] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(reassessmentPlans)
      .where(and(eq(reassessmentPlans.id, planId as Uuid), eq(reassessmentPlans.tenantId, tenantId as Uuid))).limit(1));
    if (!plan) throw new NotFoundError('ReassessmentPlan', planId);
    if (plan.statusCode !== 'planned') throw new ConflictError(`This plan is already ${plan.statusCode}`);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(reassessmentPlans).set({
      statusCode: input.statusCode, outcomeNote: input.note ?? null, closedBy: actorId, closedAt: clockNow(),
    }).where(eq(reassessmentPlans.id, plan.id)).returning());
    return row!;
  }

  async listPlans(tenantId: string, enrolmentId: string): Promise<ReassessmentPlan[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(reassessmentPlans)
      .where(and(eq(reassessmentPlans.tenantId, tenantId as Uuid), eq(reassessmentPlans.enrolmentId, enrolmentId as Uuid)))
      .orderBy(reassessmentPlans.createdAt));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #recommendation(tenantId: string, id: string): Promise<AwardRecommendation> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(awardRecommendations)
      .where(and(eq(awardRecommendations.id, id as Uuid), eq(awardRecommendations.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('AwardRecommendation', id);
    return row;
  }

  async #code(tenantId: string, entity: string, field: string, value: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field, message: 'Value is not active in the configured value set' }]);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ('code' in e && (e).code === '23505') return true;
  }
  return false;
}
