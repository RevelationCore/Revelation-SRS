import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

/**
 * EC claim routes need ec-claim:read or ec-claim:manage. Before, any
 * authenticated user of the tenant, a student included, could list, read,
 * record or determine any student's claim.
 */

const PERSON = '00000000-0000-4000-8000-0000000000e1';
const ENROLMENT = '00000000-0000-4000-8000-0000000000e2';
const CLAIM = '00000000-0000-4000-8000-0000000000e3';

let ctx: TestWellbeingApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

const call = (roles: string[], method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({
    method, url, headers: { authorization: `Bearer ${ctx.makeJwt({ roles, srsPersonId: PERSON })}` },
    ...(payload ? { payload } : {}),
  });

const claim = { personId: PERSON, enrolmentId: ENROLMENT, assessmentPeriodRef: '2026-S1', affectedModuleCodes: ['CS101'] };

describe('EC claim authorisation', () => {
  it.each([['a student', ['student']], ['a mental health adviser', ['wellbeing-mental-health-advisor']], ['a module tutor', ['module-tutor']]])(
    'refuses %s on every EC claim route', async (_who, roles) => {
      expect((await call(roles, 'GET', `/api/v1/ec-claims?personId=${PERSON}`)).statusCode).toBe(403);
      expect((await call(roles, 'GET', `/api/v1/ec-claims/${CLAIM}`)).statusCode).toBe(403);
      expect((await call(roles, 'POST', '/api/v1/ec-claims', claim)).statusCode).toBe(403);
      expect((await call(roles, 'PATCH', `/api/v1/ec-claims/${CLAIM}/status`, { statusCode: 'under-review' })).statusCode).toBe(403);
      expect((await call(roles, 'POST', `/api/v1/ec-claims/${CLAIM}/withdraw`, {})).statusCode).toBe(403);
      expect((await call(roles, 'POST', `/api/v1/ec-claims/${CLAIM}/determine`, {
        authorisedById: 'x', determinationCode: 'accepted', moduleOutcomes: [], determinedAt: '2026-11-19',
      })).statusCode).toBe(403);
    },
  );

  it('lets a wellbeing adviser record and read claims', async () => {
    const created = await call(['wellbeing-advisor'], 'POST', '/api/v1/ec-claims', claim);
    expect(created.statusCode).toBe(201);
    expect((await call(['wellbeing-advisor'], 'GET', `/api/v1/ec-claims?personId=${PERSON}`)).statusCode).toBe(200);
  });
});
