/**
 * Stage 4 — Exam Board and Record Governance Refactor integration tests.
 *
 * Exit criterion: "Board variation is workflow/flag configured;
 * ratification and lock integrity remain service enforced."
 *
 * Tests cover:
 *   1. Three new board governance flags exist with correct defaults
 *   2. exam-board-virtual workflow definition exists with correct steps
 *   3. exam-board.external-examiner.required flag now actually controls the guard
 *   4. exam-board.quorum.required flag blocks ratification until quorum recorded
 *   5. Deferral: flag off → rejected; flag on → board deferred and cannot be ratified
 *   6. Deferred board can be re-opened (DELETE /deferral) and then ratified
 *   7. Service guard: ratification authority (exam-board-chair) unchanged
 *   8. Record lock: ratified board cannot be re-ratified or deferred
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { currentPack, ratifyThroughDecision } from './helpers/board-ratification.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;      // registry-administrator (exam-board:write, mark:write)
let chairJwt: string; // exam-board-chair       (exam-board:ratify)

beforeAll(async () => {
  ctx      = await startTestApp();
  jwt      = await ctx.makeJwt();
  chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Direct DB flag assignment — used by stage 4 tests that need to freely set flag
// state (including 'off' on non-bypassable flags) for exam board behaviour testing.
// Governance guards are exercised separately in stage 6 integration tests.
async function enableFlag(flagKey: string, variantKey: string): Promise<void> {
  await ctx.db.execute(sql`
    UPDATE feature_flag_assignment ffa
    SET active_to = now() - interval '1 millisecond'
    FROM feature_flag ff
    WHERE ff.id = ffa.flag_id
      AND ff.flag_key = ${flagKey}
      AND ffa.tenant_id = ${ctx.tenantId}::uuid
      AND (ffa.active_to IS NULL OR ffa.active_to > now())
  `);

  await ctx.db.execute(sql`
    INSERT INTO feature_flag_assignment (flag_id, tenant_id, variant_id, active_from, created_by)
    SELECT ff.id, ${ctx.tenantId}::uuid, ffv.id, now() - interval '1 second', 'test-setup'
    FROM feature_flag ff
    JOIN feature_flag_variant ffv ON ffv.flag_id = ff.id AND ffv.variant_key = ${variantKey}
    WHERE ff.flag_key = ${flagKey}
  `);
}

async function createMinimalBoard(academicYear = '2026-27'): Promise<string> {
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'award', academicYear },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ examBoardId: string }>().examBoardId;
}

async function signoffBoard(examBoardId: string): Promise<void> {
  const res = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${chairJwt}` },
    payload: { commentary: 'Approved' },
  });
  expect(res.statusCode).toBe(201);
}

async function ratifyBoard(examBoardId: string): Promise<number> {
  const res = await ratifyThroughDecision(ctx, chairJwt, examBoardId);
  return res.statusCode;
}

// ── Feature flags ─────────────────────────────────────────────────────────────

describe('Stage 4 feature flags', () => {
  it('exam-board.virtual-board.enabled exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string; statusCode: string }>>();
    const flag = flags.find((f) => f.flagKey === 'exam-board.virtual-board.enabled');
    expect(flag, 'exam-board.virtual-board.enabled must exist').toBeDefined();
    expect(flag!.statusCode).toBe('active');
    expect(flag!.defaultVariantKey).toBe('off');
  });

  it('exam-board.deferral.enabled exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'exam-board.deferral.enabled');
    expect(flag, 'exam-board.deferral.enabled must exist').toBeDefined();
    expect(flag!.defaultVariantKey).toBe('off');
  });

  it('exam-board.quorum.required exists and defaults to off', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/feature-flags',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const flags = res.json<Array<{ flagKey: string; defaultVariantKey: string }>>();
    const flag = flags.find((f) => f.flagKey === 'exam-board.quorum.required');
    expect(flag, 'exam-board.quorum.required must exist').toBeDefined();
    expect(flag!.defaultVariantKey).toBe('off');
  });
});

// ── Virtual board workflow ────────────────────────────────────────────────────

describe('exam-board-virtual workflow definition', () => {
  it('exists as active with data-pack-distributed, async-member-review, async-chair-review, external-examiner-async steps', async () => {
    const listRes = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/workflow-definitions?statusCode=active',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const defs = listRes.json<Array<{ definitionCode: string }>>();
    const def = defs.find((d) => d.definitionCode === 'exam-board-virtual');
    expect(def, 'exam-board-virtual must be an active workflow definition').toBeDefined();

    const steps = await ctx.db.execute(sql`
      SELECT ws.step_key, ws.step_type_code, ws.owner_role_code
      FROM workflow_step ws
      JOIN workflow_definition_version wdv ON wdv.id = ws.workflow_definition_version_id
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.definition_code = 'exam-board-virtual'
        AND wd.tenant_id IS NULL
        AND wdv.status_code = 'active'
      ORDER BY ws.sort_order
    `);
    const stepList = steps as unknown as Array<{ step_key: string; step_type_code: string; owner_role_code: string | null }>;
    const keys = stepList.map((s) => s.step_key);
    expect(keys).toContain('data-pack-distributed');
    expect(keys).toContain('async-member-review');
    expect(keys).toContain('async-chair-review');
    expect(keys).toContain('external-examiner-async');

    const chairReview = stepList.find((s) => s.step_key === 'async-chair-review');
    expect(chairReview?.owner_role_code).toBe('exam-board-chair');
  });
});

// ── External examiner flag gate ───────────────────────────────────────────────

describe('exam-board.external-examiner.required flag gate', () => {
  it('when on (default), ratification is blocked without external examiner sign-off', async () => {
    const examBoardId = await createMinimalBoard();
    // Do NOT sign off — external examiner required is on by default
    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(422);
  });

  it('when off, ratification succeeds without external examiner sign-off', async () => {
    await enableFlag('exam-board.external-examiner.required', 'off');

    const examBoardId = await createMinimalBoard();
    // Skip sign-off — flag is off
    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(204);

    // Restore flag for other tests
    await enableFlag('exam-board.external-examiner.required', 'on');
  });
});

// ── Quorum flag gate ──────────────────────────────────────────────────────────

// BL-265 (pre-review BP-05 F2): a board ratifies only when quorate. The
// exam-board.quorum.required flag used to switch this off, by default.
describe('quorum gate at ratification (BL-265)', () => {
  /** Decide and ratify directly, without the helper's quorum decision. */
  async function decideAndRatify(examBoardId: string): Promise<number> {
    const pack = await currentPack(ctx, examBoardId);
    if ('statusCode' in pack) return pack.statusCode;
    const d = await ctx.app.inject({ method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/decisions`, headers: { authorization: `Bearer ${chairJwt}` }, payload: { dataPackId: pack.dataPackId, packHash: pack.packHash, decisionTypeCode: 'ratify' } });
    expect(d.statusCode, d.body).toBe(201);
    const ratifier = await ctx.makeJwt({ sub: 'quorum-ratifier', roles: ['exam-board-chair'] });
    return (await ctx.app.inject({ method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/ratification`, headers: { authorization: `Bearer ${ratifier}` }, payload: { packHash: pack.packHash } })).statusCode;
  }
  const quorum = (examBoardId: string, attendingCount: number) => ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/quorum-decision`, headers: { authorization: `Bearer ${chairJwt}` },
    payload: { requiredCount: 4, attendingCount },
  });

  it('refuses ratification with no quorum decision, whatever the old flag says', async () => {
    await enableFlag('exam-board.quorum.required', 'off');
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    expect(await decideAndRatify(examBoardId)).toBe(422);
  });

  it('refuses ratification when the latest quorum decision found it not quorate', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    expect((await quorum(examBoardId, 4)).statusCode).toBe(201);
    expect((await quorum(examBoardId, 2)).statusCode).toBe(201); // members left: the latest governs
    expect(await decideAndRatify(examBoardId)).toBe(422);
  });

  it('ratifies when the latest quorum decision found it quorate', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    expect((await quorum(examBoardId, 5)).statusCode).toBe(201);
    expect(await decideAndRatify(examBoardId)).toBe(204);
  });

  it('refuses a decision while a declared conflict is unrecused, and ratification by a conflicted member', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    expect((await quorum(examBoardId, 5)).statusCode).toBe(201);
    const conflicted = await ctx.makeJwt({ sub: 'conflicted-member', roles: ['exam-board-chair'] });
    const declare = await ctx.app.inject({ method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/conflicts`, headers: { authorization: `Bearer ${conflicted}` }, payload: { conflictTypeCode: 'family', enrolmentId: '11111111-1111-4111-8111-111111111111' } });
    expect(declare.statusCode, declare.body).toBe(201);
    const pack = await currentPack(ctx, examBoardId);
    if ('statusCode' in pack) throw new Error('no pack');
    const decide = (token: string) => ctx.app.inject({ method: 'POST', url: `/api/v1/exam-boards/${examBoardId}/decisions`, headers: { authorization: `Bearer ${token}` }, payload: { dataPackId: pack.dataPackId, packHash: pack.packHash, decisionTypeCode: 'ratify' } });
    expect((await decide(chairJwt)).statusCode).toBe(409);
    const conflictId = declare.json<{ conflictId: string }>().conflictId;
    expect((await ctx.app.inject({ method: 'PATCH', url: `/api/v1/board-conflicts/${conflictId}/recuse`, headers: { authorization: `Bearer ${chairJwt}` } })).statusCode).toBeLessThan(300);
    expect((await decide(conflicted)).statusCode).toBe(403);
    expect((await decide(chairJwt)).statusCode).toBe(201);
  });

  it('requires exam-board:ratify to record quorum', async () => {
    const examBoardId = await createMinimalBoard();
    // registry-administrator also holds exam-board:ratify (see
    // permissions.ts) — module-tutor is the role that genuinely lacks it.
    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/quorum`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
      payload: { memberCount: 3 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Board deferral ────────────────────────────────────────────────────────────

describe('board deferral', () => {
  it('when deferral flag is off, deferring a board returns 422', async () => {
    const examBoardId = await createMinimalBoard();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reason: 'Missing data' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('when deferral flag is on, a board can be deferred and the DTO reflects deferral', async () => {
    await enableFlag('exam-board.deferral.enabled', 'on');

    const examBoardId = await createMinimalBoard();
    const deferRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reason: 'Missing external examiner commentary' },
    });
    expect(deferRes.statusCode).toBe(204);

    const getRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/exam-boards/${examBoardId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const board = getRes.json<{ deferredAt: string | null; deferralReason: string | null }>();
    expect(board.deferredAt).not.toBeNull();
    expect(board.deferralReason).toBe('Missing external examiner commentary');

    await enableFlag('exam-board.deferral.enabled', 'off');
  });

  it('a deferred board cannot be ratified', async () => {
    await enableFlag('exam-board.deferral.enabled', 'on');

    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);

    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reason: 'Deferred for re-moderation' },
    });

    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(422);

    await enableFlag('exam-board.deferral.enabled', 'off');
  });

  it('a deferred board can be re-opened (DELETE /deferral) and then ratified', async () => {
    await enableFlag('exam-board.deferral.enabled', 'on');

    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);

    // Defer
    await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reason: 'Awaiting further moderation' },
    });

    // Re-open
    const reopenRes = await ctx.app.inject({
      method:  'DELETE',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(reopenRes.statusCode).toBe(204);

    // Verify deferredAt cleared
    const getRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/exam-boards/${examBoardId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const board = getRes.json<{ deferredAt: string | null }>();
    expect(board.deferredAt).toBeNull();

    // Can now ratify
    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(204);

    await enableFlag('exam-board.deferral.enabled', 'off');
  });

  it('a non-deferred board cannot be re-opened', async () => {
    const examBoardId = await createMinimalBoard();
    const res = await ctx.app.inject({
      method:  'DELETE',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ── Record lock integrity ─────────────────────────────────────────────────────

describe('record lock integrity (service guards unchanged)', () => {
  it('a ratified board cannot be ratified again', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    expect(await ratifyBoard(examBoardId)).toBe(204);
    expect(await ratifyBoard(examBoardId)).toBe(422);
  });

  it('a ratified board cannot be deferred', async () => {
    await enableFlag('exam-board.deferral.enabled', 'on');

    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    await ratifyBoard(examBoardId);

    const deferRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/deferral`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reason: 'Too late' },
    });
    expect(deferRes.statusCode).toBe(422);

    await enableFlag('exam-board.deferral.enabled', 'off');
  });

  it('quorum cannot be recorded on a ratified board', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    await ratifyBoard(examBoardId);

    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/quorum`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { memberCount: 3 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('requires exam-board:ratify permission to ratify a board', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);

    // registry-administrator also holds exam-board:ratify (see
    // permissions.ts) — module-tutor is the role that genuinely lacks it.
    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const res = await ratifyThroughDecision(ctx, moduleTutorJwt, examBoardId);
    expect(res.statusCode).toBe(403);
  });
});
