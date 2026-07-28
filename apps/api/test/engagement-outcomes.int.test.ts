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
let integrationJwt: string;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
  jwt = await ctx.makeJwt();
  integrationJwt = await ctx.makeJwt({ roles: ['integration-service'] });
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Engagement outcomes (attendance-module handoff)', () => {
  it('records an outcome, is idempotent on the same sourceAlertId + outcomeCode, and publishes the event', async () => {
    const fixture = await createEngagementOutcomeFixture('ENG101');
    const sourceAlertId = 'attendance-alert-001';

    const first = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/engagement-outcomes`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        outcomeCode: 'at-risk',
        severityCode: 'medium',
        effectiveFrom: '2026-10-01T00:00:00.000Z',
        sourceAlertId,
      },
    });
    expect(first.statusCode).toBe(201);
    const engagementOutcomeId = first.json<{ engagementOutcomeId: string }>().engagementOutcomeId;

    // A repeated delivery of the same logical outcome from the attendance
    // module returns the existing row rather than creating a duplicate.
    const repeat = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/engagement-outcomes`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        outcomeCode: 'at-risk',
        severityCode: 'medium',
        effectiveFrom: '2026-10-01T00:00:00.000Z',
        sourceAlertId,
      },
    });
    expect(repeat.statusCode).toBe(201);
    expect(repeat.json<{ engagementOutcomeId: string }>().engagementOutcomeId).toBe(engagementOutcomeId);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/engagement-outcomes`,
      headers: { authorization: `Bearer ${integrationJwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ engagementOutcomeId: string; outcomeCode: string }>>())
      .toContainEqual(expect.objectContaining({ engagementOutcomeId, outcomeCode: 'at-risk' }));

    const recorded = capturedEvents.find((event) => event.type === 'srs.engagement.outcome-recorded');
    expect(recorded).toBeDefined();
    expect(recorded?.classification).toBe('sensitive');
    expect(recorded?.payload).toMatchObject({
      engagementOutcomeId,
      personId: fixture.personId,
      enrolmentId: fixture.enrolmentId,
      outcomeCode: 'at-risk',
    });
  });

  it('rejects an outcome for an enrolment that does not belong to the student', async () => {
    const fixtureA = await createEngagementOutcomeFixture('ENG102');
    const fixtureB = await createEngagementOutcomeFixture('ENG103');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixtureA.personId}/engagement-outcomes`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        enrolmentId: fixtureB.enrolmentId,
        outcomeCode: 'at-risk',
        effectiveFrom: '2026-10-01T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not leak engagement outcomes across tenants', async () => {
    const fixture = await createEngagementOutcomeFixture('ENG104');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/engagement-outcomes`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        outcomeCode: 'at-risk',
        effectiveFrom: '2026-10-01T00:00:00.000Z',
      },
    });

    const otherTenantJwt = await ctx.makeJwt({ roles: ['integration-service'], tenantId: ctx.secondTenantId });
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/engagement-outcomes`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(list.statusCode).toBe(404);
  });
});

interface EngagementOutcomeFixture {
  personId: string;
  enrolmentId: string;
}

async function createEngagementOutcomeFixture(code: string): Promise<EngagementOutcomeFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Engagement' },
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
