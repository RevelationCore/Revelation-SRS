/**
 * Annual re-registration (BP-02-010; D-8).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';
import { transitionEnrolment } from './helpers/transition.js';

let ctx: TestApp;
let registryJwt: string;
let adminJwt: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, jwt: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });

interface Registration { confirmation: { confirmationId: string; statusCode: string; channelCode: string | null; termsVersion: string | null }; period: { periodId: string }; blockers: Array<{ code: string }>; termsVersion: string }

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'reg-registry', roles: ['registry-administrator'] });
  adminJwt = await ctx.makeJwt({ sub: 'reg-admin', roles: ['tenant-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function student(name: string, entry: string): Promise<{ personId: string; enrolmentId: string; jwt: string }> {
  const personId = (await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Register' })).json<{ personId: string }>().personId;
  const enrolmentId = (await call('POST', '/enrolments', registryJwt, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: entry, startDate: `${entry.slice(0, 4)}-09-21` }))
    .json<{ enrolmentId: string }>().enrolmentId;
  return { personId, enrolmentId, jwt: await ctx.makeJwt({ sub: `student-${name}`, roles: ['student'], srsPersonId: personId }) };
}

const registrations = async (s: { personId: string; jwt: string }) => (await call('GET', `/students/${s.personId}/registrations`, s.jwt)).json<Registration[]>();

describe('annual re-registration', () => {
  it('opens for continuing students only, confirms in the portal against the current terms, and creates the year\'s fee liability', async () => {
    const continuing = await student('Cont', '2025-26');
    const newEntrant = await student('New', '2027-28');
    const onBreak = await student('Brk', '2025-26');
    await transitionEnrolment(ctx, onBreak.enrolmentId, 'intermitting');

    const period = { academicYear: '2027-28', opensAt: '2026-01-01T00:00:00Z', closesAt: '2030-01-01T00:00:00Z' };
    expect((await call('POST', '/registration-periods', registryJwt, period)).statusCode).toBe(422);
    expect((await call('PATCH', '/tenant/configuration', adminJwt, { registrationTermsVersion: '2027.1' })).statusCode).toBe(200);
    const opened = await call('POST', '/registration-periods', registryJwt, period);
    expect(opened.statusCode).toBe(201);
    expect((await registrations(newEntrant))).toEqual([]);
    expect((await registrations(onBreak))).toEqual([]);

    // Unratified results for the previous year block confirmation until the board ratifies.
    const decisionId = randomUUID();
    await ctx.db.execute(sql`
      INSERT INTO progression_decision (version_id, id, tenant_id, enrolment_id, academic_year, year_of_study, decision_code, locked, actor_id, valid_from)
      VALUES (${randomUUID()}, ${decisionId}, ${ctx.tenantId}, ${continuing.enrolmentId}, '2026-27', '2', 'progress', false, 'board', now())`);
    const [mine] = await registrations(continuing);
    expect(mine).toMatchObject({ confirmation: { statusCode: 'pending' }, termsVersion: '2027.1', blockers: [{ code: 'results-pending' }] });
    const id = mine!.confirmation.confirmationId;
    expect((await call('POST', `/registration-confirmations/${id}/confirmation`, continuing.jwt, { acceptedTermsVersion: '2027.1' })).statusCode).toBe(409);
    await ctx.db.execute(sql`UPDATE progression_decision SET locked = true WHERE id = ${decisionId}`);

    expect((await call('POST', `/registration-confirmations/${id}/confirmation`, continuing.jwt, { acceptedTermsVersion: '2026.9' })).statusCode).toBe(409);
    expect((await call('POST', `/registration-confirmations/${id}/confirmation`, newEntrant.jwt, { acceptedTermsVersion: '2027.1' })).statusCode).toBe(403);
    const confirmed = await call('POST', `/registration-confirmations/${id}/confirmation`, continuing.jwt, { acceptedTermsVersion: '2027.1' });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ statusCode: 'confirmed', channelCode: 'portal', termsVersion: '2027.1' });
    const fees = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM fee_liability WHERE enrolment_id = ${continuing.enrolmentId} AND academic_year = '2027-28'`)) as unknown as Array<{ n: number }>;
    expect(fees[0]!.n).toBe(1);
    expect((await call('POST', `/registration-confirmations/${id}/confirmation`, continuing.jwt, { acceptedTermsVersion: '2027.1' })).statusCode).toBe(409);
  });

  it('closing lapses unconfirmed students; only the registry can then register them, as a late registration', async () => {
    const late = await student('Late', '2025-26');
    await call('PATCH', '/tenant/configuration', adminJwt, { registrationTermsVersion: '2028.1' });
    const period = (await call('POST', '/registration-periods', registryJwt, { academicYear: '2028-29', opensAt: '2026-01-01T00:00:00Z', closesAt: '2026-06-01T00:00:00Z' })).json<{ periodId: string }>();
    const [mine] = await registrations(late);
    // The period has ended: the student can no longer confirm.
    expect((await call('POST', `/registration-confirmations/${mine!.confirmation.confirmationId}/confirmation`, late.jwt, { acceptedTermsVersion: '2028.1' })).statusCode).toBe(409);

    const closed = await call('POST', `/registration-periods/${period.periodId}/closure`, registryJwt);
    expect(closed.json()).toMatchObject({ counts: { lapsed: expect.any(Number) as number }, lapsedCount: expect.any(Number) as number });
    expect((await registrations(late))[0]!.confirmation.statusCode).toBe('lapsed');
    expect((await call('POST', `/registration-periods/${period.periodId}/closure`, registryJwt)).statusCode).toBe(409);

    const id = mine!.confirmation.confirmationId;
    expect((await call('POST', `/registration-confirmations/${id}/confirmation`, registryJwt, { acceptedTermsVersion: '2028.1', assistedReasonCode: 'phone' })).statusCode).toBe(409);
    const lateConfirm = await call('POST', `/registration-confirmations/${id}/confirmation`, registryJwt, { acceptedTermsVersion: '2028.1', assistedReasonCode: 'late' });
    expect(lateConfirm.json()).toMatchObject({ statusCode: 'confirmed', channelCode: 'assisted', assistedReasonCode: 'late' });
  });

  it('a period cannot be closed before its end date', async () => {
    const period = (await call('GET', '/registration-periods', registryJwt)).json<Array<{ periodId: string; academicYear: string }>>().find((p) => p.academicYear === '2027-28')!;
    expect((await call('POST', `/registration-periods/${period.periodId}/closure`, registryJwt)).statusCode).toBe(409);
  });
});
