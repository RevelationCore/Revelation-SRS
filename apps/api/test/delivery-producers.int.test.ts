/**
 * Delivery-ledger producers beyond the enrolment flows: identity
 * verification (F-SIS-OIV-01), service desk (F-SIS-ITSM-01), research portal
 * (F-SIS-RP-01), and the per-period extracts for estates, surveys and
 * curriculum management (F-SIS-EST/SETS/CM-01).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestResearchPortalSnapshot } from '../src/platform/delivery/producers/research-flows.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

interface Item { deliveryItemId: string; flowCode: string; statusCode: string; summary: string; payload: Record<string, unknown> }

describe('F-SIS-OIV-01 identity verification', () => {
  it('a requested check becomes a verification request; completing the check marks it done', async () => {
    const personId = await student('OIV101');
    const check = await post(`/api/v1/students/${personId}/identity-verifications`, {});
    const checkId = check.json<{ verificationCheckId: string }>().verificationCheckId;

    const [item] = await items('F-SIS-OIV-01', checkId);
    expect(item).toMatchObject({ statusCode: 'pending', payload: expect.objectContaining({ verificationCheckId: checkId, legalFamilyName: 'Producer' }) as Record<string, unknown> });

    const done = await post(`/api/v1/students/${personId}/identity-verifications/${checkId}/completion`, { statusCode: 'verified', confidenceScore: 92 });
    expect(done.statusCode, done.body).toBe(204);
    expect((await items('F-SIS-OIV-01', checkId))[0]!.statusCode).toBe('delivered');
  });
});

describe('F-SIS-ITSM-01 service desk', () => {
  it('a new person and an identity change each send the latest snapshot', async () => {
    const personId = await student('ITSM101');
    expect((await items('F-SIS-ITSM-01', personId)).map((i) => i.statusCode)).toEqual(['pending']);

    const patch = await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/students/${personId}/identity`,
      headers: { authorization: `Bearer ${jwt}` }, payload: { preferredName: 'Ari', emailInstitutional: 'ari@uni.test' },
    });
    expect(patch.statusCode).toBe(204);
    const all = await items('F-SIS-ITSM-01', personId);
    expect(all.map((i) => i.statusCode)).toEqual(['superseded', 'pending']);
    expect(all[1]!.payload).toMatchObject({ displayName: 'Ari Producer', emailInstitutional: 'ari@uni.test' });
    expect(all[1]!.payload).not.toHaveProperty('dateOfBirth');
  });
});

describe('F-SIS-RP-01 research portal', () => {
  it('sends the current supervisory team, and an empty team once closed', async () => {
    const personId = await student('RP101');
    const enrolmentId = (await post('/api/v1/enrolments', {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
    })).json<{ enrolmentId: string }>().enrolmentId;
    const supervisor = await student('RP101-SUP');
    const supervisionCaseId = await ctx.app.supervisionService.openSupervisionCase(ctx.tenantId, { enrolmentId, ownerId: 'test' }, 'test');
    await ctx.db.execute(sql`
      INSERT INTO staff_assignment (version_id, id, tenant_id, enrolment_id, supervision_case_id, person_id, assignment_type_code,
        role_detail_code, contractual_status_code, access_level_code, actor_id, valid_from, recorded_at)
      VALUES (${randomUUID()}, ${randomUUID()}, ${ctx.tenantId}, ${enrolmentId}, ${supervisionCaseId}, ${supervisor}, 'supervisor',
        'principal', 'employed', 'full', 'test', now(), now())
    `);

    await requestResearchPortalSnapshot(ctx.app.deliveryService, ctx.db, ctx.tenantId, enrolmentId, 'rp-test-1');
    expect((await items('F-SIS-RP-01', enrolmentId))[0]!.payload['supervisors']).toEqual([
      expect.objectContaining({ personId: supervisor, roleDetailCode: 'principal' }),
    ]);

    await ctx.app.supervisionService.closeCurrentAssignments(ctx.tenantId, enrolmentId);
    const latest = (await items('F-SIS-RP-01', enrolmentId)).at(-1)!;
    expect(latest).toMatchObject({ summary: 'Update research portal: no current supervisors', payload: expect.objectContaining({ supervisors: [] }) as Record<string, unknown> });
  });
});

describe('Per-period extracts', () => {
  it('estates, surveys and curriculum each get one item per offering; an unchanged rerun sends nothing', async () => {
    const f = await offeringWithStudents('EXT101', 2, 10);

    const est = await run('F-SIS-EST-01', f.academicPeriodId);
    expect(est).toMatchObject({ offerings: 1, created: 1, unchanged: 0 });
    expect((await items('F-SIS-EST-01', f.moduleOfferingId))[0]).toMatchObject({
      summary: 'EXT101 2026-27 EXT101-SEM1: 2 registered of 10 (20%)',
      payload: expect.objectContaining({ registered: 2, capacity: 10, occupancy: 20 }) as Record<string, unknown>,
    });

    await run('F-SIS-SETS-01', f.academicPeriodId);
    expect((await items('F-SIS-SETS-01', f.moduleOfferingId))[0]!.payload['studentNumbers']).toHaveLength(2);

    await run('F-SIS-CM-01', f.academicPeriodId);
    expect((await items('F-SIS-CM-01', f.moduleOfferingId))[0]!.payload).toMatchObject({ registrationsByStatus: { registered: 2 } });

    expect(await run('F-SIS-EST-01', f.academicPeriodId)).toMatchObject({ created: 0, unchanged: 1 });
  });

  it('a changed figure supersedes the undelivered earlier item', async () => {
    const f = await offeringWithStudents('EXT102', 2, 10);
    await run('F-SIS-EST-01', f.academicPeriodId);
    const withdraw = await post(`/api/v1/module-registrations/${f.registrationIds[0]}/withdrawal`, { validFrom: '2026-10-15T00:00:00.000Z' });
    expect(withdraw.statusCode, withdraw.body).toBe(204);

    expect(await run('F-SIS-EST-01', f.academicPeriodId)).toMatchObject({ created: 1 });
    expect((await items('F-SIS-EST-01', f.moduleOfferingId)).map((i) => [i.statusCode, i.payload['registered']])).toEqual([['superseded', 2], ['pending', 1]]);
  });

  it('rejects a flow that is not an extract', async () => {
    const f = await offeringWithStudents('EXT103', 1, 5);
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/delivery-flows/F-SIS-LIB-01/run', headers: { authorization: `Bearer ${jwt}` },
      payload: { academicPeriodId: f.academicPeriodId },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function student(code: string): Promise<string> {
  return (await post('/api/v1/students', { legalFirstName: code, legalFamilyName: 'Producer' })).json<{ personId: string }>().personId;
}

async function offeringWithStudents(code: string, students: number, capacity: number) {
  const academicPeriodId = (await post('/api/v1/academic-periods', {
    academicYear: '2026-27', periodCode: `${code}-SEM1`, periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15',
  })).json<{ academicPeriodId: string }>().academicPeriodId;
  const moduleId = (await post('/api/v1/modules', { code, title: `${code} module`, creditValue: 20 })).json<{ moduleId: string }>().moduleId;
  const moduleOfferingId = (await post('/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity }))
    .json<{ moduleOfferingId: string }>().moduleOfferingId;
  const registrationIds: string[] = [];
  for (let i = 0; i < students; i += 1) {
    const personId = await student(`${code}-${i}`);
    const enrolmentId = (await post('/api/v1/enrolments', {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
    })).json<{ enrolmentId: string }>().enrolmentId;
    registrationIds.push((await post('/api/v1/module-registrations', {
      enrolmentId, moduleOfferingId, registrationDate: '2026-10-01', validFrom: '2026-10-01T00:00:00.000Z',
    })).json<{ moduleRegistrationId: string }>().moduleRegistrationId);
  }
  return { academicPeriodId, moduleOfferingId, registrationIds };
}

async function run(flowCode: string, academicPeriodId: string) {
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/delivery-flows/${flowCode}/run`, headers: { authorization: `Bearer ${jwt}` },
    payload: { academicPeriodId },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ offerings: number; created: number; unchanged: number }>();
}

async function items(flowCode: string, subjectId: string): Promise<Item[]> {
  const res = await ctx.app.inject({
    method: 'GET', url: `/api/v1/delivery-items?flowCode=${flowCode}&subjectId=${subjectId}`, headers: { authorization: `Bearer ${jwt}` },
  });
  return res.json<Item[]>();
}

async function post(url: string, payload: Record<string, unknown>) {
  const res = await ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${jwt}` }, payload });
  if (res.statusCode >= 400) throw new Error(`${url}: ${res.statusCode} ${res.body}`);
  return res;
}
