import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
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

describe('Assessment components', () => {
  it('creates and lists components for a module offering', async () => {
    const moduleOfferingId = await createModuleOffering('ASS101');

    const exam = await createComponent(moduleOfferingId, {
      componentTypeCode: 'exam',
      title: 'Final Exam',
      weighting: 60,
      passMarkOverride: 40,
    });
    const coursework = await createComponent(moduleOfferingId, {
      componentTypeCode: 'coursework',
      title: 'Coursework Portfolio',
      weighting: 40,
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ assessmentComponentId: string; title: string; weighting: number }>>())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ assessmentComponentId: exam, title: 'Final Exam', weighting: 60 }),
        expect.objectContaining({ assessmentComponentId: coursework, title: 'Coursework Portfolio', weighting: 40 }),
      ]));
  });

  it('rejects component weightings that would exceed 100 for an offering', async () => {
    const moduleOfferingId = await createModuleOffering('ASS102');
    await createComponent(moduleOfferingId, {
      componentTypeCode: 'exam',
      title: 'Whole Module Exam',
      weighting: 100,
    });

    const over = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        componentTypeCode: 'coursework',
        title: 'Extra Coursework',
        weighting: 1,
      },
    });
    expect(over.statusCode).toBe(422);
  });

  it('rejects invalid component type codes', async () => {
    const moduleOfferingId = await createModuleOffering('ASS103');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        componentTypeCode: 'not-a-component-type',
        title: 'Mystery Assessment',
        weighting: 100,
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('updates components before marks have been ingested', async () => {
    const moduleOfferingId = await createModuleOffering('ASS104');
    const assessmentComponentId = await createComponent(moduleOfferingId, {
      componentTypeCode: 'portfolio',
      title: 'Portfolio',
      weighting: 100,
    });

    const update = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components/${assessmentComponentId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        title: 'Reflective Portfolio',
        componentTypeCode: 'coursework',
        passMarkOverride: 45,
      },
    });
    expect(update.statusCode).toBe(204);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.json<Array<{ title: string; componentTypeCode: string; passMarkOverride: number }>>())
      .toContainEqual(expect.objectContaining({
        title: 'Reflective Portfolio',
        componentTypeCode: 'coursework',
        passMarkOverride: 45,
      }));
  });

  it('rejects updates once current marks reference the component', async () => {
    const moduleOfferingId = await createModuleOffering('ASS105');
    const assessmentComponentId = await createComponent(moduleOfferingId, {
      componentTypeCode: 'exam',
      title: 'Locked Exam',
      weighting: 100,
    });
    await insertCurrentMark(assessmentComponentId);

    const update = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components/${assessmentComponentId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { title: 'Should Not Change' },
    });
    expect(update.statusCode).toBe(422);
  });

  it('does not expose components through another tenant', async () => {
    const moduleOfferingId = await createModuleOffering('ASS106');
    await createComponent(moduleOfferingId, {
      componentTypeCode: 'exam',
      title: 'Tenant Scoped Exam',
      weighting: 100,
    });
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(list.statusCode).toBe(404);
  });
});

async function createModuleOffering(moduleCode: string): Promise<string> {
  const module = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      code: moduleCode,
      title: `${moduleCode} Module`,
      creditValue: 20,
    },
  });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2027-28',
      periodCode: `${moduleCode}-SEM1`,
      periodTypeCode: 'semester',
      startDate: '2027-09-20',
      endDate: '2028-01-14',
    },
  });
  expect(period.statusCode).toBe(201);
  const academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

  const offering = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      moduleId,
      academicPeriodId,
      deliveryModeCode: 'in-person',
      capacity: 100,
    },
  });
  expect(offering.statusCode).toBe(201);
  return offering.json<{ moduleOfferingId: string }>().moduleOfferingId;
}

async function createComponent(
  moduleOfferingId: string,
  payload: {
    componentTypeCode: string;
    title: string;
    weighting: number;
    passMarkOverride?: number;
  },
): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ assessmentComponentId: string }>().assessmentComponentId;
}

async function insertCurrentMark(assessmentComponentId: string): Promise<void> {
  await ctx.db.execute(sql`
    INSERT INTO mark (
      version_id,
      id,
      tenant_id,
      module_registration_id,
      assessment_component_id,
      attempt_number,
      raw_mark,
      adjusted_mark,
      penalty_applied,
      locked,
      actor_id,
      valid_from,
      recorded_at
    )
    VALUES (
      ${randomUUID()},
      ${randomUUID()},
      ${ctx.tenantId},
      ${randomUUID()},
      ${assessmentComponentId},
      1,
      55.00,
      55.00,
      false,
      false,
      'test-user-001',
      NOW(),
      NOW()
    )
  `);
}
