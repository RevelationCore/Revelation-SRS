import type { TestApp } from './test-app.js';

type InjectResponse = Awaited<ReturnType<TestApp['app']['inject']>>;

/** The current data pack's id and hash, generating a pack first if the board has none. */
export async function currentPack(ctx: TestApp, examBoardId: string): Promise<{ dataPackId: string; packHash: string } | InjectResponse> {
  const admin = { authorization: `Bearer ${await ctx.makeJwt()}` };
  let pack = await ctx.app.inject({ method: 'GET', url: `/api/v1/exam-boards/${examBoardId}/data-pack`, headers: admin });
  if (pack.statusCode === 404) {
    const generated = await ctx.app.inject({ method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/data-pack`, headers: admin });
    if (generated.statusCode >= 300) return generated;
    pack = await ctx.app.inject({ method: 'GET', url: `/api/v1/exam-boards/${examBoardId}/data-pack`, headers: admin });
  }
  if (pack.statusCode !== 200) return pack;
  return pack.json<{ dataPackId: string; packHash: string }>();
}

/**
 * Ratifies a board the way Phase 5 D-36 requires: the board decides to
 * ratify its current data pack, citing the pack's hash, and the
 * ratification names the same hash. Returns the first response that is not
 * a success, or the ratification's response.
 */
export async function ratifyThroughDecision(ctx: TestApp, token: string, examBoardId: string): Promise<InjectResponse> {
  const pack = await currentPack(ctx, examBoardId);
  if ('statusCode' in pack) return pack;
  const headers = { authorization: `Bearer ${token}` };
  // BL-265: a board ratifies only when quorate; record that the quorum was met.
  const quorum = await ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/quorum-decision`,
    headers: { authorization: `Bearer ${await ctx.makeJwt({ sub: 'board-secretary', roles: ['exam-board-chair'] })}` },
    payload: { requiredCount: 3, attendingCount: 3 },
  });
  if (quorum.statusCode !== 201) return quorum;
  const decision = await ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/decisions`, headers,
    payload: { dataPackId: pack.dataPackId, packHash: pack.packHash, decisionTypeCode: 'ratify' },
  });
  if (decision.statusCode !== 201) return decision;
  // Separation of duties (BL-065): someone other than the person who recorded
  // the decision ratifies it.
  const ratifier = await ctx.makeJwt({ sub: 'board-ratifier', roles: ['exam-board-chair'] });
  return ctx.app.inject({ method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/ratification`, headers: { authorization: `Bearer ${ratifier}` }, payload: { packHash: pack.packHash } });
}
