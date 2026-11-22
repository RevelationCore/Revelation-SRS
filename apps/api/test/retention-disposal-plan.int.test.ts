import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * BL-327 (the rest of the BP-08 pre-review Blocker behind BL-284):
 * irreversible retention disposal takes two people. A DPO prepares a plan
 * from the dry run; someone else holding retention:approve approves it;
 * execution applies only that plan, refuses if anyone's eligibility changed,
 * and records a disposition with a certificate reference per person.
 */

let ctx: TestApp;
let preparer: string;
let approver: string;
let registry: string;

beforeAll(async () => {
  ctx = await startTestApp();
  preparer = await ctx.makeJwt({ sub: 'dpo-preparer', roles: ['dpo'] });
  approver = await ctx.makeJwt({ sub: 'dpo-approver', roles: ['dpo'] });
  registry = await ctx.makeJwt({ roles: ['registry-administrator'] });
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

async function endedStudent(name: string): Promise<string> {
  const student = await post('/api/v1/students', registry, { legalFirstName: name, legalFamilyName: 'Disposal' });
  expect(student.statusCode, student.body).toBe(201);
  const personId = student.json<{ personId: string }>().personId;
  const enrolment = await post('/api/v1/enrolments', registry, { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2017-18', startDate: '2017-09-20' });
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;
  const ended = new Date();
  ended.setFullYear(ended.getFullYear() - 7);
  await ctx.db.execute(sql`UPDATE enrolment SET status_code = 'withdrawn', actual_end_date = ${ended.toISOString().slice(0, 10)} WHERE id = ${enrolmentId}::uuid`);
  return personId;
}

async function post(url: string, token: string, payload?: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
}

async function firstName(personId: string): Promise<string> {
  const [row] = await ctx.db.execute(sql`SELECT legal_first_name FROM person_identity WHERE person_id = ${personId}::uuid ORDER BY recorded_at DESC LIMIT 1`) as unknown as Array<{ legal_first_name: string }>;
  return row!.legal_first_name;
}

async function prepare(): Promise<{ planId: string; personIds: string[] }> {
  const res = await post('/api/v1/admin/retention/plans', preparer);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ planId: string; personIds: string[] }>();
}

describe('two-person retention disposal (BL-327)', () => {
  it('no longer disposes of anything from the sweep directly', async () => {
    const personId = await endedStudent('Direct');
    const res = await post('/api/v1/admin/retention/enforce?dryRun=false', preparer);
    expect(res.statusCode).toBe(409);
    expect(await firstName(personId)).toBe('Direct');
  });

  it('the preparer can neither approve nor reject their own plan', async () => {
    await endedStudent('Own');
    const { planId } = await prepare();
    for (const action of ['approve', 'reject']) {
      const res = await post(`/api/v1/admin/retention/plans/${planId}/${action}`, preparer, action === 'reject' ? { reason: 'mine' } : undefined);
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json<{ type: string }>().type).toMatch(/separation-of-duties$/);
    }
    await post(`/api/v1/admin/retention/plans/${planId}/reject`, approver, { reason: 'tidy up for the next test' });
  });

  it('an unapproved or rejected plan is not executed', async () => {
    const personId = await endedStudent('Unapproved');
    const { planId } = await prepare();
    expect((await post(`/api/v1/admin/retention/plans/${planId}/execute`, preparer)).statusCode).toBe(409);
    expect((await post(`/api/v1/admin/retention/plans/${planId}/reject`, approver, { reason: 'not this month' })).statusCode).toBe(200);
    expect((await post(`/api/v1/admin/retention/plans/${planId}/execute`, preparer)).statusCode).toBe(409);
    expect(await firstName(personId)).toBe('Unapproved');
  });

  it('only a holder of retention:approve may approve', async () => {
    await endedStudent('Approver');
    const { planId } = await prepare();
    expect((await post(`/api/v1/admin/retention/plans/${planId}/approve`, registry)).statusCode).toBe(403);
    await post(`/api/v1/admin/retention/plans/${planId}/reject`, approver, { reason: 'tidy up' });
  });

  it('executes an approved plan once, with a certificate per person', async () => {
    const personId = await endedStudent('Approved');
    const { planId, personIds } = await prepare();
    expect(personIds).toContain(personId);
    expect((await post(`/api/v1/admin/retention/plans/${planId}/approve`, approver)).statusCode).toBe(200);

    const res = await post(`/api/v1/admin/retention/plans/${planId}/execute`, preparer);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ anonymised: number; certificates: Array<{ personId: string; certificateRef: string }> }>();
    expect(body.anonymised).toBe(personIds.length);
    const cert = body.certificates.find((c) => c.personId === personId);
    expect(cert?.certificateRef).toMatch(/^RDC-[0-9A-F]{8}-\d{4}$/);
    expect(await firstName(personId)).toMatch(/^ANON-/);

    const [disposition] = await ctx.db.execute(sql`
      SELECT disposition_type_code, disposal_plan_id::text, executed_by FROM record_disposition
      WHERE person_id = ${personId}::uuid AND certificate_ref = ${cert!.certificateRef}`) as unknown as Array<{ disposition_type_code: string; disposal_plan_id: string; executed_by: string }>;
    expect(disposition).toMatchObject({ disposition_type_code: 'anonymised', disposal_plan_id: planId, executed_by: 'dpo-preparer' });

    expect((await post(`/api/v1/admin/retention/plans/${planId}/execute`, preparer)).statusCode).toBe(409);
  });

  it('refuses the whole plan if anyone in it gained a hold after approval', async () => {
    const free = await endedStudent('Free');
    const heldLater = await endedStudent('HeldLater');
    const { planId, personIds } = await prepare();
    expect(personIds).toEqual(expect.arrayContaining([free, heldLater]));
    expect((await post(`/api/v1/admin/retention/plans/${planId}/approve`, approver)).statusCode).toBe(200);

    await ctx.db.execute(sql`
      INSERT INTO processing_restriction (tenant_id, person_id, restriction_type_code, applied_by)
      VALUES (${ctx.tenantId}::uuid, ${heldLater}::uuid, 'processing-paused', 'dpo-approver')`);

    const res = await post(`/api/v1/admin/retention/plans/${planId}/execute`, preparer);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain(heldLater);
    expect(await firstName(free)).toBe('Free');
    expect(await firstName(heldLater)).toBe('HeldLater');
  });
});
