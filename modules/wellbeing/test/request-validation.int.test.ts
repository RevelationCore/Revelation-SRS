import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

/**
 * Request validation and error shape (enterprise readiness plan, item 1.7):
 * every route validates its input against a schema, and every error is
 * problem+json.
 */

let ctx: TestWellbeingApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = ctx.makeJwt();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: { authorization: `Bearer ${jwt}` }, ...(payload ? { payload } : {}) });

function expectProblem(res: Awaited<ReturnType<typeof call>>, status: number) {
  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  const body = res.json<{ type: string; title: string; status: number; detail: string; instance: string; error: string }>();
  expect(body).toMatchObject({ type: 'about:blank', status });
  expect(body.title).toBeTruthy();
  expect(body.detail).toBeTruthy();
  expect(body.error).toBe(body.detail);
  return body;
}

describe('request validation', () => {
  it('refuses a malformed id in the path with 400, before any query runs', async () => {
    for (const url of [
      '/api/v1/disability-cases/not-a-uuid',
      '/api/v1/ec-claims/123',
      '/api/v1/mental-health-cases/x/session-notes',
      '/api/v1/adjustment-cases/00000000-0000-0000-0000-00000000000g',
      '/api/v1/sar/export/robert',
    ]) {
      const body = expectProblem(await call('GET', url), 400);
      expect(body.detail).toMatch(/params\/\w+ must match format "uuid"/);
    }
  });

  it('refuses a body missing required fields, or of the wrong type', async () => {
    expectProblem(await call('POST', '/api/v1/disability-cases', { supportTypeCode: 'dsa' }), 400);
    expectProblem(await call('POST', '/api/v1/disability-cases', { personId: 'not-a-uuid', supportTypeCode: 'dsa' }), 400);
    expectProblem(await call('POST', '/api/v1/ec-claims', {
      personId: '00000000-0000-4000-8000-000000000001', enrolmentId: '00000000-0000-4000-8000-000000000002',
      affectedModuleCodes: ['CS101'],
    }), 400);
  });

  it('refuses a malformed id in the query', async () => {
    expectProblem(await call('GET', '/api/v1/mental-health-cases?personId=nope'), 400);
  });

  it('answers a missing record and an unknown route with problem+json', async () => {
    expectProblem(await call('GET', '/api/v1/disability-cases/00000000-0000-4000-8000-0000000000ff'), 404);
    expectProblem(await call('GET', '/api/v1/no-such-route'), 404);
  });
});
