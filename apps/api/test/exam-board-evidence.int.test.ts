import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ratifyThroughDecision } from './helpers/board-ratification.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Phase 5 D-36: a data pack carries a content hash and a rule manifest;
 * board decisions and ratification cite the hash of the exact current pack.
 */
let ctx: TestApp;
let staff: string;
let chair: string;
let admin: string;
let seq = 0;

beforeAll(async () => {
  ctx = await startTestApp();
  staff = await ctx.makeJwt();
  chair = await ctx.makeJwt({ sub: 'evidence-chair', roles: ['exam-board-chair'] });
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function call<T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, token = staff): Promise<T> {
  const res = await ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return (res.body ? res.json<T>() : undefined) as T;
}
const raw = (method: 'GET' | 'POST', url: string, payload?: unknown, token = staff) =>
  ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

interface Pack { dataPackId: string; packHash: string; ruleManifestRef: string; packVersion: number }

/** A module board with one student and one mark, under a programme pass-mark rule. */
async function boardWithCandidate(): Promise<{ examBoardId: string; programmeId: string; ruleId: string }> {
  const code = `EV${++seq}`;
  const { programmeId } = await call<{ programmeId: string }>('POST', '/api/v1/programmes', { code, title: `Evidence ${code}`, fheqLevel: 6, creditTotal: 360 });
  const { academicRuleId: ruleId } = await call<{ academicRuleId: string }>('POST', '/api/v1/academic-rules', {
    programmeId, ruleTypeCode: 'pass-mark', ruleKey: 'undergraduate-default', ruleValue: { mark: 40 }, validFrom: '2020-01-01T00:00:00.000Z',
  }, admin);
  const { academicPeriodId } = await call<{ academicPeriodId: string }>('POST', '/api/v1/academic-periods', {
    academicYear: '2026-27', periodCode: `${code}-S1`, periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15',
  });
  const { personId } = await call<{ personId: string }>('POST', '/api/v1/students', { legalFirstName: code, legalFamilyName: 'Candidate' });
  const { enrolmentId } = await call<{ enrolmentId: string }>('POST', '/api/v1/enrolments', {
    personId, programmeId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  });
  const { moduleId } = await call<{ moduleId: string }>('POST', '/api/v1/modules', { code: `${code}-M`, title: 'Module', creditValue: 20 });
  const { moduleOfferingId } = await call<{ moduleOfferingId: string }>('POST', '/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 10 });
  const { moduleRegistrationId } = await call<{ moduleRegistrationId: string }>('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId, registrationDate: '2026-10-01' });
  const { assessmentComponentId } = await call<{ assessmentComponentId: string }>('POST', `/api/v1/module-offerings/${moduleOfferingId}/components`, { componentTypeCode: 'coursework', title: 'Essay', weighting: 100 });
  await call('POST', `/api/v1/module-registrations/${moduleRegistrationId}/marks`, { assessmentComponentId, rawMark: 64 });
  const { examBoardId } = await call<{ examBoardId: string }>('POST', '/api/v1/exam-boards', { boardTypeCode: 'module', academicYear: '2026-27', academicPeriodId });
  await call('POST', `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`, { commentary: 'Ready' }, chair);
  return { examBoardId, programmeId, ruleId };
}

async function generate(examBoardId: string): Promise<Pack> {
  await call('POST', `/api/v1/exam-boards/${examBoardId}/data-pack`);
  return call<Pack>('GET', `/api/v1/exam-boards/${examBoardId}/data-pack`);
}

const decide = (examBoardId: string, pack: { dataPackId: string; packHash: string }, decisionTypeCode = 'ratify') =>
  raw('POST', `/api/v1/exam-boards/${examBoardId}/decisions`, { dataPackId: pack.dataPackId, packHash: pack.packHash, decisionTypeCode }, chair);

describe('Data pack hash and verification (D-36)', () => {
  it('hashes the pack at generation, verifies it from the stored rows, and detects tampering', async () => {
    const { examBoardId } = await boardWithCandidate();
    const pack = await generate(examBoardId);
    expect(pack.packHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(pack.ruleManifestRef).toMatch(/^sha256:[0-9a-f]{64}$/);

    const verified = await call<{ status: string; recomputedHash: string; manifestHashMatches: boolean }>('GET', `/api/v1/exam-boards/${examBoardId}/data-packs/${pack.dataPackId}/verification`);
    expect(verified).toMatchObject({ status: 'verified', recomputedHash: pack.packHash, manifestHashMatches: true });

    await ctx.db.execute(sql`UPDATE exam_board_candidate_profile SET profile_data = jsonb_set(profile_data, '{candidate,legalFamilyName}', '"Altered"') WHERE data_pack_id = ${pack.dataPackId}::uuid`);
    const tampered = await call<{ status: string }>('GET', `/api/v1/exam-boards/${examBoardId}/data-packs/${pack.dataPackId}/verification`);
    expect(tampered.status).toBe('mismatch');
  });

  it('lists the rules in force, and the drift when a cited rule has since changed', async () => {
    const { examBoardId, programmeId, ruleId } = await boardWithCandidate();
    const first = await generate(examBoardId);
    const manifest = await call<{ content: { inForce: Array<{ ruleTypeCode: string; programmeId: string | null; versionId: string }>; drift: unknown[]; cited: Array<{ versionId: string }> } }>(
      'GET', `/api/v1/exam-boards/${examBoardId}/data-packs/${first.dataPackId}/rule-manifest`);
    const passMark = manifest.content.inForce.find((r) => r.ruleTypeCode === 'pass-mark' && r.programmeId === programmeId)!;
    expect(passMark).toBeDefined();
    expect(manifest.content.cited.map((c) => c.versionId)).toContain(passMark.versionId);
    expect(manifest.content.drift).toEqual([]);

    // The rule changes after the result was calculated: the next pack shows the result's rule as drifted.
    await call('PATCH', `/api/v1/academic-rules/${ruleId}`, { ruleValue: { mark: 45 } }, admin);
    const second = await generate(examBoardId);
    const verification = await call<{ drift: Array<{ versionId: string; ruleTypeCode: string }> }>('GET', `/api/v1/exam-boards/${examBoardId}/data-packs/${second.dataPackId}/verification`);
    expect(verification.drift).toEqual([{ versionId: passMark.versionId, ruleTypeCode: 'pass-mark' }]);

    // With blockOnRuleDrift, the board cannot decide on that pack.
    await call('PATCH', '/api/v1/tenant/configuration', { examBoard: { pack: { blockOnRuleDrift: true } } }, admin);
    try {
      const blocked = await decide(examBoardId, second);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json<{ detail: string }>().detail).toMatch(/no longer in force/);
    } finally {
      await call('PATCH', '/api/v1/tenant/configuration', { examBoard: { pack: { blockOnRuleDrift: false } } }, admin);
    }
  });
});

describe('Decisions and ratification cite the exact pack (D-36)', () => {
  it('refuses a stale hash, a superseded pack and another board\'s pack', async () => {
    const a = await boardWithCandidate();
    const b = await boardWithCandidate();
    const first = await generate(a.examBoardId);
    const otherBoardsPack = await generate(b.examBoardId);

    expect((await decide(a.examBoardId, { dataPackId: first.dataPackId, packHash: `sha256:${'0'.repeat(64)}` })).statusCode).toBe(409);
    expect((await decide(a.examBoardId, otherBoardsPack)).statusCode).toBe(409);
    await generate(a.examBoardId);
    const superseded = await decide(a.examBoardId, first);
    expect(superseded.statusCode).toBe(409);
    expect(superseded.json<{ detail: string }>().detail).toMatch(/superseded/);
  });

  it('ratifies only after a ratify decision on the current pack, and records the pack it was ratified against', async () => {
    const { examBoardId } = await boardWithCandidate();
    const pack = await generate(examBoardId);

    // No decision yet.
    expect((await raw('POST', `/api/v1/exam-boards/${examBoardId}/ratification`, { packHash: pack.packHash }, chair)).statusCode).toBe(409);
    // A deferral is not a ratification.
    expect((await decide(examBoardId, pack, 'defer')).statusCode).toBe(201);
    expect((await raw('POST', `/api/v1/exam-boards/${examBoardId}/ratification`, { packHash: pack.packHash }, chair)).statusCode).toBe(409);

    // Regenerating the pack after a ratify decision makes the decision stale.
    expect((await decide(examBoardId, pack)).statusCode).toBe(201);
    const regenerated = await generate(examBoardId);
    expect((await raw('POST', `/api/v1/exam-boards/${examBoardId}/ratification`, { packHash: pack.packHash }, chair)).statusCode).toBe(409);
    expect((await raw('POST', `/api/v1/exam-boards/${examBoardId}/ratification`, { packHash: regenerated.packHash }, chair)).statusCode).toBe(409);

    expect((await ratifyThroughDecision(ctx, chair, examBoardId)).statusCode).toBe(204);
    const verification = await call<{ ratifiedAgainst: { dataPackId: string; packHash: string }; decisions: Array<{ matches: boolean; decisionTypeCode: string }> }>(
      'GET', `/api/v1/exam-boards/${examBoardId}/data-packs/${regenerated.dataPackId}/verification`);
    expect(verification.ratifiedAgainst).toEqual({ dataPackId: regenerated.dataPackId, packHash: regenerated.packHash });
    expect(verification.decisions.at(-1)).toMatchObject({ decisionTypeCode: 'ratify', matches: true });
  });

  it('is ratified by someone other than the person who recorded the decision (BL-065)', async () => {
    const { examBoardId } = await boardWithCandidate();
    const pack = await generate(examBoardId);
    expect((await decide(examBoardId, pack)).statusCode).toBe(201); // recorded by `chair`
    // BL-265: quorate, so ratification reaches the separation-of-duties check.
    expect((await raw('POST', `/api/v1/exam-boards/${examBoardId}/quorum-decision`, { requiredCount: 3, attendingCount: 3 }, chair)).statusCode).toBe(201);

    const own = await raw('POST', `/api/v1/exam-boards/${examBoardId}/ratification`, { packHash: pack.packHash }, chair);
    expect(own.statusCode).toBe(403);
    const other = await ctx.makeJwt({ sub: 'evidence-second-chair', roles: ['exam-board-chair'] });
    expect((await raw('POST', `/api/v1/exam-boards/${examBoardId}/ratification`, { packHash: pack.packHash }, other)).statusCode).toBe(204);
  });

  it('a ratification record cannot be made from a decision on a superseded pack', async () => {
    const { examBoardId } = await boardWithCandidate();
    const pack = await generate(examBoardId);
    const { decisionId } = (await decide(examBoardId, pack)).json<{ decisionId: string }>();
    await generate(examBoardId);
    const ratifier = await ctx.makeJwt({ sub: 'evidence-ratifier', roles: ['exam-board-chair'] });
    expect((await raw('POST', `/api/v1/board-decisions/${decisionId}/ratification`, undefined, ratifier)).statusCode).toBe(409);
  });
});
