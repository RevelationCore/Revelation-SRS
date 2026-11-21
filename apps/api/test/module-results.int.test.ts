import { sql } from 'drizzle-orm';
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
  personId: string;
  enrolmentId: string;
  moduleRegistrationId: string;
  examComponentId: string;
  courseworkComponentId: string;
}

// BL-177: the pre-review of BP-05 found any student could read any other
// student's module results, provisional ones included, and list every
// registration in the tenant. The portal hid unratified results; the API did not.
describe('student access to module results and registrations', () => {
  it('lets a student see only their own result, and only once it is ratified', async () => {
    const mine = await createModuleResultFixture('OWN101');
    await ingestMark(mine.moduleRegistrationId, mine.examComponentId, 70);
    const me = await ctx.makeJwt({ sub: 'student-own-101', roles: ['student'], srsPersonId: mine.personId });
    const url = `/api/v1/module-registrations/${mine.moduleRegistrationId}/result`;
    const asMe = () => ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${me}` } });

    expect((await asMe()).statusCode).toBe(404);   // provisional: not published to the student
    expect((await getResult(mine.moduleRegistrationId)).statusCode).toBe(200); // staff still see it

    await ctx.db.execute(sql`UPDATE module_result SET locked = true WHERE module_registration_id = ${mine.moduleRegistrationId}::uuid`);
    const published = await asMe();
    expect(published.statusCode).toBe(200);
    expect(published.json<{ locked: boolean }>().locked).toBe(true);
  });

  it("refuses another student's result, registrations and timetable", async () => {
    const theirs = await createModuleResultFixture('OWN102');
    await ingestMark(theirs.moduleRegistrationId, theirs.examComponentId, 70);
    await ctx.db.execute(sql`UPDATE module_result SET locked = true WHERE module_registration_id = ${theirs.moduleRegistrationId}::uuid`);
    const mine = await createModuleResultFixture('OWN103');
    const other = await ctx.makeJwt({ sub: 'student-own-103', roles: ['student'], srsPersonId: mine.personId });
    const get = (url: string) => ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${other}` } });

    expect((await get(`/api/v1/module-registrations/${theirs.moduleRegistrationId}/result`)).statusCode).toBe(403);
    expect((await get(`/api/v1/module-registrations?enrolmentId=${theirs.enrolmentId}`)).statusCode).toBe(403);
    expect((await get(`/api/v1/module-registrations/timetable?enrolmentId=${theirs.enrolmentId}`)).statusCode).toBe(403);
    expect((await get('/api/v1/module-registrations')).statusCode).toBe(403); // no tenant-wide list for students
    expect((await get(`/api/v1/module-registrations?enrolmentId=${mine.enrolmentId}`)).statusCode).toBe(200);
  });

  it('refuses a student token with no bound person, on reads and writes', async () => {
    const theirs = await createModuleResultFixture('OWN104');
    const unbound = await ctx.makeJwt({ sub: 'student-unbound', roles: ['student'] });
    const headers = { authorization: `Bearer ${unbound}` };
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/module-registrations?enrolmentId=${theirs.enrolmentId}`, headers })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'POST', url: `/api/v1/module-registrations/${theirs.moduleRegistrationId}/withdrawal`, headers, payload: {} })).statusCode).toBe(403);
  });
});

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

  return { personId, enrolmentId, moduleRegistrationId, examComponentId, courseworkComponentId };
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
