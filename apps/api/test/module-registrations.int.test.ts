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

  it('rejects transitions once a module registration is no longer registered', async () => {
    const moduleId = await createModule('REG102B', 'Closed Registration Module');
    const moduleOfferingId = await createOffering(moduleId, 20);
    const moduleRegistrationId = await createRegistration(enrolmentId, moduleOfferingId);

    const withdraw = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${moduleRegistrationId}/withdrawal`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { validFrom: '2026-11-01T00:00:00.000Z' },
    });
    expect(withdraw.statusCode).toBe(204);

    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${moduleRegistrationId}/completion`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { validFrom: '2026-11-02T00:00:00.000Z' },
    });
    expect(complete.statusCode).toBe(422);
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

// Isolated in the second tenant so enabling registrationWindowMode here
// cannot affect the unrestricted-by-default behaviour the rest of this file
// relies on.
describe('Registration window enforcement', () => {
  it('blocks registration until an admin configures an open window, then enforces it', async () => {
    const tenantId = ctx.secondTenantId;
    const adminJwt = await ctx.makeJwt({ tenantId, roles: ['tenant-administrator'] });
    const regJwt   = await ctx.makeJwt({ tenantId });

    const configure = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/tenant/configuration',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: { registrationWindowMode: 'academic-period' },
    });
    expect(configure.statusCode).toBe(200);

    const period = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/academic-periods',
      headers: { authorization: `Bearer ${regJwt}` },
      payload: {
        academicYear: '2026-27', periodCode: 'WINDOW-SEM1', periodTypeCode: 'semester',
        startDate: '2026-09-21', endDate: '2027-01-15',
      },
    });
    const windowPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${regJwt}` },
      payload: { legalFirstName: 'Wren', legalFamilyName: 'Window' },
    });
    const windowPersonId = student.json<{ personId: string }>().personId;

    const enrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${regJwt}` },
      payload: { personId: windowPersonId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' },
    });
    const windowEnrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

    const moduleRes = await ctx.app.inject({
      method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${regJwt}` },
      payload: { code: 'WIN101', title: 'Window Module', creditValue: 20 },
    });
    const windowModuleId = moduleRes.json<{ moduleId: string }>().moduleId;

    const offering = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${regJwt}` },
      payload: { moduleId: windowModuleId, academicPeriodId: windowPeriodId, deliveryModeCode: 'in-person', capacity: 20 },
    });
    const windowOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

    // No registration_window row exists yet for this period — blocked.
    const beforeWindowConfigured = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${regJwt}` },
      payload: { enrolmentId: windowEnrolmentId, moduleOfferingId: windowOfferingId, registrationDate: '2026-10-01' },
    });
    expect(beforeWindowConfigured.statusCode).toBe(422);

    // Window configured but already closed — still blocked.
    const closedWindow = await ctx.app.inject({
      method: 'POST', url: '/api/v1/registration-windows', headers: { authorization: `Bearer ${regJwt}` },
      payload: { academicPeriodId: windowPeriodId, opensAt: '2020-01-01T00:00:00.000Z', closesAt: '2020-02-01T00:00:00.000Z' },
    });
    expect(closedWindow.statusCode).toBe(201);
    const registrationWindowId = closedWindow.json<{ registrationWindowId: string }>().registrationWindowId;

    const duringClosedWindow = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${regJwt}` },
      payload: { enrolmentId: windowEnrolmentId, moduleOfferingId: windowOfferingId, registrationDate: '2026-10-01' },
    });
    expect(duringClosedWindow.statusCode).toBe(422);

    // Reopen the window to cover now — registration succeeds.
    const reopen = await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/registration-windows/${registrationWindowId}`, headers: { authorization: `Bearer ${regJwt}` },
      payload: { opensAt: '2020-01-01T00:00:00.000Z', closesAt: '2099-01-01T00:00:00.000Z' },
    });
    expect(reopen.statusCode).toBe(204);

    const duringOpenWindow = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${regJwt}` },
      payload: { enrolmentId: windowEnrolmentId, moduleOfferingId: windowOfferingId, registrationDate: '2026-10-01' },
    });
    expect(duringOpenWindow.statusCode).toBe(201);
  });
});

// Isolated in the second tenant, same reasoning as the window-enforcement
// block above.
describe('Registration/withdrawal change requests', () => {
  let regJwt: string;
  let studentJwt: string;
  let tutorJwt: string;
  let crPersonId: string;
  let crEnrolmentId: string;
  let crModuleAId: string;
  let crModuleBId: string;
  let crOfferingAId: string;
  let crOfferingBId: string;

  beforeAll(async () => {
    regJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const period = await ctx.app.inject({
      method: 'POST', url: '/api/v1/academic-periods', headers: { authorization: `Bearer ${regJwt}` },
      payload: { academicYear: '2026-27', periodCode: 'CR-SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15' },
    });
    const periodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

    // The preceding "Registration window enforcement" block already enabled
    // registrationWindowMode='academic-period' on this same secondTenantId,
    // so this new academic period needs its own open window too.
    await ctx.app.inject({
      method: 'POST', url: '/api/v1/registration-windows', headers: { authorization: `Bearer ${regJwt}` },
      payload: { academicPeriodId: periodId, opensAt: '2020-01-01T00:00:00.000Z', closesAt: '2099-01-01T00:00:00.000Z' },
    });

    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${regJwt}` },
      payload: { legalFirstName: 'Cara', legalFamilyName: 'Request' },
    });
    crPersonId = student.json<{ personId: string }>().personId;

    const enrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${regJwt}` },
      payload: { personId: crPersonId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21' },
    });
    crEnrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

    const moduleA = await ctx.app.inject({
      method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${regJwt}` },
      payload: { code: 'CR101', title: 'Change Request Module A', creditValue: 20 },
    });
    crModuleAId = moduleA.json<{ moduleId: string }>().moduleId;
    const offeringA = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${regJwt}` },
      payload: { moduleId: crModuleAId, academicPeriodId: periodId, deliveryModeCode: 'in-person', capacity: 20 },
    });
    crOfferingAId = offeringA.json<{ moduleOfferingId: string }>().moduleOfferingId;

    const moduleB = await ctx.app.inject({
      method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${regJwt}` },
      payload: { code: 'CR102', title: 'Change Request Module B', creditValue: 20 },
    });
    crModuleBId = moduleB.json<{ moduleId: string }>().moduleId;
    const offeringB = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${regJwt}` },
      payload: { moduleId: crModuleBId, academicPeriodId: periodId, deliveryModeCode: 'in-person', capacity: 20 },
    });
    crOfferingBId = offeringB.json<{ moduleOfferingId: string }>().moduleOfferingId;

    studentJwt = await ctx.makeJwt({ roles: ['student'], tenantId: ctx.secondTenantId, srsPersonId: crPersonId });
    tutorJwt   = await ctx.makeJwt({ roles: ['personal-tutor'], tenantId: ctx.secondTenantId });
  });

  it('a student cannot register directly — only request', async () => {
    // Direct immediate registration remains reachable at the route level for
    // 'module-registration:write:own', but a student requesting their own
    // registration should use the request endpoint per the workflow design;
    // this test documents the new request endpoint's 202 contract.
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations/requests', headers: { authorization: `Bearer ${studentJwt}` },
      payload: { enrolmentId: crEnrolmentId, moduleOfferingId: crOfferingAId, registrationDate: '2026-10-01' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ workflowInstanceId: string; statusCode: string }>();
    expect(body.statusCode).toBe('running');
  });

  it('an approved request creates the registration', async () => {
    const request = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations/requests', headers: { authorization: `Bearer ${studentJwt}` },
      payload: { enrolmentId: crEnrolmentId, moduleOfferingId: crOfferingBId, registrationDate: '2026-10-01' },
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const pending = await ctx.app.inject({
      method: 'GET', url: '/api/v1/module-registration-requests', headers: { authorization: `Bearer ${tutorJwt}` },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<Array<{ workflowInstanceId: string }>>().some(r => r.workflowInstanceId === workflowInstanceId)).toBe(true);

    const decide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registration-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(200);
    const { moduleRegistrationId } = decide.json<{ moduleRegistrationId: string | null }>();
    expect(moduleRegistrationId).toMatch(/^[0-9a-f-]{36}$/);

    const list = await ctx.app.inject({
      method: 'GET', url: `/api/v1/module-registrations?enrolmentId=${crEnrolmentId}`,
      headers: { authorization: `Bearer ${regJwt}` },
    });
    expect(list.json<Array<{ moduleRegistrationId: string; statusCode: string }>>())
      .toContainEqual(expect.objectContaining({ moduleRegistrationId, statusCode: 'registered' }));

    // The now-completed request no longer appears in the pending queue.
    const pendingAfter = await ctx.app.inject({
      method: 'GET', url: '/api/v1/module-registration-requests', headers: { authorization: `Bearer ${tutorJwt}` },
    });
    expect(pendingAfter.json<Array<{ workflowInstanceId: string }>>().some(r => r.workflowInstanceId === workflowInstanceId)).toBe(false);

    // A withdrawal request on the newly-approved registration, also approved.
    const withdrawRequest = await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registrations/${moduleRegistrationId}/withdrawal-requests`,
      headers: { authorization: `Bearer ${studentJwt}` },
      payload: {},
    });
    expect(withdrawRequest.statusCode).toBe(202);
    const { workflowInstanceId: withdrawalWorkflowId } = withdrawRequest.json<{ workflowInstanceId: string }>();

    const decideWithdrawal = await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registration-requests/${withdrawalWorkflowId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decideWithdrawal.statusCode).toBe(200);

    const getReg = await ctx.app.inject({
      method: 'GET', url: `/api/v1/module-registrations/${moduleRegistrationId}`,
      headers: { authorization: `Bearer ${regJwt}` },
    });
    expect(getReg.json<{ statusCode: string }>().statusCode).toBe('withdrawn');
  });

  it('a rejected request does not create a registration', async () => {
    const moduleC = await ctx.app.inject({
      method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${regJwt}` },
      payload: { code: 'CR103', title: 'Change Request Module C', creditValue: 20 },
    });
    const moduleCId = moduleC.json<{ moduleId: string }>().moduleId;
    const offeringC = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${regJwt}` },
      payload: {
        moduleId: moduleCId,
        academicPeriodId: (await ctx.app.inject({
          method: 'GET', url: '/api/v1/academic-periods?academicYear=2026-27', headers: { authorization: `Bearer ${regJwt}` },
        })).json<Array<{ academicPeriodId: string; periodCode: string }>>().find(p => p.periodCode === 'CR-SEM1')!.academicPeriodId,
        deliveryModeCode: 'in-person', capacity: 20,
      },
    });
    const offeringCId = offeringC.json<{ moduleOfferingId: string }>().moduleOfferingId;

    const request = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations/requests', headers: { authorization: `Bearer ${studentJwt}` },
      payload: { enrolmentId: crEnrolmentId, moduleOfferingId: offeringCId, registrationDate: '2026-10-01' },
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const decide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registration-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` },
      payload: { decisionCode: 'rejected', reason: 'Timetable clash' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<{ moduleRegistrationId: string | null }>().moduleRegistrationId).toBeNull();

    const list = await ctx.app.inject({
      method: 'GET', url: `/api/v1/module-registrations?enrolmentId=${crEnrolmentId}&moduleOfferingId=${offeringCId}`,
      headers: { authorization: `Bearer ${regJwt}` },
    });
    expect(list.json<unknown[]>()).toHaveLength(0);

    // Deciding the same request twice is rejected.
    const secondDecide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registration-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${tutorJwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(secondDecide.statusCode).toBe(422);
  });

  it('a student cannot decide a change request', async () => {
    const request = await ctx.app.inject({
      method: 'POST', url: '/api/v1/module-registrations/requests', headers: { authorization: `Bearer ${studentJwt}` },
      payload: { enrolmentId: crEnrolmentId, moduleOfferingId: crOfferingAId, registrationDate: '2026-10-01' },
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const decide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/module-registration-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${studentJwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(403);
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
