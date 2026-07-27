import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('GET /api/v1/workflow-tasks permissions', () => {
  it('allows a wellbeing adviser to read their task inbox with Keycloak default roles present', async () => {
    const jwt = await ctx.makeJwt({
      sub: 'wellbeing-user',
      roles: [
        'default-roles-srs',
        'offline_access',
        'wellbeing-advisor',
        'uma_authorization',
      ],
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflow-tasks',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('continues to allow roles with workflow:read to list tasks', async () => {
    const jwt = await ctx.makeJwt({ roles: ['registry-administrator'] });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflow-tasks',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('denies roles with neither workflow permission', async () => {
    const jwt = await ctx.makeJwt({ roles: ['student'] });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/workflow-tasks',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
