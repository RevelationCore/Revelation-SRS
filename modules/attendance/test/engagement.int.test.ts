/**
 * Full engagement-domain coverage, migrated from apps/api/test/engagement.int.test.ts
 * as part of the Stage 1 cutover. Fixtures now seed the module's local
 * enrolment_person_map via a synthetic srs.student.enrolled event (dispatched
 * directly, no NATS) instead of calling core's /students and /enrolments
 * endpoints, which this module no longer has access to. Local state changes
 * are captured via the onEvent sink instead of a spied SRS_EVENTS publisher,
 * since this module never publishes onto that stream.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';
import { EVENT_TYPES } from '@revelation-srs/domain';

import { AttendanceEventConsumer } from '../src/consumers/consumer.js';
import type { LocalEngagementEvent } from '../src/services/engagement-service.js';
import type { ValueSetClient } from '../src/srs/srs-value-set-client.js';

import { startTestApp, type TestAttendanceApp } from './helpers/test-db.js';

/** Rejects only the one known-bad code the original core value-set config disallowed. */
class TestValueSetClient implements ValueSetClient {
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateFieldValue(_entity: string, _field: string, value: string): Promise<boolean | null> {
    return value !== 'automatically-withdrawn';
  }
}

let ctx: TestAttendanceApp;
let consumer: AttendanceEventConsumer;
let registryJwt: string;
let tutorJwt: string;
let personalTutorJwt: string;
let studentJwt: string;
let tenantAdminJwt: string;
let engagementOfficerJwt: string;
const capturedEvents: LocalEngagementEvent[] = [];

function makeEnvelope<T>(type: string, payload: T, tenantId: string): DomainEventEnvelope<T> {
  return {
    id:                 randomUUID(),
    type,
    version:            '1.0.0',
    schemaRef:          `https://schemas.srs.ac.uk/events/${type}/v1.0.0`,
    tenantId,
    occurredAt:         new Date().toISOString(),
    publishedAt:        new Date().toISOString(),
    validAt:            new Date().toISOString(),
    correlationId:      randomUUID(),
    causationId:        randomUUID(),
    source:             'srs-core',
    dataClassification: 'personal',
    payload,
  };
}

beforeAll(async () => {
  ctx = await startTestApp({ onEvent: (event) => capturedEvents.push(event), valueSetClient: new TestValueSetClient() });
  consumer = new AttendanceEventConsumer('nats://unused', ctx.db, ctx.app.log);
  registryJwt = ctx.makeJwt({ roles: ['registry-administrator'] });
  tutorJwt = ctx.makeJwt({ roles: ['module-tutor'] });
  personalTutorJwt = ctx.makeJwt({ roles: ['personal-tutor'] });
  studentJwt = ctx.makeJwt({ roles: ['student'] });
  tenantAdminJwt = ctx.makeJwt({ roles: ['tenant-administrator'] });
  engagementOfficerJwt = ctx.makeJwt({ roles: ['engagement-officer'] });
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

    expect(capturedEvents.filter((event) => event.type === 'attendance.expected-event.created'))
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
    expect(capturedEvents.filter((event) => event.type === 'attendance.observation.recorded'))
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
      FROM attendance.engagement_observation
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
      FROM attendance.engagement_observation_revision
      WHERE tenant_id = ${ctx.tenantId} AND observation_id = ${observationId}
    `) as Array<{ correction_reason_code: string; disputed: boolean }>;
    expect(revisions).toEqual([{ correction_reason_code: 'staff-entry-error', disputed: false }]);
    expect(capturedEvents).toContainEqual(expect.objectContaining({
      type: 'attendance.observation.corrected',
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

    const otherTenantJwt = ctx.makeJwt({
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

describe('Attendance and engagement Increment D', () => {
  it('uses an approved policy version to create one explainable review alert', async () => {
    const fixture = await createFixture('ENGD01');
    const eventId = await createEvent(fixture, 'TT-ENGD01');
    await createObservation(eventId, 'OBS-ENGD01');
    const policyVersionId = await createPolicy('STANDARD-ENGAGEMENT', 1, 'approved');
    const payload = evaluationPayload(fixture, policyVersionId);

    const created = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/evaluations',
      headers: { authorization: `Bearer ${engagementOfficerJwt}` }, payload,
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<{
      alert: { alertId: string; evidenceHash: string; explanation: Record<string, unknown>; statusCode: string };
    }>();
    expect(result.alert.statusCode).toBe('open');
    expect(result.alert.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.alert.explanation).toMatchObject({
      policyCode: 'STANDARD-ENGAGEMENT', policyVersion: 1,
      decision: 'human-review-required', automatedAdverseActionPermitted: false,
    });

    const replay = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/evaluations',
      headers: { authorization: `Bearer ${engagementOfficerJwt}` }, payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ matched: true, alertCreated: false });
    expect(capturedEvents.filter((event) => event.type === 'attendance.alert.raised')).toHaveLength(1);
  });

  it('suspends an alert when the source evidence is disputed', async () => {
    const fixture = await createFixture('ENGD02');
    const eventId = await createEvent(fixture, 'TT-ENGD02');
    const observation = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/events/${eventId}/observations`,
      headers: { authorization: `Bearer ${tutorJwt}`, 'idempotency-key': 'OBS-ENGD02-v1' },
      payload: { ...observationPayload('OBS-ENGD02', '1', 'absent'), dataQualityCode: 'disputed' },
    });
    expect(observation.statusCode).toBe(201);
    const policyVersionId = await createPolicy('STANDARD-ENGAGEMENT', 2, 'approved');
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/evaluations',
      headers: { authorization: `Bearer ${engagementOfficerJwt}` },
      payload: evaluationPayload(fixture, policyVersionId),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      alert: {
        statusCode: 'suspended-reconciliation', reevaluationRequired: true,
        explanation: { decision: 'reconciliation-required', automatedAdverseActionPermitted: false },
      },
    });
    expect(capturedEvents).toContainEqual(expect.objectContaining({ type: 'attendance.alert.suspended' }));
  });

  it('rejects draft policies and protects policy and alert routes with RBAC', async () => {
    const fixture = await createFixture('ENGD03');
    const policyVersionId = await createPolicy('DRAFT-ENGAGEMENT', 1, 'draft');
    const rejected = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/evaluations',
      headers: { authorization: `Bearer ${engagementOfficerJwt}` },
      payload: evaluationPayload(fixture, policyVersionId),
    });
    expect(rejected.statusCode).toBe(404);
    const forbiddenPolicy = await ctx.app.inject({
      method: 'POST', url: '/api/v1/engagement/policies',
      headers: { authorization: `Bearer ${registryJwt}` }, payload: policyPayload('FORBIDDEN', 1, 'approved'),
    });
    expect(forbiddenPolicy.statusCode).toBe(403);
    const forbiddenAlerts = await ctx.app.inject({
      method: 'GET', url: '/api/v1/engagement/alerts',
      headers: { authorization: `Bearer ${studentJwt}` },
    });
    expect(forbiddenAlerts.statusCode).toBe(403);
  });
});

describe('Attendance and engagement Increment E', () => {
  it('opens one assigned intervention from a triaged alert idempotently', async () => {
    const { alertId } = await createOpenAlert('ENGE01');
    const payload = {
      decision: 'open-intervention', assignedRoleCode: 'engagement-officer',
      assignedActorId: 'officer-1', dueAt: '2027-10-15T12:00:00.000Z', reasonCode: 'threshold-met',
    };
    const created = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/alerts/${alertId}/triage`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'triage-enge01' }, payload,
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<{ interventionCaseId: string }>();
    const replay = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/alerts/${alertId}/triage`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'triage-enge01' }, payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ interventionCaseId: result.interventionCaseId, created: false });
    expect(capturedEvents.filter((event) => event.type === 'attendance.intervention.opened')).toHaveLength(1);
  });

  it('records accessible contacts and actions without restricted narrative', async () => {
    const caseId = await createIntervention('ENGE02');
    const contact = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/cases/${caseId}/contacts`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'contact-enge02' },
      payload: {
        channelCode: 'portal', attemptedAt: '2027-10-11T10:00:00.000Z',
        outcomeCode: 'response-received', communicationLocale: 'cy',
        operationalNote: 'Student requested an afternoon appointment.',
      },
    });
    expect(contact.statusCode).toBe(201);
    const action = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/cases/${caseId}/actions`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'action-enge02' },
      payload: { actionTypeCode: 'academic-meeting', ownerRoleCode: 'personal-tutor', dueAt: '2027-10-16T12:00:00.000Z' },
    });
    expect(action.statusCode).toBe(201);
    const restricted = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/cases/${caseId}/contacts`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'contact-enge02-restricted' },
      payload: {
        channelCode: 'telephone', attemptedAt: '2027-10-11T11:00:00.000Z',
        outcomeCode: 'contacted', operationalNote: 'Medical diagnosis details were discussed.',
      },
    });
    expect(restricted.statusCode).toBe(422);
    const view = await ctx.app.inject({
      method: 'GET', url: `/api/v1/engagement/cases/${caseId}`,
      headers: { authorization: `Bearer ${personalTutorJwt}` },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      contacts: [expect.objectContaining({ communicationLocale: 'cy' })],
      actions: [expect.objectContaining({ actionTypeCode: 'academic-meeting' })],
    });
  });

  it('creates a minimum-necessary referral without making a status or sponsor decision', async () => {
    const caseId = await createIntervention('ENGE03');
    const view = await ctx.app.inject({
      method: 'GET', url: `/api/v1/engagement/cases/${caseId}`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}` },
    });
    const versionId = view.json<{ intervention: { versionId: string } }>().intervention.versionId;
    const referred = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/cases/${caseId}/review`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'review-enge03' },
      payload: {
        expectedVersionId: versionId, decision: 'refer', reviewAt: '2027-10-14T12:00:00.000Z',
        referral: {
          targetServiceCode: 'sponsor-compliance-review', referralTypeCode: 'compliance-review',
          externalReference: 'SCR-OPAQUE-001',
        },
      },
    });
    expect(referred.statusCode).toBe(201);
    expect(referred.json()).toMatchObject({ statusCode: 'referred' });
    const caseView = await ctx.app.inject({
      method: 'GET', url: `/api/v1/engagement/cases/${caseId}`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}` },
    });
    expect(caseView.json()).toMatchObject({
      referrals: [expect.objectContaining({
        targetServiceCode: 'sponsor-compliance-review', referralTypeCode: 'compliance-review', statusCode: 'pending',
      })],
    });
    expect(JSON.stringify(caseView.json())).not.toMatch(/diagnosis|sponsorDecision|ukviSubmission/i);
    expect(capturedEvents).toContainEqual(expect.objectContaining({ type: 'attendance.referral.created' }));
  });

  it('closes a case with an authorised outcome and immutable prior version', async () => {
    const caseId = await createIntervention('ENGE04');
    const view = await ctx.app.inject({
      method: 'GET', url: `/api/v1/engagement/cases/${caseId}`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}` },
    });
    const versionId = view.json<{ intervention: { versionId: string } }>().intervention.versionId;
    const closed = await ctx.app.inject({
      method: 'POST', url: `/api/v1/engagement/cases/${caseId}/review`,
      headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': 'review-enge04-close' },
      payload: {
        expectedVersionId: versionId, decision: 'close', outcomeCode: 'engagement-restored',
        reviewAt: '2027-10-14T12:00:00.000Z',
      },
    });
    expect(closed.statusCode).toBe(201);
    expect(closed.json()).toMatchObject({ statusCode: 'closed' });
    const versions = await ctx.db.execute(sql`
      SELECT status_code, recorded_until
      FROM attendance.engagement_intervention_case
      WHERE tenant_id = ${ctx.tenantId} AND id = ${caseId}
      ORDER BY recorded_at
    `) as Array<{ status_code: string; recorded_until: Date | null }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]?.recorded_until).not.toBeNull();
    expect(versions[1]).toMatchObject({ status_code: 'closed', recorded_until: null });
    expect(capturedEvents).toContainEqual(expect.objectContaining({ type: 'attendance.intervention.closed' }));
  });
});

interface Fixture {
  personId: string;
  enrolmentId: string;
}

/**
 * Seeds the module's local enrolment_person_map by dispatching a synthetic
 * srs.student.enrolled event, replacing the original test's calls to core's
 * /students and /enrolments endpoints (this module has no access to those).
 */
async function createFixture(code: string): Promise<Fixture> {
  const personId = randomUUID();
  const enrolmentId = randomUUID();
  await consumer.dispatch(makeEnvelope(
    EVENT_TYPES.STUDENT_ENROLLED,
    { personId, enrolmentId, academicYear: '2027/28', modeOfStudy: 'full-time' },
    ctx.tenantId,
  ));
  return { personId, enrolmentId };
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

function policyPayload(policyCode: string, versionNumber: number, statusCode: 'draft' | 'approved') {
  return {
    policyCode, versionNumber, displayName: `${policyCode} v${versionNumber}`, statusCode,
    validFrom: '2027-09-01T00:00:00.000Z', evidenceWindowDays: 14,
    minimumExpectedEvents: 1, minimumAbsenceCount: 1, minimumAbsenceRate: 1,
    severityCode: 'medium', reviewDeadlineDays: 5,
  };
}

async function createPolicy(
  policyCode: string, versionNumber: number, statusCode: 'draft' | 'approved',
): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST', url: '/api/v1/engagement/policies',
    headers: { authorization: `Bearer ${tenantAdminJwt}` },
    payload: policyPayload(policyCode, versionNumber, statusCode),
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ policyVersionId: string }>().policyVersionId;
}

function evaluationPayload(fixture: Fixture, policyVersionId: string) {
  return {
    policyVersionId, personId: fixture.personId, enrolmentId: fixture.enrolmentId,
    evidenceWindowFrom: '2027-10-01T00:00:00.000Z',
    evidenceWindowTo: '2027-10-10T00:00:00.000Z',
  };
}

async function createOpenAlert(code: string): Promise<{ alertId: string }> {
  const fixture = await createFixture(code);
  const eventId = await createEvent(fixture, `TT-${code}`);
  await createObservation(eventId, `OBS-${code}`);
  const policyVersionId = await createPolicy(`POLICY-${code}`, 1, 'approved');
  const response = await ctx.app.inject({
    method: 'POST', url: '/api/v1/engagement/evaluations',
    headers: { authorization: `Bearer ${engagementOfficerJwt}` },
    payload: evaluationPayload(fixture, policyVersionId),
  });
  expect(response.statusCode).toBe(201);
  return { alertId: response.json<{ alert: { alertId: string } }>().alert.alertId };
}

async function createIntervention(code: string): Promise<string> {
  const { alertId } = await createOpenAlert(code);
  const response = await ctx.app.inject({
    method: 'POST', url: `/api/v1/engagement/alerts/${alertId}/triage`,
    headers: { authorization: `Bearer ${engagementOfficerJwt}`, 'idempotency-key': `triage-${code}` },
    payload: {
      decision: 'open-intervention', assignedRoleCode: 'engagement-officer',
      dueAt: '2027-10-15T12:00:00.000Z', reasonCode: 'threshold-met',
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ interventionCaseId: string }>().interventionCaseId;
}
