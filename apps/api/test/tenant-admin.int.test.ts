import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('Tenant provisioning', () => {
  it('allows a system administrator to create, list, read, and update tenants', async () => {
    const jwt = await ctx.makeJwt({ roles: ['system-administrator'] });

    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        code: 'STAGE5',
        name: 'Stage 5 University',
        configuration: { timezone: 'Europe/London' },
      },
    });
    expect(create.statusCode).toBe(201);
    const tenantId = create.json<{ tenantId: string }>().tenantId;

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ tenantId: string; code: string }>>())
      .toContainEqual(expect.objectContaining({ tenantId, code: 'STAGE5' }));

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        name: 'Stage 5 University Updated',
        active: false,
        configuration: { timezone: 'Europe/London', studentNumberPrefix: 'S5' },
      },
    });
    expect(patch.statusCode).toBe(204);

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ name: string; active: boolean; configuration: Record<string, unknown> }>())
      .toMatchObject({
        name: 'Stage 5 University Updated',
        active: false,
        configuration: { studentNumberPrefix: 'S5' },
      });
  });

  it('does not allow tenant administrators to provision tenants', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'NOPE', name: 'Nope University' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Tenant configuration', () => {
  it('allows a tenant administrator to read and merge tenant configuration', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/tenant/configuration',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        registrationWindowMode: 'academic-period',
        defaultAcademicYear: '2026-27',
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<Record<string, unknown>>()).toMatchObject({
      registrationWindowMode: 'academic-period',
      defaultAcademicYear: '2026-27',
    });

    const get = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/tenant/configuration',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<Record<string, unknown>>()).toMatchObject({
      registrationWindowMode: 'academic-period',
      defaultAcademicYear: '2026-27',
    });
  });
});

describe('Academic rules', () => {
  let programmeId: string;
  let academicRuleId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const programme = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/programmes',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        code: 'RULES-BSC',
        title: 'BSc Rule Management',
        modeOfStudyCode: 'full-time',
      },
    });
    expect(programme.statusCode).toBe(201);
    programmeId = programme.json<{ programmeId: string }>().programmeId;
  });

  it('creates, lists, and reads tenant academic rules', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/academic-rules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        programmeId,
        ruleTypeCode: 'pass-mark',
        ruleKey: 'undergraduate-default',
        ruleValue: { mark: 40 },
        description: 'Default undergraduate pass mark',
        appliesToLevel: 4,
      },
    });
    expect(create.statusCode).toBe(201);
    academicRuleId = create.json<{ academicRuleId: string }>().academicRuleId;

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/academic-rules?ruleTypeCode=pass-mark',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ academicRuleId: string; ruleValue: Record<string, unknown> }>>())
      .toContainEqual(expect.objectContaining({ academicRuleId, ruleValue: { mark: 40 } }));

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/academic-rules/${academicRuleId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ programmeId: string; ruleKey: string }>())
      .toMatchObject({ programmeId, ruleKey: 'undergraduate-default' });
  });

  it('updates academic rules bitemporally and exposes history', async () => {
    const jwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/academic-rules/${academicRuleId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        ruleValue: { mark: 45 },
        description: 'Raised pass mark for this programme',
        validFrom: '2026-09-01T00:00:00.000Z',
      },
    });
    expect(patch.statusCode).toBe(204);

    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/academic-rules/${academicRuleId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ ruleValue: Record<string, unknown>; recordedUntil: string | null }>>())
      .toMatchObject([
        { ruleValue: { mark: 40 } },
        { ruleValue: { mark: 45 }, recordedUntil: null },
      ]);
  });

  it('does not expose academic rules to a different tenant', async () => {
    const otherTenantJwt = await ctx.makeJwt({
      tenantId: ctx.secondTenantId,
      roles: ['tenant-administrator'],
    });

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/academic-rules/${academicRuleId}`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(get.statusCode).toBe(404);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/academic-rules',
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ academicRuleId: string }>>())
      .not.toContainEqual(expect.objectContaining({ academicRuleId }));
  });
});
