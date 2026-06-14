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

describe('UCAS application ingest', () => {
  it('starts an Admissions workflow handoff for confirmed applications', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/applications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: confirmedPayload('9000000001'),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ applicationId: string; linkedEnrolmentId: string | null }>();
    expect(body.applicationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.linkedEnrolmentId).toBeNull();

    const handoffRows = await ctx.db.execute(sql`
      SELECT wi.workflow_code, wi.subject_entity_type, wi.subject_entity_id, wt.step_key, wt.assignee_role_code
      FROM workflow_instance wi
      JOIN workflow_task wt ON wt.workflow_instance_id = wi.id
      WHERE wi.tenant_id = ${ctx.tenantId}
        AND wi.subject_entity_type = 'ucas_application'
        AND wi.subject_entity_id = ${body.applicationId}
    `) as Array<{
      workflow_code: string;
      subject_entity_type: string;
      subject_entity_id: string;
      step_key: string;
      assignee_role_code: string | null;
    }>;
    expect(handoffRows).toEqual([
      expect.objectContaining({
        workflow_code: 'admissions-ucas-domestic',
        subject_entity_type: 'ucas_application',
        subject_entity_id: body.applicationId,
        step_key: 'handoff-to-srs-enrolment',
        assignee_role_code: 'registry-administrator',
      }),
    ]);

    const appEvent = events.find((e) => e.type === 'srs.regulatory.ucas-application-received');
    expect(appEvent).toBeDefined();
    expect(appEvent!.classification).toBe('personal');
    expect(appEvent!.payload).toMatchObject({
      applicationId: body.applicationId,
      ucasPersonalId: '9000000001',
      cycle: '2027',
      statusCode: 'confirmed',
    });
  });

  it('stages clearing applications without auto-creating an enrolment', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/applications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        ...confirmedPayload('9000000002'),
        statusCode: 'clearing',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<{ linkedEnrolmentId: string | null }>().linkedEnrolmentId).toBeNull();

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ucas/applications?statusCode=clearing',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ ucasPersonalId: string; linkedEnrolmentId: string | null }>>()).toContainEqual(
      expect.objectContaining({ ucasPersonalId: '9000000002', linkedEnrolmentId: null }),
    );
  });

  it('can manually link a staged application to an enrolment', async () => {
    const person = await createPerson('Manual', 'Link');
    const enrolmentId = await createEnrolment(person.personId, { ucasPersonalId: '9000000003' });

    const ingest = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/applications',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        ...confirmedPayload('9000000003'),
        statusCode: 'clearing',
      },
    });
    const applicationId = ingest.json<{ applicationId: string }>().applicationId;

    const link = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ucas/applications/${applicationId}/link`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId },
    });
    expect(link.statusCode).toBe(204);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ucas/applications?cycle=2027',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.json<Array<{ applicationId: string; linkedEnrolmentId: string | null }>>()).toContainEqual(
      expect.objectContaining({ applicationId, linkedEnrolmentId: enrolmentId }),
    );
  });

  it('does not expose applications across tenants', async () => {
    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ucas/applications',
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toEqual([]);
  });
});

describe('UCAS outbound confirmations', () => {
  it('processes pending UCAS triggers and is idempotent on a second call', async () => {
    const person = await createPerson('Trigger', 'Student');
    const enrolmentId = await createEnrolment(person.personId, { ucasPersonalId: '9000000004' });

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { cycle: '2027' },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ processedCount: number; payload: { confirmations: Array<{ enrolmentId: string; ucasPersonalId: string }> } }>();
    expect(body.processedCount).toBeGreaterThanOrEqual(1);
    expect(body.payload.confirmations).toContainEqual(
      expect.objectContaining({ enrolmentId, ucasPersonalId: '9000000004' }),
    );

    const triggerRows = await ctx.db.execute(sql`
      SELECT status_code, sent_at
      FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId}
        AND enrolment_id = ${enrolmentId}
        AND trigger_type_code = 'ucas-confirmation'
    `) as Array<{ status_code: string; sent_at: string | Date | null }>;
    expect(triggerRows).toEqual([
      expect.objectContaining({ status_code: 'processed', sent_at: expect.anything() }),
    ]);

    const confirmationEvent = events.find((e) => e.type === 'srs.regulatory.ucas-confirmation-sent');
    expect(confirmationEvent).toBeDefined();
    expect(confirmationEvent!.classification).toBe('personal');

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { cycle: '2027' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ processedCount: number }>().processedCount).toBe(0);
  });
});

function confirmedPayload(ucasPersonalId: string) {
  return {
    ucasPersonalId,
    cycle: '2027',
    statusCode: 'confirmed',
    applicant: {
      givenNames: 'Amara',
      familyName: 'Singh',
      dateOfBirth: '2008-04-12',
      email: `${ucasPersonalId}@example.test`,
    },
    enrolment: {
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'home-undergraduate',
    },
  };
}

async function createPerson(legalFirstName: string, legalFamilyName: string): Promise<{ personId: string }> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName, legalFamilyName },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ personId: string }>();
}

async function createEnrolment(
  personId: string,
  overrides: { ucasPersonalId?: string } = {},
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
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ enrolmentId: string }>().enrolmentId;
}
