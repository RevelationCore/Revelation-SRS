/**
 * Student status cases (BPR-D04; BP-02-006/007/008/009/012).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let registryJwt: string;
let deciderJwt: string;
let academicJwt: string;
let financeJwt: string;

interface Case {
  statusCaseId: string; statusCode: string; caseTypeCode: string; initiatedByCode: string;
  enrolmentStatusTransitionId: string | null; relatedCaseId: string | null;
  conditions: Array<{ conditionId: string; statusCode: string; description: string }>;
  outstandingReturnConditions: Array<{ conditionId: string }>;
  assessments: Array<{ assessorRoleCode: string; outcomeCode: string }>;
}

beforeAll(async () => {
  ctx = await startTestApp();
  registryJwt = await ctx.makeJwt({ sub: 'registry-officer-1', roles: ['registry-administrator'] });
  deciderJwt = await ctx.makeJwt({ sub: 'registry-officer-2', roles: ['registry-administrator'] });
  academicJwt = await ctx.makeJwt({ sub: 'academic-1', roles: ['programme-approver'] });
  financeJwt = await ctx.makeJwt({ sub: 'finance-1', roles: ['finance-administrator'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function call(method: 'GET' | 'POST', url: string, jwt: string, payload?: Record<string, unknown>) {
  return ctx.app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });
}

async function student(name: string): Promise<{ personId: string; enrolmentId: string; jwt: string }> {
  const person = await call('POST', '/students', registryJwt, { legalFirstName: name, legalFamilyName: 'Status' });
  const personId = person.json<{ personId: string }>().personId;
  const enrolment = await call('POST', '/enrolments', registryJwt, {
    personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
  });
  expect(enrolment.statusCode).toBe(201);
  const jwt = await ctx.makeJwt({ sub: `student-${name}`, roles: ['student'], srsPersonId: personId });
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId, jwt };
}

const enrolmentStatus = async (enrolmentId: string) => (await call('GET', `/enrolments/${enrolmentId}`, registryJwt))
  .json<{ statusCode: string; modeOfStudyCode: string }>();

async function open(enrolmentId: string, jwt: string, body: Record<string, unknown>): Promise<Case> {
  const res = await call('POST', `/enrolments/${enrolmentId}/status-cases`, jwt, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Case>();
}

const decide = (id: string, decisionCode: 'approved' | 'rejected', jwt = deciderJwt, extra: Record<string, unknown> = {}) =>
  call('POST', `/status-cases/${id}/decision`, jwt, { decisionCode, reason: 'Decided at registry review', ...extra });

describe('interruption and return', () => {
  it('a student requests an interruption; reviewers advise; the registry approves with a return condition', async () => {
    const s = await student('Ina');
    const c = await open(s.enrolmentId, s.jwt, {
      caseTypeCode: 'interruption', reasonCategoryCode: 'health',
      requestedEffectiveDate: '2030-01-15', expectedReturnDate: '2030-09-21',
    });
    expect(c).toMatchObject({ statusCode: 'requested', initiatedByCode: 'student' });

    expect((await call('POST', `/status-cases/${c.statusCaseId}/assessments`, academicJwt, { assessorRoleCode: 'academic', outcomeCode: 'supports', note: 'Restart at semester 1' })).statusCode).toBe(200);
    expect((await call('POST', `/status-cases/${c.statusCaseId}/assessments`, financeJwt, { assessorRoleCode: 'finance', outcomeCode: 'supports' })).statusCode).toBe(200);
    const withCondition = (await call('POST', `/status-cases/${c.statusCaseId}/conditions`, deciderJwt, {
      conditionTypeCode: 'fitness-to-study', description: 'Fitness to study confirmation before return', dueDate: '2030-09-01',
    })).json<Case>();
    expect(withCondition.assessments).toHaveLength(2);

    const approved = (await decide(c.statusCaseId, 'approved')).json<Case>();
    expect(approved.statusCode).toBe('approved');
    expect(approved.enrolmentStatusTransitionId).not.toBeNull();
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('intermitting');
    const transition = (await ctx.db.execute(sql`
      SELECT to_status_code FROM enrolment_status_transition WHERE id = ${approved.enrolmentStatusTransitionId}`)) as unknown as Array<{ to_status_code: string }>;
    expect(transition[0]?.to_status_code).toBe('intermitting');

    // The return is held until the interruption's condition is met.
    const back = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'return', requestedEffectiveDate: '2030-09-21' });
    expect(back.relatedCaseId).toBe(c.statusCaseId);
    expect(back.outstandingReturnConditions).toHaveLength(1);
    const held = await decide(back.statusCaseId, 'approved');
    expect(held.statusCode).toBe(409);
    expect(held.json<{ detail: string }>().detail).toMatch(/Return conditions are not yet met/);
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('intermitting');

    const conditionId = approved.conditions[0]!.conditionId;
    expect((await call('POST', `/status-case-conditions/${conditionId}/resolution`, registryJwt, { statusCode: 'met', evidenceRef: 'occ-health:REF-1' })).statusCode).toBe(200);
    expect((await decide(back.statusCaseId, 'approved')).json<Case>().statusCode).toBe('approved');
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('enrolled');
  });

  it('whoever opened a case cannot decide it', async () => {
    const s = await student('Sod');
    const c = await open(s.enrolmentId, registryJwt, {
      caseTypeCode: 'interruption', reasonCategoryCode: 'personal', requestedEffectiveDate: '2030-01-15', expectedReturnDate: '2030-09-21',
    });
    const res = await decide(c.statusCaseId, 'approved', registryJwt);
    expect(res.statusCode).toBe(409);
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('enrolled');
  });

  it('an interruption must be time-bound, and a rejection changes nothing', async () => {
    const s = await student('Rej');
    expect((await call('POST', `/enrolments/${s.enrolmentId}/status-cases`, s.jwt, { caseTypeCode: 'interruption', requestedEffectiveDate: '2030-01-15' })).statusCode).toBe(422);
    const c = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'interruption', requestedEffectiveDate: '2030-01-15', expectedReturnDate: '2030-06-01' });
    expect((await decide(c.statusCaseId, 'rejected')).json<Case>().statusCode).toBe('rejected');
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('enrolled');
  });

  it('allows one open status case per enrolment', async () => {
    const s = await student('One');
    await open(s.enrolmentId, s.jwt, { caseTypeCode: 'interruption', requestedEffectiveDate: '2030-01-15', expectedReturnDate: '2030-06-01' });
    const second = await call('POST', `/enrolments/${s.enrolmentId}/status-cases`, s.jwt, { caseTypeCode: 'withdrawal', requestedEffectiveDate: '2030-01-20' });
    expect(second.statusCode).toBe(409);
  });
});

describe('withdrawal and leaver closure', () => {
  it('withdraws, then closes the leaver record once its closure items are resolved', async () => {
    const s = await student('Wit');
    const w = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'withdrawal', reasonCategoryCode: 'employment', requestedEffectiveDate: '2030-02-01' });
    expect((await decide(w.statusCaseId, 'approved')).json<Case>().statusCode).toBe('approved');
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('withdrawn');

    // Leaver closure is institutional only.
    expect((await call('POST', `/enrolments/${s.enrolmentId}/status-cases`, s.jwt, { caseTypeCode: 'leaver-closure', requestedEffectiveDate: '2030-02-10' })).statusCode).toBe(403);
    const closure = await open(s.enrolmentId, registryJwt, { caseTypeCode: 'leaver-closure', requestedEffectiveDate: '2030-02-10' });
    const withItem = (await call('POST', `/status-cases/${closure.statusCaseId}/conditions`, registryJwt, {
      conditionTypeCode: 'fee-clearance', description: 'Final liability recorded by finance',
    })).json<Case>();
    expect((await decide(closure.statusCaseId, 'approved')).statusCode).toBe(409);
    await call('POST', `/status-case-conditions/${withItem.conditions[0]!.conditionId}/resolution`, registryJwt, { statusCode: 'met' });
    const closed = (await decide(closure.statusCaseId, 'approved')).json<Case>();
    expect(closed).toMatchObject({ statusCode: 'approved', enrolmentStatusTransitionId: null });
  });

  it('an institutional withdrawal must reference the authorising outcome', async () => {
    const s = await student('Ins');
    const res = await call('POST', `/enrolments/${s.enrolmentId}/status-cases`, registryJwt, { caseTypeCode: 'withdrawal', initiatedByCode: 'institution', requestedEffectiveDate: '2030-02-01' });
    expect(res.statusCode).toBe(422);
    const ok = await open(s.enrolmentId, registryJwt, {
      caseTypeCode: 'withdrawal', initiatedByCode: 'institution', reasonCategoryCode: 'non-engagement',
      requestedEffectiveDate: '2030-02-01', institutionalOutcomeRef: 'engagement-case:EC-123',
    });
    expect(ok.initiatedByCode).toBe('institution');
  });
});

describe('transfer', () => {
  it('changes the mode of study and keeps the student enrolled', async () => {
    const s = await student('Tra');
    const t = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'transfer', destinationModeOfStudyCode: 'part-time', requestedEffectiveDate: '2030-01-15' });
    const approved = (await decide(t.statusCaseId, 'approved')).json<Case>();
    expect(approved.enrolmentStatusTransitionId).not.toBeNull();
    expect(await enrolmentStatus(s.enrolmentId)).toMatchObject({ statusCode: 'enrolled', modeOfStudyCode: 'part-time' });
  });

  it('a transfer to another programme needs the destination programme\'s support', async () => {
    const s = await student('Tdp');
    const programme = await call('POST', '/programmes', registryJwt, { code: 'TDP-DEST', title: 'Destination Programme', fheqLevel: 6, creditTotal: 360 });
    const destinationProgrammeId = programme.json<{ programmeId: string }>().programmeId;
    const t = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'transfer', destinationProgrammeId, requestedEffectiveDate: '2030-01-15' });
    const refused = await decide(t.statusCaseId, 'approved');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/destination programme/);
    await call('POST', `/status-cases/${t.statusCaseId}/assessments`, academicJwt, { assessorRoleCode: 'destination-academic', outcomeCode: 'supports' });
    expect((await decide(t.statusCaseId, 'approved')).statusCode).toBe(200);
  });
});

describe('what a student may request', () => {
  it('follows the enrolment\'s status, offers a return only after an approved interruption, and none while a case is open', async () => {
    type Options = { requestableTypes: string[]; openCaseId: string | null; returnFrom: { statusCaseId: string; outstandingConditions: unknown[] } | null; sponsored: boolean };
    const s = await student('Opt');
    const options = async () => (await call('GET', `/enrolments/${s.enrolmentId}/status-case-options`, s.jwt)).json<Options>();
    expect(await options()).toMatchObject({ requestableTypes: ['interruption', 'withdrawal', 'transfer'], openCaseId: null, returnFrom: null, sponsored: false });

    const i = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'interruption', requestedEffectiveDate: '2030-03-01', expectedReturnDate: '2030-09-01', reasonCategoryCode: 'health' });
    expect(await options()).toMatchObject({ requestableTypes: [], openCaseId: i.statusCaseId });

    await call('POST', `/status-cases/${i.statusCaseId}/conditions`, registryJwt, { conditionTypeCode: 'fitness-to-study', description: 'Fit-to-study note' });
    expect((await decide(i.statusCaseId, 'approved')).statusCode).toBe(200);
    const after = await options();
    expect(after.requestableTypes).toEqual(['return', 'withdrawal']);
    expect(after.returnFrom?.statusCaseId).toBe(i.statusCaseId);
    expect(after.returnFrom?.outstandingConditions).toHaveLength(1);

    const other = await student('Oth');
    expect((await call('GET', `/enrolments/${other.enrolmentId}/status-case-options`, s.jwt)).statusCode).toBe(403);
  });
});

describe('sponsored students', () => {
  it('a sponsored student\'s withdrawal needs UKVI compliance advice before it is decided', async () => {
    const s = await student('Spo');
    await ctx.db.execute(sql`
      INSERT INTO ukvi_visa_status (id, tenant_id, enrolment_id, cas_reference, status_code, effective_date, valid_from)
      VALUES (gen_random_uuid(), ${ctx.tenantId}, ${s.enrolmentId}, 'CAS-SPO-1', 'active', '2026-09-01', now())
    `);
    expect((await call('GET', `/enrolments/${s.enrolmentId}/status-case-options`, s.jwt)).json<{ sponsored: boolean }>().sponsored).toBe(true);
    const w = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'withdrawal', requestedEffectiveDate: '2030-02-01', reasonCategoryCode: 'personal' });
    const refused = await decide(w.statusCaseId, 'approved');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/UKVI compliance advice/);
    expect((await call('POST', `/status-cases/${w.statusCaseId}/assessments`, registryJwt, {
      assessorRoleCode: 'compliance', outcomeCode: 'supports', note: 'Report to UKVI within 10 working days',
    })).statusCode).toBe(200);
    expect((await decide(w.statusCaseId, 'approved')).statusCode).toBe(200);
  });
});

describe('access and failure', () => {
  it('a student can only see and request changes for their own enrolment', async () => {
    const a = await student('Aaa');
    const b = await student('Bbb');
    expect((await call('GET', `/enrolments/${b.enrolmentId}/status-cases`, a.jwt)).statusCode).toBe(403);
    expect((await call('POST', `/enrolments/${b.enrolmentId}/status-cases`, a.jwt, { caseTypeCode: 'withdrawal', requestedEffectiveDate: '2030-01-15' })).statusCode).toBe(403);
    expect((await call('POST', `/enrolments/${a.enrolmentId}/status-cases`, a.jwt, { caseTypeCode: 'suspension', requestedEffectiveDate: '2030-01-15' })).statusCode).toBe(403);
  });

  it('a change the enrolment refuses leaves the case open', async () => {
    const s = await student('Fail');
    const c = await open(s.enrolmentId, s.jwt, { caseTypeCode: 'withdrawal', requestedEffectiveDate: '2030-02-01' });
    // An effective date before the current enrolment version is refused.
    const res = await decide(c.statusCaseId, 'approved', deciderJwt, { effectiveDate: '2001-01-01' });
    expect(res.statusCode).toBe(422);
    expect((await call('GET', `/status-cases/${c.statusCaseId}`, registryJwt)).json<Case>().statusCode).toBe('requested');
    expect((await enrolmentStatus(s.enrolmentId)).statusCode).toBe('enrolled');
  });

  it('lists open cases for the registry worklist', async () => {
    const list = (await call('GET', '/status-cases', registryJwt)).json<Case[]>();
    expect(list.every((c) => c.statusCode === 'requested')).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it('shows assessors who cannot open student records who each case is about', async () => {
    const list = (await call('GET', '/status-cases', academicJwt)).json<Array<Case & { subject: { personId: string; studentName: string; studentNumber: string } }>>();
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      expect(c.subject.personId).toBe(c.personId);
      expect(c.subject.studentName).toMatch(/Status$/);
      expect(c.subject.studentNumber).not.toBe('');
    }
    const one = (await call('GET', `/status-cases/${list[0]!.statusCaseId}`, academicJwt)).json<{ subject: { personId: string } }>();
    expect(one.subject.personId).toBe(list[0]!.personId);
  });
});
