/**
 * Stage 9 — the API behind the admin wellbeing screens.
 *
 * - Disability, mental-health and early-warning routes are role-gated: a
 *   student, or a registry/panel role for mental-health data, is refused.
 * - Caseloads list open cases across the tenant, closed ones left out.
 * - Status changes follow each record's lifecycle; anything else is 409, and
 *   detail responses carry the allowed next statuses.
 * - Staff can raise a concern; assigning one needs the same student's case.
 * - Only a mental-health advisor may write a session note.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

const PERSON_A = '90000000-0000-0000-0000-000000000001';
const PERSON_B = '90000000-0000-0000-0000-000000000002';

describe('Stage 9 — staff case screens API', () => {
  let ctx: TestWellbeingApp;
  let advisor: string;
  let mhAdvisor: string;
  let auditor: string;
  let student: string;
  let registry: string;
  let panelChair: string;

  const call = async (jwt: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${jwt}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  beforeAll(async () => {
    ctx        = await startTestApp();
    advisor    = ctx.makeJwt({ sub: 'advisor-9', roles: ['wellbeing-advisor'] });
    mhAdvisor  = ctx.makeJwt({ sub: 'mh-9', roles: ['wellbeing-mental-health-advisor'] });
    auditor    = ctx.makeJwt({ sub: 'auditor-9', roles: ['wellbeing-auditor'] });
    student    = ctx.makeJwt({ sub: 'student-9', roles: ['student'] });
    registry   = ctx.makeJwt({ sub: 'registry-9', roles: ['registry-administrator'] });
    panelChair = ctx.makeJwt({ sub: 'panel-9', roles: ['wellbeing-panel-chair'] });
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  async function newDisabilityCase(personId: string, assignedAdvisorId?: string): Promise<string> {
    const res = await call(advisor, 'POST', '/api/v1/disability-cases', {
      personId, supportTypeCode: 'dsa', ...(assignedAdvisorId ? { assignedAdvisorId } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  }

  async function newMhCase(personId: string, riskLevelCode = 'low'): Promise<string> {
    const res = await call(advisor, 'POST', '/api/v1/mental-health-cases', { personId, presentingConcernCode: 'anxiety', riskLevelCode });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  }

  describe('role gates', () => {
    it('refuses a student on every case and alert route', async () => {
      const dc = await newDisabilityCase(PERSON_A);
      const mh = await newMhCase(PERSON_A);
      for (const [method, url, payload] of [
        ['GET',   `/api/v1/disability-cases?personId=${PERSON_A}`],
        ['GET',   `/api/v1/disability-cases/${dc}`],
        ['GET',   '/api/v1/disability-cases/caseload'],
        ['POST',  '/api/v1/disability-cases', { personId: PERSON_A, supportTypeCode: 'dsa' }],
        ['PATCH', `/api/v1/disability-cases/${dc}/status`, { statusCode: 'active' }],
        ['GET',   `/api/v1/mental-health-cases?personId=${PERSON_A}`],
        ['GET',   `/api/v1/mental-health-cases/${mh}`],
        ['GET',   '/api/v1/mental-health-cases/caseload'],
        ['PATCH', `/api/v1/mental-health-cases/${mh}/risk`, { riskLevelCode: 'high' }],
        ['GET',   '/api/v1/early-warning-alerts?triageStatus=pending'],
        ['POST',  '/api/v1/early-warning-alerts', { personId: PERSON_A, alertTypeCode: 'staff-referral', summary: 'x' }],
        ['GET',   '/api/v1/reports/wellbeing-summary'],
      ] as Array<['GET' | 'POST' | 'PATCH', string, unknown?]>) {
        const res = await call(student, method, url, payload);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it('lets registry read disability cases but not mental-health cases or alerts', async () => {
      const dc = await newDisabilityCase(PERSON_A);
      const mh = await newMhCase(PERSON_A);
      expect((await call(registry, 'GET', `/api/v1/disability-cases/${dc}`)).statusCode).toBe(200);
      expect((await call(registry, 'GET', `/api/v1/mental-health-cases/${mh}`)).statusCode).toBe(403);
      expect((await call(registry, 'GET', '/api/v1/early-warning-alerts?triageStatus=open')).statusCode).toBe(403);
      expect((await call(panelChair, 'GET', '/api/v1/mental-health-cases/caseload')).statusCode).toBe(403);
    });

    it('lets an auditor read mental-health cases but not change them', async () => {
      const mh = await newMhCase(PERSON_A);
      expect((await call(auditor, 'GET', `/api/v1/mental-health-cases/${mh}`)).statusCode).toBe(200);
      expect((await call(auditor, 'PATCH', `/api/v1/mental-health-cases/${mh}/status`, { statusCode: 'active' })).statusCode).toBe(403);
    });

    it('only a mental-health advisor may write a session note', async () => {
      const mh = await newMhCase(PERSON_A);
      const note = { practitionerId: 'mh-9', sessionDate: '2026-11-01', sessionTypeCode: 'individual', content: 'Session' };
      expect((await call(auditor, 'POST', `/api/v1/mental-health-cases/${mh}/session-notes`, note)).statusCode).toBe(403);
      expect((await call(mhAdvisor, 'POST', `/api/v1/mental-health-cases/${mh}/session-notes`, note)).statusCode).toBe(201);
      // The auditor can still read them.
      expect((await call(auditor, 'GET', `/api/v1/mental-health-cases/${mh}/session-notes`)).statusCode).toBe(200);
    });
  });

  describe('caseloads', () => {
    it('lists open disability cases across students, closed ones left out', async () => {
      const open = await newDisabilityCase(PERSON_A, 'advisor-9');
      const other = await newDisabilityCase(PERSON_B);
      const closed = await newDisabilityCase(PERSON_B);
      expect((await call(advisor, 'PATCH', `/api/v1/disability-cases/${closed}/status`, { statusCode: 'closed' })).statusCode).toBe(204);

      const all = (await call(advisor, 'GET', '/api/v1/disability-cases/caseload')).json<{ items: Array<{ id: string; allowedNextStatuses: string[] }> }>();
      const ids = all.items.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([open, other]));
      expect(ids).not.toContain(closed);
      expect(all.items.find((c) => c.id === open)?.allowedNextStatuses).toEqual(['evidence_pending', 'active', 'rejected', 'closed']);

      const mine = (await call(advisor, 'GET', '/api/v1/disability-cases/caseload?assignedTo=me')).json<{ items: Array<{ id: string }> }>();
      expect(mine.items.map((c) => c.id)).toEqual([open]);

      const closedOnly = (await call(advisor, 'GET', '/api/v1/disability-cases/caseload?statusCode=closed')).json<{ items: Array<{ id: string }> }>();
      expect(closedOnly.items.map((c) => c.id)).toContain(closed);
    });

    it('lists open mental-health cases highest risk first', async () => {
      const low = await newMhCase(PERSON_A, 'low');
      const crisis = await newMhCase(PERSON_B, 'crisis');
      const res = (await call(mhAdvisor, 'GET', '/api/v1/mental-health-cases/caseload')).json<{ items: Array<{ id: string; riskLevelCode: string }> }>();
      const ids = res.items.map((c) => c.id);
      expect(ids.indexOf(crisis)).toBeLessThan(ids.indexOf(low));
      expect(res.items[0]?.riskLevelCode).toBe('crisis');

      const high = (await call(mhAdvisor, 'GET', '/api/v1/mental-health-cases/caseload?riskLevelCode=crisis')).json<{ items: Array<{ id: string }> }>();
      expect(high.items.map((c) => c.id)).toContain(crisis);
      expect(high.items.map((c) => c.id)).not.toContain(low);
    });
  });

  describe('status lifecycles', () => {
    it('refuses a disability case status change its lifecycle does not allow', async () => {
      const dc = await newDisabilityCase(PERSON_A);
      expect((await call(advisor, 'PATCH', `/api/v1/disability-cases/${dc}/status`, { statusCode: 'closed' })).statusCode).toBe(204);
      const res = await call(advisor, 'PATCH', `/api/v1/disability-cases/${dc}/status`, { statusCode: 'active' });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ title: string; allowedNextStatuses: string[] }>()).toMatchObject({ title: 'Status change not allowed', allowedNextStatuses: [] });
      const detail = (await call(advisor, 'GET', `/api/v1/disability-cases/${dc}`)).json<{ statusCode: string; allowedNextStatuses: string[] }>();
      expect(detail).toMatchObject({ statusCode: 'closed', allowedNextStatuses: [] });
    });

    it('refuses an unknown status and keeps the case as it was', async () => {
      const mh = await newMhCase(PERSON_A);
      const res = await call(advisor, 'PATCH', `/api/v1/mental-health-cases/${mh}/status`, { statusCode: 'active_support' });
      expect(res.statusCode).toBe(409);
      const detail = (await call(advisor, 'GET', `/api/v1/mental-health-cases/${mh}`)).json<{ statusCode: string; allowedNextStatuses: string[] }>();
      expect(detail.statusCode).toBe('referral_received');
      expect(detail.allowedNextStatuses).toEqual(['assessment_pending', 'active', 'closed']);
    });

    it('follows the intervention plan and evidence lifecycles', async () => {
      const mh = await newMhCase(PERSON_A);
      const plan = (await call(advisor, 'POST', `/api/v1/mental-health-cases/${mh}/intervention-plans`, { planTypeCode: 'counselling', practitionerId: 'mh-9' })).json<{ id: string }>().id;
      expect((await call(advisor, 'PATCH', `/api/v1/mental-health-cases/${mh}/intervention-plans/${plan}/status`, { statusCode: 'completed' })).statusCode).toBe(409);
      expect((await call(advisor, 'PATCH', `/api/v1/mental-health-cases/${mh}/intervention-plans/${plan}/status`, { statusCode: 'active' })).statusCode).toBe(204);
      const plans = (await call(advisor, 'GET', `/api/v1/mental-health-cases/${mh}/intervention-plans`)).json<{ items: Array<{ id: string; allowedNextStatuses: string[] }> }>();
      expect(plans.items.find((p) => p.id === plan)?.allowedNextStatuses).toEqual(['completed', 'discontinued']);

      // A plan belongs to its own case only.
      const otherCase = await newMhCase(PERSON_B);
      expect((await call(advisor, 'PATCH', `/api/v1/mental-health-cases/${otherCase}/intervention-plans/${plan}/status`, { statusCode: 'completed' })).statusCode).toBe(404);

      const dc = await newDisabilityCase(PERSON_A);
      const ev = (await call(advisor, 'POST', `/api/v1/disability-cases/${dc}/evidence`, { evidenceTypeCode: 'medical', filename: 'letter.pdf', contentType: 'application/pdf' })).json<{ evidenceId: string }>().evidenceId;
      expect((await call(advisor, 'PATCH', `/api/v1/evidence/${ev}/status`, { statusCode: 'verified' })).statusCode).toBe(409);
      expect((await call(advisor, 'PATCH', `/api/v1/evidence/${ev}/status`, { statusCode: 'received' })).statusCode).toBe(204);
      const detail = (await call(advisor, 'GET', `/api/v1/disability-cases/${dc}`)).json<{ evidence: Array<{ id: string; allowedNextStatuses: string[] }> }>();
      expect(detail.evidence.find((e) => e.id === ev)?.allowedNextStatuses).toEqual(['verified', 'rejected']);
    });
  });

  describe('early-warning concerns', () => {
    it('lets staff raise a concern, which joins the triage queue', async () => {
      const res = await call(advisor, 'POST', '/api/v1/early-warning-alerts', { personId: PERSON_A, alertTypeCode: 'tutor-concern', summary: 'Missed three tutorials' });
      expect(res.statusCode, res.body).toBe(201);
      const id = res.json<{ id: string }>().id;

      const queue = (await call(advisor, 'GET', '/api/v1/early-warning-alerts?triageStatus=pending')).json<{ items: Array<{ id: string; alertSourceCode: string; alertPayload: { summary: string }; allowedNextStatuses: string[] }> }>();
      const alert = queue.items.find((a) => a.id === id);
      expect(alert).toMatchObject({ alertSourceCode: 'staff', alertPayload: { summary: 'Missed three tutorials' } });
      expect(alert?.allowedNextStatuses).toEqual(['reviewed', 'assigned', 'resolved', 'dismissed']);

      // UKVI alerts come from SRS events only.
      expect((await call(advisor, 'POST', '/api/v1/early-warning-alerts', { personId: PERSON_A, alertTypeCode: 'ukvi-compliance', summary: 'x' })).statusCode).toBe(422);
      expect((await call(advisor, 'POST', '/api/v1/early-warning-alerts', { personId: PERSON_A, alertTypeCode: 'staff-referral', summary: ' ' })).statusCode).toBe(422);
    });

    it('assigns a concern only to the same student\'s mental-health case, then keeps it open until resolved', async () => {
      const id = (await call(advisor, 'POST', '/api/v1/early-warning-alerts', { personId: PERSON_A, alertTypeCode: 'staff-referral', summary: 'Referred by tutor' })).json<{ id: string }>().id;
      const otherStudentsCase = await newMhCase(PERSON_B);
      const ownCase = await newMhCase(PERSON_A);

      expect((await call(advisor, 'PATCH', `/api/v1/early-warning-alerts/${id}/triage`, { triageStatusCode: 'assigned' })).statusCode).toBe(422);
      expect((await call(advisor, 'PATCH', `/api/v1/early-warning-alerts/${id}/triage`, { triageStatusCode: 'assigned', assignedCaseId: otherStudentsCase })).statusCode).toBe(422);
      expect((await call(advisor, 'PATCH', `/api/v1/early-warning-alerts/${id}/triage`, { triageStatusCode: 'assigned', assignedCaseId: ownCase })).statusCode).toBe(204);

      const open = (await call(advisor, 'GET', '/api/v1/early-warning-alerts?triageStatus=open')).json<{ items: Array<{ id: string; triageStatusCode: string; assignedCaseId: string }> }>();
      expect(open.items.find((a) => a.id === id)).toMatchObject({ triageStatusCode: 'assigned', assignedCaseId: ownCase });

      expect((await call(advisor, 'PATCH', `/api/v1/early-warning-alerts/${id}/triage`, { triageStatusCode: 'dismissed' })).statusCode).toBe(409);
      expect((await call(advisor, 'PATCH', `/api/v1/early-warning-alerts/${id}/triage`, { triageStatusCode: 'resolved' })).statusCode).toBe(204);
      const after = (await call(advisor, 'GET', '/api/v1/early-warning-alerts?triageStatus=open')).json<{ items: Array<{ id: string }> }>();
      expect(after.items.map((a) => a.id)).not.toContain(id);
    });
  });
});
