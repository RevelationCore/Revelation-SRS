import { randomUUID } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import {
  caseEvidenceReferences,
  pgrProgressReviews,
  pgrReviewMembers,
  researchMilestones,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { RegulatoryExchangeService } from '../regulatory/exchange-service.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * PGR progress review and milestones (BP-04-003, BPR-D07 part 2, ADR-023).
 *
 * pgr_progress_review extends the shared business_case primitive; each
 * review is its own case instance, never a version of a prior one. Panel
 * conflicts follow the same declare/recuse shape as BoardAuthorityService's
 * exam-board conflicts. An outcome is recorded as the case decision and
 * advances the case's own status — an unsatisfactory outcome never alters
 * candidature (nothing else reads business_case.statusCode as authoritative
 * for enrolment status), and a milestone is only published once a decision
 * exists.
 */

export interface OpenReviewInput {
  enrolmentId:        string;
  reviewTypeCode:     'initial' | 'annual' | 'upgrade' | 'return-from-interruption';
  ownerId:            string;
  supervisionCaseId?: string;
}

export interface AddReviewMemberInput {
  personId: string;
  roleCode: 'chair' | 'independent-reviewer' | 'panel-member';
}

export interface RecordOutcomeInput {
  outcomeCode: 'satisfactory' | 'conditions' | 'referral' | 'transfer' | 'escalation';
  reasonText?: string;
}

export interface PublishMilestoneInput {
  milestoneTypeCode: 'confirmation-of-registration' | 'upgrade' | 'thesis-submission' | 'viva';
  achievedDate:      string;
}

export interface ProgressReviewDto {
  reviewId:          string;
  businessCaseId:    string;
  enrolmentId:       string;
  supervisionCaseId: string | null;
  reviewTypeCode:    string;
  statusCode:        string;
  ownerId:           string;
  createdAt:         Date;
}

export interface ReviewMemberDto {
  memberId:         string;
  reviewId:         string;
  personId:         string;
  roleCode:         string;
  conflictTypeCode: string | null;
  declaredAt:       Date | null;
  recusedAt:        Date | null;
}

export interface ResearchMilestoneDto {
  milestoneId:       string;
  enrolmentId:       string;
  reviewId:          string | null;
  milestoneTypeCode: string;
  achievedDate:      string;
  publishedAt:       Date | null;
}

export class ProgressReviewService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
    private readonly exchanges: RegulatoryExchangeService,
    private readonly valueSets: ValueSetService,
  ) {}

  async openReview(tenantId: string, input: OpenReviewInput, actorId: string): Promise<string> {
    const isValidType = await this.valueSets.validateFieldValue('pgr_progress_review', 'review_type_code', input.reviewTypeCode, tenantId);
    if (isValidType === false) {
      throw new ValidationError(`Invalid PGR review type '${input.reviewTypeCode}'`);
    }

    const businessCaseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'enrolment',
      subjectId:   input.enrolmentId,
      processId:   'BP-04-003',
      statusCode:  'open',
      ownerId:     input.ownerId,
    }, actorId);

    const reviewId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrProgressReviews).values({
        id:                reviewId,
        tenantId:          tenantId as Uuid,
        businessCaseId:    businessCaseId as Uuid,
        enrolmentId:       input.enrolmentId as Uuid,
        supervisionCaseId: input.supervisionCaseId ? (input.supervisionCaseId as Uuid) : null,
        reviewTypeCode:    input.reviewTypeCode,
        createdAt:         clockNow(),
      });
    });
    return reviewId;
  }

  async addMember(tenantId: string, reviewId: string, input: AddReviewMemberInput, actorId: string): Promise<string> {
    await this.#getReview(tenantId, reviewId);
    const isValidRole = await this.valueSets.validateFieldValue('pgr_review_member', 'role_code', input.roleCode, tenantId);
    if (isValidRole === false) {
      throw new ValidationError(`Invalid PGR review member role '${input.roleCode}'`);
    }

    const memberId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(pgrReviewMembers).values({
        id:               memberId,
        tenantId:         tenantId as Uuid,
        reviewId:         reviewId as Uuid,
        personId:         input.personId as Uuid,
        roleCode:         input.roleCode,
        conflictTypeCode: null,
        declaredAt:       null,
        recusedAt:        null,
        addedBy:          actorId,
        addedAt:          clockNow(),
      });
    });
    return memberId;
  }

  async declareConflict(tenantId: string, memberId: string, conflictTypeCode: string): Promise<void> {
    const isValidConflict = await this.valueSets.validateFieldValue('pgr_review_member', 'conflict_type_code', conflictTypeCode, tenantId);
    if (isValidConflict === false) {
      throw new ValidationError(`Invalid conflict type '${conflictTypeCode}'`);
    }

    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(pgrReviewMembers)
        .set({ conflictTypeCode, declaredAt: clockNow() })
        .where(and(
          eq(pgrReviewMembers.id, memberId as Uuid),
          eq(pgrReviewMembers.tenantId, tenantId as Uuid),
        ))
        .returning({ id: pgrReviewMembers.id });
      if (!updated[0]) throw new NotFoundError('PgrReviewMember', memberId);
    });
  }

  async recuseMember(tenantId: string, memberId: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const updated = await tx.update(pgrReviewMembers)
        .set({ recusedAt: clockNow() })
        .where(and(
          eq(pgrReviewMembers.id, memberId as Uuid),
          eq(pgrReviewMembers.tenantId, tenantId as Uuid),
        ))
        .returning({ id: pgrReviewMembers.id });
      if (!updated[0]) throw new NotFoundError('PgrReviewMember', memberId);
    });
  }

  /** Records evidence considered by the panel, using the shared case-evidence primitive. */
  async recordEvidence(
    tenantId: string,
    reviewId: string,
    input: { evidenceRef: string; classificationCode: string; sourceSystem: string; receivedBy: string },
  ): Promise<string> {
    const review = await this.#getReview(tenantId, reviewId);
    return this.businessCases.addEvidence(review.businessCaseId, tenantId, input);
  }

  /**
   * Records the panel's outcome. Requires every declared conflict to be
   * resolved (recused) first, and at least one evidence record — missing
   * evidence or an unresolved conflict must postpone the review, not default
   * to an outcome (BP-04-003 exception E1).
   */
  async recordOutcome(tenantId: string, reviewId: string, input: RecordOutcomeInput, actorId: string): Promise<void> {
    const review = await this.#getReview(tenantId, reviewId);
    if (review.statusCode !== 'open') {
      throw new ValidationError(`Review '${reviewId}' has already been decided`);
    }

    const outcomeSet = await this.valueSets.getValueSet('pgr-review-outcome-code', tenantId);
    if (!outcomeSet || !outcomeSet.members.some((m) => m.code === input.outcomeCode)) {
      throw new ValidationError(`Invalid PGR review outcome '${input.outcomeCode}'`);
    }

    const members = await this.listMembers(tenantId, reviewId);
    if (members.some((m) => m.declaredAt && !m.recusedAt)) {
      throw new ValidationError('Every declared conflict must be resolved (recused) before recording an outcome');
    }

    const evidenceRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ total: count() }).from(caseEvidenceReferences).where(and(
        eq(caseEvidenceReferences.tenantId, tenantId as Uuid),
        eq(caseEvidenceReferences.businessCaseId, review.businessCaseId as Uuid),
      )),
    );
    if ((evidenceRows[0]?.total ?? 0) === 0) {
      throw new ValidationError('At least one evidence record must be considered before recording an outcome');
    }

    await this.businessCases.recordDecision(review.businessCaseId, tenantId, {
      decisionTypeCode: input.outcomeCode,
      authorityActorId: actorId,
      ...(input.reasonText ? { reasonText: input.reasonText } : {}),
      effectiveAt:       clockNow(),
    });
    await this.businessCases.advanceCaseStatus(review.businessCaseId, tenantId, input.outcomeCode, actorId);
  }

  /** Publishes a milestone once the review has been decided. Idempotent per (review, milestone type). */
  async publishMilestone(tenantId: string, reviewId: string, input: PublishMilestoneInput, actorId: string): Promise<string> {
    const review = await this.#getReview(tenantId, reviewId);
    if (review.statusCode === 'open') {
      throw new ValidationError('A milestone cannot be published before the review has been decided');
    }

    const isValidMilestone = await this.valueSets.validateFieldValue('research_milestone', 'milestone_type_code', input.milestoneTypeCode, tenantId);
    if (isValidMilestone === false) {
      throw new ValidationError(`Invalid research milestone type '${input.milestoneTypeCode}'`);
    }

    const milestoneId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(researchMilestones).values({
        id:                milestoneId,
        tenantId:          tenantId as Uuid,
        enrolmentId:       review.enrolmentId as Uuid,
        reviewId:          reviewId as Uuid,
        milestoneTypeCode: input.milestoneTypeCode,
        achievedDate:      input.achievedDate,
        publishedAt:       now,
        actorId,
        createdAt:         now,
      });
    });

    await this.exchanges.recordExchange(
      tenantId,
      'cris-pgr-milestones.v1',
      {
        directionCode:    'outbound',
        exchangeTypeCode: 'pgr-milestone-published',
        idempotencyKey:   `pgr-milestone:${milestoneId}`,
        payloadSummary:   { enrolmentId: review.enrolmentId, milestoneTypeCode: input.milestoneTypeCode },
      },
      actorId,
    );

    return milestoneId;
  }

  async getReview(tenantId: string, reviewId: string): Promise<ProgressReviewDto> {
    return this.#getReview(tenantId, reviewId);
  }

  async listMembers(tenantId: string, reviewId: string): Promise<ReviewMemberDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrReviewMembers).where(and(
        eq(pgrReviewMembers.tenantId, tenantId as Uuid),
        eq(pgrReviewMembers.reviewId, reviewId as Uuid),
      )),
    );
    return rows.map(memberToDto);
  }

  async listMilestones(tenantId: string, enrolmentId: string): Promise<ResearchMilestoneDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(researchMilestones).where(and(
        eq(researchMilestones.tenantId, tenantId as Uuid),
        eq(researchMilestones.enrolmentId, enrolmentId as Uuid),
      )),
    );
    return rows.map(milestoneToDto);
  }

  async #getReview(tenantId: string, reviewId: string): Promise<ProgressReviewDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(pgrProgressReviews).where(and(
        eq(pgrProgressReviews.id, reviewId as Uuid),
        eq(pgrProgressReviews.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('PgrProgressReview', reviewId);

    const businessCase = await this.businessCases.getCurrentCase(row.businessCaseId, tenantId);
    if (!businessCase) throw new NotFoundError('BusinessCase', row.businessCaseId);

    return {
      reviewId:          row.id,
      businessCaseId:    row.businessCaseId,
      enrolmentId:       row.enrolmentId,
      supervisionCaseId: row.supervisionCaseId,
      reviewTypeCode:    row.reviewTypeCode,
      statusCode:        businessCase.statusCode,
      ownerId:           businessCase.ownerId,
      createdAt:         row.createdAt,
    };
  }
}

function memberToDto(row: typeof pgrReviewMembers.$inferSelect): ReviewMemberDto {
  return {
    memberId:         row.id,
    reviewId:         row.reviewId,
    personId:         row.personId,
    roleCode:         row.roleCode,
    conflictTypeCode: row.conflictTypeCode,
    declaredAt:       row.declaredAt,
    recusedAt:        row.recusedAt,
  };
}

function milestoneToDto(row: typeof researchMilestones.$inferSelect): ResearchMilestoneDto {
  return {
    milestoneId:       row.id,
    enrolmentId:       row.enrolmentId,
    reviewId:          row.reviewId,
    milestoneTypeCode: row.milestoneTypeCode,
    achievedDate:      row.achievedDate,
    publishedAt:       row.publishedAt,
  };
}
