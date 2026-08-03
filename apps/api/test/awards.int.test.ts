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
let chairJwt: string;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
  jwt = await ctx.makeJwt();
  chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
  await seedClassificationRules();
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Classification recommendation', () => {
  it('returns a weighted-average recommendation for ratified results', async () => {
    const fixture = await createAwardFixture('AWD101');
    await seedRatifiedResult(fixture, 'AWD101A', 72, 20);
    await seedRatifiedResult(fixture, 'AWD101B', 58, 20);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/classification`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ aggregateMark: number; classificationCode: string; algorithm: string }>();
    expect(body.aggregateMark).toBe(65);           // (72*20 + 58*20) / 40
    expect(body.classificationCode).toBe('upper-second');
    expect(body.algorithm).toBe('weighted-average');
  });

  it('applies best-of-two-years algorithm when configured', async () => {
    const fixture = await createAwardFixture('AWD102');
    // Seed best-of algorithm rule for this fixture's programme
    const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/academic-rules',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: { ruleTypeCode: 'classification-algorithm', ruleKey: 'undergraduate', ruleValue: { algorithm: 'best-of-two-years' } },
    });

    await seedRatifiedResult(fixture, 'AWD102A', 80, 20);  // high mark
    await seedRatifiedResult(fixture, 'AWD102B', 40, 20);  // low mark — should be less counted

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/classification`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ aggregateMark: number; classificationCode: string; algorithm: string }>();
    // best-of: top 50% of credits (20 out of 40) → only the 80 mark counts
    expect(body.aggregateMark).toBe(80);
    expect(body.algorithm).toBe('best-of-two-years');
    expect(body.classificationCode).toBe('first');
  });

  it('returns 404 for unknown enrolment', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/enrolments/00000000-0000-0000-0000-000000000099/classification',
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Award conferral', () => {
  it('confers an award, records HEAR stub, transitions enrolment to graduated, and publishes event', async () => {
    const fixture = await createAwardFixture('AWD201');
    await seedRatifiedResult(fixture, 'AWD201A', 65, 20);
    const examBoardId = await createExamBoard();

    const award = await conferAward(fixture, examBoardId, 'BSc', 'upper-second');
    expect(award.statusCode).toBe(201);
    const awardId = award.json<{ awardId: string }>().awardId;

    // Award record readable
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/award`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(read.statusCode).toBe(200);
    const body = read.json<{
      awardId: string;
      qualificationCode: string;
      classificationCode: string;
      hearGeneratedAt: string | null;
    }>();
    expect(body.awardId).toBe(awardId);
    expect(body.qualificationCode).toBe('BSc');
    expect(body.classificationCode).toBe('upper-second');
    expect(body.hearGeneratedAt).not.toBeNull();  // stub timestamp set

    // Enrolment transitioned to graduated via standard path
    const enrolmentRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(enrolmentRes.statusCode).toBe(200);
    expect(enrolmentRes.json<{ statusCode: string }>().statusCode).toBe('graduated');

    // Person status advanced to alumnus via cascade
    const studentRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(studentRes.statusCode).toBe(200);
    expect(studentRes.json<{ personStatusCode: string }>().personStatusCode).toBe('alumnus');

    // award.conferred event published
    const event = capturedEvents.find((e) => e.type === 'srs.award.conferred');
    expect(event).toBeDefined();
    expect(event?.classification).toBe('personal');
    expect(event?.payload).toMatchObject({
      awardId,
      enrolmentId: fixture.enrolmentId,
      personId: fixture.personId,
      qualificationCode: 'BSc',
      classificationCode: 'upper-second',
    });
  });

  it('does not re-transition a student already in graduated status', async () => {
    const fixture = await createAwardFixture('AWD202');
    await seedRatifiedResult(fixture, 'AWD202A', 72, 20);
    const examBoardId = await createExamBoard();

    // Manually graduate the enrolment first
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/graduate`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });

    const award = await conferAward(fixture, examBoardId, 'BSc', 'first');
    expect(award.statusCode).toBe(201);

    // Enrolment still graduated (not double-transitioned)
    const enrolmentRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(enrolmentRes.json<{ statusCode: string }>().statusCode).toBe('graduated');
  });

  it('rejects a duplicate award on the same enrolment', async () => {
    const fixture = await createAwardFixture('AWD203');
    await seedRatifiedResult(fixture, 'AWD203A', 72, 20);
    const examBoardId = await createExamBoard();

    const first = await conferAward(fixture, examBoardId, 'BSc', 'first');
    expect(first.statusCode).toBe(201);

    const second = await conferAward(fixture, examBoardId, 'BSc', 'upper-second');
    expect(second.statusCode).toBe(422);
  });

  it('rejects award conferral against an unratified board', async () => {
    const fixture = await createAwardFixture('AWD206');
    await seedRatifiedResult(fixture, 'AWD206A', 72, 20);
    const examBoardId = await createUnratifiedExamBoard();

    const award = await conferAward(fixture, examBoardId, 'BSc', 'first');
    expect(award.statusCode).toBe(422);
  });

  it('does not expose awards through another tenant', async () => {
    const fixture = await createAwardFixture('AWD204');
    await seedRatifiedResult(fixture, 'AWD204A', 72, 20);
    const examBoardId = await createExamBoard();
    await conferAward(fixture, examBoardId, 'BSc', 'first');

    const otherJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['exam-board-chair'] });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/award`,
      headers: { authorization: `Bearer ${otherJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires exam-board:ratify to confer an award', async () => {
    const fixture = await createAwardFixture('AWD205');
    await seedRatifiedResult(fixture, 'AWD205A', 72, 20);
    const examBoardId = await createExamBoard();
    // registry-administrator also holds exam-board:ratify (see
    // permissions.ts) — module-tutor is the role that genuinely lacks it.
    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const res = await conferAward(fixture, examBoardId, 'BSc', 'first', moduleTutorJwt);
    expect(res.statusCode).toBe(403);
  });
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface AwardFixture {
  personId:    string;
  enrolmentId: string;
}

async function createAwardFixture(code: string): Promise<AwardFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Graduate' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2025-26', startDate: '2025-09-22' },
  });
  expect(enrolment.statusCode).toBe(201);
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}

async function seedRatifiedResult(fixture: AwardFixture, moduleCode: string, mark: number, creditValue: number): Promise<void> {
  const module = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/modules',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { code: moduleCode, title: `${moduleCode} Module`, creditValue },
  });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-periods',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { academicYear: '2025-26', periodCode: `${moduleCode}-SEM1`, periodTypeCode: 'semester', startDate: '2025-09-22', endDate: '2026-01-16' },
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
    payload: { enrolmentId: fixture.enrolmentId, moduleOfferingId, registrationDate: '2025-10-01' },
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

  const markRes = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId, rawMark: mark },
  });
  expect(markRes.statusCode).toBe(201);

  const boardId = await createExamBoard(academicPeriodId);
  await signoffBoard(boardId);
  await ratifyBoard(boardId);
}

async function createExamBoard(academicPeriodId?: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      boardTypeCode: 'award',
      academicYear: '2025-26',
      ...(academicPeriodId ? { academicPeriodId } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  const examBoardId = res.json<{ examBoardId: string }>().examBoardId;
  if (!academicPeriodId) {
    await signoffBoard(examBoardId);
    await ratifyBoard(examBoardId);
  }
  return examBoardId;
}

async function createUnratifiedExamBoard(): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/exam-boards',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'award', academicYear: '2025-26' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ examBoardId: string }>().examBoardId;
}

async function signoffBoard(examBoardId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${chairJwt}` },
    payload: { commentary: 'Ready for award conferral' },
  });
  expect(res.statusCode).toBe(201);
}

async function ratifyBoard(examBoardId: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/ratification`,
    headers: { authorization: `Bearer ${chairJwt}` },
  });
  expect(res.statusCode).toBe(204);
}

async function conferAward(
  fixture: AwardFixture,
  examBoardId: string,
  qualificationCode: string,
  classificationCode: string,
  authJwt = chairJwt,
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/enrolments/${fixture.enrolmentId}/award`,
    headers: { authorization: `Bearer ${authJwt}` },
    payload: { examBoardId, qualificationCode, classificationCode, awardDate: '2026-07-15' },
  });
}

async function seedClassificationRules(): Promise<void> {
  const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-rules',
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: {
      ruleTypeCode: 'classification-boundary',
      ruleKey: 'undergraduate',
      ruleValue: {
        boundaries: [
          { code: 'first',        minimumMark: 70 },
          { code: 'upper-second', minimumMark: 60 },
          { code: 'lower-second', minimumMark: 50 },
          { code: 'third',        minimumMark: 40 },
        ],
      },
      description: 'Standard UK HE classification boundaries',
    },
  });
}
