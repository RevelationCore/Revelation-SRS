import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let chairJwt: string;

beforeAll(async () => {
  ctx      = await startTestApp();
  jwt      = await ctx.makeJwt();
  chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

interface CorrectionFixture {
  enrolmentId: string;
  examBoardId: string;
  markId: string;
}

async function createCorrectionFixture(code: string): Promise<CorrectionFixture> {
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Distribution' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${jwt}` },
    payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2024-25', startDate: '2024-09-23' },
  });
  expect(enrolment.statusCode).toBe(201);
  const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

  const module = await ctx.app.inject({
    method: 'POST', url: '/api/v1/modules', headers: { authorization: `Bearer ${jwt}` },
    payload: { code, title: `${code} Module`, creditValue: 20 },
  });
  expect(module.statusCode).toBe(201);
  const moduleId = module.json<{ moduleId: string }>().moduleId;

  const period = await ctx.app.inject({
    method: 'POST', url: '/api/v1/academic-periods', headers: { authorization: `Bearer ${jwt}` },
    payload: { academicYear: '2024-25', periodCode: `${code}-SEM1`, periodTypeCode: 'semester', startDate: '2024-09-23', endDate: '2025-01-17' },
  });
  expect(period.statusCode).toBe(201);
  const academicPeriodId = period.json<{ academicPeriodId: string }>().academicPeriodId;

  const offering = await ctx.app.inject({
    method: 'POST', url: '/api/v1/module-offerings', headers: { authorization: `Bearer ${jwt}` },
    payload: { moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 100 },
  });
  expect(offering.statusCode).toBe(201);
  const moduleOfferingId = offering.json<{ moduleOfferingId: string }>().moduleOfferingId;

  const registration = await ctx.app.inject({
    method: 'POST', url: '/api/v1/module-registrations', headers: { authorization: `Bearer ${jwt}` },
    payload: { enrolmentId, moduleOfferingId, registrationDate: '2024-10-01' },
  });
  expect(registration.statusCode).toBe(201);
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const component = await ctx.app.inject({
    method: 'POST', url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { componentTypeCode: 'exam', title: 'Final Exam', weighting: 100 },
  });
  expect(component.statusCode).toBe(201);
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  const mark = await ctx.app.inject({
    method: 'POST', url: `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId, rawMark: 55 },
  });
  expect(mark.statusCode).toBe(201);
  const markId = mark.json<{ markId: string }>().markId;

  const board = await ctx.app.inject({
    method: 'POST', url: '/api/v1/exam-boards', headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'module', academicYear: '2024-25' },
  });
  expect(board.statusCode).toBe(201);
  const examBoardId = board.json<{ examBoardId: string }>().examBoardId;

  return { enrolmentId, examBoardId, markId };
}

async function ratifyBoard(examBoardId: string): Promise<void> {
  await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/external-examiner-signoff`,
    headers: { authorization: `Bearer ${chairJwt}` },
    payload: { commentary: 'Approved' },
  });
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/exam-boards/${examBoardId}/ratification`,
    headers: { authorization: `Bearer ${chairJwt}` },
  });
  expect(res.statusCode).toBe(204);
}

describe('Post-ratification correction distribution (BPR-D13)', () => {
  it('opens a case with an error category and evidence reference, upholds it, amends the mark, and distributes to consumers', async () => {
    const fixture = await createCorrectionFixture('DIST101');
    await ratifyBoard(fixture.examBoardId);

    const openCase = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: {
        caseTypeCode: 'administrative-correction',
        errorCategoryCode: 'data-entry',
        authorisedBy: 'registry-manager-01',
      },
    });
    expect(openCase.statusCode).toBe(201);
    const { caseId } = openCase.json<{ caseId: string }>();

    const toReview = await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` }, payload: { statusCode: 'under-review' },
    });
    expect(toReview.statusCode).toBe(204);

    const toUpheld = await ctx.app.inject({
      method: 'PATCH', url: `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` }, payload: { statusCode: 'upheld' },
    });
    expect(toUpheld.statusCode).toBe(204);

    const amendment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { entityType: 'mark', entityId: fixture.markId, afterValue: { rawMark: 60 } },
    });
    expect(amendment.statusCode).toBe(201);
    const { amendmentId } = amendment.json<{ amendmentId: string }>();

    const distribute = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/correction-cases/amendments/${amendmentId}/distribute`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { targetSystemCodes: ['hesa-return', 'student-portal'] },
    });
    expect(distribute.statusCode).toBe(201);
    const { distributionItemIds } = distribute.json<{ distributionItemIds: string[] }>();
    expect(distributionItemIds).toHaveLength(2);

    // The case's error category and authority are visible via the list endpoint.
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(list.statusCode).toBe(200);
    const cases = list.json<Array<{ caseId: string; errorCategoryCode: string | null; authorisedBy: string | null }>>()
      .filter((c) => c.caseId === caseId);
    expect(cases[0]?.errorCategoryCode).toBe('data-entry');
    expect(cases[0]?.authorisedBy).toBe('registry-manager-01');
  });
});
