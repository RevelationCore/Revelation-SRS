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
  integrationJwt = await ctx.makeJwt({ roles: ['tenant-administrator'] });
}, 120_000);

beforeEach(() => {
  capturedEvents.length = 0;
});

afterAll(async () => {
  await ctx?.teardown();
});

describe('Reasonable adjustments', () => {
  it('records an adjustment, creates distribution rows, and publishes approval', async () => {
    const fixture = await createAdjustmentFixture('ADJ101');

    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'all',
      validFrom: '2027-09-01T00:00:00.000Z',
      validTo: '2028-01-31T00:00:00.000Z',
      notes: '25 percent extra time',
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ adjustmentId: string; adjustmentTypeCode: string; scopeCode: string }>>())
      .toContainEqual(expect.objectContaining({
        adjustmentId: adjustment.adjustmentId,
        adjustmentTypeCode: 'extra-time',
        scopeCode: 'all',
      }));

    const distributions = await listDistributions(adjustment.adjustmentId);
    expect(distributions.statusCode).toBe(200);
    expect(distributions.json<Array<{ targetSystem: string; statusCode: string }>>())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ targetSystem: 'attendance', statusCode: 'pending' }),
        expect.objectContaining({ targetSystem: 'exams', statusCode: 'pending' }),
        expect.objectContaining({ targetSystem: 'vle', statusCode: 'pending' }),
      ]));

    const approved = capturedEvents.find((event) => event.type === 'srs.adjustment.approved');
    expect(approved).toBeDefined();
    expect(approved?.classification).toBe('sensitive');
    expect(approved?.payload).toMatchObject({
      adjustmentId: adjustment.adjustmentId,
      enrolmentId: fixture.enrolmentId,
      personId: fixture.personId,
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'all',
    });
  });

  it('acknowledges distribution and publishes distributed event', async () => {
    const fixture = await createAdjustmentFixture('ADJ102');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'deadline-extension',
      scopeCode: 'coursework',
      validFrom: '2027-09-01T00:00:00.000Z',
    });
    const distributions = await listDistributions(adjustment.adjustmentId);
    const distribution = distributions.json<Array<{ distributionId: string; targetSystem: string }>>()[0]!;

    const ack = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/adjustments/${adjustment.adjustmentId}/distributions/${distribution.distributionId}/acknowledge`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: { targetSystem: distribution.targetSystem },
    });
    expect(ack.statusCode).toBe(204);

    const after = await listDistributions(adjustment.adjustmentId);
    expect(after.json<Array<{ distributionId: string; statusCode: string; distributedAt: string | null }>>())
      .toContainEqual(expect.objectContaining({
        distributionId: distribution.distributionId,
        statusCode: 'distributed',
        distributedAt: expect.any(String) as string,
      }));

    const distributed = capturedEvents.find((event) => event.type === 'srs.adjustment.distributed');
    expect(distributed).toBeDefined();
    expect(distributed?.classification).toBe('sensitive');
    expect(distributed?.payload).toMatchObject({
      adjustmentId: adjustment.adjustmentId,
      distributionId: distribution.distributionId,
      targetSystem: distribution.targetSystem,
    });
  });

  it('expires the current adjustment version and supersedes pending distributions', async () => {
    const fixture = await createAdjustmentFixture('ADJ103');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'all',
      validFrom: '2027-09-01T00:00:00.000Z',
    });
    const distributions = await listDistributions(adjustment.adjustmentId);
    const acknowledged = distributions
      .json<Array<{ distributionId: string; targetSystem: string }>>()
      .find((row) => row.targetSystem === 'vle')!;

    const ack = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/adjustments/${adjustment.adjustmentId}/distributions/${acknowledged.distributionId}/acknowledge`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: { targetSystem: acknowledged.targetSystem },
    });
    expect(ack.statusCode).toBe(204);

    const expire = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/adjustments/${adjustment.adjustmentId}/expire`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(expire.statusCode).toBe(204);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.json<Array<{ adjustmentId: string }>>())
      .not.toContainEqual(expect.objectContaining({ adjustmentId: adjustment.adjustmentId }));

    const after = await listDistributions(adjustment.adjustmentId);
    const statuses = after.json<Array<{ targetSystem: string; statusCode: string }>>();
    expect(statuses).toContainEqual(expect.objectContaining({ targetSystem: 'vle', statusCode: 'distributed' }));
    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetSystem: 'attendance', statusCode: 'superseded' }),
      expect.objectContaining({ targetSystem: 'exams', statusCode: 'superseded' }),
    ]));

    const expired = capturedEvents.find((event) => event.type === 'srs.adjustment.expired');
    expect(expired).toBeDefined();
    expect(expired?.classification).toBe('sensitive');
    expect(expired?.payload).toMatchObject({
      adjustmentId: adjustment.adjustmentId,
      enrolmentId: fixture.enrolmentId,
      personId: fixture.personId,
    });
  });

  it('does not expose adjustments through another tenant', async () => {
    const fixture = await createAdjustmentFixture('ADJ104');
    await createAdjustment(fixture, {
      adjustmentTypeCode: 'reader',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
    });
    const otherTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${otherTenantJwt}` },
    });
    expect(list.statusCode).toBe(404);
  });
});

interface AdjustmentFixture {
  personId: string;
  enrolmentId: string;
}

async function createAdjustmentFixture(code: string): Promise<AdjustmentFixture> {
  const student = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { legalFirstName: code, legalFamilyName: 'Adjustment' },
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

async function createAdjustment(
  fixture: AdjustmentFixture,
  payload: {
    adjustmentTypeCode: string;
    scopeCode: string;
    validFrom: string;
    validTo?: string;
    notes?: string;
  },
): Promise<{ adjustmentId: string }> {
  const adjustment = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/students/${fixture.personId}/adjustments`,
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      enrolmentId: fixture.enrolmentId,
      ...payload,
    },
  });
  expect(adjustment.statusCode).toBe(201);
  return adjustment.json<{ adjustmentId: string }>();
}

async function listDistributions(adjustmentId: string) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/adjustments/${adjustmentId}/distributions`,
    headers: { authorization: `Bearer ${jwt}` },
  });
}
