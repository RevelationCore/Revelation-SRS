/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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

function createSpyBus(events: CapturedEvent[]): IntegrationBusPublisher {
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
      events.push({ type, classification, payload });
      return Promise.resolve();
    },
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as IntegrationBusPublisher;
}

let ctx: TestApp;
let jwt: string;
const events: CapturedEvent[] = [];

beforeAll(async () => {
  ctx = await startTestApp({ eventBus: createSpyBus(events) });
  jwt = await ctx.makeJwt();
}, 120_000);

beforeEach(() => { events.length = 0; });

afterAll(async () => {
  await ctx?.teardown();
});

describe('UKVI compliance exchange', () => {
  it('generates CAS requests from pending triggers and is idempotent', async () => {
    const fixture = await createUkviEnrolment('Cas', 'Generate');

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/cas-requests/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ processedCount: number; casRequests: Array<{ casRequestId: string; enrolmentId: string }> }>();
    expect(body.processedCount).toBeGreaterThanOrEqual(1);
    expect(body.casRequests).toContainEqual(expect.objectContaining({ enrolmentId: fixture.enrolmentId }));

    const triggerRows = await ctx.db.execute(sql`
      SELECT status_code, sent_at
      FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId}
        AND enrolment_id = ${fixture.enrolmentId}
        AND trigger_type_code = 'ukvi-cas'
    `) as Array<{ status_code: string; sent_at: string | Date | null }>;
    expect(triggerRows).toEqual([
      expect.objectContaining({ status_code: 'processed', sent_at: expect.anything() }),
    ]);
    expect(events.find((e) => e.type === 'srs.regulatory.ukvi-cas-requested')).toMatchObject({
      classification: 'sensitive',
    });

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/cas-requests/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ processedCount: number }>().processedCount).toBe(0);
  });

  it('records CAS assignment as a bitemporal update', async () => {
    const fixture = await createUkviEnrolment('Cas', 'Assign');
    const casRequestId = await generateCasRequestFor(fixture.enrolmentId);

    const assigned = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ukvi/cas-requests/${casRequestId}/assignment`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { casReference: 'CAS-ASSIGN-001' },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json<{ statusCode: string; casReference: string }>())
      .toMatchObject({ statusCode: 'assigned', casReference: 'CAS-ASSIGN-001' });

    const versions = await ctx.db.execute(sql`
      SELECT status_code, cas_reference, recorded_until
      FROM ukvi_cas_request
      WHERE tenant_id = ${ctx.tenantId}
        AND id = ${casRequestId}
      ORDER BY recorded_at ASC
    `) as Array<{ status_code: string; cas_reference: string | null; recorded_until: string | Date | null }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ status_code: 'pending', cas_reference: null, recorded_until: expect.anything() });
    expect(versions[1]).toMatchObject({ status_code: 'assigned', cas_reference: 'CAS-ASSIGN-001', recorded_until: null });
    expect(events.find((e) => e.type === 'srs.regulatory.ukvi-cas-assigned')).toMatchObject({
      classification: 'sensitive',
    });
  });

  it('blocks the retired direct attendance-report path', async () => {
    const fixture = await createUkviEnrolment('Attendance', 'Report');
    const casRequestId = await generateCasRequestFor(fixture.enrolmentId);
    await assignCas(casRequestId, 'CAS-ATTEND-001');
    const academicPeriodId = await createAcademicPeriod('UKVI-ATTEND');

    const report = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/attendance-reports/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicPeriodId },
    });
    expect(report.statusCode).toBe(422);
    expect(report.json<{ detail: string }>().detail).toContain('independent authorisation');
    expect(events.find((e) => e.type === 'srs.regulatory.ukvi-attendance-submitted')).toBeUndefined();
  });

  it('records curtailed visa updates and raises a compliance alert', async () => {
    const fixture = await createUkviEnrolment('Visa', 'Curtail');
    const casRequestId = await generateCasRequestFor(fixture.enrolmentId);
    await assignCas(casRequestId, 'CAS-VISA-001');

    const update = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/visa-updates',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        casReference: 'CAS-VISA-001',
        statusCode: 'curtailed',
        effectiveDate: '2028-02-01',
        rawPayload: { reason: 'sponsor notification' },
      },
    });
    expect(update.statusCode).toBe(201);
    expect(update.json<{ visaStatusId: string; alertId: string | null }>().alertId).toMatch(/^[0-9a-f-]{36}$/);

    const alerts = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ukvi/compliance-alerts?unresolvedOnly=true',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.json<Array<{ enrolmentId: string; alertTypeCode: string; casReference: string }>>()).toContainEqual(
      expect.objectContaining({
        enrolmentId: fixture.enrolmentId,
        alertTypeCode: 'visa-curtailed',
        casReference: 'CAS-VISA-001',
      }),
    );
    expect(events.find((e) => e.type === 'srs.regulatory.ukvi-visa-status-updated')).toMatchObject({
      classification: 'sensitive',
    });
    expect(events.find((e) => e.type === 'srs.regulatory.ukvi-compliance-alert-raised')).toMatchObject({
      classification: 'sensitive',
    });
  });

  it('evaluates threshold breaches once and does not re-raise a resolved same-period breach', async () => {
    const fixture = await createUkviEnrolment('Alert', 'Threshold');
    const casRequestId = await generateCasRequestFor(fixture.enrolmentId);
    await assignCas(casRequestId, 'CAS-ALERT-001');
    const academicPeriodId = await createAcademicPeriod('UKVI-ALERT');
    await insertAttendanceReport(academicPeriodId, {
      academicPeriodId,
      generatedAt: new Date().toISOString(),
      studentCount: 1,
      threshold: { unauthorisedAbsencesPerEightWeeks: 10 },
      _attendance_data_completeness: 'provided',
      students: [
        {
          enrolmentId: fixture.enrolmentId,
          casReference: 'CAS-ALERT-001',
          absenceCount: 11,
        },
      ],
    });

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/compliance-alerts/evaluate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ alertsRaised: number }>().alertsRaised).toBe(1);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/compliance-alerts/evaluate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ alertsRaised: number }>().alertsRaised).toBe(0);

    const alertId = (await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ukvi/compliance-alerts?unresolvedOnly=true',
      headers: { authorization: `Bearer ${jwt}` },
    })).json<Array<{ alertId: string; enrolmentId: string }>>()
      .find((alert) => alert.enrolmentId === fixture.enrolmentId)!.alertId;

    const resolve = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ukvi/compliance-alerts/${alertId}/resolve`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(resolve.statusCode).toBe(204);

    const afterResolve = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/compliance-alerts/evaluate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(afterResolve.statusCode).toBe(200);
    expect(afterResolve.json<{ alertsRaised: number }>().alertsRaised).toBe(0);
  });

  it('creates an immutable sponsor evidence snapshot only from a compliance referral', async () => {
    const fixture = await createUkviEnrolment('Evidence', 'Snapshot');
    const alertId = await createSponsorReferral(fixture, false);

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/engagement-evidence-snapshots',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { engagementAlertId: alertId },
    });
    expect(first.statusCode, first.body).toBe(201);
    const snapshot = first.json<{
      snapshotId: string;
      evidenceQualityCode: string;
      evidenceHash: string;
    }>();
    expect(snapshot).toMatchObject({
      evidenceQualityCode: 'verified',
      evidenceHash: 'verified-engagement-hash',
    });

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/engagement-evidence-snapshots',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { engagementAlertId: alertId },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ snapshotId: string }>().snapshotId).toBe(snapshot.snapshotId);

    await expect(ctx.db.execute(sql`
      UPDATE ukvi_engagement_evidence_snapshot
      SET evidence_quality_code = 'reconciliation-required'
      WHERE id = ${snapshot.snapshotId}
    `)).rejects.toThrow(/append-only/);
  });

  it('requires separate human authorisation before producing a sponsor report', async () => {
    const fixture = await createUkviEnrolment('Sponsor', 'Decision');
    await createAcademicPeriod(`UKVI-G-${randomUUID().slice(0, 8)}`);
    const alertId = await createSponsorReferral(fixture, false);
    const snapshotResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/engagement-evidence-snapshots',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { engagementAlertId: alertId },
    });
    const snapshotId = snapshotResponse.json<{ snapshotId: string }>().snapshotId;
    const decisionResponse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/sponsor-decisions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        evidenceSnapshotId: snapshotId,
        outcomeCode: 'report',
        rationaleCode: 'sustained-non-engagement',
        guidanceVersion: 'student-sponsor-guidance-2027.1',
      },
    });
    expect(decisionResponse.statusCode).toBe(201);
    const decision = decisionResponse.json<{ decisionId: string; statusCode: string }>();
    expect(decision.statusCode).toBe('pending-authorisation');

    const selfAuthorisation = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ukvi/sponsor-decisions/${decision.decisionId}/authorise`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(selfAuthorisation.statusCode).toBe(422);

    const authoriserJwt = await ctx.makeJwt({ sub: 'independent-authoriser' });
    const authorised = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ukvi/sponsor-decisions/${decision.decisionId}/authorise`,
      headers: { authorization: `Bearer ${authoriserJwt}` },
    });
    expect(authorised.statusCode).toBe(200);
    expect(authorised.json<{
      statusCode: string;
      authorisedBy: string;
      externalReportId: string;
    }>()).toMatchObject({
      statusCode: 'authorised',
      authorisedBy: 'independent-authoriser',
      externalReportId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(events.find((event) => event.type === 'srs.regulatory.ukvi-attendance-submitted'))
      .toMatchObject({ classification: 'regulatory' });
  });

  it('blocks report/no-report decisions while engagement evidence needs reconciliation', async () => {
    const fixture = await createUkviEnrolment('Disputed', 'Evidence');
    const alertId = await createSponsorReferral(fixture, true);
    const snapshot = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/engagement-evidence-snapshots',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { engagementAlertId: alertId },
    });
    const snapshotId = snapshot.json<{ snapshotId: string }>().snapshotId;
    const decision = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/sponsor-decisions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        evidenceSnapshotId: snapshotId,
        outcomeCode: 'no-report',
        rationaleCode: 'evidence-disputed',
        guidanceVersion: 'student-sponsor-guidance-2027.1',
      },
    });
    expect(decision.statusCode).toBe(422);

    const status = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ukvi/operations/status',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ reconciliationRequired: number }>().reconciliationRequired)
      .toBeGreaterThanOrEqual(1);
  });

  it('does not expose UKVI CAS requests across tenants', async () => {
    const fixture = await createUkviEnrolment('Tenant', 'Isolation');
    await generateCasRequestFor(fixture.enrolmentId);
    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ukvi/cas-requests',
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Array<{ enrolmentId: string }>>()).not.toContainEqual(
      expect.objectContaining({ enrolmentId: fixture.enrolmentId }),
    );
  });
});

async function createPerson(legalFirstName: string, legalFamilyName: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>().personId;
}

async function createUkviEnrolment(
  legalFirstName: string,
  legalFamilyName: string,
): Promise<{ personId: string; enrolmentId: string }> {
  const personId = await createPerson(legalFirstName, legalFamilyName);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'international-undergraduate',
      ukviCasRequired: true,
    },
  });
  expect(res.statusCode).toBe(201);
  return { personId, enrolmentId: res.json<{ enrolmentId: string }>().enrolmentId };
}

async function generateCasRequestFor(enrolmentId: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/regulatory/ukvi/cas-requests/generate',
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ casRequests: Array<{ casRequestId: string; enrolmentId: string }> }>();
  return body.casRequests.find((request) => request.enrolmentId === enrolmentId)!.casRequestId;
}

async function assignCas(casRequestId: string, casReference: string): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/regulatory/ukvi/cas-requests/${casRequestId}/assignment`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: { casReference },
  });
  expect(res.statusCode).toBe(200);
}

async function createAcademicPeriod(periodCode: string): Promise<string> {
  const academicPeriodId = randomUUID();
  await ctx.db.execute(sql`
    INSERT INTO academic_period (id, tenant_id, academic_year, period_code, period_type_code, start_date, end_date)
    VALUES (${academicPeriodId}, ${ctx.tenantId}, '2027-28', ${periodCode}, 'term', '2027-09-20', '2027-12-15')
  `);
  return academicPeriodId;
}

async function insertAttendanceReport(academicPeriodId: string, payload: Record<string, unknown>): Promise<void> {
  await ctx.db.execute(sql`
    INSERT INTO ukvi_attendance_report (id, tenant_id, academic_period_id, submitted_at, report_payload, submitted_by)
    VALUES (${randomUUID()}, ${ctx.tenantId}, ${academicPeriodId}, NOW(), ${JSON.stringify(payload)}::jsonb, 'test-user')
  `);
}

/**
 * Simulates the attendance module's outcome handoff (POST
 * /students/:personId/engagement-outcomes, outcomeCode
 * 'referred-sponsor-compliance') that occurs when the module refers an
 * engagement case for sponsor-compliance review. The module's own
 * alert/case/referral tables live in its own schema (modules/attendance)
 * since the Stage 1 extraction — core only ever sees this outcome row.
 */
async function createSponsorReferral(
  fixture: { personId: string; enrolmentId: string },
  reevaluationRequired: boolean,
): Promise<string> {
  const alertId = randomUUID();
  await ctx.db.execute(sql`
    INSERT INTO engagement_outcome (
      version_id, id, tenant_id, person_id, enrolment_id, outcome_code, source_alert_id,
      source_module, actor_id, valid_from, recorded_at,
      policy_version_id, evidence_window_from, evidence_window_to,
      evidence_snapshot, evidence_hash, reevaluation_required
    ) VALUES (
      ${randomUUID()}, ${randomUUID()}, ${ctx.tenantId}, ${fixture.personId}, ${fixture.enrolmentId},
      'referred-sponsor-compliance', ${alertId}, 'attendance', 'engagement-officer', NOW(), NOW(),
      ${randomUUID()}, '2027-09-20', '2027-10-20',
      '{"expectedCount": 12, "attendedCount": 1, "absentCount": 11}',
      ${reevaluationRequired ? 'disputed-engagement-hash' : 'verified-engagement-hash'},
      ${reevaluationRequired}
    )
  `);
  return alertId;
}
