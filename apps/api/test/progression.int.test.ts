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
