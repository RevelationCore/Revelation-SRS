import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

async function createPerson(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

async function createEnrolment(personId: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'home-postgraduate-research',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function openCase(enrolmentId: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/pgr/supervision-cases',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, ownerId: 'pgr-admin-01', researchArea: 'Applied cryptography' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ supervisionCaseId: string }>().supervisionCaseId;
}

async function nominate(caseId: string, personId: string, roleDetailCode: 'principal' | 'additional' | 'external'): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/supervision-cases/${caseId}/nominations`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, roleDetailCode },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ nominationId: string }>().nominationId;
}

async function recordEligibility(caseId: string, nominationId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/pgr/supervision-cases/${caseId}/nominations/${nominationId}/eligibility-check`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(204);
}

describe('PGR supervision and research context (BP-03-007)', () => {
  it('opens a case, nominates a supervisor, checks eligibility, approves, and activates the team', async () => {
    const student = await createPerson('Priya', 'Candidate');
    const supervisor = await createPerson('Alex', 'Supervisor');
    const enrolmentId = await createEnrolment(student);

    const caseId = await openCase(enrolmentId);
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/supervision-cases/${caseId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ statusCode: string; researchArea: string | null }>())
      .toMatchObject({ statusCode: 'proposed', researchArea: 'Applied cryptography' });

    const nominationId = await nominate(caseId, supervisor, 'principal');
    await recordEligibility(caseId, nominationId);

    const nominations = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/supervision-cases/${caseId}/nominations`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(nominations.statusCode).toBe(200);
    expect(nominations.json<Array<{ nominationId: string; eligibilityCheckedAt: string | null }>>())
      .toContainEqual(expect.objectContaining({ nominationId, eligibilityCheckedAt: expect.any(String) }));

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });
    expect(decide.statusCode).toBe(204);

    const assignments = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/supervision`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(assignments.statusCode).toBe(200);
    expect(assignments.json<Array<{ personId: string; roleDetailCode: string; validTo: string | null }>>())
      .toContainEqual(expect.objectContaining({ personId: supervisor, roleDetailCode: 'principal', validTo: null }));

    const publish = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/publish`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(publish.statusCode).toBe(204);
  });

  it('rejects approval when a nominee has no recorded eligibility check', async () => {
    const student = await createPerson('NoCheck', 'Candidate');
    const supervisor = await createPerson('Uncertain', 'Supervisor');
    const enrolmentId = await createEnrolment(student);
    const caseId = await openCase(enrolmentId);
    await nominate(caseId, supervisor, 'principal');

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });
    expect(decide.statusCode).toBe(422);
  });

  it('rejects approval when there are no nominations at all', async () => {
    const student = await createPerson('Empty', 'Candidate');
    const enrolmentId = await createEnrolment(student);
    const caseId = await openCase(enrolmentId);

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });
    expect(decide.statusCode).toBe(422);
  });

  it('a returned case activates no assignment, and cannot be decided twice', async () => {
    const student = await createPerson('Returned', 'Candidate');
    const supervisor = await createPerson('Held', 'Supervisor');
    const enrolmentId = await createEnrolment(student);
    const caseId = await openCase(enrolmentId);
    const nominationId = await nominate(caseId, supervisor, 'principal');
    await recordEligibility(caseId, nominationId);

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'return', reasonText: 'Needs a co-supervisor' },
    });
    expect(decide.statusCode).toBe(204);

    const assignments = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/supervision`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(assignments.json<unknown[]>()).toEqual([]);

    const secondDecide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });
    expect(secondDecide.statusCode).toBe(422);
  });

  it('a change of supervisor end-dates the previous team rather than deleting it', async () => {
    const student = await createPerson('Change', 'Candidate');
    const firstSupervisor = await createPerson('First', 'Supervisor');
    const secondSupervisor = await createPerson('Second', 'Supervisor');
    const enrolmentId = await createEnrolment(student);

    const firstCaseId = await openCase(enrolmentId);
    const firstNominationId = await nominate(firstCaseId, firstSupervisor, 'principal');
    await recordEligibility(firstCaseId, firstNominationId);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${firstCaseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });

    const secondCaseId = await openCase(enrolmentId);
    const secondNominationId = await nominate(secondCaseId, secondSupervisor, 'principal');
    await recordEligibility(secondCaseId, secondNominationId);
    const secondDecide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${secondCaseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });
    expect(secondDecide.statusCode).toBe(204);

    const assignments = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/supervision`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const current = assignments.json<Array<{ personId: string }>>();
    expect(current).toHaveLength(1);
    expect(current[0]!.personId).toBe(secondSupervisor);
  });

  it('rejects a decision from a role lacking pgr-case:decide', async () => {
    const student = await createPerson('WrongRole', 'Candidate');
    const supervisor = await createPerson('Blocked', 'Supervisor');
    const enrolmentId = await createEnrolment(student);
    const caseId = await openCase(enrolmentId);
    const nominationId = await nominate(caseId, supervisor, 'principal');
    await recordEligibility(caseId, nominationId);

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${caseId}/decision`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
      payload: { decisionTypeCode: 'approve' },
    });
    expect(decide.statusCode).toBe(403);
  });

  it('does not expose supervision cases across tenants', async () => {
    const student = await createPerson('Tenant', 'Isolation');
    const enrolmentId = await createEnrolment(student);
    const caseId = await openCase(enrolmentId);

    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/pgr/supervision-cases/${caseId}`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
