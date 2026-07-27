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
let registryJwt: string;
let tutorJwt: string;
let personalTutorJwt: string;
let studentJwt: string;
const capturedEvents: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(capturedEvents) });
  registryJwt = await ctx.makeJwt({ roles: ['registry-administrator'] });
  tutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
  personalTutorJwt = await ctx.makeJwt({ roles: ['personal-tutor'] });
  studentJwt = await ctx.makeJwt({ roles: ['student'] });
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Attendance and engagement Increment C', () => {
  it('creates, lists and publishes an expected event idempotently by source version', async () => {
    const fixture = await createFixture('ENG101');
    const payload = eventPayload(fixture);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/engagement/events',
      headers: { authorization: `Bearer ${registryJwt}` },
      payload,
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<{ expectedEventId: string; created: boolean }>();
    expect(result.created).toBe(true);

    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/engagement/events',
      headers: { authorization: `Bearer ${registryJwt}` },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ expectedEventId: result.expectedEventId, created: false });

    const listed = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/engagement/events?personId=${fixture.personId}`,
      headers: { authorization: `Bearer ${tutorJwt}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<Array<{ expectedEventId: string; activityTypeCode: string }>>())
      .toContainEqual(expect.objectContaining({
        expectedEventId: result.expectedEventId,
        activityTypeCode: 'lecture',
      }));

    expect(capturedEvents.filter((event) => event.type === 'srs.engagement.expected-event.created'))
      .toHaveLength(1);
  });

  it('records an observation once for repeated idempotency keys', async () => {
    const fixture = await createFixture('ENG102');
    const expectedEventId = await createEvent(fixture, 'TT-ENG102');
    const payload = observationPayload('OBS-ENG102', '1', 'absent');

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/events/${expectedEventId}/observations`,
      headers: {
        authorization: `Bearer ${tutorJwt}`,
        'idempotency-key': 'observation-eng102-v1',
      },
      payload,
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<{ observationId: string; created: boolean }>();

    const replay = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/events/${expectedEventId}/observations`,
      headers: {
        authorization: `Bearer ${tutorJwt}`,
        'idempotency-key': 'observation-eng102-v1',
      },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ observationId: result.observationId, created: false });
    expect(capturedEvents.filter((event) => event.type === 'srs.engagement.observation.recorded'))
      .toHaveLength(1);
  });

  it('corrects an observation by appending a version and revision record', async () => {
    const fixture = await createFixture('ENG103');
    const expectedEventId = await createEvent(fixture, 'TT-ENG103');
    const observationId = await createObservation(expectedEventId, 'OBS-ENG103');

    const corrected = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/observations/${observationId}/corrections`,
      headers: {
        authorization: `Bearer ${tutorJwt}`,
        'idempotency-key': 'observation-eng103-v2',
      },
      payload: {
        sourceVersion: '2',
        outcomeCode: 'attended',
        dataQualityCode: 'corrected',
        correctionReasonCode: 'staff-entry-error',
        correctionReason: 'Tutor confirmed the original register was incorrect.',
      },
    });
    expect(corrected.statusCode).toBe(201);

    const versions = await ctx.db.execute(sql`
      SELECT outcome_code, data_quality_code, recorded_until
      FROM engagement_observation
      WHERE tenant_id = ${ctx.tenantId} AND id = ${observationId}
      ORDER BY recorded_at
    `) as Array<{ outcome_code: string; data_quality_code: string; recorded_until: Date | null }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]?.outcome_code).toBe('absent');
    expect(versions[0]?.recorded_until).not.toBeNull();
    expect(versions[1]).toMatchObject({
      outcome_code: 'attended',
      data_quality_code: 'corrected',
      recorded_until: null,
    });

    const revisions = await ctx.db.execute(sql`
      SELECT correction_reason_code, disputed
      FROM engagement_observation_revision
      WHERE tenant_id = ${ctx.tenantId} AND observation_id = ${observationId}
    `) as Array<{ correction_reason_code: string; disputed: boolean }>;
    expect(revisions).toEqual([{ correction_reason_code: 'staff-entry-error', disputed: false }]);
    expect(capturedEvents).toContainEqual(expect.objectContaining({
      type: 'srs.engagement.observation.corrected',
      classification: 'sensitive',
    }));
  });

  it('returns the current expected-event and observation timeline', async () => {
    const fixture = await createFixture('ENG104');
    const expectedEventId = await createEvent(fixture, 'TT-ENG104');
    const observationId = await createObservation(expectedEventId, 'OBS-ENG104');

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/engagement/students/${fixture.personId}/timeline`,
      headers: { authorization: `Bearer ${personalTutorJwt}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{
      events: Array<{ expectedEventId: string }>;
      observations: Array<{ observationId: string }>;
    }>()).toMatchObject({
      events: [expect.objectContaining({ expectedEventId })],
      observations: [expect.objectContaining({ observationId })],
    });
  });

  it('rejects missing idempotency headers and invalid controlled values', async () => {
    const fixture = await createFixture('ENG105');
    const expectedEventId = await createEvent(fixture, 'TT-ENG105');

    const missingHeader = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/events/${expectedEventId}/observations`,
      headers: { authorization: `Bearer ${tutorJwt}` },
      payload: observationPayload('OBS-ENG105', '1', 'attended'),
    });
    expect(missingHeader.statusCode).toBe(400);

    const invalidCode = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/events/${expectedEventId}/observations`,
      headers: {
        authorization: `Bearer ${tutorJwt}`,
        'idempotency-key': 'observation-eng105-invalid',
      },
      payload: observationPayload('OBS-ENG105', '1', 'automatically-withdrawn'),
    });
    expect(invalidCode.statusCode).toBe(422);
  });

  it('enforces permissions and tenant isolation', async () => {
    const fixture = await createFixture('ENG106');
    const expectedEventId = await createEvent(fixture, 'TT-ENG106');

    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/engagement/events',
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const otherTenantJwt = await ctx.makeJwt({
      tenantId: ctx.secondTenantId,
      roles: ['registry-administrator'],
    });
    const crossTenant = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/events/${expectedEventId}/observations`,
      headers: {
        authorization: `Bearer ${otherTenantJwt}`,
        'idempotency-key': 'cross-tenant-observation',
      },
      payload: observationPayload('OBS-CROSS', '1', 'attended'),
    });
    expect(crossTenant.statusCode).toBe(404);
  });
});

interface Fixture {
  personId: string;
  enrolmentId: string;
}

async function createFixture(code: string): Promise<Fixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${registryJwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Engagement' },
  });
  expect(student.statusCode).toBe(201);
  const personId = student.json<{ personId: string }>().personId;
  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${registryJwt}` },
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

function eventPayload(fixture: Fixture) {
  return {
    personId: fixture.personId,
    enrolmentId: fixture.enrolmentId,
    activityTypeCode: 'lecture',
    activityReference: 'MOD-ENG-101',
    eventModeCode: 'in-person',
    scheduledFrom: '2027-10-04T09:00:00.000Z',
    scheduledTo: '2027-10-04T10:00:00.000Z',
    locationReference: 'ROOM-A1',
    sourceSystemCode: 'timetable',
    sourceEventId: `event-${fixture.enrolmentId}`,
    sourceVersion: '1',
  };
}

function observationPayload(sourceEventId: string, sourceVersion: string, outcomeCode: string) {
  return {
    sourceSystemCode: 'manual-register',
    sourceEventId,
    sourceVersion,
    captureMethodCode: 'staff-entry',
    outcomeCode,
    dataQualityCode: 'valid',
    eventTime: '2027-10-04T09:00:00.000Z',
  };
}

async function createEvent(fixture: Fixture, sourceEventId: string): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/engagement/events',
    headers: { authorization: `Bearer ${registryJwt}` },
    payload: { ...eventPayload(fixture), sourceEventId },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ expectedEventId: string }>().expectedEventId;
}

async function createObservation(expectedEventId: string, sourceEventId: string): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/engagement/events/${expectedEventId}/observations`,
    headers: {
      authorization: `Bearer ${tutorJwt}`,
      'idempotency-key': `${sourceEventId}-v1`,
    },
    payload: observationPayload(sourceEventId, '1', 'absent'),
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ observationId: string }>().observationId;
}
