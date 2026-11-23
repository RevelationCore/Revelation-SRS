import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * BL-402: a deployment whose environment is not registered yet (a fresh
 * install, or the evaluation stack before demo data) reports that as a
 * state, with what it does know, rather than failing the whole screen.
 */
let ctx: TestApp;
let jwt: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

const runtime = async () => ctx.app.inject({ method: 'GET', url: '/api/v1/environment-runtime', headers: { authorization: `Bearer ${jwt}` } });

describe('GET /environment-runtime', () => {
  it('reports an unregistered environment with its code, versions, workflows and flags', async () => {
    const { environmentCode } = (await runtime()).json<{ environmentCode: string }>();
    // The baseline registers the test environment; set it aside.
    await ctx.db.execute(sql`UPDATE deployment_environment SET environment_code = ${`${environmentCode}-set-aside`} WHERE environment_code = ${environmentCode}`);
    const res = await runtime();
    expect(res.statusCode).toBe(200);
    const body = res.json<{ environmentCode: string; registered: boolean; environment: unknown; migrationVersion: string; featureFlags: unknown[]; workflowDefinitions: unknown[] }>();
    expect(body.registered).toBe(false);
    expect(body.environment).toBeNull();
    expect(body.environmentCode.length).toBeGreaterThan(0);
    expect(body.featureFlags.length).toBeGreaterThan(0);
    expect(body.workflowDefinitions.length).toBeGreaterThan(0);
  });

  it('reports the environment once one is registered with that code', async () => {
    const { environmentCode } = (await runtime()).json<{ environmentCode: string }>();
    await ctx.db.execute(sql`UPDATE deployment_environment SET environment_code = ${environmentCode} WHERE environment_code = ${`${environmentCode}-set-aside`}`);
    const body = (await runtime()).json<{ registered: boolean; environment: { environmentCode: string } | null }>();
    expect(body.registered).toBe(true);
    expect(body.environment).toMatchObject({ environmentCode });
  });
});
