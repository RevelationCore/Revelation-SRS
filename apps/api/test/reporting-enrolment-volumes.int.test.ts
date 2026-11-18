import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';
import { transitionEnrolment } from './helpers/transition.js';

/**
 * GET /api/v1/reporting/enrolment-volumes — the enrolment summary on the admin
 * Reporting → Enrolment volumes page and the dashboard. Counts must reflect
 * only each enrolment's current version, stay inside the caller's tenant and
 * need enrolment:read:all.
 */

interface Volumes {
  total:         number;
  byStatus:      Record<string, number>;
  byMode:        Record<string, number>;
  byYearOfEntry: Record<string, Record<string, number>>;
  byProgramme:   Array<{ programmeId: string; programmeCode: string | null; programmeName: string | null; count: number }>;
  generatedAt:   string;
}

let ctx: TestApp;
let staffJwt: string;
let programmeA: string;
let programmeB: string;

async function createProgramme(code: string, title: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST', url: '/api/v1/programmes', headers: { authorization: `Bearer ${staffJwt}` },
    payload: { code, title, creditFrameworkCode: 'cats', creditTotal: 360, durationYears: 3, modeOfStudyCode: 'full-time' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ programmeId: string }>().programmeId;
}

async function createEnrolment(opts: {
  mode: 'full-time' | 'part-time'; year: string; programmeId?: string; jwt?: string;
}): Promise<string> {
  const jwt = opts.jwt ?? staffJwt;
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: 'Volume', legalFamilyName: 'Tester' },
  });
  expect(student.statusCode).toBe(201);
  const res = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId: student.json<{ personId: string }>().personId,
      modeOfStudyCode: opts.mode,
      academicYearOfEntry: opts.year,
      startDate: `${opts.year.slice(0, 4)}-09-22`,
      fundingSourceCode: 'slc',
      ...(opts.programmeId ? { programmeId: opts.programmeId } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function getVolumes(jwt: string): Promise<Volumes> {
  const res = await ctx.app.inject({
    method: 'GET', url: '/api/v1/reporting/enrolment-volumes', headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Volumes>();
}

beforeAll(async () => {
  ctx = await startTestApp();
  staffJwt = await ctx.makeJwt();
  programmeA = await createProgramme('VOL-A', 'BSc Volume Studies');
  programmeB = await createProgramme('VOL-B', 'MA Volume Studies');
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('GET /api/v1/reporting/enrolment-volumes', () => {
  it('returns an empty summary before any enrolment exists', async () => {
    const before = Date.now();
    const v = await getVolumes(staffJwt);
    expect(v).toMatchObject({ total: 0, byStatus: {}, byMode: {}, byYearOfEntry: {}, byProgramme: [] });
    expect(Date.parse(v.generatedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it('counts current enrolments by status, mode, year of entry and programme', async () => {
    // Programme A: three full-time 2025-26 entrants. One stays enrolled, one
    // intermits and returns before withdrawing (three status versions), one intermits.
    await createEnrolment({ mode: 'full-time', year: '2025-26', programmeId: programmeA });
    const a2 = await createEnrolment({ mode: 'full-time', year: '2025-26', programmeId: programmeA });
    const a3 = await createEnrolment({ mode: 'full-time', year: '2025-26', programmeId: programmeA });
    // Programme B: one part-time 2024-25 entrant.
    await createEnrolment({ mode: 'part-time', year: '2024-25', programmeId: programmeB });
    // No programme yet: counted in the totals, left out of the programme list.
    await createEnrolment({ mode: 'part-time', year: '2025-26' });

    const t = Date.now();
    await transitionEnrolment(ctx, a2, 'intermitting', { validFrom: new Date(t + 1000) });
    await transitionEnrolment(ctx, a2, 'enrolled', { validFrom: new Date(t + 2000) });
    await transitionEnrolment(ctx, a2, 'withdrawn', { reasonCode: 'personal', validFrom: new Date(t + 3000) });
    await transitionEnrolment(ctx, a3, 'intermitting', { validFrom: new Date(t + 1000) });

    const v = await getVolumes(staffJwt);

    // Five enrolments, however many versions their status changes created.
    expect(v.total).toBe(5);
    expect(v.byStatus).toEqual({ enrolled: 3, intermitting: 1, withdrawn: 1 });
    expect(Object.values(v.byStatus).reduce((a, b) => a + b, 0)).toBe(v.total);
    expect(v.byMode).toEqual({ 'full-time': 3, 'part-time': 2 });
    expect(v.byYearOfEntry).toEqual({
      '2025-26': { enrolled: 2, intermitting: 1, withdrawn: 1 },
      '2024-25': { enrolled: 1 },
    });
    // Largest programme first; the enrolment with no programme is not listed.
    expect(v.byProgramme).toEqual([
      { programmeId: programmeA, programmeCode: 'VOL-A', programmeName: 'BSc Volume Studies', count: 3 },
      { programmeId: programmeB, programmeCode: 'VOL-B', programmeName: 'MA Volume Studies', count: 1 },
    ]);
  });

  it('only counts enrolments in the caller\'s tenant', async () => {
    const otherJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    expect((await getVolumes(otherJwt)).total).toBe(0);

    await createEnrolment({ mode: 'full-time', year: '2025-26', jwt: otherJwt });
    const other = await getVolumes(otherJwt);
    expect(other.total).toBe(1);
    expect(other.byStatus).toEqual({ enrolled: 1 });

    expect((await getVolumes(staffJwt)).total).toBe(5);
  });

  it('requires enrolment:read:all', async () => {
    const studentJwt = await ctx.makeJwt({ roles: ['student'] });
    const forbidden = await ctx.app.inject({
      method: 'GET', url: '/api/v1/reporting/enrolment-volumes', headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/v1/reporting/enrolment-volumes' });
    expect(anonymous.statusCode).toBe(401);

    // A role that may read all enrolments, though not a registry administrator.
    const examChairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
    expect((await getVolumes(examChairJwt)).total).toBe(5);
  });
});
