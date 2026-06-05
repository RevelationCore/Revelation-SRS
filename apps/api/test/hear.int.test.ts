import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { startTestApp, type TestApp } from './helpers/test-app.js';

// Minimal spy bus — HEAR generates no domain events itself
function makeSpyBus(): IntegrationBusPublisher {
  return {
    isConnected: () => true,
    publish: () => Promise.resolve(),
    connect: () => Promise.resolve(),
    close:   () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
let chairJwt: string;

beforeAll(async () => {
  ctx      = await startTestApp({ eventBus: makeSpyBus() });
  jwt      = await ctx.makeJwt();
  chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

describe('HEAR generation', () => {
  it('generates a structured HEAR document containing all module results and student details', async () => {
    const fixture = await createHearFixture('HEAR101');

    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(res.statusCode).toBe(201);

    const body = res.json<{
      enrolmentId: string;
      awardId: string;
      hearGeneratedAt: string;
      document: {
        version: string;
        student: { personId: string; studentNumber: string; legalFirstName: string; legalFamilyName: string };
        award:   { qualificationCode: string; classificationCode: string };
        moduleResults: Array<{ moduleCode: string; aggregateMark: number; resultCode: string; creditValue: number }>;
      };
    }>();

    expect(body.enrolmentId).toBe(fixture.enrolmentId);
    expect(body.awardId).toBe(fixture.awardId);
    expect(body.hearGeneratedAt).toBeTruthy();

    // Document structure
    expect(body.document.version).toBe('1.0');
    expect(body.document.student.personId).toBe(fixture.personId);
    expect(body.document.student.legalFirstName).toBe('HEAR101');
    expect(body.document.student.legalFamilyName).toBe('Graduate');
    expect(body.document.student.studentNumber).toBeTruthy();

    expect(body.document.award.qualificationCode).toBe('BSc');
    expect(body.document.award.classificationCode).toBe('upper-second');

    // Module results included
    expect(body.document.moduleResults).toHaveLength(1);
    expect(body.document.moduleResults[0]).toMatchObject({
      moduleCode:    'HEAR101A',
      aggregateMark: 65,
      resultCode:    'pass',
      creditValue:   20,
    });
  });

  it('persists the HEAR document on the award and refreshes hear_generated_at', async () => {
    const fixture = await createHearFixture('HEAR102');

    // Capture hear_generated_at from the stub set at conferral
    const awardBefore = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/award`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    const beforeTs = awardBefore.json<{ hearGeneratedAt: string }>().hearGeneratedAt;

    await ctx.app.inject({
      method: 'POST', url: `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });

    // GET /hear now returns the persisted document
    const getHear = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(getHear.statusCode).toBe(200);
    const doc = getHear.json<{ document: { version: string }; hearGeneratedAt: string }>();
    expect(doc.document.version).toBe('1.0');
    // hear_generated_at refreshed (may be same second or later)
    expect(new Date(doc.hearGeneratedAt).getTime()).toBeGreaterThanOrEqual(new Date(beforeTs).getTime());
  });

  it('returns 422 when no award exists for the enrolment', async () => {
    // Student and enrolment but no award
    const student = await ctx.app.inject({
      method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'HEAR103', legalFamilyName: 'NoAward' },
    });
    const personId = student.json<{ personId: string }>().personId;
    const enrolment = await ctx.app.inject({
      method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` },
      payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2025-26', startDate: '2025-09-22' },
    });
    const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 422 when HEAR has not been generated yet', async () => {
    const fixture = await createHearFixture('HEAR104');
    // Award conferred (stub only) but POST /hear not yet called
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(res.statusCode).toBe(422);
  });

  it('student can read their own HEAR via student:read:own', async () => {
    const fixture = await createHearFixture('HEAR105');
    await ctx.app.inject({
      method: 'POST', url: `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });

    // Student JWT: sub matches personId, role = student
    const studentJwt = await ctx.makeJwt({ sub: fixture.personId, roles: ['student'] });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('student cannot read another student\'s HEAR', async () => {
    const fixture = await createHearFixture('HEAR106');
    await ctx.app.inject({
      method: 'POST', url: `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });

    const otherStudentJwt = await ctx.makeJwt({ sub: 'different-person-id', roles: ['student'] });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${otherStudentJwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires exam-board:ratify to generate', async () => {
    const fixture = await createHearFixture('HEAR107');
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${jwt}` },  // registry-admin, not chair
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not expose HEAR through another tenant', async () => {
    const fixture = await createHearFixture('HEAR108');
    await ctx.app.inject({
      method: 'POST', url: `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });

    const otherJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['exam-board-chair'] });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/hear`,
      headers: { authorization: `Bearer ${otherJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Fixture ───────────────────────────────────────────────────────────────────

interface HearFixture {
  personId:    string;
  enrolmentId: string;
  awardId:     string;
}

async function createHearFixture(code: string): Promise<HearFixture> {
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Graduate', emailPersonal: `${code.toLowerCase()}@test.ac.uk` },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;

  // Add identity so legalFirstName/legalFamilyName are on the identity record
  await ctx.app.inject({
    method: 'PATCH', url: `/api/v1/students/${personId}/identity`, headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Graduate' },
  });

  const enrolment = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2025-26', startDate: '2025-09-22' },
  });
  expect(enrolment.statusCode).toBe(201);
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

  // Module, period, offering, registration, component, mark
  const module = await ctx.app.inject({
    method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${jwt}` },
    payload: { code: `${code}A`, title: `${code} Module A`, creditValue: 20 },
  });
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST', url: '/api/v1/academic-periods', headers: { authorization: `Bearer ${jwt}` },
    payload: { academicYear: '2025-26', periodCode: `${code}-SEM1`, periodTypeCode: 'semester', startDate: '2025-09-22', endDate: '2026-01-16' },
  });
  const academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

  const offering = await ctx.app.inject({
    method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

  const registration = await ctx.app.inject({
    method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, moduleOfferingId, registrationDate: '2025-10-01' },
  });
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const component = await ctx.app.inject({
    method: 'POST', url: `/api/v1/module-offerings/${moduleOfferingId}/components`, headers: { authorization: `Bearer ${jwt}` },
    payload: { componentTypeCode: 'exam', title: 'Final Exam', weighting: 100 },
  });
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  await ctx.app.inject({
    method: 'POST', url: `/api/v1/module-registrations/${moduleRegistrationId}/marks`, headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId, rawMark: 65 },
  });

  // Create exam board and confer award
  const board = await ctx.app.inject({
    method: 'POST', url: '/api/v1/exam-boards', headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'award', academicYear: '2025-26' },
  });
  const examBoardId = board.json<{ examBoardId: string }>().examBoardId;
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${chairJwt}` },
    payload: { commentary: 'Ready for HEAR fixture' },
  });
  const ratification = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/ratification`,
    headers: { authorization: `Bearer ${chairJwt}` },
  });
  expect(ratification.statusCode).toBe(204);

  const award = await ctx.app.inject({
    method: 'POST', url: `/api/v1/enrolments/${enrolmentId}/award`, headers: { authorization: `Bearer ${chairJwt}` },
    payload: { examBoardId, qualificationCode: 'BSc', classificationCode: 'upper-second', awardDate: '2026-07-15' },
  });
  expect(award.statusCode).toBe(201);
  const awardId = award.json<{ awardId: string }>().awardId;

  return { personId, enrolmentId, awardId };
}
