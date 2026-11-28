/**
 * AJ-21 finding 2 — the SRS as the 'exams' adjustment target.
 *
 * Exam entries state the time a candidate is entitled to (120-minute exam,
 * 25% extra time → +30 = 150 minutes), the schedule returned by the
 * timetabling system confirms delivery on the distribution ledger, and an
 * adjustment's withdrawal removes it from entries for exams not yet sat while
 * leaving those already sat as they were.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { recordApprovedAdjustment, withdrawApprovedAdjustment } from './helpers/adjustments.js';
import { startTestApp, type TestApp } from './helpers/test-app.js';

const bus = {
  isConnected: () => true,
  publish: () => Promise.resolve(),
  connect: () => Promise.resolve(),
  close: () => Promise.resolve(),
} as unknown as IntegrationBusPublisher;

let ctx: TestApp;
let jwt: string;
let integrationJwt: string;

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: bus });
  jwt = await ctx.makeJwt();
  integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

interface Timing { assessmentComponentId: string; title: string; durationMinutes: number | null; extraMinutes: number | null; totalMinutes: number | null }
interface Accommodations {
  adjustments: Array<{ adjustmentId: string; distributionId: string | null; adjustmentTypeCode: string; applied: boolean; reason?: string }>;
  extraTimePercent: number;
  components: Timing[];
}
interface Entry { moduleRegistrationId: string; accommodations: Accommodations }

describe('Exam entries state the candidate\'s time', () => {
  it('states 150 minutes for a 120-minute exam with 25% extra time (AJ-21)', async () => {
    const f = await fixture('EA-150', [{ title: 'Written exam', durationMinutes: 120 }]);
    const { adjustmentId } = await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });

    const entry = await generate(f);

    expect(entry.accommodations.extraTimePercent).toBe(25);
    expect(entry.accommodations.components).toEqual([
      expect.objectContaining({ title: 'Written exam', durationMinutes: 120, extraMinutes: 30, totalMinutes: 150 }),
    ]);
    const [exams] = await distributions(adjustmentId);
    expect(entry.accommodations.adjustments).toEqual([
      expect.objectContaining({ adjustmentId, distributionId: exams!.distributionId, applied: true }),
    ]);
  });

  it('combines time adjustments (25% + 10 min/hour on 90 minutes = +38)', async () => {
    const f = await fixture('EA-COMB', [{ title: 'Paper 1', durationMinutes: 90 }]);
    await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    await adjust(f, 'rest-breaks', { value: 10, unitCode: 'minutes-per-hour' });

    const entry = await generate(f);

    expect(entry.accommodations.extraTimePercent).toBe(41.67);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 38, totalMinutes: 128 });
  });

  it('carries non-time arrangements, and leaves deadline extensions out', async () => {
    const f = await fixture('EA-ROOM', [{ title: 'Paper', durationMinutes: 60 }]);
    await adjust(f, 'separate-room', undefined);
    await adjust(f, 'deadline-extension', { value: 7, unitCode: 'days' }, 'all');

    const entry = await generate(f);

    expect(entry.accommodations.adjustments.map((a) => a.adjustmentTypeCode)).toEqual(['separate-room']);
    expect(entry.accommodations.adjustments[0]!.applied).toBe(true);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 0, totalMinutes: 60 });
  });

  it('reports a time adjustment without an amount as a failed exams distribution', async () => {
    const f = await fixture('EA-NOAMT', [{ title: 'Paper', durationMinutes: 120 }]);
    const { adjustmentId } = await adjust(f, 'extra-time', undefined);

    const entry = await generate(f);

    expect(entry.accommodations.adjustments[0]).toMatchObject({ applied: false });
    expect(entry.accommodations.adjustments[0]!.reason).toMatch(/amount/i);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 0, totalMinutes: 120 });
    const [exams] = await distributions(adjustmentId);
    expect(exams).toMatchObject({ statusCode: 'failed' });
    expect(exams!.failureReason).toMatch(/amount/i);
  });

  it('does not invent minutes when the exam has no recorded duration', async () => {
    const f = await fixture('EA-NODUR', [{ title: 'Untimed exam', durationMinutes: null }]);
    const { adjustmentId } = await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });

    const entry = await generate(f);

    expect(entry.accommodations.adjustments[0]).toMatchObject({ applied: false });
    expect(entry.accommodations.adjustments[0]!.reason).toMatch(/duration/i);
    expect(entry.accommodations.components[0]).toMatchObject({ durationMinutes: null, extraMinutes: null, totalMinutes: null });
    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'pending' });
  });
});

describe('Delivery and withdrawal on the distribution ledger', () => {
  it('the returned schedule confirms delivery of the arrangements the entry carried', async () => {
    const f = await fixture('EA-SCHED', [{ title: 'Paper', durationMinutes: 120 }]);
    const { adjustmentId } = await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    await generate(f);
    expect((await distributions(adjustmentId))[0]!.statusCode).toBe('pending');

    await schedule(f, '2027-12-10');

    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'distributed' });
  });

  it('withdrawal removes the arrangement from an exam not yet sat and confirms it', async () => {
    const f = await fixture('EA-WD', [{ title: 'Paper', durationMinutes: 120 }]);
    const { adjustmentId } = await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    await generate(f);

    await expire(adjustmentId);

    const entry = await currentEntry(f);
    expect(entry.accommodations.adjustments).toEqual([]);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 0, totalMinutes: 120 });
    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'withdrawn' });
  });

  it('withdrawal keeps the arrangement on an exam already sat', async () => {
    // In force from September 2026, exam sat on 1 November 2026, expired today.
    const f = await fixture('EA-SAT', [{ title: 'Paper', durationMinutes: 120 }], { validFrom: '2026-09-01T00:00:00.000Z', meetingDate: '2026-11-20' });
    const { adjustmentId } = await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    await generate(f);
    await schedule(f, '2026-11-01');

    await expire(adjustmentId);

    const entry = await currentEntry(f);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 30, totalMinutes: 150 });
    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'withdrawn' });
  });
});

describe('Adjustments approved after the entries were generated (BL-058)', () => {
  it('adds the arrangement to an unscheduled entry, and the next schedule confirms it', async () => {
    const f = await fixture('EA-LATE', [{ title: 'Paper', durationMinutes: 120 }]);
    const before = await generate(f);
    expect(before.accommodations.adjustments).toEqual([]);

    const { adjustmentId } = await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });

    const entry = await currentEntry(f);
    expect(entry.accommodations.adjustments).toEqual([expect.objectContaining({ adjustmentId, applied: true })]);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 30, totalMinutes: 150 });
    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'pending' });

    await schedule(f, '2027-12-10');
    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'distributed' });
  });

  it('adds it to a scheduled exam not yet sat and keeps the schedule', async () => {
    const f = await fixture('EA-LATESCH', [{ title: 'Paper', durationMinutes: 90 }]);
    await generate(f);
    await schedule(f, '2027-12-10');

    await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });

    const entry = await currentEntry(f) as Entry & { scheduledDate: string; candidateNumber: string; roomReference: string; statusCode: string };
    expect(entry).toMatchObject({ scheduledDate: '2027-12-10', candidateNumber: 'C-1', roomReference: 'HALL-A', statusCode: 'scheduled' });
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 23, totalMinutes: 113 });
  });

  it('combines with the arrangements the entry already carried', async () => {
    const f = await fixture('EA-LATECOMB', [{ title: 'Paper', durationMinutes: 90 }]);
    await adjust(f, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    await generate(f);

    await adjust(f, 'rest-breaks', { value: 10, unitCode: 'minutes-per-hour' });

    const entry = await currentEntry(f);
    expect(entry.accommodations.adjustments).toHaveLength(2);
    expect(entry.accommodations.components[0]).toMatchObject({ extraMinutes: 38, totalMinutes: 128 });
  });

  it('never rewrites an exam already sat, or one sat before the adjustment starts', async () => {
    const sat = await fixture('EA-LATESAT', [{ title: 'Paper', durationMinutes: 120 }], { validFrom: '2026-09-01T00:00:00.000Z', meetingDate: '2026-11-20' });
    await generate(sat);
    await schedule(sat, '2026-11-01');
    await adjust(sat, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    expect((await currentEntry(sat)).accommodations.adjustments).toEqual([]);

    const early = await fixture('EA-LATEEARLY', [{ title: 'Paper', durationMinutes: 120 }], { validFrom: '2028-01-01T00:00:00.000Z' });
    await generate(early);
    await schedule(early, '2027-12-10');
    await adjust(early, 'extra-time', { value: 25, unitCode: 'percent-of-duration' });
    expect((await currentEntry(early)).accommodations.adjustments).toEqual([]);
  });

  it('leaves out arrangements that are not for exams, and is idempotent', async () => {
    const f = await fixture('EA-LATEIDEM', [{ title: 'Paper', durationMinutes: 60 }]);
    await generate(f);
    await adjust(f, 'deadline-extension', { value: 7, unitCode: 'days' }, 'all');
    await adjust(f, 'separate-room', undefined);

    expect(await ctx.app.examEntryService.applyExamAdditions(ctx.tenantId)).toBe(0);
    const entry = await currentEntry(f);
    expect(entry.accommodations.adjustments.map((a) => a.adjustmentTypeCode)).toEqual(['separate-room']);
  });

  it('reports a late time adjustment with no amount as a failed exams distribution', async () => {
    const f = await fixture('EA-LATENOAMT', [{ title: 'Paper', durationMinutes: 120 }]);
    await generate(f);

    const { adjustmentId } = await adjust(f, 'extra-time', undefined);

    expect((await currentEntry(f)).accommodations.adjustments[0]).toMatchObject({ adjustmentId, applied: false });
    expect((await distributions(adjustmentId))[0]).toMatchObject({ statusCode: 'failed' });
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Fixture {
  personId: string;
  enrolmentId: string;
  moduleRegistrationId: string;
  boardId: string;
  validFrom: string;
}

async function fixture(
  code: string,
  components: Array<{ title: string; durationMinutes: number | null }>,
  opts: { validFrom?: string; meetingDate?: string } = {},
): Promise<Fixture> {
  const personId = (await post('/api/v1/students', { legalFirstName: code, legalFamilyName: 'Exam' })).json<{ personId: string }>().personId;
  const enrolmentId = (await post('/api/v1/enrolments', {
    personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  })).json<{ enrolmentId: string }>().enrolmentId;
  const moduleId = (await post('/api/v1/modules', { code, title: `${code} Module`, creditValue: 20 })).json<{ moduleId: string }>().moduleId;
  const academicPeriodId = (await post('/api/v1/academic-periods', {
    academicYear: '2026-27', periodCode: `${code}-SEM1`, periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15',
  })).json<{ academicPeriodId: string }>().academicPeriodId;
  const moduleOfferingId = (await post('/api/v1/module-offerings', {
    moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100,
  })).json<{ moduleOfferingId: string }>().moduleOfferingId;
  const weighting = Math.floor(100 / components.length);
  for (const c of components) {
    await post(`/api/v1/module-offerings/${moduleOfferingId}/components`, {
      componentTypeCode: 'exam', title: c.title, weighting,
      ...(c.durationMinutes !== null ? { durationMinutes: c.durationMinutes } : {}),
    });
  }
  const moduleRegistrationId = (await post('/api/v1/module-registrations', {
    enrolmentId, moduleOfferingId, registrationDate: '2026-10-01', validFrom: '2026-10-01T00:00:00.000Z',
  })).json<{ moduleRegistrationId: string }>().moduleRegistrationId;
  const boardId = (await post('/api/v1/exam-boards', {
    boardTypeCode: 'module', academicYear: '2026-27', academicPeriodId, meetingDate: opts.meetingDate ?? '2028-02-10',
  })).json<{ examBoardId: string }>().examBoardId;
  return { personId, enrolmentId, moduleRegistrationId, boardId, validFrom: opts.validFrom ?? '2027-09-01T00:00:00.000Z' };
}

async function adjust(
  f: Fixture,
  adjustmentTypeCode: string,
  amount: { value: number; unitCode: string } | undefined,
  scopeCode = 'exam',
): Promise<{ adjustmentId: string }> {
  return recordApprovedAdjustment(ctx, f.personId, {
    enrolmentId: f.enrolmentId, adjustmentTypeCode, scopeCode, validFrom: f.validFrom,
    ...(amount ? { amount } : {}),
  });
}

async function generate(f: Fixture): Promise<Entry> {
  await post(`/api/v1/exam-boards/${f.boardId}/data-pack`, {});
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${f.boardId}/exam-entries/generate`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  const entry = res.json<{ entries: Entry[] }>().entries.find((e) => e.moduleRegistrationId === f.moduleRegistrationId);
  expect(entry).toBeDefined();
  return entry!;
}

async function schedule(f: Fixture, scheduledDate: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/exam-boards/${f.boardId}/exam-schedule`,
    headers: { authorization: `Bearer ${integrationJwt}` },
    payload: { candidates: [{ moduleRegistrationId: f.moduleRegistrationId, candidateNumber: 'C-1', scheduledDate, room: 'HALL-A' }] },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function currentEntry(f: Fixture): Promise<Entry> {
  const res = await ctx.app.inject({
    method: 'GET', url: `/api/v1/module-registrations/${f.moduleRegistrationId}/exam-entry`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Entry>();
}

async function distributions(adjustmentId: string): Promise<Array<{ distributionId: string; targetSystem: string; statusCode: string; failureReason: string | null }>> {
  const res = await ctx.app.inject({
    method: 'GET', url: `/api/v1/adjustments/${adjustmentId}/distributions`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  return res.json<Array<{ distributionId: string; targetSystem: string; statusCode: string; failureReason: string | null }>>()
    .filter((d) => d.targetSystem === 'exams');
}

async function expire(adjustmentId: string): Promise<void> {
  // ADR-034: ended through its wellbeing case; the /expire route is retired.
  const res = await withdrawApprovedAdjustment(ctx, adjustmentId);
  expect(res.statusCode).toBe(200);
}

async function post(url: string, payload: Record<string, unknown>) {
  const res = await ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${jwt}` }, payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(201);
  return res;
}
