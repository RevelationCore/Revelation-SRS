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
  await seedProgressionRules();
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Progression decisions', () => {
  it('counts approved recognised credit for the year and applies an approved rule variation (BPR-D05)', async () => {
    const proposerJwt = await ctx.makeJwt({ sub: 'prg-proposer', roles: ['registry-administrator'] });
    const approverJwt = await ctx.makeJwt({ sub: 'prg-approver', roles: ['programme-approver'] });
    const post = (url: string, as: string, payload: Record<string, unknown>) =>
      ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { authorization: `Bearer ${as}` }, payload });
    const approve = (url: string) => post(url, approverJwt, { decisionCode: 'approved', reason: 'Approved' });

    // No module results: without credit the student would repeat the year.
    const credited = await createProgressionFixture('PRG110');
    const otherYear = await post(`/enrolments/${credited.enrolmentId}/recognised-credits`, proposerJwt, {
      recognitionTypeCode: 'rpcl', sourceDescription: 'Prior study', creditValue: 20, academicYear: '2028-29',
    });
    await approve(`/recognised-credits/${otherYear.json<{ recognisedCreditId: string }>().recognisedCreditId}/decision`);
    await evaluateProgression(credited.enrolmentId);
    expect((await getProgression(credited.enrolmentId)).json<{ decisionCode: string }>().decisionCode).toBe('repeat-year');

    const thisYear = await post(`/enrolments/${credited.enrolmentId}/recognised-credits`, proposerJwt, {
      recognitionTypeCode: 'rpcl', sourceDescription: 'Prior study', creditValue: 20, academicYear: '2027-28',
    });
    const creditId = thisYear.json<{ recognisedCreditId: string }>().recognisedCreditId;
    await approve(`/recognised-credits/${creditId}/decision`);
    await evaluateProgression(credited.enrolmentId);
    expect((await getProgression(credited.enrolmentId)).json<{ decisionCode: string }>().decisionCode).toBe('progress');
    const snapshot = (await ctx.db.execute(sql`
      SELECT e.earned_credits::int AS earned_credits, e.rule_snapshot FROM progression_calculation_evidence e
      JOIN progression_decision d ON d.id = e.progression_decision_id AND d.recorded_until IS NULL
      WHERE d.enrolment_id = ${credited.enrolmentId} ORDER BY e.calculated_at DESC LIMIT 1
    `)) as unknown as Array<{ earned_credits: number; rule_snapshot: { recognisedCreditIds: string[] } }>;
    expect(snapshot[0]).toMatchObject({ earned_credits: 20, rule_snapshot: { recognisedCreditIds: [creditId] } });
    const decisionId = (await getProgression(credited.enrolmentId)).json<{ progressionDecisionId: string }>().progressionDecisionId;
    const evidence = await ctx.app.inject({ method: 'GET', url: `/api/v1/progression-decisions/${decisionId}/evidence`, headers: { authorization: `Bearer ${jwt}` } });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({ requiredCredits: 20, earnedCredits: 20, recognisedCredits: 20, recognisedCreditIds: [creditId], decisionCode: 'progress' });

    // A variation raising the requirement to 40 turns a 20-credit pass into a resit.
    const varied = await createProgressionFixture('PRG111');
    await addModuleResult(varied, 'PRG111A', 60);
    const exception = await post(`/enrolments/${varied.enrolmentId}/rule-exceptions`, proposerJwt, {
      ruleCode: 'progression-credit-requirement', exceptionTypeCode: 'variation', variationValue: { requiredCredits: 40 },
      description: 'Must complete the deferred module this year', validFrom: '2027-09-01', authorityRef: 'Board 2027/3',
    });
    expect(exception.statusCode).toBe(201);
    await approve(`/rule-exceptions/${exception.json<{ ruleExceptionId: string }>().ruleExceptionId}/decision`);
    await evaluateProgression(varied.enrolmentId);
    expect((await getProgression(varied.enrolmentId)).json<{ decisionCode: string }>().decisionCode).toBe('resit');
  });

  it('evaluates a passing progression decision and publishes an event', async () => {
    const fixture = await createProgressionFixture('PRG101');
    await addModuleResult(fixture, 'PRG101A', 60);

    const decision = await evaluateProgression(fixture.enrolmentId);
    expect(decision.statusCode).toBe(201);
    const progressionDecisionId = decision.json<{ progressionDecisionId: string }>().progressionDecisionId;

    const current = await getProgression(fixture.enrolmentId);
    expect(current.statusCode).toBe(200);
    expect(current.json<{ progressionDecisionId: string; decisionCode: string; yearOfStudy: string; locked: boolean }>())
      .toMatchObject({ progressionDecisionId, decisionCode: 'progress', yearOfStudy: '1', locked: false });

    const event = capturedEvents.find((captured) => captured.type === 'srs.progression.decided');
    expect(event).toBeDefined();
    expect(event?.classification).toBe('personal');
    expect(event?.payload).toMatchObject({
      progressionDecisionId,
      enrolmentId: fixture.enrolmentId,
      personId: fixture.personId,
      academicYear: '2027-28',
      decisionCode: 'progress',
    });
  });

  it('applies compensation and condonement thresholds from configured rules', async () => {
    const compensated = await createProgressionFixture('PRG102');
    await addModuleResult(compensated, 'PRG102A', 35);
    const compensatedDecision = await evaluateProgression(compensated.enrolmentId);
    expect(compensatedDecision.statusCode).toBe(201);
    expect((await getProgression(compensated.enrolmentId)).json<{ decisionCode: string }>().decisionCode)
      .toBe('progress');

    const condoned = await createProgressionFixture('PRG103');
    await addModuleResult(condoned, 'PRG103A', 28);
    const condonedDecision = await evaluateProgression(condoned.enrolmentId);
    expect(condonedDecision.statusCode).toBe(201);
    expect((await getProgression(condoned.enrolmentId)).json<{ decisionCode: string }>().decisionCode)
      .toBe('progress');
  });

  it('updates bitemporally and rejects mutation once locked', async () => {
    const fixture = await createProgressionFixture('PRG104');
    await addModuleResult(fixture, 'PRG104A', 20);
    const first = await evaluateProgression(fixture.enrolmentId);
    expect(first.statusCode).toBe(201);
    const progressionDecisionId = first.json<{ progressionDecisionId: string }>().progressionDecisionId;

    const second = await evaluateProgression(fixture.enrolmentId);
    expect(second.statusCode).toBe(201);
    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/progression/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ progressionDecisionId: string; recordedUntil: string | null }>>())
      .toMatchObject([
        { progressionDecisionId },
        { progressionDecisionId, recordedUntil: null },
      ]);

    await ctx.db.execute(sql`
      UPDATE progression_decision
      SET locked = true
      WHERE id = ${progressionDecisionId}
        AND tenant_id = ${ctx.tenantId}
        AND recorded_until IS NULL
    `);
    const locked = await evaluateProgression(fixture.enrolmentId);
    expect(locked.statusCode).toBe(403);
  });

  it('does not expose progression decisions through another tenant', async () => {
    const fixture = await createProgressionFixture('PRG105');
    await addModuleResult(fixture, 'PRG105A', 55);
    await evaluateProgression(fixture.enrolmentId);
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const current = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/progression?academicYear=2027-28`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(current.statusCode).toBe(404);
  });
});

interface ProgressionFixture {
  personId: string;
  enrolmentId: string;
}

async function createProgressionFixture(code: string): Promise<ProgressionFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Progression' },
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
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}

async function addModuleResult(fixture: ProgressionFixture, code: string, rawMark: number): Promise<void> {
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
    payload: { enrolmentId: fixture.enrolmentId, moduleOfferingId, registrationDate: '2027-10-01' },
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

  const mark = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { assessmentComponentId, rawMark },
  });
  expect(mark.statusCode).toBe(201);
}

async function evaluateProgression(enrolmentId: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/enrolments/${enrolmentId}/progression`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { academicYear: '2027-28' },
  });
}

async function getProgression(enrolmentId: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/enrolments/${enrolmentId}/progression?academicYear=2027-28`,
    headers: { authorization: `Bearer ${jwt}` },
  });
}

async function seedProgressionRules(): Promise<void> {
  const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  const rules = [
    ['progression-credit-requirement', { requiredCredits: 20 }],
    ['compensation-threshold', { minimumMark: 30 }],
    ['compensation-credit-limit', { maxCredits: 20 }],
    ['condonement-threshold', { minimumMark: 25 }],
  ] as const;

  for (const [ruleTypeCode, ruleValue] of rules) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/academic-rules',
      headers: { authorization: `Bearer ${adminJwt}` },
      payload: {
        ruleTypeCode,
        ruleKey: 'default',
        ruleValue,
        description: 'Progression integration rule',
      },
    });
    expect(res.statusCode).toBe(201);
  }
}
