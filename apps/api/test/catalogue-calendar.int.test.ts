import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('Programme catalogue', () => {
  let programmeId: string;

  it('creates and retrieves a programme', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/programmes',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        code:                'BSC-CS',
        title:               'BSc Computer Science',
        creditFrameworkCode: 'cats',
        creditTotal:         360,
        durationYears:       3,
        modeOfStudyCode:     'full-time',
      },
    });
    expect(create.statusCode).toBe(201);
    programmeId = create.json<{ programmeId: string }>().programmeId;

    const get = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/programmes/${programmeId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ code: string; title: string; creditTotal: number }>())
      .toMatchObject({ code: 'BSC-CS', title: 'BSc Computer Science', creditTotal: 360 });
  });

  it('updates a programme bitemporally and exposes history', async () => {
    const jwt = await ctx.makeJwt();
    const update = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/programmes/${programmeId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { title: 'BSc Computer Science with Software Engineering', creditTotal: 480 },
    });
    expect(update.statusCode).toBe(204);

    const history = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/programmes/${programmeId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    const versions = history.json<Array<{ title: string; recordedUntil: string | null }>>();
    expect(versions).toHaveLength(2);
    expect(versions[0]?.recordedUntil).not.toBeNull();
    expect(versions[1]).toMatchObject({
      title: 'BSc Computer Science with Software Engineering',
      recordedUntil: null,
    });
  });

  it('does not expose a programme to a different tenant', async () => {
    const jwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/programmes/${programmeId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Module catalogue', () => {
  let moduleId: string;
  let relatedModuleId: string;

  it('creates modules and bitemporal module history', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        code:        'CS101',
        title:       'Programming 1',
        creditValue: 20,
      },
    });
    expect(create.statusCode).toBe(201);
    moduleId = create.json<{ moduleId: string }>().moduleId;

    const createRelated = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        code:        'CS100',
        title:       'Computing Foundations',
        creditValue: 20,
      },
    });
    relatedModuleId = createRelated.json<{ moduleId: string }>().moduleId;

    const update = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/modules/${moduleId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { title: 'Programming Fundamentals', creditValue: 30 },
    });
    expect(update.statusCode).toBe(204);

    const history = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/modules/${moduleId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ title: string }>>().map((m) => m.title)).toEqual([
      'Programming 1',
      'Programming Fundamentals',
    ]);
  });

  it('creates and lists module relationships', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/module-relationships',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        moduleId,
        relatedModuleId,
        relationshipTypeCode: 'prerequisite',
      },
    });
    expect(create.statusCode).toBe(201);

    const list = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/modules/${moduleId}/relationships`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ relatedModuleId: string; relationshipTypeCode: string }>>()).toMatchObject([
      { relatedModuleId, relationshipTypeCode: 'prerequisite' },
    ]);
  });

  it('creates and filters learning outcomes', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/learning-outcomes',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        moduleId,
        outcomeCode: 'LO1',
        description: 'Write and test small programs.',
      },
    });
    expect(create.statusCode).toBe(201);

    const list = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/learning-outcomes?moduleId=${moduleId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ moduleId: string; outcomeCode: string }>>()).toMatchObject([
      { moduleId, outcomeCode: 'LO1' },
    ]);
  });

  it('does not expose a module to a different tenant', async () => {
    const jwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/modules/${moduleId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Academic calendar and module offerings', () => {
  let moduleId: string;
  let academicPeriodId: string;
  let moduleOfferingId: string;

  beforeAll(async () => {
    const jwt = await ctx.makeJwt();
    const moduleRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/modules',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { code: 'CAL101', title: 'Calendar Module', creditValue: 10 },
    });
    moduleId = moduleRes.json<{ moduleId: string }>().moduleId;
  });

  it('creates and retrieves an academic period', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/academic-periods',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        academicYear:   '2026-27',
        periodCode:     'SEM1',
        periodTypeCode: 'semester',
        startDate:      '2026-09-21',
        endDate:        '2027-01-15',
      },
    });
    expect(create.statusCode).toBe(201);
    academicPeriodId = create.json<{ academicPeriodId: string }>().academicPeriodId;

    const get = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/academic-periods/${academicPeriodId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ academicYear: string; periodCode: string }>())
      .toMatchObject({ academicYear: '2026-27', periodCode: 'SEM1' });
  });

  it('creates and lists a module offering', async () => {
    const jwt = await ctx.makeJwt();
    const create = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/module-offerings',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        moduleId,
        academicPeriodId,
        deliveryModeCode: 'in-person',
        capacity: 120,
      },
    });
    expect(create.statusCode).toBe(201);
    moduleOfferingId = create.json<{ moduleOfferingId: string }>().moduleOfferingId;

    const list = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-offerings?academicPeriodId=${academicPeriodId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ moduleOfferingId: string; moduleId: string; capacity: number }>>()).toMatchObject([
      { moduleOfferingId, moduleId, capacity: 120 },
    ]);
  });

  it('does not expose a module offering to a different tenant', async () => {
    const jwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-offerings/${moduleOfferingId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
