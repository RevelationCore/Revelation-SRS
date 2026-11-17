import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Subject areas and joint-honours balance (Phase 4 D-27). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let admin: string;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin });
  for (const [code, label] of [['HIST', 'History'], ['POL', 'Politics']]) {
    const res = await f.inject('POST', '/api/v1/value-sets/subject-area-code/members', { code, displayLabel: label }, admin);
    expect(res.statusCode, res.body).toBeLessThan(300);
  }
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const preview = async (proposalId: string) =>
  (await f.inject('GET', `/api/v1/module-selection-proposals/${proposalId}/validation`)).json<{ valid: boolean; messages: Array<{ ruleTypeCode: string; severity: string; message: string }> }>();

describe('Joint-honours balance', () => {
  it('validates subject proportions on a module', async () => {
    const m = await f.module();
    expect((await f.inject('PUT', `/api/v1/modules/${m.moduleId}/subjects`, [{ subjectAreaCode: 'HIST', proportionPercent: 60 }], admin)).statusCode).toBe(422);
    expect((await f.inject('PUT', `/api/v1/modules/${m.moduleId}/subjects`, [{ subjectAreaCode: 'GEOG', proportionPercent: 100 }], admin)).statusCode).toBe(422);
    const ok = await f.inject('PUT', `/api/v1/modules/${m.moduleId}/subjects`, [{ subjectAreaCode: 'HIST', proportionPercent: 50 }, { subjectAreaCode: 'POL', proportionPercent: 50 }], admin);
    expect(ok.statusCode).toBe(200);
    expect((await f.inject('GET', `/api/v1/modules/${m.moduleId}/subjects`)).json()).toHaveLength(2);
  });

  it('returns a selection outside the subject bounds, counting split modules by proportion and warning on unassigned modules', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    await f.ruleSet(programmeId);
    await f.rule(programmeId, 'joint-honours-balance', 'default', {
      components: [{ subjectAreaCode: 'HIST', minPercent: 40, maxPercent: 60 }, { subjectAreaCode: 'POL', minPercent: 40, maxPercent: 60 }],
    });
    const hist1 = await f.module(20); const hist2 = await f.module(20); const split = await f.module(20); const pol = await f.module(20); const none = await f.module(20);
    for (const h of [hist1, hist2]) await f.inject('PUT', `/api/v1/modules/${h.moduleId}/subjects`, [{ subjectAreaCode: 'HIST', proportionPercent: 100 }], admin);
    await f.inject('PUT', `/api/v1/modules/${pol.moduleId}/subjects`, [{ subjectAreaCode: 'POL', proportionPercent: 100 }], admin);
    await f.inject('PUT', `/api/v1/modules/${split.moduleId}/subjects`, [{ subjectAreaCode: 'HIST', proportionPercent: 50 }, { subjectAreaCode: 'POL', proportionPercent: 50 }], admin);
    const { enrolmentId } = await f.student(programmeId);

    // 50 HIST, 30 POL and 20 unassigned of 100: HIST 50%, POL 30% (below 40).
    const proposalId = await f.proposal(enrolmentId, periodId);
    for (const m of [hist1, split, pol, none]) await f.item(proposalId, m.moduleId, await f.offering(m.moduleId, periodId));
    await f.item(proposalId, hist2.moduleId, await f.offering(hist2.moduleId, periodId));
    let v = await preview(proposalId);
    expect(v.valid).toBe(false);
    expect(v.messages.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([expect.stringContaining('POL makes up 30%')]);
    expect(v.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleTypeCode: 'joint-honours-balance', severity: 'warning', message: expect.stringContaining(none.code) }),
    ]));

    // Swapping the unassigned module for politics balances it: 50 HIST, 50 POL of 100.
    const p = await f.getProposal(proposalId);
    const noneItem = p.items.find((i) => i.moduleId === none.moduleId)!;
    await f.inject('DELETE', `/api/v1/module-selection-proposals/${proposalId}/items/${noneItem.proposalItemId}`);
    const pol2 = await f.module(20);
    await f.inject('PUT', `/api/v1/modules/${pol2.moduleId}/subjects`, [{ subjectAreaCode: 'POL', proportionPercent: 100 }], admin);
    await f.item(proposalId, pol2.moduleId, await f.offering(pol2.moduleId, periodId));
    v = await preview(proposalId);
    expect(v.messages.filter((m) => m.severity === 'error')).toEqual([]);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });

  it('a rule exception varying the tolerance lets a near-balanced selection through', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    await f.ruleSet(programmeId);
    await f.rule(programmeId, 'joint-honours-balance', 'default', { components: [{ subjectAreaCode: 'HIST', minPercent: 50, maxPercent: 50 }] });
    const h = await f.module(40); const p = await f.module(60);
    await f.inject('PUT', `/api/v1/modules/${h.moduleId}/subjects`, [{ subjectAreaCode: 'HIST', proportionPercent: 100 }], admin);
    await f.inject('PUT', `/api/v1/modules/${p.moduleId}/subjects`, [{ subjectAreaCode: 'POL', proportionPercent: 100 }], admin);
    const { enrolmentId } = await f.student(programmeId);
    const proposalId = await f.proposal(enrolmentId, periodId);
    await f.item(proposalId, h.moduleId, await f.offering(h.moduleId, periodId));
    await f.item(proposalId, p.moduleId, await f.offering(p.moduleId, periodId));
    expect((await preview(proposalId)).valid).toBe(false);

    const proposer = await ctx.makeJwt({ sub: 'jh-proposer', roles: ['registry-administrator'] });
    const decider = await ctx.makeJwt({ sub: 'jh-decider', roles: ['programme-approver'] });
    const ex = await f.inject('POST', `/api/v1/enrolments/${enrolmentId}/rule-exceptions`, {
      ruleCode: 'joint-honours-balance', exceptionTypeCode: 'variation', description: 'Approved imbalance', validFrom: '2020-01-01',
      variationValue: { tolerancePercent: 10 },
    }, proposer);
    expect(ex.statusCode, ex.body).toBe(201);
    const exceptionId = ex.json<{ ruleExceptionId: string }>().ruleExceptionId;
    expect((await f.inject('POST', `/api/v1/rule-exceptions/${exceptionId}/decision`, { decisionCode: 'approved', reason: 'Board agreed' }, decider)).statusCode).toBe(200);
    expect((await preview(proposalId)).valid).toBe(true);
  });
});
