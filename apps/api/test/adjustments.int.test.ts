import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IntegrationBusPublisher } from '../src/platform/integration-bus/publisher.js';

import { wellbeingServiceJwt, withdrawApprovedAdjustment } from './helpers/adjustments.js';
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
  it('stores and returns sourceCaseId when the wellbeing module handoff supplies one', async () => {
    const fixture = await createAdjustmentFixture('ADJ102');
    const sourceCaseId = '11111111-2222-3333-4444-555555555555';

    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
      sourceCaseId,
    });

    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.json<Array<{ adjustmentId: string; sourceCaseId: string | null }>>())
      .toContainEqual(expect.objectContaining({ adjustmentId: adjustment.adjustmentId, sourceCaseId }));
  });

  it('refuses a staff member recording a core adjustment directly (ADR-033)', async () => {
    const fixture = await createAdjustmentFixture('ADJ103');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { enrolmentId: fixture.enrolmentId, adjustmentTypeCode: 'deadline-extension', scopeCode: 'coursework', validFrom: '2027-09-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(403);
    const get = await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${fixture.personId}/adjustments`, headers: { authorization: `Bearer ${jwt}` } });
    expect(get.json<unknown[]>()).toEqual([]);
  });

  it('refuses free-text notes and records nothing (BL-243)', async () => {
    const fixture = await createAdjustmentFixture('ADJ105N');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${await wellbeingServiceJwt(ctx)}` },
      payload: {
        sourceCaseId: randomUUID(), enrolmentId: fixture.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'all',
        validFrom: '2027-09-01T00:00:00.000Z', notes: 'Diagnosis detail',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/notes is not accepted/);
    const get = await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${fixture.personId}/adjustments`, headers: { authorization: `Bearer ${jwt}` } });
    expect(get.json<unknown[]>()).toEqual([]);
  });

  it('records the wellbeing case as the provenance (ADR-033)', async () => {
    const fixture = await createAdjustmentFixture('ADJ104P');
    const { adjustmentId } = await createAdjustment(fixture, { adjustmentTypeCode: 'separate-room', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' });
    const get = await ctx.app.inject({ method: 'GET', url: `/api/v1/adjustments/${adjustmentId}`, headers: { authorization: `Bearer ${jwt}` } });
    expect(get.json<{ provenanceCode: string; sourceCaseId: string | null; manualProposalId: string | null }>()).toMatchObject({ provenanceCode: 'wellbeing-case', manualProposalId: null });
    expect(get.json<{ sourceCaseId: string | null }>().sourceCaseId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('attaches an outcome document and can retrieve it byte-for-byte', async () => {
    const fixture = await createAdjustmentFixture('ADJ104');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z',
    });

    const content = 'Detailed adjustment specification: laptop with screen-reader software, separate room, 25% extra time.';
    const { body, contentType } = buildMultipartBody('outcome-spec.pdf', content);

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${jwt}`, 'content-type': contentType },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(201);
    const { documentId, checksumSha256 } = uploadRes.json<{ documentId: string; checksumSha256: string }>();
    expect(documentId).toBeTruthy();
    expect(checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    const downloadRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.body).toBe(content);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(listRes.json<Array<{ adjustmentId: string; outcomeDocumentId: string | null }>>())
      .toContainEqual(expect.objectContaining({ adjustmentId: adjustment.adjustmentId, outcomeDocumentId: documentId }));
  });

  it('the owning student can download their own outcome document; another student cannot', async () => {
    const fixture = await createAdjustmentFixture('ADJ105');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z',
    });

    const { body, contentType } = buildMultipartBody('outcome-spec.pdf', 'self-service outcome detail');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${jwt}`, 'content-type': contentType },
      payload: body,
    });

    const ownStudentJwt   = await ctx.makeJwt({ roles: ['student'], srsPersonId: fixture.personId });
    const otherStudentJwt = await ctx.makeJwt({ roles: ['student'], srsPersonId: 'not-this-student' });

    const ownRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${ownStudentJwt}` },
    });
    expect(ownRes.statusCode).toBe(200);

    const otherRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${otherStudentJwt}` },
    });
    expect(otherRes.statusCode).toBe(403);
  });

  it('returns 404 for an adjustment with no outcome document attached', async () => {
    const fixture = await createAdjustmentFixture('ADJ106');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a student who is not the owner cannot attach an outcome document (adjustment:write required)', async () => {
    const fixture = await createAdjustmentFixture('ADJ107');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time', scopeCode: 'all', validFrom: '2027-09-01T00:00:00.000Z',
    });
    const ownStudentJwt = await ctx.makeJwt({ roles: ['student'], srsPersonId: fixture.personId });

    const { body, contentType } = buildMultipartBody('outcome-spec.pdf', 'should not be allowed');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments/${adjustment.adjustmentId}/outcome-document`,
      headers: { authorization: `Bearer ${ownStudentJwt}`, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('records an adjustment, creates distribution rows, and publishes approval', async () => {
    const fixture = await createAdjustmentFixture('ADJ101');

    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'all',
      validFrom: '2027-09-01T00:00:00.000Z',
      validTo: '2028-01-31T00:00:00.000Z',
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

  it('expires the adjustment as a new version ending its valid period, and requests withdrawal from every instructed target', async () => {
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

    const expire = await withdrawApprovedAdjustment(ctx, adjustment.adjustmentId);
    expect(expire.statusCode).toBe(200);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    // Still visible, now with an end date: expiry ends the valid period, it
    // does not erase the adjustment from the record.
    const listed = list.json<Array<{ adjustmentId: string; validTo: string | null }>>()
      .find((row) => row.adjustmentId === adjustment.adjustmentId);
    expect(listed).toBeDefined();
    expect(listed?.validTo).not.toBeNull();

    const after = await listDistributions(adjustment.adjustmentId);
    const statuses = after.json<Array<{ targetSystem: string; statusCode: string }>>();
    // Every target was instructed when the adjustment was recorded (the spy
    // bus is connected), so each may have applied it — acknowledged or not —
    // and each is told to remove it. Never-sent instructions are superseded
    // instead; see adjustment-distribution-instructions.int.test.ts.
    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetSystem: 'vle', statusCode: 'withdrawal-requested' }),
      expect.objectContaining({ targetSystem: 'attendance', statusCode: 'withdrawal-requested' }),
      // The SRS is the exams target and completes its own withdrawal.
      expect.objectContaining({ targetSystem: 'exams', statusCode: 'withdrawn' }),
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

describe('AJ-21 A21-AC04 — a lost response or repeated acknowledgement creates no duplicate', () => {
  it('a retry with the same idempotency key and payload returns the original adjustment', async () => {
    const fixture = await createAdjustmentFixture('ADJ201');
    const payload = {
      sourceCaseId: '9a1b2c3d-0000-4000-8000-000000000201',
      enrolmentId: fixture.enrolmentId,
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
      validTo: '2028-07-31T00:00:00.000Z',
    };
    const send = async () => ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${await wellbeingServiceJwt(ctx)}`, 'x-idempotency-key': 'handoff-ADJ201' },
      payload,
    });

    const first = await send();
    expect(first.statusCode).toBe(201);
    const second = await send();
    expect(second.statusCode).toBe(200);
    expect(second.json<{ adjustmentId: string }>().adjustmentId)
      .toBe(first.json<{ adjustmentId: string }>().adjustmentId);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(list.json<unknown[]>()).toHaveLength(1);

    const distributions = await listDistributions(first.json<{ adjustmentId: string }>().adjustmentId);
    expect(distributions.json<unknown[]>()).toHaveLength(1);
    expect(capturedEvents.filter((event) => event.type === 'srs.adjustment.approved')).toHaveLength(1);
  });

  it('reusing an idempotency key for a different request is a conflict', async () => {
    const fixture = await createAdjustmentFixture('ADJ202');
    const send = async (scopeCode: string) => ctx.app.inject({
      method: 'POST',
      url: `/api/v1/students/${fixture.personId}/adjustments`,
      headers: { authorization: `Bearer ${await wellbeingServiceJwt(ctx)}`, 'idempotency-key': 'handoff-ADJ202' },
      payload: { sourceCaseId: randomUUID(), 
        enrolmentId: fixture.enrolmentId,
        adjustmentTypeCode: 'extra-time',
        scopeCode,
        validFrom: '2027-09-01T00:00:00.000Z',
      },
    });

    expect((await send('exam')).statusCode).toBe(201);
    expect((await send('coursework')).statusCode).toBe(409);
  });

  it('requests without an idempotency key are recorded separately, as before', async () => {
    const fixture = await createAdjustmentFixture('ADJ203');
    const payload = { adjustmentTypeCode: 'reader', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z' };
    const first = await createAdjustment(fixture, payload);
    const second = await createAdjustment(fixture, payload);
    expect(second.adjustmentId).not.toBe(first.adjustmentId);
  });

  it('a repeated acknowledgement is accepted once and publishes one distributed event', async () => {
    const fixture = await createAdjustmentFixture('ADJ204');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'deadline-extension',
      scopeCode: 'coursework',
      validFrom: '2027-09-01T00:00:00.000Z',
    });
    const distribution = (await listDistributions(adjustment.adjustmentId))
      .json<Array<{ distributionId: string; targetSystem: string; distributedAt: string | null }>>()[0]!;
    const acknowledge = () => ctx.app.inject({
      method: 'POST',
      url: `/api/v1/adjustments/${adjustment.adjustmentId}/distributions/${distribution.distributionId}/acknowledge`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: { targetSystem: distribution.targetSystem },
    });

    expect((await acknowledge()).statusCode).toBe(204);
    const firstAt = (await listDistributions(adjustment.adjustmentId))
      .json<Array<{ distributedAt: string | null }>>()[0]!.distributedAt;
    expect((await acknowledge()).statusCode).toBe(204);
    const secondAt = (await listDistributions(adjustment.adjustmentId))
      .json<Array<{ distributedAt: string | null }>>()[0]!.distributedAt;

    expect(secondAt).toBe(firstAt);
    expect(capturedEvents.filter((event) => event.type === 'srs.adjustment.distributed')).toHaveLength(1);
  });
});

describe('AJ-21 A21-AC06 — expiry keeps past arrangements and the current dated state wins', () => {
  it('the version recorded before expiry keeps its original end date', async () => {
    const fixture = await createAdjustmentFixture('ADJ301');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
      validTo: '2099-07-31T00:00:00.000Z',
    });

    const expire = await withdrawApprovedAdjustment(ctx, adjustment.adjustmentId);
    expect(expire.statusCode).toBe(200);

    const versions = await ctx.db.execute<{ valid_to: Date | string | null; recorded_until: Date | string | null }>(sql`
      SELECT valid_to, recorded_until FROM reasonable_adjustment
      WHERE id = ${adjustment.adjustmentId}
      ORDER BY recorded_at
    `);
    const rows = (Array.isArray(versions) ? versions : (versions as { rows: unknown[] }).rows) as Array<{
      valid_to: Date | string | null;
      recorded_until: Date | string | null;
    }>;

    expect(rows).toHaveLength(2);
    // Original belief, closed in transaction time but not rewritten.
    expect(new Date(rows[0]!.valid_to!).toISOString()).toBe('2099-07-31T00:00:00.000Z');
    expect(rows[0]!.recorded_until).not.toBeNull();
    // Current belief: the period ended at the expiry.
    expect(rows[1]!.recorded_until).toBeNull();
    expect(new Date(rows[1]!.valid_to!).getTime()).toBeLessThan(Date.parse('2099-07-31T00:00:00.000Z'));
  });

  it('a distribution cannot be acknowledged as applied after expiry', async () => {
    const fixture = await createAdjustmentFixture('ADJ302');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'reader',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
    });
    const distribution = (await listDistributions(adjustment.adjustmentId))
      .json<Array<{ distributionId: string; targetSystem: string }>>()[0]!;

    await withdrawApprovedAdjustment(ctx, adjustment.adjustmentId);

    const lateAck = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/adjustments/${adjustment.adjustmentId}/distributions/${distribution.distributionId}/acknowledge`,
      headers: { authorization: `Bearer ${integrationJwt}` },
      payload: { targetSystem: distribution.targetSystem },
    });
    expect(lateAck.statusCode).toBe(409);

    const after = (await listDistributions(adjustment.adjustmentId))
      .json<Array<{ statusCode: string }>>()[0]!;
    // An exam-scoped adjustment's only target is the SRS's exam entries,
    // which complete the withdrawal at expiry.
    expect(after.statusCode).toBe('withdrawn');
  });

  it('expiring an already-expired adjustment records no further version', async () => {
    const fixture = await createAdjustmentFixture('ADJ303');
    const adjustment = await createAdjustment(fixture, {
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'exam',
      validFrom: '2027-09-01T00:00:00.000Z',
    });
    const expire = () => withdrawApprovedAdjustment(ctx, adjustment.adjustmentId);

    // ADR-034: idempotent by state; the repeat changes nothing.
    const first = await expire();
    expect(first.statusCode).toBe(200);
    expect(first.json<{ changed: boolean }>().changed).toBe(true);
    const again = await expire();
    expect(again.statusCode).toBe(200);
    expect(again.json<{ changed: boolean }>().changed).toBe(false);

    const versions = await ctx.db.execute(sql`
      SELECT 1 FROM reasonable_adjustment WHERE id = ${adjustment.adjustmentId}
    `);
    const count = Array.isArray(versions) ? versions.length : (versions as { rows: unknown[] }).rows.length;
    expect(count).toBe(2);
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
    sourceCaseId?: string;
  },
): Promise<{ adjustmentId: string }> {
  const adjustment = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/students/${fixture.personId}/adjustments`,
    headers: { authorization: `Bearer ${await wellbeingServiceJwt(ctx)}` },
    payload: { sourceCaseId: randomUUID(), 
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

function buildMultipartBody(filename: string, content: string): { body: Buffer; contentType: string } {
  const boundary = '----adjustmentsTestBoundary';
  const parts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: application/pdf',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { body: Buffer.from(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
