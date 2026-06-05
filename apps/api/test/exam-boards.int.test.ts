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

describe('Exam boards and data packs', () => {
  it('generates candidate profiles and supersedes regenerated packs', async () => {
    const fixture = await createBoardFixture('BRD101');
    await createAdjustment(fixture);
    await createExceptionalCircumstances(fixture);
    const markId = await ingestMark(fixture, 68);
    await createMisconduct(fixture, markId);
    const boardId = await createBoard(fixture.academicPeriodId);

    const firstPack = await generatePack(boardId);
    expect(firstPack.statusCode).toBe(201);
    const firstDataPackId = firstPack.json<{ dataPackId: string }>().dataPackId;

    const summary = await getPack(boardId);
    expect(summary.statusCode).toBe(200);
    expect(summary.json<{ dataPackId: string; candidateCount: number; packVersion: number }>())
      .toMatchObject({ dataPackId: firstDataPackId, candidateCount: 1, packVersion: 1 });

    const profile = await getCandidateProfile(boardId, fixture.enrolmentId, jwt);
    expect(profile.statusCode).toBe(200);
    const profileData = profile.json<{ profileData: {
      moduleRegistrations: Array<{ moduleRegistrationId: string; moduleResult: { aggregateMark: number }; marks: Array<{ markId: string }> }>;
      adjustments: Array<{ adjustmentTypeCode: string; scopeCode: string }>;
      exceptionalCircumstances: Array<{ outcomeCode: string; moduleOfferingId: string }>;
      misconduct: Array<{ penaltyCode: string; penaltyEffects: Array<{ targetEntityId: string }> }>;
      preBoardRecommendation: { type: string };
    } }>().profileData;
    const registrationProfile = profileData.moduleRegistrations.find((row) =>
      row.moduleRegistrationId === fixture.moduleRegistrationId);
    expect(registrationProfile?.moduleResult.aggregateMark).toBe(68);
    expect(registrationProfile?.marks).toContainEqual(expect.objectContaining({ markId }));
    expect(profileData.adjustments).toContainEqual(expect.objectContaining({
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'exam',
    }));
    expect(profileData.exceptionalCircumstances).toContainEqual(expect.objectContaining({
      outcomeCode: 'defer',
      moduleOfferingId: fixture.moduleOfferingId,
    }));
    expect(profileData.misconduct).toContainEqual(expect.objectContaining({
      penaltyCode: 'mark-cap',
      penaltyEffects: expect.arrayContaining([expect.objectContaining({ targetEntityId: markId })]) as Array<{ targetEntityId: string }>,
    }));
    expect(profileData.preBoardRecommendation).toMatchObject({ type: 'not-evaluated' });

    const event = capturedEvents.find((captured) => captured.type === 'srs.governance.exam-board-data-pack-ready');
    expect(event).toBeDefined();
    expect(event?.classification).toBe('standard');
    expect(event?.payload).toMatchObject({
      examBoardId: boardId,
      dataPackId: firstDataPackId,
      candidateCount: 1,
      packVersion: 1,
    });

    const secondPack = await generatePack(boardId);
    expect(secondPack.statusCode).toBe(201);
    const secondDataPackId = secondPack.json<{ dataPackId: string }>().dataPackId;
    const current = await getPack(boardId);
    expect(current.json<{ dataPackId: string; packVersion: number }>())
      .toMatchObject({ dataPackId: secondDataPackId, packVersion: 2 });
  });

  it('enforces exam board read permissions for candidate profiles', async () => {
    const fixture = await createBoardFixture('BRD102');
    await ingestMark(fixture, 58);
    const boardId = await createBoard(fixture.academicPeriodId);
    const pack = await generatePack(boardId);
    expect(pack.statusCode).toBe(201);
    const boardMemberJwt = await ctx.makeJwt({ roles: ['exam-board-member'] });
    const studentJwt = await ctx.makeJwt({ roles: ['student'] });

    const allowed = await getCandidateProfile(boardId, fixture.enrolmentId, boardMemberJwt);
    expect(allowed.statusCode).toBe(200);
    const denied = await getCandidateProfile(boardId, fixture.enrolmentId, studentJwt);
    expect(denied.statusCode).toBe(403);
  });

  it('records board attendance and external examiner signoff', async () => {
    const fixture = await createBoardFixture('BRD103');
    const boardId = await createBoard(fixture.academicPeriodId);
    const chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });

    const attendance = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/attendance`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { roleCode: 'member' },
    });
    expect(attendance.statusCode).toBe(201);
    expect(attendance.json<{ attendanceId: string }>().attendanceId).toEqual(expect.any(String));

    const signoff = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/exam-boards/${boardId}/external-examiner-signoff`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { commentary: 'Ready for ratification' },
    });
    expect(signoff.statusCode).toBe(201);
    expect(signoff.json<{ signoffId: string }>().signoffId).toEqual(expect.any(String));
  });

  it('requires external examiner signoff before ratification', async () => {
    const fixture = await createBoardFixture('BRD104');
    await ingestMark(fixture, 62);
    const boardId = await createBoard(fixture.academicPeriodId);
    const chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });

    const ratification = await ratifyBoard(boardId, chairJwt);
    expect(ratification.statusCode).toBe(422);
  });

  it('ratifies the board, locks covered records, and leaves out-of-scope records mutable', async () => {
    const covered = await createBoardFixture('BRD105');
    const outside = await createBoardFixture('BRD106');
    const coveredMarkId = await ingestMark(covered, 71);
    const outsideMarkId = await ingestMark(outside, 64);
    const boardId = await createBoard(covered.academicPeriodId);
    const chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });

    await signoffBoard(boardId, chairJwt);
    const ratification = await ratifyBoard(boardId, chairJwt);
    expect(ratification.statusCode).toBe(204);

    const board = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/exam-boards/${boardId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(board.json<{ ratifiedAt: string | null }>().ratifiedAt).toEqual(expect.any(String));

    const coveredMarks = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${covered.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(coveredMarks.json<Array<{ markId: string; locked: boolean }>>())
      .toContainEqual(expect.objectContaining({ markId: coveredMarkId, locked: true }));

    const coveredResult = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${covered.moduleRegistrationId}/result`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(coveredResult.json<{ locked: boolean }>().locked).toBe(true);

    const lockedPatch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/marks/${coveredMarkId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 72 },
    });
    expect(lockedPatch.statusCode).toBe(403);

    const outsidePatch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/marks/${outsideMarkId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 66 },
    });
    expect(outsidePatch.statusCode).toBe(204);

    const ratifiedEvent = capturedEvents.find((event) => event.type === 'srs.governance.exam-board-ratified');
    expect(ratifiedEvent?.classification).toBe('standard');
    expect(ratifiedEvent?.payload as { examBoardId: string }).toMatchObject({ examBoardId: boardId });

    const lockedEvent = capturedEvents.find((event) => event.type === 'srs.governance.record-locked');
    expect(lockedEvent?.classification).toBe('standard');
    expect(lockedEvent?.payload as { examBoardId: string; lockedEntityTypes: string[] }).toMatchObject({
      examBoardId: boardId,
      lockedEntityTypes: ['module_result', 'mark'],
    });

    const moduleResultEvent = capturedEvents.find((event) => event.type === 'srs.assessment.module-result-ratified');
    expect(moduleResultEvent?.classification).toBe('personal');
    expect(moduleResultEvent?.payload as {
      examBoardId: string;
      moduleRegistrationId: string;
      aggregateMark: number;
    }).toMatchObject({
      examBoardId: boardId,
      moduleRegistrationId: covered.moduleRegistrationId,
      aggregateMark: 71,
    });
  });
});

interface BoardFixture {
  personId: string;
  enrolmentId: string;
  academicPeriodId: string;
  moduleOfferingId: string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
}

async function createBoardFixture(code: string): Promise<BoardFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Board' },
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

  const component = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { componentTypeCode: 'coursework', title: 'Coursework', weighting: 100 },
  });
  expect(component.statusCode).toBe(201);
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  return { personId, enrolmentId, academicPeriodId, moduleOfferingId, moduleRegistrationId, assessmentComponentId };
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

async function generatePack(boardId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${boardId}/data-pack`,
    headers: { authorization: `Bearer ${jwt}` },
  });
}

async function getPack(boardId: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/exam-boards/${boardId}/data-pack`,
    headers: { authorization: `Bearer ${jwt}` },
  });
}

async function getCandidateProfile(boardId: string, enrolmentId: string, token: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/exam-boards/${boardId}/candidates/${enrolmentId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function signoffBoard(boardId: string, token: string): Promise<void> {
  const signoff = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${boardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${token}` },
    payload: { commentary: 'Ready for ratification' },
  });
  expect(signoff.statusCode).toBe(201);
}

async function ratifyBoard(boardId: string, token: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${boardId}/ratification`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function ingestMark(fixture: BoardFixture, rawMark: number): Promise<string> {
  const mark = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId: fixture.assessmentComponentId, rawMark },
  });
  expect(mark.statusCode).toBe(201);
  return mark.json<{ markId: string }>().markId;
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

async function createExceptionalCircumstances(fixture: BoardFixture): Promise<void> {
  const ec = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/students/${fixture.personId}/exceptional-circumstances`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId: fixture.enrolmentId,
      moduleOfferingId: fixture.moduleOfferingId,
      outcomeCode: 'defer',
      determinationDate: '2027-11-10',
    },
  });
  expect(ec.statusCode).toBe(201);
}

async function createMisconduct(fixture: BoardFixture, markId: string): Promise<void> {
  const misconduct = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/students/${fixture.personId}/misconduct-outcomes`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId: fixture.enrolmentId,
      caseReference: 'AI-BOARD-001',
      penaltyCode: 'mark-cap',
      effectiveDate: '2027-11-20',
      penaltyEffects: [{ targetEntityType: 'mark', targetEntityId: markId, penaltyDetail: 'Cap at 40' }],
    },
  });
  expect(misconduct.statusCode).toBe(201);
}
