/**
 * Stage 1 extraction — end-to-end integration test.
 *
 * Proves the attendance module works standalone: context ingestion via the
 * NATS consumer's dispatch() (no NATS required — called directly), expected
 * event + observation capture via HTTP, policy evaluation producing an
 * alert, and intervention triage/review — with the SRS outcome handoff
 * captured by a stub client instead of a real HTTP call to core.
 */

import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DomainEventEnvelope } from '@revelation-srs/domain';
import { EVENT_TYPES } from '@revelation-srs/domain';

import { AttendanceEventConsumer } from '../src/consumers/consumer.js';
import { SrsEngagementOutcomeStubClient } from '../src/srs/srs-engagement-outcome-client.js';

import { startTestApp, type TestAttendanceApp } from './helpers/test-db.js';

let ctx: TestAttendanceApp;
let outcomeClient: SrsEngagementOutcomeStubClient;
let consumer: AttendanceEventConsumer;

const PERSON_ID    = '00000000-0000-0001-0000-000000000001';
const ENROLMENT_ID = '00000000-0000-0001-0001-000000000001';
const MOD_REG_ID   = '00000000-0000-0001-0002-000000000001';
const MODULE_ID    = 'COMP1001';

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
  outcomeClient = new SrsEngagementOutcomeStubClient();
  ctx = await startTestApp({ srsOutcomeClient: outcomeClient });
  // Consumer is exercised via dispatch() directly — no live NATS in tests,
  // same pattern as modules/wellbeing's context-ingestion tests.
  consumer = new AttendanceEventConsumer('nats://unused', ctx.db, ctx.app.log);
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
});

describe('Stage 1 — context ingestion', () => {
  it('populates enrolment_person_map from a synthetic srs.student.enrolled event', async () => {
    await consumer.dispatch(makeEnvelope(
      EVENT_TYPES.STUDENT_ENROLLED,
      { personId: PERSON_ID, enrolmentId: ENROLMENT_ID, academicYear: '2026/27', modeOfStudy: 'full-time' },
      ctx.tenantId,
    ));

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/engagement/students/${PERSON_ID}/timeline`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('populates module_registration_map from a synthetic module-registered event', async () => {
    await consumer.dispatch(makeEnvelope(
      EVENT_TYPES.ENROLMENT_MODULE_REGISTERED,
      {
        enrolmentId: ENROLMENT_ID, moduleRegistrationId: MOD_REG_ID, moduleOfferingId: randomUUID(),
        moduleId: MODULE_ID, academicPeriodId: randomUUID(), registrationDate: new Date().toISOString(),
      },
      ctx.tenantId,
    ));
    // No direct assertion surface yet — exercised indirectly via expected-event
    // creation below, which succeeds only if enrolment resolution works.
  });
});

let expectedEventId: string;
let alertId: string;

describe('Stage 1 — expected events and observations', () => {
  it('creates an expected engagement event tied to the module registration', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/engagement/events',
      headers: { authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}` },
      payload: {
        personId: PERSON_ID,
        enrolmentId: ENROLMENT_ID,
        moduleRegistrationId: MOD_REG_ID,
        activityTypeCode: 'lecture',
        eventModeCode: 'in-person',
        scheduledFrom: '2026-10-01T09:00:00.000Z',
        scheduledTo: '2026-10-01T10:00:00.000Z',
        sourceSystemCode: 'test-timetable',
        sourceEventId: 'evt-1',
        sourceVersion: '1',
      },
    });
    expect(res.statusCode).toBe(201);
    expectedEventId = res.json().expectedEventId;
    expect(expectedEventId).toBeTruthy();
  });

  it('records an absence observation against the expected event', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/events/${expectedEventId}/observations`,
      headers: {
        authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        sourceSystemCode: 'test-register',
        sourceEventId: 'obs-1',
        sourceVersion: '1',
        captureMethodCode: 'staff-entry',
        outcomeCode: 'absent',
        eventTime: '2026-10-01T09:05:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('Stage 1 — policy evaluation and SRS outcome handoff', () => {
  let policyVersionId: string;

  it('creates an approved engagement policy', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/engagement/policies',
      headers: { authorization: `Bearer ${ctx.makeJwt({ roles: ['tenant-administrator'] })}` },
      payload: {
        policyCode: 'test-policy',
        versionNumber: 1,
        displayName: 'Test Non-Engagement Policy',
        statusCode: 'approved',
        validFrom: '2026-01-01T00:00:00.000Z',
        evidenceWindowDays: 30,
        minimumExpectedEvents: 1,
        minimumAbsenceCount: 1,
        minimumAbsenceRate: 0.5,
        severityCode: 'medium',
        reviewDeadlineDays: 7,
      },
    });
    expect(res.statusCode).toBe(201);
    policyVersionId = res.json().policyVersionId;
  });

  it('evaluates the policy, raises an alert, and hands the outcome off to SRS', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/engagement/evaluations',
      headers: { authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}` },
      payload: {
        policyVersionId,
        personId: PERSON_ID,
        enrolmentId: ENROLMENT_ID,
        evidenceWindowFrom: '2026-09-15T00:00:00.000Z',
        evidenceWindowTo: '2026-10-05T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.alertCreated).toBe(true);
    alertId = body.alert.alertId;

    // The module never calls core's event bus directly — it hands the
    // outcome off via the SRS client, captured here by the stub.
    expect(outcomeClient.submissions.some((s) => s.sourceAlertId === alertId && s.outcomeCode === 'at-risk')).toBe(true);
  });
});

describe('Stage 1 — intervention casework', () => {
  let caseId: string;
  let expectedVersionId: string;

  it('triages the alert into an open intervention case', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/alerts/${alertId}/triage`,
      headers: {
        authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        decision: 'open-intervention',
        assignedRoleCode: 'engagement-officer',
        dueAt: '2026-11-01T00:00:00.000Z',
        reasonCode: 'non-engagement-pattern',
      },
    });
    expect(res.statusCode).toBe(201);
    caseId = res.json().interventionCaseId;

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/engagement/cases/${caseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}` },
    });
    expectedVersionId = detail.json().intervention.versionId;
  });

  it('closes the case and hands the closure outcome off to SRS', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/engagement/cases/${caseId}/review`,
      headers: {
        authorization: `Bearer ${ctx.makeJwt({ roles: ['engagement-officer'] })}`,
        'idempotency-key': randomUUID(),
      },
      payload: {
        expectedVersionId,
        decision: 'close',
        outcomeCode: 'engagement-restored',
        reviewAt: '2026-11-02T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().statusCode).toBe('closed');

    expect(outcomeClient.submissions.some((s) => s.idempotencyKey === `${caseId}-closed` && s.outcomeCode === 'engagement-restored')).toBe(true);
  });
});
