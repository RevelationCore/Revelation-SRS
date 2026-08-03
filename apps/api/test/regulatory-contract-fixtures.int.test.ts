import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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

describe('Regulatory contract fixtures', () => {
  it('UCAS generated confirmation payload matches pinned confirmation fields and domains', async () => {
    const fixture = await readJson<{ cycle: string; confirmations: Array<Record<string, unknown>> }>('ucas/2027/confirmation.sample.json');
    const expected = fixture.confirmations[0]!;
    const personId = await createPerson('Ucas', 'Fixture');
    await createEnrolment(personId, {
      academicYearOfEntry: '2027-28',
      ucasPersonalId: expected['ucasPersonalId'],
    });

    const generated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { cycle: fixture.cycle },
    });
    expect(generated.statusCode).toBe(200);
    const body = generated.json<{ payload: { cycle: string; confirmations: Array<Record<string, unknown>> } }>();
    const confirmation = body.payload.confirmations.find((row) => row.ucasPersonalId === expected['ucasPersonalId']);
    expect(confirmation).toBeDefined();
    expect(body.payload.cycle).toBe(fixture.cycle);
    expect(confirmation).toMatchObject({
      ucasPersonalId: expected['ucasPersonalId'],
      confirmationType: expected['confirmationType'],
    });
    expect(typeof confirmation!['confirmedAt']).toBe('string');
  });

  it('HESA XML generation and validation report processing accept pinned fixtures', async () => {
    const minimalXml = await readText('hesa/2027-28/student-return.minimal.xml');
    const validationReport = await readJson<Record<string, unknown>>('hesa/2027-28/validation-report.sample.json');
    const personId = await createPerson('Amara', 'Singh', { dateOfBirth: '2008-04-12' });
    await createEnrolment(personId, { academicYearOfEntry: '2031-32', startDate: '2031-09-20' });

    const generated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/hesa/returns',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2031-32' },
    });
    expect(generated.statusCode).toBe(201);
    const returnId = generated.json<{ returnId: string }>().returnId;
    const validate = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/validate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(validate.statusCode).toBe(200);
    const file = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/file`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(file.statusCode).toBe(200);
    const xml = file.body;
    for (const tag of ['StudentReturn', 'Student', 'HUSID', 'SURNAME', 'FNAMES', 'BIRTHDTE', 'MODE', 'YEARPRG']) {
      expect(xml).toContain(`<${tag}`);
    }
    expect(minimalXml.indexOf('<HUSID>')).toBeLessThan(minimalXml.indexOf('<SURNAME>'));

    const report = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/validation-reports`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reportPayload: validationReport },
    });
    expect(report.statusCode).toBe(201);
    expect(report.json<{ warningCount: number }>().warningCount).toBeGreaterThanOrEqual(1);
  });

  it('SLC confirmation and notification payloads satisfy pinned v1 fixture structure', async () => {
    const confirmationFixture = await readJson<{ confirmations: Array<Record<string, unknown>> }>('slc/v1/confirmation.sample.json');
    const notificationFixture = await readJson<Record<string, unknown>>('slc/v1/notification.sample.json');
    const expected = confirmationFixture.confirmations[0]!;
    const personId = await createPerson('Slc', 'Fixture');
    const enrolmentId = await createEnrolment(personId, {
      academicYearOfEntry: '2027-28',
      fundingSourceCode: 'slc',
      slcReference: expected['slcReference'],
    });

    const generated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(generated.statusCode).toBe(200);
    const confirmation = generated
      .json<{ payload: { confirmations: Array<Record<string, unknown>> } }>()
      .payload.confirmations.find((row) => row.slcReference === expected['slcReference']);
    expect(confirmation).toBeDefined();
    expect(confirmation).toMatchObject({
      slcReference: expected['slcReference'],
      confirmationType: expected['confirmationType'],
      startDate: expected['startDate'],
    });

    const inbound = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/notifications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId,
        notificationTypeCode: notificationFixture['notificationTypeCode'],
        effectiveDate: notificationFixture['effectiveDate'],
        amount: notificationFixture['amount'],
        notificationId: notificationFixture['notificationId'],
      },
    });
    expect(inbound.statusCode).toBe(201);
  });

  it('UKVI CAS and visa status payloads satisfy pinned v1 fixture structure', async () => {
    const casFixture = await readJson<{ requests: Array<Record<string, unknown>> }>('ukvi/v1/cas-request.sample.json');
    const visaFixture = await readJson<Record<string, unknown>>('ukvi/v1/visa-status.sample.json');
    const expected = casFixture.requests[0]!;
    const personId = await createPerson(String(expected['givenNames']), String(expected['familyName']));
    const enrolmentId = await createEnrolment(personId, {
      academicYearOfEntry: '2027-28',
      ukviCasRequired: true,
      expectedEndDate: expected['expectedEndDate'],
    });

    const generated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/cas-requests/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(generated.statusCode).toBe(200);
    const cas = generated
      .json<{ casRequests: Array<{ casRequestId: string; enrolmentId: string; personData: Record<string, unknown> }> }>()
      .casRequests.find((row) => row.enrolmentId === enrolmentId)!;
    expect(cas.personData).toMatchObject({
      legalFirstName: expected['givenNames'],
      legalFamilyName: expected['familyName'],
      startDate: expected['startDate'],
      expectedEndDate: expected['expectedEndDate'],
    });

    const assignment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ukvi/cas-requests/${cas.casRequestId}/assignment`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { casReference: visaFixture['casReference'] },
    });
    expect(assignment.statusCode).toBe(200);
    const visa = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/visa-updates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: visaFixture,
    });
    expect(visa.statusCode).toBe(201);

    // Direct attendance-report generation is deliberately retired in favour
    // of the engagement evidence-snapshot + human sponsor decision +
    // independent authorisation flow (see attendance/engagement vertical
    // slice tests) — this asserts the retirement stays in effect rather
    // than silently regressing back to direct generation.
    const academicPeriodId = await createAcademicPeriod('UKVI-CONTRACT');
    const attendance = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/attendance-reports/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicPeriodId },
    });
    expect(attendance.statusCode).toBe(422);
    expect(attendance.json<{ detail: string }>().detail).toContain('retired');
  });

  it('Exam Scheduling timetable fixture is accepted and schedules entries bitemporally', async () => {
    const fixture = await readJson<{ candidates: Array<Record<string, unknown>> }>('exam-scheduling/v1/timetable.sample.json');
    const board = await createExamFixture('EXAM-CONTRACT');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${board.examBoardId}/data-pack`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const generated = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${board.examBoardId}/exam-entries/generate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(generated.statusCode).toBe(200);
    const integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const schedule = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${board.examBoardId}/exam-schedule`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        candidates: fixture.candidates.map((candidate) => ({
          ...candidate,
          moduleRegistrationId: board.moduleRegistrationId,
        })),
      },
    });
    expect(schedule.statusCode).toBe(201);
    expect(schedule.json<{ updatedCount: number }>().updatedCount).toBe(1);
  });
});

async function readText(relativePath: string): Promise<string> {
  const file = new URL(`../../../packages/testing/regulatory-contracts/${relativePath}`, import.meta.url);
  return readFile(fileURLToPath(file), 'utf8');
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readText(relativePath)) as T;
}

async function createPerson(firstName: string, familyName: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: firstName, legalFamilyName: familyName, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

async function createEnrolment(personId: string, overrides: Record<string, unknown>): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

async function createAcademicPeriod(periodCode: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      academicYear: '2027-28',
      periodCode,
      periodTypeCode: 'semester',
      startDate: '2027-09-20',
      endDate: '2028-01-14',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ academicPeriodId: string }>().academicPeriodId;
}

async function createExamFixture(code: string): Promise<{ examBoardId: string; moduleRegistrationId: string }> {
  const personId = await createPerson('Exam', 'Contract');
  const enrolmentId = await createEnrolment(personId, {});
  const module = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title: `${code} Module`, creditValue: 20 },
  });
  expect(module.statusCode).toBe(201);
  const academicPeriodId = await createAcademicPeriod(`${code}-${randomUUID().slice(0, 8)}`);
  const offering = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-offerings',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId: module.json<{ moduleId: string }>().moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  expect(offering.statusCode).toBe(201);
  const registration = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/module-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, moduleOfferingId: offering.json<{ moduleOfferingId: string }>().moduleOfferingId, registrationDate: '2027-10-01' },
  });
  expect(registration.statusCode).toBe(201);
  const board = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'module', academicYear: '2027-28', academicPeriodId, meetingDate: '2028-02-10' },
  });
  expect(board.statusCode).toBe(201);
  return {
    examBoardId: board.json<{ examBoardId: string }>().examBoardId,
    moduleRegistrationId: registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId,
  };
}
