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

describe('Regulatory downstream trigger processing', () => {
  it('drains UCAS, SLC, and UKVI pending triggers into processed exchanges', async () => {
    const personId = await createPerson();
    const enrolment = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/enrolments',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        personId,
        modeOfStudyCode: 'full-time',
        academicYearOfEntry: '2027-28',
        startDate: '2027-09-20',
        ucasPersonalId: 'TRIG-UCAS-001',
        fundingSourceCode: 'slc',
        slcReference: 'TRIG-SLC-001',
        ukviCasRequired: true,
      },
    });
    expect(enrolment.statusCode).toBe(201);
    const enrolmentId = enrolment.json<{ enrolmentId: string }>().enrolmentId;

    const before = await ctx.db.execute(sql`
      SELECT trigger_type_code, status_code, sent_at
      FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId}
        AND enrolment_id = ${enrolmentId}
      ORDER BY trigger_type_code
    `) as Array<{ trigger_type_code: string; status_code: string; sent_at: string | Date | null }>;
    expect(before.map((row) => row.trigger_type_code)).toEqual(['slc-confirmation', 'ucas-confirmation', 'ukvi-cas']);
    expect(before.every((row) => row.status_code === 'pending' && row.sent_at === null)).toBe(true);

    const ucas = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ucas/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { cycle: '2027' },
    });
    expect(ucas.statusCode).toBe(200);

    const slc = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/slc/confirmations/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(slc.statusCode).toBe(200);

    const ukvi = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ukvi/cas-requests/generate',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(ukvi.statusCode).toBe(200);

    const after = await ctx.db.execute(sql`
      SELECT trigger_type_code, status_code, sent_at
      FROM enrolment_downstream_trigger
      WHERE tenant_id = ${ctx.tenantId}
        AND enrolment_id = ${enrolmentId}
      ORDER BY trigger_type_code
    `) as Array<{ trigger_type_code: string; status_code: string; sent_at: string | Date | null }>;
    expect(after).toHaveLength(3);
    expect(after.every((row) => row.status_code === 'processed' && row.sent_at !== null)).toBe(true);

    const exchanges = await ctx.db.execute(sql`
      SELECT exchange_type_code, idempotency_key
      FROM integration_exchange
      WHERE tenant_id = ${ctx.tenantId}
        AND exchange_type_code IN ('ucas-confirmation', 'slc-confirmation', 'ukvi-cas-request')
      ORDER BY exchange_type_code
    `) as Array<{ exchange_type_code: string; idempotency_key: string }>;
    expect(exchanges.map((row) => row.exchange_type_code)).toEqual([
      'slc-confirmation',
      'ucas-confirmation',
      'ukvi-cas-request',
    ]);
    expect(exchanges.every((row) => row.idempotency_key.includes(':'))).toBe(true);

    expect(events.some((event) => event.type === 'srs.regulatory.ucas-confirmation-sent')).toBe(true);
    expect(events.some((event) => event.type === 'srs.regulatory.slc-confirmation-sent')).toBe(true);
    expect(events.some((event) => event.type === 'srs.regulatory.ukvi-cas-requested')).toBe(true);
  });
});

async function createPerson(): Promise<string> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: 'Trigger', legalFamilyName: 'Processing' },
  });
  expect(student.statusCode).toBe(201);
  return student.json<{ personId: string }>().personId;
}
