import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

interface CapturedEvent {
  type: string;
  classification: string;
  payload: unknown;
}

function createSpyBus(capture: CapturedEvent[]): IntegrationBusPublisher {
  return {
    isConnected: () => true,
    publish: (
      type: string,
      _version: string,
      _tenantId: string,
      _correlationId: string,
      classification: string,
      payload: unknown,
    ): Promise<void> => {
      capture.push({ type, classification, payload });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
  jwt = await ctx.makeJwt();
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Module results', () => {
  it('recalculates weighted module results after mark ingestion and correction', async () => {
    const fixture = await createModuleResultFixture('RES101');

    await ingestMark(fixture.moduleRegistrationId, fixture.examComponentId, 50);
    const deferred = await getResult(fixture.moduleRegistrationId);
    expect(deferred.statusCode).toBe(200);
    expect(deferred.json<{ aggregateMark: number; resultCode: string }>())
      .toMatchObject({ aggregateMark: 30, resultCode: 'deferred' });

    const courseworkMarkId = await ingestMark(fixture.moduleRegistrationId, fixture.courseworkComponentId, 80);
    const passed = await getResult(fixture.moduleRegistrationId);
    expect(passed.json<{ moduleResultId: string; aggregateMark: number; resultCode: string; locked: boolean }>())
      .toMatchObject({ aggregateMark: 62, resultCode: 'pass', locked: false });

    const event = capturedEvents.find((captured) =>
      captured.type === 'srs.assessment.module-result-calculated'
      && (captured.payload as { resultCode?: string }).resultCode === 'pass');
    expect(event).toBeDefined();
    expect(event?.classification).toBe('personal');
    expect(event?.payload).toMatchObject({
      moduleRegistrationId: fixture.moduleRegistrationId,
      aggregateMark: 62,
      resultCode: 'pass',
    });

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/marks/${courseworkMarkId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 35, reason: 'moderation correction' },
    });
    expect(patch.statusCode).toBe(204);

    const failed = await getResult(fixture.moduleRegistrationId);
    expect(failed.json<{ aggregateMark: number; resultCode: string }>())
      .toMatchObject({ aggregateMark: 44, resultCode: 'fail' });

    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/result/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ aggregateMark: number; resultCode: string; recordedUntil: string | null }>>())
      .toMatchObject([
        { aggregateMark: 30, resultCode: 'deferred' },
        { aggregateMark: 62, resultCode: 'pass' },
        { aggregateMark: 44, resultCode: 'fail', recordedUntil: null },
      ]);
  });

  it('does not expose module results through another tenant', async () => {
    const fixture = await createModuleResultFixture('RES102');
    await ingestMark(fixture.moduleRegistrationId, fixture.examComponentId, 55);
    await ingestMark(fixture.moduleRegistrationId, fixture.courseworkComponentId, 65);
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const result = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/result`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(result.statusCode).toBe(404);
  });
});

interface ModuleResultFixture {
  moduleRegistrationId: string;
  examComponentId: string;
  courseworkComponentId: string;
}

async function createModuleResultFixture(code: string): Promise<ModuleResultFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Result' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
    },
  });
  expect(enrolment.statusCode).toBe(201);
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

  const module = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title: `${code} Module`, creditValue: 20 },
  });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2027-28',
      periodCode: `${code}-SEM1`,
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
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  expect(offering.statusCode).toBe(201);
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

  const registration = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId,
      moduleOfferingId,
      registrationDate: '2027-10-01',
    },
  });
  expect(registration.statusCode).toBe(201);
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const examComponentId = await createComponent(moduleOfferingId, {
    componentTypeCode: 'exam',
    title: 'Exam',
    weighting: 60,
  });
  const courseworkComponentId = await createComponent(moduleOfferingId, {
    componentTypeCode: 'coursework',
    title: 'Coursework',
    weighting: 40,
  });

  return { moduleRegistrationId, examComponentId, courseworkComponentId };
}

async function createComponent(
  moduleOfferingId: string,
  payload: { componentTypeCode: string; title: string; weighting: number },
): Promise<string> {
  const component = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload,
  });
  expect(component.statusCode).toBe(201);
  return component.json<{ assessmentComponentId: string }>().assessmentComponentId;
}

async function ingestMark(
  moduleRegistrationId: string,
  assessmentComponentId: string,
  rawMark: number,
): Promise<string> {
  const mark = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId, rawMark },
  });
  expect(mark.statusCode).toBe(201);
  return mark.json<{ markId: string }>().markId;
}

async function getResult(moduleRegistrationId: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/module-registrations/${moduleRegistrationId}/result`,
    headers: { authorization: `Bearer ${jwt}` },
  });
}
