import { randomUUID } from 'node:crypto';

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
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Marks', () => {
  it('ingests a mark, applies late penalty, stores source submission, and publishes event', async () => {
    const fixture = await createAssessmentFixture('MRK101');
    await createLatePenaltyRule(5);

    const ingest = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId: fixture.assessmentComponentId,
        rawMark: 70,
        attemptNumber: 1,
        sourceSystem: 'vle',
        sourceReference: 'VLE-MRK-001',
        submittedAt: '2027-10-03T09:00:00.000Z',
        dueAt: '2027-10-01T09:00:00.000Z',
        rawPayload: { source: 'unit-test' },
      },
    });
    expect(ingest.statusCode).toBe(201);
    const markId = ingest.json<{ markId: string }>().markId;

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{
      markId: string;
      rawMark: number;
      adjustedMark: number;
      penaltyApplied: boolean;
      penaltyPercent: number;
      assessmentSubmissionId: string | null;
    }>>()).toContainEqual(expect.objectContaining({
      markId,
      rawMark: 70,
      adjustedMark: 60,
      penaltyApplied: true,
      penaltyPercent: 10,
      assessmentSubmissionId: expect.any(String) as string,
    }));

    const evt = capturedEvents.find((event) => event.type === 'srs.assessment.mark-received');
    expect(evt).toBeDefined();
    expect(evt?.classification).toBe('personal');
    expect(evt?.payload).toMatchObject({
      markId,
      moduleRegistrationId: fixture.moduleRegistrationId,
      assessmentComponentId: fixture.assessmentComponentId,
      rawMark: 70,
      adjustedMark: 60,
      penaltyApplied: true,
      sourceSystem: 'vle',
    });
  });

  it('suppresses late penalty when an active deadline-extension adjustment exists', async () => {
    const fixture = await createAssessmentFixture('MRK102');
    await createLatePenaltyRule(5);
    await insertDeadlineExtension(fixture.enrolmentId, fixture.personId);

    const ingest = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId: fixture.assessmentComponentId,
        rawMark: 70,
        submittedAt: '2027-10-03T09:00:00.000Z',
        dueAt: '2027-10-01T09:00:00.000Z',
      },
    });
    expect(ingest.statusCode).toBe(201);

    const marks = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(marks.json<Array<{ adjustedMark: number; penaltyApplied: boolean }>>())
      .toContainEqual(expect.objectContaining({ adjustedMark: 70, penaltyApplied: false }));
  });

  it('updates a mark bitemporally and exposes history', async () => {
    const fixture = await createAssessmentFixture('MRK103');
    const markId = await ingestMark(fixture, 52);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/marks/${markId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 62, reason: 'moderation correction' },
    });
    expect(patch.statusCode).toBe(204);

    const history = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/marks/${markId}/history`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<Array<{ rawMark: number; recordedUntil: string | null }>>())
      .toMatchObject([
        { rawMark: 52 },
        { rawMark: 62, recordedUntil: null },
      ]);

    const evt = capturedEvents.find((event) => event.type === 'srs.assessment.mark-updated');
    expect(evt).toBeDefined();
    expect(evt?.classification).toBe('personal');
    expect(evt?.payload).toMatchObject({
      markId,
      previousMark: 52,
      newMark: 62,
      reason: 'moderation correction',
    });
  });

  it('preserves an existing late penalty when correcting only the raw mark', async () => {
    const fixture = await createAssessmentFixture('MRK106');
    await createLatePenaltyRule(5);

    const ingest = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        assessmentComponentId: fixture.assessmentComponentId,
        rawMark: 70,
        submittedAt: '2027-10-03T09:00:00.000Z',
        dueAt: '2027-10-01T09:00:00.000Z',
      },
    });
    expect(ingest.statusCode).toBe(201);
    const markId = ingest.json<{ markId: string }>().markId;

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/marks/${markId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 80, reason: 'entered mark correction' },
    });
    expect(patch.statusCode).toBe(204);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.json<Array<{ markId: string; rawMark: number; adjustedMark: number; penaltyPercent: number }>>())
      .toContainEqual(expect.objectContaining({
        markId,
        rawMark: 80,
        adjustedMark: 70,
        penaltyPercent: 10,
      }));
  });

  it('rejects updates to locked marks', async () => {
    const fixture = await createAssessmentFixture('MRK104');
    const markId = await ingestMark(fixture, 50);
    await ctx.db.execute(sql`
      UPDATE mark
      SET locked = true
      WHERE id = ${markId}
        AND tenant_id = ${ctx.tenantId}
        AND recorded_until IS NULL
    `);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/marks/${markId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rawMark: 55 },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('does not expose marks through another tenant', async () => {
    const fixture = await createAssessmentFixture('MRK105');
    await ingestMark(fixture, 64);
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(list.statusCode).toBe(404);
  });
});

interface AssessmentFixture {
  personId: string;
  enrolmentId: string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
}

async function createAssessmentFixture(code: string): Promise<AssessmentFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Marker' },
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
    payload: {
      enrolmentId,
      moduleOfferingId,
      registrationDate: '2027-10-01',
    },
  });
  expect(registration.statusCode).toBe(201);
  const moduleRegistrationId = registration.json<{ moduleRegistrationId: string }>().moduleRegistrationId;

  const component = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-offerings/${moduleOfferingId}/components`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      assessmentComponentId: randomUUID(),
      componentTypeCode: 'coursework',
      title: 'Coursework',
      weighting: 100,
    },
  });
  expect(component.statusCode).toBe(201);
  const assessmentComponentId = component.json<{ assessmentComponentId: string }>().assessmentComponentId;

  return { personId, enrolmentId, moduleRegistrationId, assessmentComponentId };
}

async function ingestMark(fixture: AssessmentFixture, rawMark: number): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/module-registrations/${fixture.moduleRegistrationId}/marks`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      assessmentComponentId: fixture.assessmentComponentId,
      rawMark,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ markId: string }>().markId;
}

async function createLatePenaltyRule(percentPerDay: number): Promise<void> {
  const adminJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/academic-rules',
    headers: { authorization: `Bearer ${adminJwt}` },
    payload: {
      ruleTypeCode: 'late-penalty-rate',
      ruleKey: 'default',
      ruleValue: { percentPerDay },
      description: 'Late penalty for mark ingestion tests',
    },
  });
  expect(res.statusCode).toBe(201);
}

async function insertDeadlineExtension(enrolmentId: string, personId: string): Promise<void> {
  const adjustment = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/students/${personId}/adjustments`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId,
      adjustmentTypeCode: 'deadline-extension',
      scopeCode: 'coursework',
      validFrom: '2027-09-01T00:00:00.000Z',
      validTo: '2027-12-31T00:00:00.000Z',
    },
  });
  expect(adjustment.statusCode).toBe(201);
}
