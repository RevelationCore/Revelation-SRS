/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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

describe('SLC exchange', () => {
  it('generates SLC confirmations from pending triggers and is idempotent', async () => {
    const fixture = await createSlcEnrolment('SLC-CONF-001');

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ processedCount: number; payload: { confirmations: Array<{ enrolmentId: string; slcReference: string }> } }>();
    expect(body.processedCount).toBeGreaterThanOrEqual(1);
    expect(body.payload.confirmations).toContainEqual(
      expect.objectContaining({ enrolmentId: fixture.enrolmentId, slcReference: 'SLC-CONF-001' }),
    );

    const triggerRows = await ctx.db.execute(sql`
      SELECT status_code, sent_at
      FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId}
        AND enrolment_id = ${fixture.enrolmentId}
        AND trigger_type_code = 'slc-confirmation'
    `) as Array<{ status_code: string; sent_at: string | Date | null }>;
    expect(triggerRows).toEqual([
      expect.objectContaining({ status_code: 'processed', sent_at: expect.anything() }),
    ]);
    expect(events.find((e) => e.type === 'srs.regulatory.slc-confirmation-sent')).toMatchObject({
      classification: 'sensitive',
    });

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ processedCount: number }>().processedCount).toBe(0);
  });

  it('generates status-change notifications and rejects missing SLC references', async () => {
    const fixture = await createSlcEnrolment('SLC-STAT-001');
    const withdraw = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/withdraw`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reasonCode: 'student-request' },
    });
    expect(withdraw.statusCode).toBe(204);

    const notification = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/slc-status-notification`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(notification.statusCode).toBe(200);
    expect(notification.json<{ confirmationType: string; slcReference: string }>())
      .toMatchObject({ confirmationType: 'withdrawal', slcReference: 'SLC-STAT-001' });

    const noRef = await createEnrolment(await createPerson('No', 'Reference'), {});
    const missing = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/enrolments/${noRef}/slc-status-notification`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(missing.statusCode).toBe(422);
  });

  it('records inbound notifications, including negative overpayment amounts', async () => {
    const fixture = await createSlcEnrolment('SLC-IN-001');

    const inbound = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/notifications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        notificationTypeCode: 'overpayment-notified',
        effectiveDate: '2027-11-01',
        amount: '-150.25',
        notificationId: 'SLC-NOT-001',
      },
    });
    expect(inbound.statusCode).toBe(201);
    const notificationId = inbound.json<{ notificationId: string }>().notificationId;
    expect(notificationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.find((e) => e.type === 'srs.regulatory.slc-notification-received')).toMatchObject({
      classification: 'sensitive',
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/slc-notifications`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ notificationTypeCode: string; amount: string | null }>>()).toContainEqual(
      expect.objectContaining({ notificationTypeCode: 'overpayment-notified', amount: '-150.25' }),
    );
  });

  it('does not expose SLC notifications across tenants', async () => {
    const fixture = await createSlcEnrolment('SLC-TENANT-001');
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/notifications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enrolmentId: fixture.enrolmentId,
        notificationTypeCode: 'payment-received',
        effectiveDate: '2027-11-01',
        amount: '100.00',
      },
    });

    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/enrolments/${fixture.enrolmentId}/slc-notifications`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('SLC confirmation submission approval workflow', () => {
  it('approving a submission request submits exactly the previewed batch', async () => {
    const fixture = await createSlcEnrolment('SLC-WF-001');

    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId, recordCount } = request.json<{ workflowInstanceId: string; recordCount: number }>();
    expect(recordCount).toBeGreaterThanOrEqual(1);

    const pending = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/slc/confirmations/requests',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<Array<{ workflowInstanceId: string }>>().some(r => r.workflowInstanceId === workflowInstanceId)).toBe(true);

    // Another trigger arrives after the request snapshot was taken — it must
    // not be swept up in this approval.
    const later = await createSlcEnrolment('SLC-WF-002');

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/slc/confirmations/requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<{ processedCount: number }>().processedCount).toBe(recordCount);

    const triggerRows = await ctx.db.execute(sql`
      SELECT status_code FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId} AND enrolment_id = ${fixture.enrolmentId} AND trigger_type_code = 'slc-confirmation'
    `) as Array<{ status_code: string }>;
    expect(triggerRows[0]?.status_code).toBe('processed');

    // The later-arriving trigger was not part of the approved batch, so it's
    // still pending.
    const laterTriggerRows = await ctx.db.execute(sql`
      SELECT status_code FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId} AND enrolment_id = ${later.enrolmentId} AND trigger_type_code = 'slc-confirmation'
    `) as Array<{ status_code: string }>;
    expect(laterTriggerRows[0]?.status_code).toBe('pending');
  });

  it('a rejected request does not submit anything, and cannot be decided twice', async () => {
    await createSlcEnrolment('SLC-WF-003');

    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/slc/confirmations/requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'rejected', reason: 'Awaiting revised data' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<{ processedCount: number }>().processedCount).toBe(0);

    const secondDecide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/slc/confirmations/requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(secondDecide.statusCode).toBe(422);
  });

  it('rejects a submission request when a role lacking regulatory:decide tries to decide it', async () => {
    await createSlcEnrolment('SLC-WF-004');
    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/slc/confirmations/requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(403);
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

async function createSlcEnrolment(slcReference: string): Promise<{ personId: string; enrolmentId: string }> {
  const personId = await createPerson('Slc', slcReference.slice(-3));
  const enrolmentId = await createEnrolment(personId, { slcReference, fundingSourceCode: 'slc' });
  return { personId, enrolmentId };
}

async function createEnrolment(
  personId: string,
  overrides: { slcReference?: string; fundingSourceCode?: string },
): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'home-undergraduate',
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}
