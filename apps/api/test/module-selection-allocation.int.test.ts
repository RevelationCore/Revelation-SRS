import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Ranked preference allocation (Phase 4 D-30). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let runner: string;
let approver: string;

beforeAll(async () => {
  ctx = await startTestApp();
  runner = await ctx.makeJwt({ sub: 'alloc-runner', roles: ['registry-administrator'] });
  approver = await ctx.makeJwt({ sub: 'alloc-approver', roles: ['programme-approver'] });
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();

interface Run { allocationRunId: string; statusCode: string; summary: { proposals: number; fullyAllocated: number; partlyAllocated: number }; results: Array<{ proposalId: string; orderPosition: number; outcomeCode: string; choiceSlot: number | null; reason: string | null }> }

async function setUp(capX: number, capY: number) {
  const periodId = await f.period();
  const programmeId = await f.programme();
  await f.ruleSet(programmeId);
  const fixed = await f.module(); const x = await f.module(); const y = await f.module();
  const of = await f.offering(fixed.moduleId, periodId, 100);
  const ox = await f.offering(x.moduleId, periodId, capX);
  const oy = await f.offering(y.moduleId, periodId, capY);
  const w = await f.inject('POST', '/api/v1/module-selection-windows', {
    academicPeriodId: periodId, opensAt: iso(-1), closesAt: iso(1), resubmissionClosesAt: iso(3), allocationModeCode: 'ranked',
  });
  expect(w.statusCode).toBe(201);
  return { periodId, programmeId, fixed, x, y, of, ox, oy, windowId: w.json<{ moduleSelectionWindowId: string }>().moduleSelectionWindowId };
}

async function rankedStudent(s: Awaited<ReturnType<typeof setUp>>, withFixed = false): Promise<string> {
  const { enrolmentId } = await f.student(s.programmeId);
  const proposalId = await f.proposal(enrolmentId, s.periodId);
  if (withFixed) await f.item(proposalId, s.fixed.moduleId, s.of);
  await f.item(proposalId, s.x.moduleId, s.ox, { choiceSlot: 1, preferenceRank: 1 });
  await f.item(proposalId, s.y.moduleId, s.oy, { choiceSlot: 1, preferenceRank: 2 });
  const res = await f.submit(proposalId);
  expect(res.json<{ statusCode: string }>().statusCode).toBe('awaiting-allocation');
  return proposalId;
}

const preview = async (windowId: string) => {
  const res = await f.inject('POST', `/api/v1/module-selection-windows/${windowId}/allocation-runs`, { kindCode: 'main' }, runner);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Run>();
};

describe('Ranked allocation', () => {
  it('allocates in a recorded random order, honouring ranks and capacity, after a second person approves', async () => {
    const s = await setUp(1, 5);
    const proposals = [await rankedStudent(s), await rankedStudent(s), await rankedStudent(s)];

    const first = await preview(s.windowId);
    expect(first.summary).toMatchObject({ proposals: 3, fullyAllocated: 3 });
    expect(first.results.filter((r) => r.reason?.includes('First choice'))).toHaveLength(1);
    // The seed is fixed per window: a second preview gives the same order.
    const second = await preview(s.windowId);
    expect(second.results.map((r) => [r.proposalId, r.orderPosition])).toEqual(first.results.map((r) => [r.proposalId, r.orderPosition]));

    expect((await f.inject('POST', `/api/v1/allocation-runs/${second.allocationRunId}/submission`, undefined, runner)).statusCode).toBe(200);
    // The runner cannot approve their own run, even holding module-selection:decide.
    expect((await f.inject('POST', `/api/v1/allocation-runs/${second.allocationRunId}/decision`, { decisionCode: 'approved' }, runner)).statusCode).toBe(403);
    const applied = await f.inject('POST', `/api/v1/allocation-runs/${second.allocationRunId}/decision`, { decisionCode: 'approved' }, approver);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json<Run>().statusCode).toBe('applied');

    const regs = await Promise.all(proposals.map(async (id) => {
      const p = await f.getProposal(id);
      expect(p.statusCode).toBe('confirmed');
      const r = (await f.inject('GET', `/api/v1/module-registrations?moduleOfferingId=${s.ox}`)).json<unknown[]>();
      return r.length;
    }));
    expect(regs[0]).toBe(1);
    expect((await f.inject('GET', `/api/v1/module-registrations?moduleOfferingId=${s.oy}`)).json<unknown[]>()).toHaveLength(2);
    const outcome = (await f.inject('GET', `/api/v1/module-selection-proposals/${proposals[0]}/allocation`)).json<{ orderPosition: number }>();
    expect(outcome.orderPosition).toBeGreaterThanOrEqual(1);
  });

  it('refuses to apply when selections changed since the preview', async () => {
    const s = await setUp(1, 1);
    await rankedStudent(s);
    const run = await preview(s.windowId);
    await f.inject('POST', `/api/v1/allocation-runs/${run.allocationRunId}/submission`, undefined, runner);
    await rankedStudent(s);
    expect((await f.inject('POST', `/api/v1/allocation-runs/${run.allocationRunId}/decision`, { decisionCode: 'approved' }, approver)).statusCode).toBe(409);
  });

  it('returns a student it could not fill, holding their other places, and takes the resubmission first come', async () => {
    const s = await setUp(1, 1);
    const proposals = [await rankedStudent(s, true), await rankedStudent(s, true), await rankedStudent(s, true)];
    const run = await preview(s.windowId);
    expect(run.summary).toMatchObject({ proposals: 3, fullyAllocated: 2, partlyAllocated: 1 });
    await f.inject('POST', `/api/v1/allocation-runs/${run.allocationRunId}/submission`, undefined, runner);
    expect((await f.inject('POST', `/api/v1/allocation-runs/${run.allocationRunId}/decision`, { decisionCode: 'approved' }, approver)).statusCode).toBe(200);

    const states = await Promise.all(proposals.map((id) => f.getProposal(id)));
    const returned = states.find((p) => p.statusCode === 'returned')!;
    expect(returned).toMatchObject({ decisionAuthorityCode: 'allocation' });
    expect(returned.decisionReason).toMatch(/could not fill 1 choice/);
    const heldItem = returned.items.find((i) => i.moduleId === s.fixed.moduleId) as unknown as { heldUntil: string | null };
    expect(heldItem.heldUntil).not.toBeNull();

    // Resubmission is first come: with no other places for the slot, the student drops it and keeps the held place.
    for (const i of returned.items.filter((x) => x.choiceSlot !== null)) {
      await f.inject('DELETE', `/api/v1/module-selection-proposals/${returned.moduleSelectionProposalId}/items/${i.proposalItemId}`);
    }
    const resubmitted = await f.submit(returned.moduleSelectionProposalId);
    expect(resubmitted.json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });
});
