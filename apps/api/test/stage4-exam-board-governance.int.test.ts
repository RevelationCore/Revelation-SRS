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
  const res = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/exam-boards/${examBoardId}/ratification`,
    headers: { authorization: `Bearer ${chairJwt}` },
  });
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

describe('exam-board.quorum.required flag gate', () => {
  it('when on, ratification is blocked if quorum has not been recorded', async () => {
    await enableFlag('exam-board.quorum.required', 'on');

    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);

    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(422);

    await enableFlag('exam-board.quorum.required', 'off');
  });

  it('when on, ratification succeeds after quorum is recorded', async () => {
    await enableFlag('exam-board.quorum.required', 'on');

    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);

    const quorumRes = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/quorum`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { memberCount: 5 },
    });
    expect(quorumRes.statusCode).toBe(204);

    // Verify the board DTO now shows the quorum
    const getRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/exam-boards/${examBoardId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const board = getRes.json<{ quorumCount: number | null; quorumRecordedAt: string | null }>();
    expect(board.quorumCount).toBe(5);
    expect(board.quorumRecordedAt).not.toBeNull();

    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(204);

    await enableFlag('exam-board.quorum.required', 'off');
  });

  it('when off (default), ratification does not require quorum', async () => {
    const examBoardId = await createMinimalBoard();
    await signoffBoard(examBoardId);
    const statusCode = await ratifyBoard(examBoardId);
    expect(statusCode).toBe(204);
  });

  it('requires exam-board:ratify to record quorum', async () => {
    const examBoardId = await createMinimalBoard();
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/quorum`,
      headers: { authorization: `Bearer ${jwt}` },  // registry-admin, not chair
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

    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/exam-boards/${examBoardId}/ratification`,
      headers: { authorization: `Bearer ${jwt}` },  // registry-admin, not chair
    });
    expect(res.statusCode).toBe(403);
  });
});
