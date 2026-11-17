import { randomUUID } from 'node:crypto';

import { moduleRegistrations, moduleResults, progressionDecisions, reassessmentPlans, withTenantContext } from '@revelation-srs/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { messages, selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Repeat-module requirement (Phase 4 D-28). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let lastYear: string;

beforeAll(async () => {
  ctx = await startTestApp();
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
  lastYear = await f.period({ academicYear: '2025-26', startDate: '2025-09-22', endDate: '2026-01-16' });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

type T = `${string}-${string}-${string}-${string}-${string}`;

/** A ratified board outcome: the student failed `offeringId` last year and must repeat it. */
async function boardRequiresRepeat(enrolmentId: string, failedOfferingId: string, planTypeCode: 'repeat-module' | 'repeat-stage', academicPeriodId: string): Promise<string> {
  const now = new Date('2026-07-01T00:00:00Z');
  const registrationId = randomUUID() as T;
  const decisionId = randomUUID() as T;
  const planId = randomUUID() as T;
  const t = ctx.tenantId as T;
  await withTenantContext(ctx.db, ctx.tenantId, async (tx) => {
    await tx.insert(moduleRegistrations).values({
      versionId: randomUUID() as T, id: registrationId, tenantId: t, enrolmentId: enrolmentId as T, moduleOfferingId: failedOfferingId as T,
      statusCode: 'completed', registrationDate: '2025-10-01', validFrom: new Date('2025-10-01T00:00:00Z'), validTo: null, recordedAt: now, recordedUntil: null,
    });
    await tx.insert(moduleResults).values({
      versionId: randomUUID() as T, id: randomUUID() as T, tenantId: t, moduleRegistrationId: registrationId, aggregateMark: '22.00', resultCode: 'fail',
      locked: true, validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
    });
    await tx.insert(progressionDecisions).values({
      versionId: randomUUID() as T, id: decisionId, tenantId: t, enrolmentId: enrolmentId as T, academicYear: '2025-26', yearOfStudy: '1',
      decisionCode: 'repeat-year', locked: true, actorId: 'board', validFrom: now, validTo: null, recordedAt: now, recordedUntil: null,
    });
    await tx.insert(reassessmentPlans).values({
      id: planId, tenantId: t, enrolmentId: enrolmentId as T, progressionDecisionId: decisionId, planTypeCode,
      moduleRegistrationId: planTypeCode === 'repeat-module' ? registrationId : null, academicPeriodId: academicPeriodId as T,
      attemptNumber: 2, markCap: 40, createdBy: 'board',
    });
  });
  return planId;
}

async function setUp() {
  const periodId = await f.period();
  const programmeId = await f.programme();
  const ruleSetId = await f.ruleSet(programmeId);
  const optional = await f.group(ruleSetId, { groupTypeCode: 'optional-pool', title: 'Options' });
  const failed = await f.module(20);
  const alt = await f.module(20);
  const small = await f.module(10);
  for (const m of [failed, alt, small]) await f.member(optional, m.moduleId);
  const failedOld = await f.offering(failed.moduleId, lastYear);
  const failedNow = await f.offering(failed.moduleId, periodId);
  const altNow = await f.offering(alt.moduleId, periodId);
  const smallNow = await f.offering(small.moduleId, periodId);
  const { enrolmentId } = await f.student(programmeId);
  return { periodId, programmeId, failed, alt, small, failedOld, failedNow, altNow, smallNow, enrolmentId };
}

describe('Repeat-module requirement', () => {
  it('adds the failed module as repeat-required, refuses a selection without it, and links the plan at confirmation', async () => {
    const s = await setUp();
    const planId = await boardRequiresRepeat(s.enrolmentId, s.failedOld, 'repeat-module', s.periodId);

    const proposalId = await f.proposal(s.enrolmentId, s.periodId);
    const p = await f.getProposal(proposalId);
    const repeatItem = p.items.find((i) => i.sourceCode === 'repeat-required');
    expect(repeatItem).toMatchObject({ moduleId: s.failed.moduleId, moduleOfferingId: s.failedNow, reassessmentPlanId: planId });

    await f.inject('DELETE', `/api/v1/module-selection-proposals/${proposalId}/items/${repeatItem!.proposalItemId}`);
    const preview = (await f.inject('GET', `/api/v1/module-selection-proposals/${proposalId}/validation`)).json<{ valid: boolean; messages: Array<{ ruleTypeCode: string; message: string }> }>();
    expect(preview.valid).toBe(false);
    expect(preview.messages).toContainEqual(expect.objectContaining({ ruleTypeCode: 'repeat-module-requirement', message: expect.stringContaining(s.failed.code) }));

    await f.item(proposalId, s.failed.moduleId, s.failedNow);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('confirmed');
    const plans = (await f.inject('GET', `/api/v1/enrolments/${s.enrolmentId}/reassessment-plans`)).json<Array<{ reassessmentPlanId: string }>>();
    expect(plans.find((x) => x.reassessmentPlanId === planId)).toBeDefined();
    const [plan] = await withTenantContext(ctx.db, ctx.tenantId, (tx) => tx.select().from(reassessmentPlans).where(eq(reassessmentPlans.id, planId as T)));
    expect(plan?.repeatModuleRegistrationId).not.toBeNull();
  });

  it('accepts an optional-pool replacement with enough credit, and refuses one with too little', async () => {
    const s = await setUp();
    const planId = await boardRequiresRepeat(s.enrolmentId, s.failedOld, 'repeat-stage', s.periodId);

    const proposalId = await f.proposal(s.enrolmentId, s.periodId);
    await f.clearItems(proposalId);
    const smallItem = await f.item(proposalId, s.small.moduleId, s.smallNow, { replacesReassessmentPlanId: planId });
    let preview = (await f.inject('GET', `/api/v1/module-selection-proposals/${proposalId}/validation`)).json<{ messages: Array<{ proposalItemId: string | null; message: string }> }>();
    expect(preview.messages).toContainEqual(expect.objectContaining({ proposalItemId: smallItem, message: expect.stringContaining('fewer credits') }));

    await f.inject('DELETE', `/api/v1/module-selection-proposals/${proposalId}/items/${smallItem}`);
    await f.item(proposalId, s.alt.moduleId, s.altNow, { replacesReassessmentPlanId: planId });
    preview = (await f.inject('GET', `/api/v1/module-selection-proposals/${proposalId}/validation`)).json();
    expect(preview.messages.filter((m) => m.message.includes('repeat'))).toEqual([]);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });

  it('applies the rule: no replacements, a cap on repeat credit, and repeat credit left out of the load', async () => {
    const s = await setUp();
    const planId = await boardRequiresRepeat(s.enrolmentId, s.failedOld, 'repeat-module', s.periodId);
    await f.rule(s.programmeId, 'repeat-module-requirement', 'default', { allowReplacement: 'never', maxRepeatCredits: 10, countTowardsCreditLoad: false });
    await f.rule(s.programmeId, 'credit-load-requirement', 'full-time', { minCredits: 20, maxCredits: null });

    const proposalId = await f.proposal(s.enrolmentId, s.periodId);
    await f.clearItems(proposalId);
    await f.item(proposalId, s.alt.moduleId, s.altNow, { replacesReassessmentPlanId: planId });
    await f.item(proposalId, s.failed.moduleId, s.failedNow);
    const p = await f.submit(proposalId);
    const reason = p.json<{ decisionReason: string }>().decisionReason;
    expect(reason).toContain('exceed the limit of 10');
    const after = await f.getProposal(proposalId);
    expect(messages(after).map((m) => m.message).join(' ')).toMatch(/replaces a repeat that is already met/);
    // The 20 repeated credits do not count, so the 20 replacement-flagged credits are all the load has.
    expect(reason).not.toMatch(/below the minimum/);
  });
});
