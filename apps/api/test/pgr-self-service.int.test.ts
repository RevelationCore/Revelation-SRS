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

describe('PGR student self-service views', () => {
  it('lets a student read their own current supervision team and milestones', async () => {
    const student = await createPerson('SelfService', 'Candidate');
    const supervisor = await createPerson('Self', 'Supervisor');
    const enrolmentId = await createEnrolment(student);

    const openCase = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/pgr/supervision-cases',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, ownerId: 'pgr-admin-01' },
    });
    const { supervisionCaseId } = openCase.json<{ supervisionCaseId: string }>();
    const nomination = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${supervisionCaseId}/nominations`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { personId: supervisor, roleDetailCode: 'principal' },
    });
    const { nominationId } = nomination.json<{ nominationId: string }>();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${supervisionCaseId}/nominations/${nominationId}/eligibility-check`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/pgr/supervision-cases/${supervisionCaseId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionTypeCode: 'approve' },
    });

    const studentJwt = await ctx.makeJwt({ roles: ['student'], srsPersonId: student });

    const supervision = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${student}/enrolments/${enrolmentId}/pgr/supervision`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(supervision.statusCode).toBe(200);
    expect(supervision.json<Array<{ personId: string; roleDetailCode: string }>>())
      .toContainEqual(expect.objectContaining({ personId: supervisor, roleDetailCode: 'principal' }));

    const milestones = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${student}/enrolments/${enrolmentId}/pgr/milestones`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(milestones.statusCode).toBe(200);
    expect(milestones.json<unknown[]>()).toEqual([]);
  });

  it('does not let a student read another student’s supervision team', async () => {
    const student = await createPerson('OtherStudent', 'Candidate');
    const otherStudent = await createPerson('Different', 'Person');
    const enrolmentId = await createEnrolment(student);

    const otherStudentJwt = await ctx.makeJwt({ roles: ['student'], srsPersonId: otherStudent });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${student}/enrolments/${enrolmentId}/pgr/supervision`,
      headers: { authorization: `Bearer ${otherStudentJwt}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
