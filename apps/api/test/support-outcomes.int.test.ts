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
      feeBandCode: 'home-undergraduate',
    },
  });
  expect(enrolment.statusCode).toBe(201);
  return enrolment.json<{ enrolmentId: string }>().enrolmentId;
}

describe('Support-outcome distribution (BPR-D09)', () => {
  it('records a minimum-necessary support outcome and distributes it to targets', async () => {
    const enrolmentId = await createEnrolment('Support', 'Outcome');

    const record = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${enrolmentId}/support-outcomes`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        outcomeTypeCode:      'extra-time',
        minimumNecessaryText: '25% extra time in written examinations',
        visibilityScopeCode:  'exam-officer',
      },
    });
    expect(record.statusCode).toBe(201);
    const { supportOutcomeId } = record.json<{ supportOutcomeId: string }>();

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${enrolmentId}/support-outcomes`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    const outcomes = list.json<Array<{ supportOutcomeId: string; minimumNecessaryText: string }>>();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.minimumNecessaryText).toBe('25% extra time in written examinations');

    const distribute = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/support-outcomes/${supportOutcomeId}/distribute`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { targetSystemCodes: ['exams', 'vle'] },
    });
    expect(distribute.statusCode).toBe(201);
    const { distributionItemIds } = distribute.json<{ distributionItemIds: string[] }>();
    expect(distributionItemIds).toHaveLength(2);
  });

  it('404s distributing an unknown support outcome', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/support-outcomes/00000000-0000-0000-0000-000000000000/distribute',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { targetSystemCodes: ['exams'] },
    });
    expect(res.statusCode).toBe(404);
  });
});
