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

  it('generates attendance reports for active sponsored students', async () => {
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
    expect(report.statusCode).toBe(200);
    const body = report.json<{ reportId: string; payload: { studentCount: number; students: Array<{ enrolmentId: string; casReference: string | null }> } }>();
    expect(body.reportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.payload.studentCount).toBeGreaterThanOrEqual(1);
    expect(body.payload.students).toContainEqual(
      expect.objectContaining({ enrolmentId: fixture.enrolmentId, casReference: 'CAS-ATTEND-001' }),
    );
    expect(events.find((e) => e.type === 'srs.regulatory.ukvi-attendance-submitted')).toMatchObject({
      classification: 'regulatory',
    });
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
