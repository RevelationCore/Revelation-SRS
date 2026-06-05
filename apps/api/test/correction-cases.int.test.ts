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
    publish: (type: string, _v: string, _t: string, _c: string, classification: string, payload: unknown): Promise<void> => {
      capture.push({ type, classification, payload });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close:   () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
let chairJwt: string;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx      = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
  jwt      = await ctx.makeJwt();
  chairJwt = await ctx.makeJwt({ roles: ['exam-board-chair'] });
}, 120_000);

beforeEach(() => { capturedEvents.length = 0; });

afterAll(async () => { await ctx?.teardown(); });

// ── End-to-end lock integrity test ───────────────────────────────────────────

describe('End-to-end: mark → ratify → amend', () => {
  it('locks a mark on ratification, amends it through an upheld case, and re-locks the result', async () => {
    const fixture = await createCorrectionFixture('COR101');

    // 1. Verify mark is initially unlocked
    const markBefore = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/marks/${fixture.markId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(markBefore.statusCode).toBe(200);
    const [initialVersion] = markBefore.json<Array<{ locked: boolean; rawMark: number }>>()
      .filter((v) => v.rawMark === 55);
    expect(initialVersion?.locked).toBe(false);

    // 2. Ratify the board (locks marks)
    await ratifyBoard(fixture.examBoardId);

    // 3. Confirm mark is now locked
    const markAfterRatify = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/marks/${fixture.markId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const current = markAfterRatify.json<Array<{ locked: boolean; recordedUntil: string | null }>>()
      .find((v) => v.recordedUntil === null);
    expect(current?.locked).toBe(true);

    // 4. Direct mutation of locked mark returns 403
    const blockedUpdate = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/marks/${fixture.markId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 60 },
    });
    expect(blockedUpdate.statusCode).toBe(403);

    // 5. Open a correction case
    const openCase = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { caseTypeCode: 'administrative-correction', reference: 'REF-001' },
    });
    expect(openCase.statusCode).toBe(201);
    const caseId = openCase.json<{ caseId: string }>().caseId;

    // 6. Advance to under-review
    const toReview = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { statusCode: 'under-review' },
    });
    expect(toReview.statusCode).toBe(204);

    // 7. Amendment on non-upheld case is rejected
    const earlyAmend = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { entityType: 'mark', entityId: fixture.markId, afterValue: { rawMark: 62, adjustedMark: 62 } },
    });
    expect(earlyAmend.statusCode).toBe(422);

    // 8. Uphold the case (already under-review from step 6)
    const uphold = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { statusCode: 'upheld' },
    });
    expect(uphold.statusCode).toBe(204);

    // 9. Apply the amendment
    const applyAmend = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { entityType: 'mark', entityId: fixture.markId, afterValue: { rawMark: 62, adjustedMark: 62 } },
    });
    expect(applyAmend.statusCode).toBe(201);
    const amendmentId = applyAmend.json<{ amendmentId: string }>().amendmentId;
    expect(amendmentId).toBeTruthy();

    // 10. Amended mark is visible at the new value AND still locked
    const markAfterAmend = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/marks/${fixture.markId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const amended = markAfterAmend.json<Array<{ locked: boolean; rawMark: number; recordedUntil: string | null }>>()
      .find((v) => v.recordedUntil === null);
    expect(amended?.rawMark).toBe(62);
    expect(amended?.locked).toBe(true);

    // 11. Subsequent unauthorised direct mutation still returns 403
    const blockedAgain = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/marks/${fixture.markId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 70 },
    });
    expect(blockedAgain.statusCode).toBe(403);

    // 12. Event published with correct payload
    const event = capturedEvents.find((e) => e.type === 'srs.governance.record-amended-post-ratification');
    expect(event).toBeDefined();
    expect(event?.classification).toBe('personal');
    expect(event?.payload).toMatchObject({
      amendmentId,
      caseId,
      entityType:      'mark',
      entityId:        fixture.markId,
      appealReference: 'REF-001',
    });
  });
});

// ── Case workflow tests ───────────────────────────────────────────────────────

describe('Case status transitions', () => {
  it('rejects an invalid status transition', async () => {
    const fixture = await createCorrectionFixture('COR201');
    const { caseId } = await openCase(fixture.enrolmentId);

    // Cannot go directly from submitted to upheld
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { statusCode: 'upheld' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists all case versions for an enrolment', async () => {
    const fixture = await createCorrectionFixture('COR202');
    const { caseId } = await openCase(fixture.enrolmentId);
    await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/correction-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { statusCode: 'dismissed' },
    });

    const list = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${chairJwt}` },
    });
    expect(list.statusCode).toBe(200);
    const cases = list.json<Array<{ caseId: string; statusCode: string }>>()
      .filter((c) => c.caseId === caseId);
    expect(cases).toContainEqual(expect.objectContaining({ statusCode: 'submitted' }));
    expect(cases).toContainEqual(expect.objectContaining({ statusCode: 'dismissed' }));
  });

  it('does not expose cases through another tenant', async () => {
    const fixture = await createCorrectionFixture('COR203');
    await openCase(fixture.enrolmentId);

    const otherJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['exam-board-chair'] });
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${otherJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Amendment guard tests ─────────────────────────────────────────────────────

describe('Amendment guards', () => {
  it('rejects amendment with unsupported entity type', async () => {
    const fixture = await createCorrectionFixture('COR301');
    const { caseId } = await openCase(fixture.enrolmentId);
    await upholdCase(caseId);

    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: { entityType: 'award', entityId: fixture.markId, afterValue: {} },
    });
    expect(res.statusCode).toBe(400);  // Fastify schema validation rejects unknown literal
  });

  it('requires exam-board:ratify to open a case', async () => {
    const fixture = await createCorrectionFixture('COR302');
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/enrolments/${fixture.enrolmentId}/correction-cases`,
      headers: { authorization: `Bearer ${jwt}` },  // registry-admin, not chair
      payload: { caseTypeCode: 'appeal' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('amends a module result through upheld case and re-locks', async () => {
    const fixture = await createCorrectionFixture('COR303');
    await ratifyBoard(fixture.examBoardId);

    const { caseId } = await openCase(fixture.enrolmentId);
    await upholdCase(caseId);

    const amend = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: {
        entityType: 'module_result',
        entityId:   fixture.moduleResultId,
        afterValue: { aggregateMark: 71, resultCode: 'pass' },
      },
    });
    expect(amend.statusCode).toBe(201);

    // Result visible at new value and still locked
    const result = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/module-registrations/${fixture.moduleRegistrationId}/result`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(result.statusCode).toBe(200);
    const body = result.json<{ aggregateMark: number; resultCode: string; locked: boolean }>();
    expect(body.aggregateMark).toBe(71);
    expect(body.resultCode).toBe('pass');
    expect(body.locked).toBe(true);
  });

  it('rejects amendment when the entity belongs to a different enrolment', async () => {
    const caseFixture = await createCorrectionFixture('COR304A');
    const targetFixture = await createCorrectionFixture('COR304B');
    await ratifyBoard(targetFixture.examBoardId);

    const { caseId } = await openCase(caseFixture.enrolmentId);
    await upholdCase(caseId);

    const amend = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/correction-cases/${caseId}/amendments`,
      headers: { authorization: `Bearer ${chairJwt}` },
      payload: {
        entityType: 'mark',
        entityId:   targetFixture.markId,
        afterValue: { rawMark: 80, adjustedMark: 80 },
      },
    });
    expect(amend.statusCode).toBe(422);
  });
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface CorrectionFixture {
  personId:             string;
  enrolmentId:          string;
  examBoardId:          string;
  markId:               string;
  moduleRegistrationId: string;
  moduleResultId:       string;
}

async function createCorrectionFixture(code: string): Promise<CorrectionFixture> {
  const student = await ctx.app.inject({
    method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Correction' },
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

  // Fetch the module result id that was auto-generated
  const resultRes = await ctx.app.inject({
    method: 'GET', url: `/api/v1/module-registrations/${moduleRegistrationId}/result`,
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(resultRes.statusCode).toBe(200);
  const moduleResultId = resultRes.json<{ moduleResultId: string }>().moduleResultId;

  const board = await ctx.app.inject({
    method: 'POST', url: '/api/v1/exam-boards', headers: { authorization: `Bearer ${jwt}` },
    payload: { boardTypeCode: 'module', academicYear: '2024-25' },
  });
  expect(board.statusCode).toBe(201);
  const examBoardId = board.json<{ examBoardId: string }>().examBoardId;

  return { personId, enrolmentId, examBoardId, markId, moduleRegistrationId, moduleResultId };
}

async function ratifyBoard(examBoardId: string): Promise<void> {
  // Record sign-off first
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

async function openCase(enrolmentId: string): Promise<{ caseId: string }> {
  const res = await ctx.app.inject({
    method:  'POST',
    url:     `/api/v1/enrolments/${enrolmentId}/correction-cases`,
    headers: { authorization: `Bearer ${chairJwt}` },
    payload: { caseTypeCode: 'appeal' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ caseId: string }>();
}

async function upholdCase(caseId: string): Promise<void> {
  // submitted → under-review → upheld
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
}
