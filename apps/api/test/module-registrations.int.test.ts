import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let personId: string;
let secondPersonId: string;
let enrolmentId: string;
let secondEnrolmentId: string;
let academicPeriodId: string;

beforeAll(async () => {
  ctx = await startTestApp();
  jwt = await ctx.makeJwt();

  personId = await createStudent('Maya', 'Register');
  secondPersonId = await createStudent('Nora', 'Capacity');
  enrolmentId = await createEnrolment(personId);
  secondEnrolmentId = await createEnrolment(secondPersonId);

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2026-27',
      periodCode: 'REG-SEM1',
      periodTypeCode: 'semester',
      startDate: '2026-09-21',
      endDate: '2027-01-15',
    },
  });
  academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('Module registrations', () => {
  it('registers a student on a module offering and exposes timetable data', async () => {
    const moduleId = await createModule('REG101', 'Registration Systems');
    const moduleOfferingId = await createOffering(moduleId, 20);

    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId,
        moduleOfferingId,
        registrationDate: '2026-10-01',
      },
    });
    expect(create.statusCode).toBe(201);
    const moduleRegistrationId = create.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${moduleRegistrationId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ statusCode: string; moduleId: string; academicPeriodId: string }>())
      .toMatchObject({ statusCode: 'registered', moduleId, academicPeriodId });

    const timetable = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/timetable?enrolmentId=${enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(timetable.statusCode).toBe(200);
    expect(timetable.json<Array<{ moduleRegistrationId: string; moduleCode: string; periodCode: string }>>())
      .toContainEqual(expect.objectContaining({
        moduleRegistrationId,
        moduleCode: 'REG101',
        periodCode: 'REG-SEM1',
      }));
  });

  it('withdraws a module registration bitemporally and exposes history', async () => {
    const moduleId = await createModule('REG102', 'Withdrawable Module');
    const moduleOfferingId = await createOffering(moduleId, 20);
    const moduleRegistrationId = await createRegistration(enrolmentId, moduleOfferingId);

    const withdraw = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${moduleRegistrationId}/withdrawal`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { validFrom: '2026-11-01T00:00:00.000Z' },
    });
    expect(withdraw.statusCode).toBe(204);

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${moduleRegistrationId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.json<{ statusCode: string }>().statusCode).toBe('withdrawn');

    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${moduleRegistrationId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ statusCode: string; recordedUntil: string | null }>>())
      .toMatchObject([
        { statusCode: 'registered' },
        { statusCode: 'withdrawn', recordedUntil: null },
      ]);
  });

  it('does not expose a module registration to a different tenant', async () => {
    const moduleId = await createModule('REG103', 'Tenant Isolation Module');
    const moduleOfferingId = await createOffering(moduleId, 20);
    const moduleRegistrationId = await createRegistration(enrolmentId, moduleOfferingId);
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${moduleRegistrationId}`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(get.statusCode).toBe(404);
  });

  it('rejects duplicate and over-capacity registrations', async () => {
    const moduleId = await createModule('REG104', 'Capacity Module');
    const moduleOfferingId = await createOffering(moduleId, 1);
    await createRegistration(enrolmentId, moduleOfferingId);

    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, moduleOfferingId, registrationDate: '2026-10-01' },
    });
    expect(duplicate.statusCode).toBe(409);

    const full = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: secondEnrolmentId, moduleOfferingId, registrationDate: '2026-10-01' },
    });
    expect(full.statusCode).toBe(409);
  });

  it('rejects registrations outside the academic period window', async () => {
    const moduleId = await createModule('REG105', 'Window Module');
    const moduleOfferingId = await createOffering(moduleId, 20);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, moduleOfferingId, registrationDate: '2026-08-01' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('checks prerequisites before registration', async () => {
    const prerequisiteModuleId = await createModule('REG106A', 'Prerequisite Module');
    const targetModuleId = await createModule('REG106B', 'Advanced Module');
    const prerequisiteOfferingId = await createOffering(prerequisiteModuleId, 20);
    const targetOfferingId = await createOffering(targetModuleId, 20);

    await createRelationship(targetModuleId, prerequisiteModuleId, 'prerequisite');

    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, moduleOfferingId: targetOfferingId, registrationDate: '2026-10-01' },
    });
    expect(blocked.statusCode).toBe(422);

    const prerequisiteRegistrationId = await createRegistration(enrolmentId, prerequisiteOfferingId);
    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${prerequisiteRegistrationId}/completion`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { validFrom: '2026-10-15T00:00:00.000Z' },
    });
    expect(complete.statusCode).toBe(204);

    const allowed = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, moduleOfferingId: targetOfferingId, registrationDate: '2026-10-20' },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('checks module exclusions before registration', async () => {
    const excludedModuleId = await createModule('REG107A', 'Excluded Module');
    const targetModuleId = await createModule('REG107B', 'Alternative Module');
    const excludedOfferingId = await createOffering(excludedModuleId, 20);
    const targetOfferingId = await createOffering(targetModuleId, 20);

    await createRegistration(enrolmentId, excludedOfferingId);
    await createRelationship(targetModuleId, excludedModuleId, 'exclusion');

    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId, moduleOfferingId: targetOfferingId, registrationDate: '2026-10-01' },
    });
    expect(blocked.statusCode).toBe(422);
  });

  it('enforces per-period credit limit when a rule is configured (REG-003)', async () => {
    // Seed a max-credits-per-period rule (60 credits) for the test tenant
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const ruleRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/academic-rules',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        ruleTypeCode: 'max-credits-per-period',
        ruleKey:      'per-period',
        ruleValue:    { maxCredits: 60 },
        description:  'Maximum 60 credits per period',
      },
    });
    expect(ruleRes.statusCode).toBe(201);

    // Create a dedicated student and enrolment for this test
    const creditPersonId = await createStudent('Credit', 'Limit');
    const creditEnrolmentId = await createEnrolment(creditPersonId);

    // Two modules at 30 credits each
    const modA = await createModuleWithCredits('REG108A', 'Credits Module A', 30);
    const modB = await createModuleWithCredits('REG108B', 'Credits Module B', 30);
    const modC = await createModuleWithCredits('REG108C', 'Credits Module C', 30);
    const offeringA = await createOffering(modA, 50);
    const offeringB = await createOffering(modB, 50);
    const offeringC = await createOffering(modC, 50);

    // First registration: 30 credits — succeeds
    const resA = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: creditEnrolmentId, moduleOfferingId: offeringA, registrationDate: '2026-10-01' },
    });
    expect(resA.statusCode).toBe(201);

    // Second registration: 30+30=60 — succeeds (at limit)
    const resB = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: creditEnrolmentId, moduleOfferingId: offeringB, registrationDate: '2026-10-01' },
    });
    expect(resB.statusCode).toBe(201);

    // Third registration: 60+30=90 — exceeds limit, rejected
    const resC = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/module-registrations',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: creditEnrolmentId, moduleOfferingId: offeringC, registrationDate: '2026-10-01' },
    });
    expect(resC.statusCode).toBe(422);
    expect(resC.json<{ detail: string }>().detail).toContain('credit limit');
  });
});

async function createStudent(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

async function createEnrolment(personId_: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId: personId_,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2026-27',
      startDate: '2026-09-21',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function createModule(code: string, title: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title, creditValue: 20 },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleId: string }>().moduleId;
}

async function createOffering(moduleId: string, capacity: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      moduleId,
      academicPeriodId,
      deliveryModeCode: 'in-person',
      capacity,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleOfferingId: string }>().moduleOfferingId;
}

async function createRegistration(enrolmentId_: string, moduleOfferingId: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId: enrolmentId_,
      moduleOfferingId,
      registrationDate: '2026-10-01',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleRegistrationId: string }>().moduleRegistrationId;
}

async function createRelationship(
  moduleId: string,
  relatedModuleId: string,
  relationshipTypeCode: 'prerequisite' | 'co-requisite' | 'exclusion',
): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-relationships',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, relatedModuleId, relationshipTypeCode },
  });
  expect(res.statusCode).toBe(201);
}

async function createModuleWithCredits(code: string, title: string, creditValue: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title, creditValue },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ moduleId: string }>().moduleId;
}
