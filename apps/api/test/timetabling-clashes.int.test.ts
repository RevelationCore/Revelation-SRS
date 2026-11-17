import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectionFixtures } from './helpers/selection-fixtures.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

/** Timetable publications (Phase 4 D-24) and clash checks in selection (D-25). */
let ctx: TestApp;
let f: ReturnType<typeof selectionFixtures>;
let registry: string;

beforeAll(async () => {
  ctx = await startTestApp();
  registry = await ctx.makeJwt({ sub: 'tt-registry', roles: ['registry-administrator'] });
  f = selectionFixtures(ctx, { staff: await ctx.makeJwt(), admin: await ctx.makeJwt({ roles: ['tenant-administrator'] }) });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05'];
const lecture = (moduleOfferingId: string, ref: string, dayOfWeek: number, startTime: string, endTime: string, extra: Record<string, unknown> = {}) => ({
  moduleOfferingId, activityRef: ref, activityTypeCode: 'lecture', slots: [{ dayOfWeek, startTime, endTime, weekCommencing: WEEKS }], ...extra,
});
const publish = (academicPeriodId: string, sourceVersion: string, activities: unknown[], extra: Record<string, unknown> = {}) =>
  f.inject('POST', '/api/v1/timetable-publications', { academicPeriodId, sourceVersion, activities, ...extra }, registry);
const preview = async (proposalId: string) =>
  (await f.inject('GET', `/api/v1/module-selection-proposals/${proposalId}/validation`)).json<{ valid: boolean; messages: Array<{ ruleTypeCode: string; severity: string; message: string; proposalItemId: string | null }> }>();

async function twoOfferings() {
  const periodId = await f.period();
  const programmeId = await f.programme();
  await f.ruleSet(programmeId);
  const a = await f.module(); const b = await f.module();
  return { periodId, programmeId, a, b, oa: await f.offering(a.moduleId, periodId), ob: await f.offering(b.moduleId, periodId) };
}

describe('Timetable publications', () => {
  it('rejects a publication naming an unknown or ambiguous offering, keeping the previous one current', async () => {
    const s = await twoOfferings();
    const ok = await publish(s.periodId, 'v1', [lecture(s.oa, 'A-LEC', 1, '09:00', '10:00')]);
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ statusCode: string }>().statusCode).toBe('applied');

    const bad = await publish(s.periodId, 'v2', [
      lecture(s.oa, 'A-LEC', 2, '09:00', '10:00'),
      { moduleCode: 'NO-SUCH-MODULE', activityRef: 'X', activityTypeCode: 'lecture', slots: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', weekCommencing: ['2026-09-22'] }] },
    ]);
    const rejected = bad.json<{ statusCode: string; rejectionReasons: string[] }>();
    expect(rejected.statusCode).toBe('rejected');
    expect(rejected.rejectionReasons.join(' ')).toMatch(/NO-SUCH-MODULE has no offering/);
    expect(rejected.rejectionReasons.join(' ')).toMatch(/2026-09-22 is not a Monday/);

    const current = (await f.inject('GET', `/api/v1/module-offerings/${s.oa}/timetable`, undefined, registry)).json<{ activities: Array<{ slots: Array<{ dayOfWeek: number }> }> }>();
    expect(current.activities[0]!.slots[0]!.dayOfWeek).toBe(1);

    // The same version again is a no-op; the same version with different content conflicts.
    expect((await publish(s.periodId, 'v1', [lecture(s.oa, 'A-LEC', 1, '09:00', '10:00')])).statusCode).toBe(201);
    expect((await publish(s.periodId, 'v1', [lecture(s.oa, 'A-LEC', 3, '09:00', '10:00')])).statusCode).toBe(409);
  });

  it('a full-period publication drops offerings it leaves out; the simulator derives a timetable for every offering', async () => {
    const s = await twoOfferings();
    await publish(s.periodId, 'p1', [lecture(s.oa, 'A', 1, '09:00', '10:00'), lecture(s.ob, 'B', 2, '09:00', '10:00')]);
    await publish(s.periodId, 'p2', [lecture(s.oa, 'A', 1, '11:00', '12:00')], { fullPeriod: true });
    expect((await f.inject('GET', `/api/v1/module-offerings/${s.ob}/timetable`, undefined, registry)).json<{ publicationId: string | null }>().publicationId).toBeNull();

    const sim = await f.inject('POST', `/api/v1/academic-periods/${s.periodId}/timetable-simulation`, undefined, registry);
    expect(sim.statusCode, sim.body).toBe(201);
    expect(sim.json<{ sourceSystemCode: string; statusCode: string }>()).toMatchObject({ sourceSystemCode: 'simulator', statusCode: 'applied' });
    for (const o of [s.oa, s.ob]) {
      const t = (await f.inject('GET', `/api/v1/module-offerings/${o}/timetable`, undefined, registry)).json<{ activities: Array<{ groupSetCode: string | null }> }>();
      expect(t.activities.map((a) => a.groupSetCode)).toEqual([null, 'SEM', 'SEM']);
    }
    const status = (await f.inject('GET', `/api/v1/academic-periods/${s.periodId}/timetable-status`, undefined, registry)).json<{ stale: boolean }>();
    expect(status.stale).toBe(false);
  });
});

describe('Timetable clashes in selection', () => {
  it('advisory by default: a clash is a warning on both items and the selection is confirmed', async () => {
    const s = await twoOfferings();
    await publish(s.periodId, 'c1', [lecture(s.oa, 'A', 1, '09:00', '11:00'), lecture(s.ob, 'B', 1, '10:00', '12:00')]);
    const { enrolmentId } = await f.student(s.programmeId);
    const proposalId = await f.proposal(enrolmentId, s.periodId);
    await f.item(proposalId, s.a.moduleId, s.oa);
    await f.item(proposalId, s.b.moduleId, s.ob);
    const v = await preview(proposalId);
    const clashes = v.messages.filter((m) => m.ruleTypeCode === 'timetable-clash-policy');
    expect(clashes).toHaveLength(2);
    expect(clashes[0]).toMatchObject({ severity: 'warning', message: expect.stringContaining('Monday 10:00–11:00') as string });
    expect((await f.submit(proposalId)).json<{ statusCode: string }>().statusCode).toBe('confirmed');
  });

  it('blocking: a clash returns the selection; a clash avoidable by choosing another group is not a clash; tolerance and excluded types apply', async () => {
    const s = await twoOfferings();
    const c = await f.module();
    const oc = await f.offering(c.moduleId, s.periodId);
    await f.rule(s.programmeId, 'timetable-clash-policy', 'default', { policy: 'blocking', toleranceMinutes: 10, excludeActivityTypes: ['online-asynchronous'] });
    await publish(s.periodId, 'b1', [
      lecture(s.oa, 'A-LEC', 2, '09:00', '10:00'),
      // B's seminar groups: group 1 clashes with A's lecture, group 2 does not, so the student can avoid it.
      lecture(s.ob, 'B-S1', 2, '09:00', '10:00', { activityTypeCode: 'seminar', groupSetCode: 'S', groupCode: '1' }),
      lecture(s.ob, 'B-S2', 3, '09:00', '10:00', { activityTypeCode: 'seminar', groupSetCode: 'S', groupCode: '2' }),
      // C overlaps A by 5 minutes (within tolerance), and has a self-paced slot at the same time (excluded).
      lecture(oc, 'C-LEC', 2, '09:55', '10:55'),
      lecture(oc, 'C-ONLINE', 2, '09:00', '10:00', { activityTypeCode: 'online-asynchronous' }),
    ]);
    const { enrolmentId } = await f.student(s.programmeId);
    const proposalId = await f.proposal(enrolmentId, s.periodId);
    for (const [m, o] of [[s.a, s.oa], [s.b, s.ob], [c, oc]] as const) await f.item(proposalId, m.moduleId, o);
    expect((await preview(proposalId)).messages.filter((m) => m.ruleTypeCode === 'timetable-clash-policy')).toEqual([]);

    // Make B's only group clash: now unavoidable, and blocking.
    await publish(s.periodId, 'b2', [lecture(s.ob, 'B-S1', 2, '09:30', '10:30', { activityTypeCode: 'seminar', groupSetCode: 'S', groupCode: '1' })]);
    const submitted = await f.submit(proposalId);
    expect(submitted.json<{ statusCode: string; decisionReason: string }>()).toMatchObject({ statusCode: 'returned' });
    expect(submitted.json<{ decisionReason: string }>().decisionReason).toMatch(/clashes with/);
  });

  it('checks clashes with existing registrations, and warns when an offering has no timetable', async () => {
    const s = await twoOfferings();
    const n = await f.module();
    const on = await f.offering(n.moduleId, s.periodId);
    await publish(s.periodId, 'e1', [lecture(s.oa, 'A', 4, '14:00', '15:00'), lecture(s.ob, 'B', 4, '14:00', '15:00')]);
    const { enrolmentId } = await f.student(s.programmeId);
    expect((await f.inject('POST', '/api/v1/module-registrations', { enrolmentId, moduleOfferingId: s.oa, registrationDate: '2026-10-01' })).statusCode).toBe(201);
    const proposalId = await f.proposal(enrolmentId, s.periodId);
    await f.item(proposalId, s.b.moduleId, s.ob);
    await f.item(proposalId, n.moduleId, on);
    const v = await preview(proposalId);
    expect(v.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleTypeCode: 'timetable-clash-policy', message: expect.stringContaining('already registered for') as string }),
      expect.objectContaining({ ruleTypeCode: 'timetable-clash-policy', severity: 'warning', message: expect.stringContaining(`${n.code} is not yet published`) as string }),
    ]));

    const tt = (await f.inject('GET', `/api/v1/module-registrations/timetable?enrolmentId=${enrolmentId}`)).json<Array<{ moduleOfferingId: string; activities: unknown[] }>>();
    expect(tt.find((r) => r.moduleOfferingId === s.oa)?.activities).toHaveLength(1);
  });
});
