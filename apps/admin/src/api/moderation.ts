import { api } from './client.js';

export interface ModerationReview {
  moderationReviewId: string;
  markSetId:          string;
  moderatorActorId:   string;
  ruleVersion:        string;
  startedAt:          string;
  completedAt:        string | null;
  outcomeCode:        string | null;
}

export function listReviews(onlyOpen?: boolean): Promise<ModerationReview[]> {
  const qs = onlyOpen ? '?onlyOpen=true' : '';
  return api.get(`/api/v1/moderation/reviews${qs}`);
}

export function createMarkSet(body: {
  assessmentComponentId: string;
  markIds:               string[];
  sourceQueryHash:       string;
}): Promise<{ markSetId: string }> {
  return api.post('/api/v1/moderation/mark-sets', body);
}

export function startReview(body: { markSetId: string; ruleVersion: string }): Promise<{ reviewId: string }> {
  return api.post('/api/v1/moderation/reviews', body);
}

export function recordSample(
  reviewId: string,
  body: { markId: string; sampleReasonCode: string; originalMark: number },
): Promise<{ sampleId: string }> {
  return api.post(`/api/v1/moderation/reviews/${reviewId}/samples`, body);
}

export type ModerationOutcomeCode = 'no-change' | 'adjusted' | 'escalated';

export function completeReview(reviewId: string, outcomeCode: ModerationOutcomeCode): Promise<void> {
  return api.patch(`/api/v1/moderation/reviews/${reviewId}/complete`, { outcomeCode });
}
