import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

interface CapturedEvent {
  type: string;
  classification: string;
  payload: unknown;
}

interface BoardFixture {
  personId: string;
  enrolmentId: string;
  academicPeriodId: string;
  moduleRegistrationId: string;
}

function createSpyBus(events: CapturedEvent[]): IntegrationBusPublisher {
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
      events.push({ type, classification, payload });
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

describe('Exam entry and scheduling exchange', () => {
  it('requires a current data pack before generating exam entries', async () => {
    const fixture = await createBoardFixture('EE-NOPACK');
    const boardId = await createBoard(fixture.academicPeriodId);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/exam-entries/generate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(422);
  });

  it('generates entries from the data pack once and includes active exam adjustments', async () => {
    const fixture = await createBoardFixture('EE-GEN');
    await createAdjustment(fixture);
    const boardId = await createBoard(fixture.academicPeriodId);
    await generateDataPack(boardId);

    const first = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/exam-entries/generate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ entryCount: number; entries: Array<{ moduleRegistrationId: string; statusCode: string; accommodations: { adjustments: unknown[] } }> }>();
    expect(body.entryCount).toBe(1);
    expect(body.entries[0]).toMatchObject({
      moduleRegistrationId: fixture.moduleRegistrationId,
      statusCode: 'pending',
    });
    expect(body.entries[0]!.accommodations.adjustments).toContainEqual(
      expect.objectContaining({ adjustmentTypeCode: 'extra-time', scopeCode: 'exam' }),
    );
    expect(events.find((e) => e.type === 'srs.governance.exam-entry-submitted')).toMatchObject({
      classification: 'standard',
    });

    const second = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/exam-entries/generate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ entryCount: number }>().entryCount).toBe(0);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/exam-boards/${boardId}/exam-entries`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ moduleRegistrationId: string }>>()).toHaveLength(1);
  });

  it('receives schedule data and updates entries bitemporally', async () => {
    const fixture = await createBoardFixture('EE-SCHED');
    const boardId = await createBoard(fixture.academicPeriodId);
    await generateDataPack(boardId);
    await generateEntries(boardId);

    const noTimetable = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/exam-timetable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(noTimetable.statusCode).toBe(404);

    const integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    const schedule = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/exam-schedule`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        candidates: [
          {
            moduleRegistrationId: fixture.moduleRegistrationId,
            candidateNumber: 'CAND-001',
            scheduledDate: '2028-01-12',
            room: 'HALL-A',
          },
        ],
      },
    });
    expect(schedule.statusCode).toBe(201);
    expect(schedule.json<{ updatedCount: number }>().updatedCount).toBe(1);
    expect(events.find((e) => e.type === 'srs.governance.exam-schedule-received')).toMatchObject({
      classification: 'standard',
    });

    const versions = await ctx.db.execute(sql`
      SELECT status_code, candidate_number, recorded_until
      FROM exam_entry
      WHERE tenant_id = ${ctx.tenantId}
        AND module_registration_id = ${fixture.moduleRegistrationId}
        AND exam_board_id = ${boardId}
      ORDER BY recorded_at ASC
    `) as Array<{ status_code: string; candidate_number: string | null; recorded_until: string | Date | null }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ status_code: 'pending', candidate_number: null, recorded_until: expect.anything() });
    expect(versions[1]).toMatchObject({ status_code: 'scheduled', candidate_number: 'CAND-001', recorded_until: null });

    const entry = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/exam-entry`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(entry.statusCode).toBe(200);
    expect(entry.json<{ candidateNumber: string; scheduledDate: string; roomReference: string }>())
      .toMatchObject({ candidateNumber: 'CAND-001', scheduledDate: '2028-01-12', roomReference: 'HALL-A' });
  });

  it('allows only the owning student to read the student-facing timetable', async () => {
    const fixture = await createBoardFixture('EE-OWN');
    const other = await createBoardFixture('EE-OTHER');
    const boardId = await createBoard(fixture.academicPeriodId);
    await generateDataPack(boardId);
    await generateEntries(boardId);
    const integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/exam-schedule`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        candidates: [
          {
            moduleRegistrationId: fixture.moduleRegistrationId,
            candidateNumber: 'CAND-OWN',
            scheduledDate: '2028-01-12',
            room: 'HALL-B',
          },
        ],
      },
    });

    const ownerJwt = await ctx.makeJwt({ sub: fixture.personId, roles: ['student'] });
    const owner = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/exam-timetable`,
      headers: { authorization: `Bearer ${ownerJwt}` },
    });
    expect(owner.statusCode).toBe(200);

    const otherJwt = await ctx.makeJwt({ sub: other.personId, roles: ['student'] });
    const denied = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/exam-timetable`,
      headers: { authorization: `Bearer ${otherJwt}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('does not expose exam entries across tenants', async () => {
    const fixture = await createBoardFixture('EE-TENANT');
    const boardId = await createBoard(fixture.academicPeriodId);
    await generateDataPack(boardId);
    await generateEntries(boardId);
    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/exam-boards/${boardId}/exam-entries`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

async function createBoardFixture(code: string): Promise<BoardFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Entry' },
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
    payload: { enrolmentId, moduleOfferingId, registrationDate: '2027-10-01' },
  });
  expect(registration.statusCode).toBe(201);
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  return { personId, enrolmentId, academicPeriodId, moduleRegistrationId };
}

async function createBoard(academicPeriodId: string): Promise<string> {
  const board = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      boardTypeCode: 'module',
      academicYear: '2027-28',
      academicPeriodId,
      meetingDate: '2028-02-10',
    },
  });
  expect(board.statusCode).toBe(201);
  return board.json<{ examBoardId: string }>().examBoardId;
}

async function createAdjustment(fixture: BoardFixture): Promise<void> {
  const adjustment = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/students/${fixture.personId}/adjustments`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId: fixture.enrolmentId,
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
    },
  });
  expect(adjustment.statusCode).toBe(201);
}

async function generateDataPack(boardId: string): Promise<void> {
  const pack = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${boardId}/data-pack`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(pack.statusCode).toBe(201);
}

async function generateEntries(boardId: string): Promise<void> {
  const entries = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${boardId}/exam-entries/generate`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(entries.statusCode).toBe(200);
}
