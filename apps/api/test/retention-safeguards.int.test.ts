import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * BL-284, found by the BP-08 AI pre-review as a Blocker: the retention sweep
 * irreversibly anonymised people while ignoring legal holds, processing
 * restrictions, open rights requests and configured schedules, and a
 * system administrator could run it alone. Destroying data under a live
 * access request risks an offence (DPA 2018 s.173).
 */

let ctx: TestApp;
let dpo: string;
let registry: string;

beforeAll(async () => {
  ctx = await startTestApp();
  dpo = await ctx.makeJwt({ sub: 'dpo-284', roles: ['dpo'] });
  registry = await ctx.makeJwt({ roles: ['registry-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

/** A student whose only enrolment was withdrawn more than six years ago. */
async function endedStudent(name: string): Promise<{ personId: string; enrolmentId: string }> {
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${registry}` },
    payload: { legalFirstName: name, legalFamilyName: 'Retention' },
  });
  expect(student.statusCode, student.body).toBe(201);
  const personId = student.json<{ personId: string }>().personId;
  const enrolment = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${registry}` },
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2017-18', startDate: '2017-09-20' },
  });
  expect(enrolment.statusCode, enrolment.body).toBe(201);
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;
  const ended = new Date();
  ended.setFullYear(ended.getFullYear() - 7);
  await ctx.db.execute(sql`
    UPDATE enrolment SET status_code = 'withdrawn', actual_end_date = ${ended.toISOString().slice(0, 10)}
    WHERE id = ${enrolmentId}::uuid AND tenant_id = ${ctx.tenantId}::uuid`);
  return { personId, enrolmentId };
}

async function assignment(entityId: string, disposalDate: string | null): Promise<string> {
  const [schedule] = await ctx.db.execute(sql`
    INSERT INTO retention_schedule (tenant_id, entity_type, retention_period_months, trigger_event_code)
    VALUES (${ctx.tenantId}::uuid, 'person', '72', 'end-of-study') RETURNING id`) as unknown as Array<{ id: string }>;
  const [row] = await ctx.db.execute(sql`
    INSERT INTO retention_assignment (tenant_id, retention_schedule_id, entity_type, entity_id, scheduled_disposal_date)
    VALUES (${ctx.tenantId}::uuid, ${schedule!.id}::uuid, 'person', ${entityId}::uuid, ${disposalDate}::date) RETURNING id`) as unknown as Array<{ id: string }>;
  return row!.id;
}

async function firstName(personId: string): Promise<string> {
  const [row] = await ctx.db.execute(sql`
    SELECT legal_first_name FROM person_identity WHERE person_id = ${personId}::uuid ORDER BY recorded_at DESC LIMIT 1`) as unknown as Array<{ legal_first_name: string }>;
  return row!.legal_first_name;
}

describe('retention sweep safeguards (BL-284)', () => {
  it('skips anyone under a hold, restriction, open rights request or schedule that is not due, and anonymises the rest', async () => {
    const held = await endedStudent('Held');
    const heldOnEnrolment = await endedStudent('HeldEnrolment');
    const restricted = await endedStudent('Restricted');
    const requesting = await endedStudent('Requesting');
    const scheduled = await endedStudent('Scheduled');
    const control = await endedStudent('Control');

    await ctx.db.execute(sql`
      INSERT INTO record_hold (tenant_id, retention_assignment_id, hold_reason_code, applied_by)
      VALUES (${ctx.tenantId}::uuid, ${await assignment(held.personId, null)}::uuid, 'litigation', 'dpo-284'),
             (${ctx.tenantId}::uuid, ${await assignment(heldOnEnrolment.enrolmentId, null)}::uuid, 'audit', 'dpo-284')`);
    await ctx.db.execute(sql`
      INSERT INTO processing_restriction (tenant_id, person_id, restriction_type_code, applied_by)
      VALUES (${ctx.tenantId}::uuid, ${restricted.personId}::uuid, 'processing-paused', 'dpo-284')`);
    const [bc] = await ctx.db.execute(sql`
      INSERT INTO business_case (id, valid_from, tenant_id, subject_type, subject_id, process_id, status_code, owner_id, actor_id)
      VALUES (gen_random_uuid(), now(), ${ctx.tenantId}::uuid, 'person', ${requesting.personId}::uuid, 'BP-08-003', 'under-review', 'dpo-284', 'dpo-284')
      RETURNING id`) as unknown as Array<{ id: string }>;
    await ctx.db.execute(sql`
      INSERT INTO individual_rights_request (tenant_id, business_case_id, person_id, request_type_code, statutory_deadline_date)
      VALUES (${ctx.tenantId}::uuid, ${bc!.id}::uuid, ${requesting.personId}::uuid, 'access', CURRENT_DATE + 30)`);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    await assignment(scheduled.personId, nextYear.toISOString().slice(0, 10));

    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/retention/enforce?dryRun=false', headers: { authorization: `Bearer ${dpo}` } });
    expect(res.statusCode, res.body).toBe(200);
    const details = res.json<{ details: Array<{ personId: string; action: string; reason?: string }> }>().details;
    const actionOf = (personId: string) => details.find((d) => d.personId === personId)?.action;

    expect(actionOf(held.personId)).toBe('skipped-hold');
    expect(actionOf(heldOnEnrolment.personId)).toBe('skipped-hold');
    expect(actionOf(restricted.personId)).toBe('skipped-restriction');
    expect(actionOf(requesting.personId)).toBe('skipped-open-request');
    expect(actionOf(scheduled.personId)).toBe('skipped-schedule');
    expect(actionOf(control.personId)).toBe('anonymised');

    for (const [who, name] of [[held, 'Held'], [heldOnEnrolment, 'HeldEnrolment'], [restricted, 'Restricted'], [requesting, 'Requesting'], [scheduled, 'Scheduled']] as const) {
      expect(await firstName(who.personId)).toBe(name);
    }
    expect(await firstName(control.personId)).toMatch(/^ANON-/);
  });

  it('a closed rights request or a lifted hold no longer protects the record', async () => {
    const closed = await endedStudent('ClosedRequest');
    const [bc] = await ctx.db.execute(sql`
      INSERT INTO business_case (id, valid_from, tenant_id, subject_type, subject_id, process_id, status_code, owner_id, actor_id)
      VALUES (gen_random_uuid(), now(), ${ctx.tenantId}::uuid, 'person', ${closed.personId}::uuid, 'BP-08-003', 'closed', 'dpo-284', 'dpo-284')
      RETURNING id`) as unknown as Array<{ id: string }>;
    await ctx.db.execute(sql`
      INSERT INTO individual_rights_request (tenant_id, business_case_id, person_id, request_type_code, statutory_deadline_date)
      VALUES (${ctx.tenantId}::uuid, ${bc!.id}::uuid, ${closed.personId}::uuid, 'access', CURRENT_DATE - 1)`);
    const lifted = await endedStudent('LiftedHold');
    await ctx.db.execute(sql`
      INSERT INTO record_hold (tenant_id, retention_assignment_id, hold_reason_code, applied_by, lifted_at)
      VALUES (${ctx.tenantId}::uuid, ${await assignment(lifted.personId, null)}::uuid, 'litigation', 'dpo-284', now())`);

    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/retention/enforce?dryRun=true', headers: { authorization: `Bearer ${dpo}` } });
    const details = res.json<{ details: Array<{ personId: string; action: string }> }>().details;
    expect(details.find((d) => d.personId === closed.personId)?.action).toBe('anonymised');
    expect(details.find((d) => d.personId === lifted.personId)?.action).toBe('anonymised');
  });

  it('is a DPO decision: a system administrator can no longer run it', async () => {
    const sysadmin = await ctx.makeJwt({ roles: ['system-administrator'] });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/retention/enforce?dryRun=true', headers: { authorization: `Bearer ${sysadmin}` } });
    expect(res.statusCode).toBe(403);
  });
});
