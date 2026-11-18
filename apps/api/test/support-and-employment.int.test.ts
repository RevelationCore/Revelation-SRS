/**
 * The payroll gap (AJ-32): student support schedules sent to payroll as
 * F-SIS-PAY-01 instructions and reconciled from payroll's confirmations, and
 * student employment links checked against configurable work limits.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';
import { transitionEnrolment } from './helpers/transition.js';

let ctx: TestApp;
let recorder: string;   // registry administrator: records awards and instalments
let approver: string;   // finance administrator: approves them
let connector: string;  // payroll/HR integration

beforeAll(async () => {
  ctx = await startTestApp();
  recorder = await ctx.makeJwt({ sub: 'registry-officer-1' });
  approver = await ctx.makeJwt({ sub: 'finance-officer-1', roles: ['finance-administrator'] });
  connector = await ctx.makeJwt({ sub: 'payroll-connector', roles: ['integration-service'] });
  await post('/api/v1/academic-periods', {
    academicYear: '2026-27', periodCode: 'SUP-SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15',
  }, recorder);
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

interface Instalment { instalmentId: string; statusCode: string; paymentReference: string | null; paidOn: string | null; rejectionReason: string | null }

describe('Student support schedule → payroll instruction → confirmation', () => {
  it('separates recording from approval, for awards and instalments', async () => {
    const f = await fixture('SUP101');
    const award = await createAward(f, 'STUD-SUP101');
    expect(award.statusCode).toBe('draft');
    expect((await post(`/api/v1/support-awards/${award.awardId}/approve`, {}, await ctx.makeJwt({ sub: 'registry-officer-1', roles: ['finance-administrator'] }))).statusCode).toBe(409);
    expect((await post(`/api/v1/support-awards/${award.awardId}/approve`, {}, approver)).json()).toMatchObject({ statusCode: 'approved', approvedBy: 'finance-officer-1' });

    const instalment = await addInstalment(award.awardId);
    expect((await post(`/api/v1/support-instalments/${instalment.instalmentId}/approve`, {}, await ctx.makeJwt({ sub: 'registry-officer-1', roles: ['finance-administrator'] }))).statusCode).toBe(409);
  });

  it('refuses teaching pay as support, and instalments outside the award', async () => {
    const f = await fixture('SUP102');
    const award = await createAward(f, 'STUD-SUP102');
    expect((await post(`/api/v1/support-awards/${award.awardId}/instalments`, { ...stipend, paymentTypeCode: 'gta-pay' }, recorder)).statusCode).toBe(422);
    expect((await post(`/api/v1/support-awards/${award.awardId}/instalments`, { ...stipend, periodStart: '2026-01-01', periodEnd: '2026-01-31' }, recorder)).statusCode).toBe(422);
  });

  it('approving an instalment sends payroll one instruction; payroll\'s confirmation marks it paid', async () => {
    const f = await fixture('SUP103');
    const award = await approvedAward(f, 'STUD-SUP103');
    const instalment = await addInstalment(award.awardId);
    expect(instalment.statusCode).toBe('planned');

    expect((await post(`/api/v1/support-instalments/${instalment.instalmentId}/approve`, {}, approver)).json()).toMatchObject({ statusCode: 'approved' });
    await post(`/api/v1/support-instalments/${instalment.instalmentId}/approve`, {}, approver); // repeat: same operation

    const items = (await get(`/api/v1/delivery-items?flowCode=F-SIS-PAY-01&subjectId=${instalment.instalmentId}`, recorder)).json<Array<{ statusCode: string; summary: string; payload: Record<string, unknown> }>>();
    expect(items).toHaveLength(1);
    expect(items[0]!.payload).toMatchObject({ operationId: instalment.instalmentId, currencyCode: 'GBP', amountMinorUnits: 180_000, paymentTypeCode: 'stipend', awardReference: 'STUD-SUP103', funder: 'EPSRC' });
    expect(items[0]!.summary).toBe(`Pay stipend £1,800.00 (award STUD-SUP103) due 2026-10-31 — operation ${instalment.instalmentId}`);

    const confirmed = await post('/api/v1/inbound/F-PAY-SIS-01', {
      personId: f.personId, idempotencyKey: 'pay-SUP103',
      payload: { paymentReference: 'PAYRUN-77', paymentType: 'stipend', instructionId: instalment.instalmentId, paymentStatus: 'paid', amountPence: 180_000, paidOn: '2026-10-30' },
    }, connector);
    expect(confirmed.statusCode, confirmed.body).toBe(201);

    expect((await instalments(f, 'STUD-SUP103'))[0]).toMatchObject({ statusCode: 'paid', paymentReference: 'PAYRUN-77', paidOn: '2026-10-30' });
    expect((await get(`/api/v1/delivery-items?flowCode=F-SIS-PAY-01&subjectId=${instalment.instalmentId}`, recorder)).json<Array<{ statusCode: string }>>()[0]!.statusCode).toBe('delivered');
  });

  it('a rejection from payroll is recorded with its reason, not as paid', async () => {
    const f = await fixture('SUP104');
    const award = await approvedAward(f, 'STUD-SUP104');
    const instalment = await addInstalment(award.awardId);
    await post(`/api/v1/support-instalments/${instalment.instalmentId}/approve`, {}, approver);

    await post('/api/v1/inbound/F-PAY-SIS-01', {
      personId: f.personId, idempotencyKey: 'pay-SUP104',
      payload: { paymentReference: 'PAYRUN-78', paymentType: 'stipend', instructionId: instalment.instalmentId, paymentStatus: 'rejected', rejectionReason: 'Invalid payroll alias' },
    }, connector);
    expect((await instalments(f, 'STUD-SUP104'))[0]).toMatchObject({ statusCode: 'rejected', rejectionReason: 'Invalid payroll alias' });
  });

  it('a confirmation naming another student\'s instruction does not reconcile it', async () => {
    const f = await fixture('SUP105');
    const other = await fixture('SUP105-OTHER');
    const award = await approvedAward(f, 'STUD-SUP105');
    const instalment = await addInstalment(award.awardId);
    await post(`/api/v1/support-instalments/${instalment.instalmentId}/approve`, {}, approver);

    await post('/api/v1/inbound/F-PAY-SIS-01', {
      personId: other.personId, idempotencyKey: 'pay-SUP105',
      payload: { paymentReference: 'PAYRUN-79', paymentType: 'stipend', instructionId: instalment.instalmentId, paymentStatus: 'paid', amountPence: 180_000 },
    }, connector);
    expect((await instalments(f, 'STUD-SUP105'))[0]!.statusCode).toBe('approved');
  });

  it('only a planned instalment can be cancelled', async () => {
    const f = await fixture('SUP106');
    const award = await approvedAward(f, 'STUD-SUP106');
    const planned = await addInstalment(award.awardId);
    expect((await post(`/api/v1/support-instalments/${planned.instalmentId}/cancel`, {}, recorder)).json()).toMatchObject({ statusCode: 'cancelled' });
    const approved = await addInstalment(award.awardId);
    await post(`/api/v1/support-instalments/${approved.instalmentId}/approve`, {}, approver);
    expect((await post(`/api/v1/support-instalments/${approved.instalmentId}/cancel`, {}, recorder)).statusCode).toBe(409);
  });
});

describe('Employment links and work limits', () => {
  it('starts from 20 h/week (visa term time) and 6 h/week (studentship), both configurable', async () => {
    const limits = (await get('/api/v1/work-limits', recorder)).json<Array<{ ruleCode: string; maxWeeklyHours: number; isDefault: boolean }>>();
    expect(limits).toEqual([
      expect.objectContaining({ ruleCode: 'student-visa-term-time', maxWeeklyHours: 20, isDefault: true }),
      expect.objectContaining({ ruleCode: 'studentship', maxWeeklyHours: 6, isDefault: true }),
    ]);
    expect((await put('/api/v1/work-limits/student-visa-term-time', { maxWeeklyHours: 10 }, recorder)).statusCode).toBe(403);
    expect((await put('/api/v1/work-limits/made-up', { maxWeeklyHours: 10 }, await ctx.makeJwt({ roles: ['tenant-administrator'] }))).statusCode).toBe(404);
  });

  it('warns when a visa-sponsored student\'s term-time hours exceed the limit', async () => {
    const f = await fixture('EMP101');
    await ctx.db.execute(sql`
      INSERT INTO cas_case (version_id, id, tenant_id, person_id, enrolment_id, cas_reference, status_code, actor_id, valid_from, recorded_at)
      SELECT ${randomUUID()}, ${randomUUID()}, ${ctx.tenantId}, e.person_id, e.id, 'CAS-EMP101', 'assigned', 'fixture', now(), now()
      FROM enrolment e WHERE e.id = ${f.enrolmentId} AND e.recorded_until IS NULL
    `);
    const ok = await link(f, 'HR-EMP101-A', 15);
    expect(ok.warnings).toEqual([]);
    const over = await link(f, 'HR-EMP101-B', 8);
    expect(over.warnings).toEqual([expect.objectContaining({
      ruleCode: 'student-visa-term-time',
      message: 'In 2026-27 SUP-SEM1 (term time) university employment totals 23 h/week, over the 20 h/week visa term-time limit',
    })]);

    const admin = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    await put('/api/v1/work-limits/student-visa-term-time', { maxWeeklyHours: 25 }, admin);
    expect((await get(`/api/v1/students/${f.personId}/employment-links`, recorder)).json<{ warnings: unknown[] }>().warnings).toEqual([]);
    await put('/api/v1/work-limits/student-visa-term-time', { maxWeeklyHours: 20 }, admin);
  });

  it('checks a studentship holder\'s hours and supervisor agreement', async () => {
    const f = await fixture('EMP102');
    await approvedAward(f, 'STUD-EMP102', '2026-09-01');
    const first = await link(f, 'HR-EMP102', 8);
    expect(first.warnings.map((w) => w.ruleCode).sort()).toEqual(['studentship', 'supervisor-agreement']);

    const fixed = await link(f, 'HR-EMP102', 5, { supervisorAgreedAt: '2026-09-10T10:00:00.000Z' });
    expect(fixed.warnings).toEqual([]);
  });

  it('a study-status change asks HR to review the employed student\'s roles', async () => {
    const employed = await fixture('EMP103');
    await link(employed, 'HR-EMP103', 6);
    const notEmployed = await fixture('EMP104');

    for (const f of [employed, notEmployed]) {
      await transitionEnrolment(ctx, f.enrolmentId, 'withdrawn', { reasonCode: 'personal' });
    }
    const hr = (id: string) => get(`/api/v1/delivery-items?flowCode=F-SIS-HR-01&subjectId=${id}`, recorder).then((r) => r.json<Array<{ summary: string }>>());
    expect((await hr(employed.personId))[0]?.summary).toBe('Review employment HR-EMP103 (gta): study status now withdrawn');
    expect(await hr(notEmployed.personId)).toEqual([]);
  });

  it('keeps one HR reference to one person, and guards access', async () => {
    const a = await fixture('EMP105');
    const b = await fixture('EMP106');
    await link(a, 'HR-SHARED', 4);
    expect((await put(`/api/v1/students/${b.personId}/employment-links/HR-SHARED`, { roleTypeCode: 'gta', startDate: '2026-09-21', weeklyHours: 4 }, recorder)).statusCode).toBe(422);

    // Supervisors read their own supervisees through the research-staff routes, not here (Phase 5 D-40).
    const supervisor = await ctx.makeJwt({ roles: ['research-supervisor'] });
    expect((await get(`/api/v1/students/${a.personId}/employment-links`, supervisor)).statusCode).toBe(403);
    const pgrDirector = await ctx.makeJwt({ roles: ['pgr-director'] });
    expect((await get(`/api/v1/students/${a.personId}/employment-links`, pgrDirector)).statusCode).toBe(200);
    const student = await ctx.makeJwt({ roles: ['student'], srsPersonId: a.personId });
    expect((await get(`/api/v1/students/${a.personId}/employment-links`, student)).statusCode).toBe(403);
    expect((await get(`/api/v1/students/${a.personId}/support-awards`, student)).statusCode).toBe(403);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const stipend = { paymentTypeCode: 'stipend', amountMinorUnits: 180_000, periodStart: '2026-10-01', periodEnd: '2026-12-31', dueDate: '2026-10-31' };

async function fixture(code: string): Promise<{ personId: string; enrolmentId: string }> {
  const personId = (await post('/api/v1/students', { legalFirstName: code, legalFamilyName: 'Support' }, recorder)).json<{ personId: string }>().personId;
  const enrolmentId = (await post('/api/v1/enrolments', {
    personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  }, recorder)).json<{ enrolmentId: string }>().enrolmentId;
  return { personId, enrolmentId };
}

async function createAward(f: { personId: string; enrolmentId: string }, ref: string, startDate = '2026-09-21') {
  const res = await post(`/api/v1/students/${f.personId}/support-awards`, {
    enrolmentId: f.enrolmentId, awardTypeCode: 'studentship', awardReference: ref, funder: 'EPSRC', startDate, endDate: '2030-09-20',
  }, recorder);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ awardId: string; statusCode: string }>();
}

async function approvedAward(f: { personId: string; enrolmentId: string }, ref: string, startDate?: string) {
  const award = await createAward(f, ref, startDate);
  expect((await post(`/api/v1/support-awards/${award.awardId}/approve`, {}, approver)).statusCode).toBe(200);
  return award;
}

async function addInstalment(awardId: string) {
  const res = await post(`/api/v1/support-awards/${awardId}/instalments`, stipend, recorder);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Instalment>();
}

async function instalments(f: { personId: string }, ref: string): Promise<Instalment[]> {
  const awards = (await get(`/api/v1/students/${f.personId}/support-awards`, recorder)).json<Array<{ awardReference: string; instalments: Instalment[] }>>();
  return awards.find((a) => a.awardReference === ref)!.instalments;
}

async function link(f: { personId: string }, ref: string, weeklyHours: number, extra: Record<string, unknown> = {}) {
  const res = await put(`/api/v1/students/${f.personId}/employment-links/${ref}`, {
    roleTypeCode: 'gta', startDate: '2026-09-21', endDate: '2027-06-30', weeklyHours, ...extra,
  }, recorder);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ warnings: Array<{ ruleCode: string; message: string }> }>();
}

function get(url: string, token: string) {
  return ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}
function post(url: string, payload: Record<string, unknown>, token: string) {
  return ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
}
function put(url: string, payload: Record<string, unknown>, token: string) {
  return ctx.app.inject({ method: 'PUT', url, headers: { authorization: `Bearer ${token}` }, payload });
}
