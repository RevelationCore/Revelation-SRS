import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  assessmentCandidateAttempts,
  markSets,
  markSetMembers,
  moderationReviews,
  moderationSamples,
  marks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Assessment candidate attempt & moderation (BPR-D10). A candidate attempt
 * gives moderation a stable identity independent of mark.attempt_number
 * (which lives on a row that can be superseded). A mark_set groups the marks
 * under review; moderation_review records who reviewed it under which rule
 * version, and moderation_sample records the individual before/after marks
 * examined.
 */

export interface CreateCandidateAttemptInput {
  moduleRegistrationId:  string;
  assessmentComponentId: string;
  attemptNumber:         number;
  attemptTypeCode:       string;
  createdFromMarkId?:    string;
}

export interface CreateMarkSetInput {
  assessmentComponentId: string;
  markIds:                string[];
  sourceQueryHash:        string;
}

export interface RecordSampleInput {
  markId:           string;
  sampleReasonCode: string;
  originalMark:     number;
}

export interface ModerationReviewDto {
  moderationReviewId: string;
  markSetId:          string;
  moderatorActorId:   string;
  ruleVersion:        string;
  startedAt:          Date;
  completedAt:        Date | null;
  outcomeCode:        string | null;
}

export class ModerationService {
  constructor(private readonly db: Db) {}

  async createCandidateAttempt(tenantId: string, input: CreateCandidateAttemptInput, actorId: string): Promise<string> {
    const id  = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(assessmentCandidateAttempts).values({
        versionId:              randomUUID(),
        id:                     id as Uuid,
        tenantId:               tenantId as Uuid,
        moduleRegistrationId:   input.moduleRegistrationId as Uuid,
        assessmentComponentId:  input.assessmentComponentId as Uuid,
        attemptNumber:          input.attemptNumber,
        attemptTypeCode:        input.attemptTypeCode,
        createdFromMarkId:      input.createdFromMarkId ? (input.createdFromMarkId as Uuid) : null,
        actorId,
        validFrom:              now,
        validTo:                null,
        recordedAt:             now,
        recordedUntil:          null,
      });
    });
    return id;
  }

  /** Creates a mark_set from a fixed list of current mark IDs for one component. */
  async createMarkSet(tenantId: string, input: CreateMarkSetInput, generatedBy: string): Promise<string> {
    if (input.markIds.length === 0) {
      throw new ValidationError('A mark set requires at least one mark');
    }

    const markSetId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(markSets).values({
        id:                     markSetId,
        tenantId:               tenantId as Uuid,
        assessmentComponentId:  input.assessmentComponentId as Uuid,
        generatedAt:            clockNow(),
        generatedBy,
        sourceQueryHash:        input.sourceQueryHash,
      });

      for (const markId of input.markIds) {
        const rows = await tx.select().from(marks).where(and(
          eq(marks.id,       markId   as Uuid),
          eq(marks.tenantId, tenantId as Uuid),
          isNull(marks.recordedUntil),
        )).limit(1);
        const mark = rows[0];
        if (!mark) throw new NotFoundError('Mark', markId);

        const attemptId = await this.createCandidateAttempt(tenantId, {
          moduleRegistrationId:  mark.moduleRegistrationId,
          assessmentComponentId: mark.assessmentComponentId,
          attemptNumber:         mark.attemptNumber,
          attemptTypeCode:       mark.attemptNumber > 1 ? 'resit' : 'first-sit',
          createdFromMarkId:     mark.id,
        }, generatedBy);

        await tx.insert(markSetMembers).values({
          id:                 randomUUID(),
          tenantId:           tenantId as Uuid,
          markSetId:          markSetId as Uuid,
          markId:             markId as Uuid,
          candidateAttemptId: attemptId as Uuid,
        });
      }
    });

    return markSetId;
  }

  async startReview(tenantId: string, markSetId: string, ruleVersion: string, moderatorActorId: string): Promise<string> {
    const reviewId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moderationReviews).values({
        id:                reviewId,
        tenantId:          tenantId as Uuid,
        markSetId:         markSetId as Uuid,
        moderatorActorId,
        ruleVersion,
        startedAt:         clockNow(),
        completedAt:       null,
        outcomeCode:       null,
      });
    });
    return reviewId;
  }

  async recordSample(tenantId: string, moderationReviewId: string, input: RecordSampleInput): Promise<string> {
    const sampleId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moderationSamples).values({
        id:                 sampleId,
        tenantId:           tenantId as Uuid,
        moderationReviewId: moderationReviewId as Uuid,
        markId:             input.markId as Uuid,
        sampleReasonCode:   input.sampleReasonCode,
        originalMark:       input.originalMark.toFixed(2),
        moderatedMark:      null,
        changeReasonCode:   null,
      });
    });
    return sampleId;
  }

  /** Lists moderation reviews, optionally filtered to only those still in progress. */
  async listReviews(tenantId: string, onlyOpen?: boolean): Promise<ModerationReviewDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moderationReviews).where(and(
        eq(moderationReviews.tenantId, tenantId as Uuid),
        ...(onlyOpen ? [isNull(moderationReviews.completedAt)] : []),
      )).orderBy(moderationReviews.startedAt),
    );
    return rows.map((row) => ({
      moderationReviewId: row.id,
      markSetId:          row.markSetId,
      moderatorActorId:   row.moderatorActorId,
      ruleVersion:        row.ruleVersion,
      startedAt:          row.startedAt,
      completedAt:        row.completedAt,
      outcomeCode:        row.outcomeCode,
    }));
  }

  async completeReview(tenantId: string, moderationReviewId: string, outcomeCode: string): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const existing = await tx.select({ id: moderationReviews.id }).from(moderationReviews).where(and(
        eq(moderationReviews.id,       moderationReviewId as Uuid),
        eq(moderationReviews.tenantId, tenantId            as Uuid),
      )).limit(1);
      if (!existing[0]) throw new NotFoundError('ModerationReview', moderationReviewId);

      await tx.update(moderationReviews)
        .set({ completedAt: clockNow(), outcomeCode })
        .where(and(
          eq(moderationReviews.id,       moderationReviewId as Uuid),
          eq(moderationReviews.tenantId, tenantId            as Uuid),
        ));
    });
  }
}
