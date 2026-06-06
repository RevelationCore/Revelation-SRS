import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../../src/platform/integration-bus/publisher.js';
import { startTestApp, type TestApp } from '../helpers/test-app.js';

interface CapturedEvent {
  type: string;
  version: string;
  tenantId: string;
  correlationId: string;
  classification: string;
  payload: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): boolean => typeof value === 'string' && UUID_RE.test(value);

function createSpyBus(capture: CapturedEvent[]): IntegrationBusPublisher {
  return {
    isConnected: () => true,
    publish: (
      type: string,
      version: string,
      tenantId: string,
      correlationId: string,
      classification: string,
      payload: unknown,
    ): Promise<void> => {
      capture.push({ type, version, tenantId, correlationId, classification, payload });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
const events: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(events) });
  jwt = await ctx.makeJwt();
}, 120_000);

beforeEach(() => { events.length = 0; });

afterAll(async () => {
  await ctx?.teardown();
});

function expectEvent(type: string, classification: string): Record<string, unknown> {
  const event = events.find((item) => item.type === type);
  expect(event, `missing event ${type}`).toBeDefined();
  expect(event!.version).toBe('1.0.0');
  expect(event!.classification).toBe(classification);
  expect(event!.tenantId).toBe(ctx.tenantId);
  return event!.payload as Record<string, unknown>;
}

describe('Phase 6 event consumers', () => {
  it('publishes UCAS regulatory events with required payload fields', async () => {
    const ingest = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/applications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        ucasPersonalId: 'EVT6UCAS001',
        cycle: '2027',
        statusCode: 'confirmed',
        legalFirstName: 'Ucas',
        legalFamilyName: 'Event',
        dateOfBirth: '2008-04-12',
        modeOfStudyCode: 'full-time',
        academicYearOfEntry: '2027-28',
        startDate: '2027-09-20',
      },
    });
    expect(ingest.statusCode).toBe(201);
    const application = expectEvent('srs.regulatory.ucas-application-received', 'personal');
    expect(isUuid(application['applicationId'])).toBe(true);
    expect(application['ucasPersonalId']).toBe('EVT6UCAS001');
    expect(application['cycle']).toBe('2027');

    const outbound = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { cycle: '2027' },
    });
    expect(outbound.statusCode).toBe(200);
    const confirmation = expectEvent('srs.regulatory.ucas-confirmation-sent', 'personal');
    expect(isUuid(confirmation['enrolmentId'])).toBe(true);
    expect(isUuid(confirmation['exchangeId'])).toBe(true);
    expect(typeof confirmation['confirmationType']).toBe('string');
  });

  it('publishes HESA regulatory events with required payload fields', async () => {
    const fixture = await createEnrolment('Hesa', 'Event', '2027-28', { dateOfBirth: '2008-04-12' });

    const generated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/hesa/returns',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2027-28' },
    });
    expect(generated.statusCode).toBe(201);
    const returnId = generated.json<{ returnId: string }>().returnId;
    const generatedEvent = expectEvent('srs.regulatory.hesa-return-generated', 'regulatory');
    expect(isUuid(generatedEvent['returnId'])).toBe(true);
    expect(generatedEvent['academicYear']).toBe('2027-28');

    const validation = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/validation-reports`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        reportPayload: {
          identifierAssignments: [{ enrolmentId: fixture.enrolmentId, hesaId: 'HESA-EVT6-001' }],
        },
      },
    });
    expect(validation.statusCode).toBe(201);
    const idAssigned = expectEvent('srs.regulatory.hesa-id-assigned', 'regulatory');
    expect(isUuid(idAssigned['returnId'])).toBe(true);
    expect(isUuid(idAssigned['enrolmentId'])).toBe(true);
    expect(idAssigned['hesaId']).toBe('HESA-EVT6-001');

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
    const submitted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/submit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { submissionReference: 'HESA-EVT6-SUB' },
    });
    expect(submitted.statusCode).toBe(204);
    const submittedEvent = expectEvent('srs.regulatory.hesa-return-submitted', 'regulatory');
    expect(isUuid(submittedEvent['returnId'])).toBe(true);
    expect(submittedEvent['submissionReference']).toBe('HESA-EVT6-SUB');
  });

  it('publishes SLC regulatory events with required payload fields', async () => {
    const fixture = await createEnrolment('Slc', 'Event', '2027-28', {
      fundingSourceCode: 'slc',
      slcReference: 'SLC-EVT6-001',
    });

    const outbound = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(outbound.statusCode).toBe(200);
    const confirmation = expectEvent('srs.regulatory.slc-confirmation-sent', 'sensitive');
    expect(isUuid(confirmation['enrolmentId'])).toBe(true);
    expect(isUuid(confirmation['exchangeId'])).toBe(true);

    const inbound = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/notifications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        notificationTypeCode: 'payment-received',
        effectiveDate: '2027-10-15',
        amount: '2312.50',
        notificationId: 'SLC-EVT6-NOT',
      },
    });
    expect(inbound.statusCode).toBe(201);
    const notification = expectEvent('srs.regulatory.slc-notification-received', 'sensitive');
    expect(isUuid(notification['enrolmentId'])).toBe(true);
    expect(isUuid(notification['notificationId'])).toBe(true);
  });

  it('publishes UKVI regulatory events with required payload fields', async () => {
    const fixture = await createEnrolment('Ukvi', 'Event', '2027-28', { ukviCasRequired: true });

    const generated = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/cas-requests/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(generated.statusCode).toBe(200);
    const casRequestId = generated
      .json<{ casRequests: Array<{ casRequestId: string; enrolmentId: string }> }>()
      .casRequests.find((request) => request.enrolmentId === fixture.enrolmentId)!.casRequestId;
    const requested = expectEvent('srs.regulatory.ukvi-cas-requested', 'sensitive');
    expect(isUuid(requested['casRequestId'])).toBe(true);
    expect(isUuid(requested['enrolmentId'])).toBe(true);

    const assignment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ukvi/cas-requests/${casRequestId}/assignment`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { casReference: 'CAS-EVT6-001' },
    });
    expect(assignment.statusCode).toBe(200);
    const assigned = expectEvent('srs.regulatory.ukvi-cas-assigned', 'sensitive');
    expect(assigned['casReference']).toBe('CAS-EVT6-001');

    const academicPeriodId = await createAcademicPeriod('EVT6-UKVI');
    const attendance = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/attendance-reports/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicPeriodId },
    });
    expect(attendance.statusCode).toBe(200);
    const attendanceEvent = expectEvent('srs.regulatory.ukvi-attendance-submitted', 'regulatory');
    expect(isUuid(attendanceEvent['reportId'])).toBe(true);
    expect(attendanceEvent['studentCount']).toEqual(expect.any(Number));

    const visa = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/visa-updates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        casReference: 'CAS-EVT6-001',
        statusCode: 'curtailed',
        effectiveDate: '2028-02-01',
      },
    });
    expect(visa.statusCode).toBe(201);
    const visaEvent = expectEvent('srs.regulatory.ukvi-visa-status-updated', 'sensitive');
    expect(visaEvent['casReference']).toBe('CAS-EVT6-001');
    const alert = expectEvent('srs.regulatory.ukvi-compliance-alert-raised', 'sensitive');
    expect(isUuid(alert['enrolmentId'])).toBe(true);
    expect(alert['alertTypeCode']).toBe('visa-curtailed');
  });

  it('publishes OfS and exam scheduling governance events with required payload fields', async () => {
    await createEnrolment('Ofs', 'Event', '2028-29');
    const ofs = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/b3-extracts',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2028-29' },
    });
    expect(ofs.statusCode).toBe(200);
    const ofsEvent = expectEvent('srs.regulatory.ofs-extract-generated', 'regulatory');
    expect(isUuid(ofsEvent['extractId'])).toBe(true);
    expect(ofsEvent['extractTypeCode']).toBe('b3-student-outcomes');

    const fixture = await createExamBoardFixture('EVT6-EXAM');
    const boardId = await createBoard(fixture.academicPeriodId);
    await post(`/api/v1/exam-boards/${boardId}/data-pack`, {});
    const entries = await post(`/api/v1/exam-boards/${boardId}/exam-entries/generate`, {});
    const submitted = expectEvent('srs.governance.exam-entry-submitted', 'standard');
    expect(isUuid(submitted['examBoardId'])).toBe(true);
    expect(submitted['entryCount']).toBe(1);

    const integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const schedule = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/exam-schedule`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        candidates: [{
          moduleRegistrationId: fixture.moduleRegistrationId,
          candidateNumber: 'EVT6-CAND',
          scheduledDate: '2028-01-12',
          room: 'HALL-EVT',
        }],
      },
    });
    expect(entries.statusCode).toBe(200);
    expect(schedule.statusCode).toBe(201);
    const received = expectEvent('srs.governance.exam-schedule-received', 'standard');
    expect(isUuid(received['receiptId'])).toBe(true);
    expect(received['candidateCount']).toBe(1);
  });
});

async function post(url: string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${jwt}` }, payload });
}

async function createEnrolment(
  firstName: string,
  familyName: string,
  academicYear: string,
  overrides: Record<string, unknown> = {},
): Promise<{ personId: string; enrolmentId: string }> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: firstName, legalFamilyName: familyName, ...('dateOfBirth' in overrides ? { dateOfBirth: overrides['dateOfBirth'] } : {}) },
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
      academicYearOfEntry: academicYear,
      startDate: `${academicYear.slice(0, 4)}-09-20`,
      ...overrides,
    },
  });
  expect(enrolment.statusCode).toBe(201);
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
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

async function createExamBoardFixture(code: string): Promise<{ academicPeriodId: string; moduleRegistrationId: string }> {
  const { enrolmentId } = await createEnrolment(code, 'Exam', '2027-28');
  const module = await post('/api/v1/modules', { code, title: `${code} Module`, creditValue: 20 });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;
  const academicPeriodId = await createAcademicPeriod(`${code}-SEM1`);
  const offering = await post('/api/v1/module-offerings', { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 });
  expect(offering.statusCode).toBe(201);
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;
  const registration = await post('/api/v1/module-registrations', { enrolmentId, moduleOfferingId, registrationDate: '2027-10-01' });
  expect(registration.statusCode).toBe(201);
  return { academicPeriodId, moduleRegistrationId: registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId };
}

async function createBoard(academicPeriodId: string): Promise<string> {
  const board = await post('/api/v1/exam-boards', {
    boardTypeCode: 'module',
    academicYear: '2027-28',
    academicPeriodId,
    meetingDate: '2028-02-10',
  });
  expect(board.statusCode).toBe(201);
  return board.json<{ examBoardId: string }>().examBoardId;
}
