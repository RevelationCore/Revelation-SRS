import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Selection windows (Phase 4 D-29). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let staff: string;
let registry: string;
let approver: string;

beforeAll(async () => {
  ctx = await startTestApp();
  staff = await ctx.makeJwt();
  registry = await ctx.makeJwt({ sub: 'window-registry', roles: ['registry-administrator'] });
  approver = await ctx.makeJwt({ sub: 'window-approver', roles: ['programme-approver'] });
  f = selectionFixtures(ctx, { staff, admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const window = (academicPeriodId: string, opensAt: string, closesAt: string, extra: Record<string, unknown> = {}) =>
  f.inject('POST', '/api/v1/module-selection-windows', { academicPeriodId, opensAt, closesAt, allocationModeCode: 'first-come', ...extra });

describe('Module selection windows', () => {
  it('refuses a student submission outside the window, keeps drafts editable, and lets staff submit late with a reason', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    await f.ruleSet(programmeId);
    const { moduleId } = await f.module();
    const offeringId = await f.offering(moduleId, periodId);
    const { enrolmentId } = await f.student(programmeId);
    expect((await window(periodId, '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z')).statusCode).toBe(201);

    const proposalId = await f.proposal(enrolmentId, periodId);
    await f.item(proposalId, moduleId, offeringId);
    const closed = await f.submit(proposalId);
    expect(closed.statusCode).toBe(422);
    expect(closed.json<{ detail: string }>().detail).toMatch(/closed/);

    // A late submission needs the permission, and a reason from the value set.
    expect((await f.submit(proposalId, { lateSubmission: { reasonCode: 'late-enrolment', note: 'Enrolled in week 3' } }, approver)).statusCode).toBe(403);
    expect((await f.submit(proposalId, { lateSubmission: { reasonCode: 'not-a-reason', note: 'x' } }, registry)).statusCode).toBe(422);
    const late = await f.submit(proposalId, { lateSubmission: { reasonCode: 'late-enrolment', note: 'Enrolled in week 3' } }, registry);
    expect(late.statusCode).toBe(200);
    expect(late.json<{ statusCode: string; lateSubmissionReasonCode: string; lateSubmittedBy: string }>()).toMatchObject({
      statusCode: 'confirmed', lateSubmissionReasonCode: 'late-enrolment', lateSubmittedBy: 'window-registry',
    });
  });

  it('applies the most specific window, and refuses overlapping windows of the same scope', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    await f.ruleSet(programmeId);
    const { moduleId } = await f.module();
    const offeringId = await f.offering(moduleId, periodId);
    const { enrolmentId } = await f.student(programmeId);

    expect((await window(periodId, '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z')).statusCode).toBe(201);
    expect((await window(periodId, '2020-01-15T00:00:00.000Z', '2020-03-01T00:00:00.000Z')).statusCode).toBe(409);
    // The programme's own window is open now, so it wins over the closed whole-period one.
    expect((await window(periodId, '2020-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', { programmeId })).statusCode).toBe(201);

    const proposalId = await f.proposal(enrolmentId, periodId);
    await f.item(proposalId, moduleId, offeringId);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('confirmed');

    const listed = (await f.inject('GET', `/api/v1/module-selection-windows?academicPeriodId=${periodId}`)).json<Array<{ programmeId: string | null }>>();
    expect(listed.map((w) => w.programmeId).sort()).toEqual([null, programmeId].sort());
  });

  it('an approver confirming a waitlisted proposal after the window closes still registers it (D-29 defect fix)', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    await f.ruleSet(programmeId);
    const { moduleId } = await f.module();
    const offeringId = await f.offering(moduleId, periodId, 1);
    const filler = await f.student(programmeId);
    expect((await f.inject('POST', '/api/v1/module-registrations', { enrolmentId: filler.enrolmentId, moduleOfferingId: offeringId, registrationDate: '2026-10-01' })).statusCode).toBe(201);

    const created = await window(periodId, '2020-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    const windowId = created.json<{ moduleSelectionWindowId: string }>().moduleSelectionWindowId;
    const { enrolmentId } = await f.student(programmeId);
    const proposalId = await f.proposal(enrolmentId, periodId);
    await f.item(proposalId, moduleId, offeringId);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('waitlisted');

    // The window closes before the approver decides.
    expect((await f.inject('PATCH', `/api/v1/module-selection-windows/${windowId}`, { opensAt: '2020-01-01T00:00:00.000Z', closesAt: '2020-06-01T00:00:00.000Z' })).statusCode).toBe(204);
    const decided = await f.inject('POST', `/api/v1/module-selection-proposals/${proposalId}/decision`, { decisionCode: 'approved', reason: 'Room for one more' }, approver);
    expect(decided.statusCode).toBe(200);
    expect(decided.json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });

  it('a returned proposal may be resubmitted until resubmission closes', async () => {
    const periodId = await f.period();
    const programmeId = await f.programme();
    const ruleSetId = await f.ruleSet(programmeId);
    const core = await f.module();
    const coreOffering = await f.offering(core.moduleId, periodId);
    const groupId = await f.group(ruleSetId, { groupTypeCode: 'compulsory', minModules: 1, title: 'Core' });
    await f.member(groupId, core.moduleId, { isDefault: true });
    const other = await f.module();
    const otherOffering = await f.offering(other.moduleId, periodId);
    const { enrolmentId } = await f.student(programmeId);
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const created = await window(periodId, iso(now - 86_400_000), iso(now + 86_400_000), { resubmissionClosesAt: iso(now + 3 * 86_400_000) });
    expect(created.statusCode).toBe(201);
    const windowId = created.json<{ moduleSelectionWindowId: string }>().moduleSelectionWindowId;

    const proposalId = await f.proposal(enrolmentId, periodId);
    await f.clearItems(proposalId);
    await f.item(proposalId, other.moduleId, otherOffering);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('returned');

    // The main window has closed; resubmission is still open.
    expect((await f.inject('PATCH', `/api/v1/module-selection-windows/${windowId}`, {
      opensAt: iso(now - 2 * 86_400_000), closesAt: iso(now - 3_600_000), resubmissionClosesAt: iso(now + 86_400_000),
    })).statusCode).toBe(204);
    await f.item(proposalId, core.moduleId, coreOffering);
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });

  it('a tenant requiring windows refuses submission when no window is configured', async () => {
    const tenantId = ctx.secondTenantId;
    const admin = await ctx.makeJwt({ tenantId, roles: ['tenant-administrator'] });
    const t = selectionFixtures(ctx, { staff: await ctx.makeJwt({ tenantId }), admin });
    expect((await t.inject('PATCH', '/api/v1/tenant/configuration', { moduleSelection: { windowEnforcement: 'required' } }, admin)).statusCode).toBe(200);
    const periodId = await t.period();
    const programmeId = await t.programme();
    await t.ruleSet(programmeId);
    const { moduleId } = await t.module();
    const offeringId = await t.offering(moduleId, periodId);
    const { enrolmentId } = await t.student(programmeId);
    const proposalId = await t.proposal(enrolmentId, periodId);
    await t.item(proposalId, moduleId, offeringId);
    const res = await t.submit(proposalId);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toMatch(/No module selection window/);
  });
});
