import type { TestApp } from './test-app.js';

export interface ConferViaBoardInput {
  enrolmentId: string;
  examBoardId: string;
  qualificationCode: string;
  classificationCode: string;
  awardDate?: string;
  discretionReason?: string;
  /** Recommends (BP-06-003 step 4). Defaults to an exam board chair. */
  recommenderJwt?: string;
  /** Confers as delegated authority (step 5); must be someone else. Defaults to a registry administrator. */
  conferrerJwt?: string;
}

/** Response-like result: the failing step's status, or 201 with the award ID. */
export interface ConferResult {
  statusCode: number;
  json<T>(): T;
}

/**
 * Confers an award the governed way (BPR-D14): the board recommends, a
 * different delegated authority confers. Replaces the retired direct
 * POST /enrolments/{id}/award in tests.
 */
export async function conferViaBoard(ctx: TestApp, input: ConferViaBoardInput): Promise<ConferResult> {
  const recommender = input.recommenderJwt ?? await ctx.makeJwt({ sub: 'test-board-chair', roles: ['exam-board-chair'] });
  const conferrer = input.conferrerJwt ?? await ctx.makeJwt({ sub: 'test-conferment-delegate', roles: ['registry-administrator'] });

  const rec = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/enrolments/${input.enrolmentId}/award-recommendations`,
    headers: { authorization: `Bearer ${recommender}` },
    payload: {
      awardTypeCode: 'standard',
      qualificationCode: input.qualificationCode,
      classificationCode: input.classificationCode,
      examBoardId: input.examBoardId,
      ...(input.discretionReason ? { discretionReason: input.discretionReason } : {}),
    },
  });
  if (rec.statusCode !== 201) return rec;
  const { recommendationId } = rec.json<{ recommendationId: string }>();

  const conferred = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/award-recommendations/${recommendationId}/conferment`,
    headers: { authorization: `Bearer ${conferrer}` },
    payload: { confermentDate: input.awardDate ?? '2026-07-15', authorityRef: 'Senate (test)' },
  });
  if (conferred.statusCode !== 201) return conferred;
  const awardId = conferred.json<{ conferment: { awardId: string } }>().conferment.awardId;
  return { statusCode: 201, json: <T>() => ({ awardId, recommendationId }) as T };
}
