import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

async function createEnrolment(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const person = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(person.statusCode).toBe(201);
  const personId = person.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'international-undergraduate',
      ukviCasRequired: true,
    },
  });
  expect(enrolment.statusCode).toBe(201);
  return enrolment.json<{ enrolmentId: string }>().enrolmentId;
}

describe('CAS governance (BPR-D03)', () => {
  it('opens a case, records eligibility, assigns a version, and records a sponsor report', async () => {
    const enrolmentId = await createEnrolment('Cas', 'Governance');

    const openCase = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${enrolmentId}/regulatory/cas-cases`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    expect(openCase.statusCode).toBe(201);
    const { casCaseId } = openCase.json<{ casCaseId: string }>();

    const check = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/cas-cases/${casCaseId}/eligibility-checks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        guidanceVersion: '2027-v1',
        checkTypeCode:   'genuine-student',
        resultCode:      'pass',
      },
    });
    expect(check.statusCode).toBe(201);

    const assignment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/cas-cases/${casCaseId}/assignment-versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assignedPayloadHash: 'sha256:abc123',
        casNumber:           'E1234567890',
      },
    });
    expect(assignment.statusCode).toBe(201);

    const report = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/cas-cases/${casCaseId}/sponsor-report-versions`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reportPayloadRef: 'ref-001' },
    });
    expect(report.statusCode).toBe(201);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/regulatory/cas-cases`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    const cases = list.json<Array<{ casCaseId: string; statusCode: string }>>();
    expect(cases).toHaveLength(1);
    expect(cases[0]?.statusCode).toBe('assigned');
  });

  it('404s recording an eligibility check against an unknown CAS case', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/cas-cases/00000000-0000-0000-0000-000000000000/eligibility-checks',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { guidanceVersion: '2027-v1', checkTypeCode: 'genuine-student', resultCode: 'pass' },
    });
    expect(res.statusCode).toBe(404);
  });
});
