import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RULE_TYPE_DOMAIN, SELECTION_RULE_TYPES } from '../src/platform/rules-engine/engine.js';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * The Phase 4 exit (D-23): module-selection validation enforces every rule
 * type the rules engine classifies as a selection rule. Each type gets a
 * selection that breaks it; validation must report that rule type.
 */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let admin: string;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin });
  await f.inject('POST', '/api/v1/value-sets/subject-area-code/members', { code: 'ECON', displayLabel: 'Economics' }, admin);
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

/** Builds a programme, a student and a proposal that breaks the rule; returns the proposal id. */
const VIOLATIONS: Record<string, () => Promise<string>> = {
  'max-credits-per-period': async () => {
    const s = await base();
    await f.rule(s.programmeId, 'max-credits-per-period', 'per-period', { maxCredits: 30 });
    return withModules(s, [20, 20]);
  },
  'credit-load-requirement': async () => {
    const s = await base();
    await f.rule(s.programmeId, 'credit-load-requirement', 'full-time', { minCredits: 60, maxCredits: null });
    return withModules(s, [20]);
  },
  'level-credit-requirement': async () => {
    const s = await base();
    await f.rule(s.programmeId, 'level-credit-requirement', 'level-4', { minCreditsAtLevel: 60 });
    return withModules(s, [20]);
  },
  'adjacent-level-credit-limit': async () => {
    const s = await base();
    await f.rule(s.programmeId, 'adjacent-level-credit-limit', 'default', { maxCredits: 10 });
    const proposalId = await f.proposal(s.enrolmentId, s.periodId);
    for (const [credit, level] of [[40, 4], [20, 5]] as const) {
      const m = await f.module(credit, level);
      await f.item(proposalId, m.moduleId, await f.offering(m.moduleId, s.periodId));
    }
    return proposalId;
  },
  'joint-honours-balance': async () => {
    const s = await base();
    await f.rule(s.programmeId, 'joint-honours-balance', 'default', { components: [{ subjectAreaCode: 'ECON', minPercent: 50 }] });
    return withModules(s, [20]);
  },
  'repeat-module-requirement': async () => {
    // An item flagged as a replacement when no repeat is required.
    const s = await base();
    const proposalId = await f.proposal(s.enrolmentId, s.periodId);
    const m = await f.module(20);
    await f.item(proposalId, m.moduleId, await f.offering(m.moduleId, s.periodId));
    await markReplacement(proposalId);
    return proposalId;
  },
  'timetable-clash-policy': async () => {
    const s = await base();
    const proposalId = await f.proposal(s.enrolmentId, s.periodId);
    const offerings: string[] = [];
    for (let n = 0; n < 2; n += 1) {
      const m = await f.module(20);
      const o = await f.offering(m.moduleId, s.periodId);
      offerings.push(o);
      await f.item(proposalId, m.moduleId, o);
    }
    await f.inject('POST', '/api/v1/timetable-publications', {
      academicPeriodId: s.periodId, sourceVersion: f.uniq('tt'),
      activities: offerings.map((o, n) => ({ moduleOfferingId: o, activityRef: `L${n}`, activityTypeCode: 'lecture', slots: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', weekCommencing: ['2026-09-21'] }] })),
    }, admin);
    return proposalId;
  },
};

async function base() {
  const periodId = await f.period();
  const programmeId = await f.programme();
  await f.ruleSet(programmeId);
  const { enrolmentId } = await f.student(programmeId);
  return { periodId, programmeId, enrolmentId };
}

async function withModules(s: { periodId: string; enrolmentId: string }, credits: number[]): Promise<string> {
  const proposalId = await f.proposal(s.enrolmentId, s.periodId);
  for (const c of credits) {
    const m = await f.module(c);
    await f.item(proposalId, m.moduleId, await f.offering(m.moduleId, s.periodId));
  }
  return proposalId;
}

/** Flags the proposal's item as a replacement for a plan that does not apply to this student. */
async function markReplacement(proposalId: string): Promise<void> {
  const { sql } = await import('drizzle-orm');
  await ctx.db.execute(sql`UPDATE module_selection_proposal_item SET is_replacement = true, reassessment_plan_id = gen_random_uuid() WHERE proposal_id = ${proposalId}::uuid`);
}

describe('Selection rule coverage (Phase 4 exit)', () => {
  it('every rule type is classified, and the selection ones are exactly those with a violating fixture', () => {
    expect(Object.keys(RULE_TYPE_DOMAIN)).toHaveLength(21);
    expect([...SELECTION_RULE_TYPES].sort()).toEqual(Object.keys(VIOLATIONS).sort());
  });

  for (const ruleType of SELECTION_RULE_TYPES) {
    it(`validation reports ${ruleType}`, async () => {
      const proposalId = await VIOLATIONS[ruleType]!();
      const v = (await f.inject('GET', `/api/v1/module-selection-proposals/${proposalId}/validation`)).json<{ messages: Array<{ ruleTypeCode: string }> }>();
      expect(v.messages.map((m) => m.ruleTypeCode)).toContain(ruleType);
    });
  }
});
