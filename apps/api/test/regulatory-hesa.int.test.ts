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

describe('HESA student returns', () => {
  it('generates, validates, creates a submission file, and marks submitted', async () => {
    await createHesaStudent('Hesa', 'Ready', '2000-01-01');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/hesa/returns',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2027-28' },
    });
    expect(created.statusCode).toBe(201);
    const returnId = created.json<{ returnId: string }>().returnId;

    expect(events.find((e) => e.type === 'srs.regulatory.hesa-return-generated')).toMatchObject({
      classification: 'regulatory',
    });

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/hesa/returns/${returnId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ recordCount: number; statusCode: string }>())
      .toMatchObject({ recordCount: 1, statusCode: 'draft' });

    const draftFile = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/file`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(draftFile.statusCode).toBe(422);

    const validation = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/validate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json<{ isValid: boolean; warnings: unknown[] }>()).toMatchObject({
      isValid: true,
      warnings: expect.any(Array),
    });

    const file = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/file`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(file.statusCode).toBe(200);
    expect(file.body).toContain('<StudentReturn academicYear="2027-28">');
    expect(file.body).toContain('<SURNAME>Ready</SURNAME>');

    const submissions = await ctx.db.execute(sql`
      SELECT submitted_at
      FROM hesa_submission
      WHERE hesa_student_return_id = ${returnId}
    `) as Array<{ submitted_at: Date | null }>;
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.submitted_at).toBeNull();

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/submit`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { submissionReference: 'HESA-SUB-001' },
    });
    expect(submit.statusCode).toBe(204);
    expect(events.find((e) => e.type === 'srs.regulatory.hesa-return-submitted')).toMatchObject({
      classification: 'regulatory',
    });
  });

  it('stores inbound validation reports, assigns HESA IDs, and creates amendments', async () => {
    const fixture = await createHesaStudent('Hesa', 'Assign', '1999-02-03');
    const returnId = await createReturn('2027-28');

    const report = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/validation-reports`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        reportPayload: {
          issues: [
            {
              enrolmentId: fixture.enrolmentId,
              fieldCode: 'MODE',
              severityCode: 'error',
              message: 'Mode must be corrected before acceptance',
            },
          ],
          identifierAssignments: [
            {
              enrolmentId: fixture.enrolmentId,
              hesaId: 'HESA000001',
            },
          ],
        },
      },
    });
    expect(report.statusCode).toBe(201);
    expect(report.json<{ assignmentsProcessed: number; blockingErrorCount: number }>())
      .toMatchObject({ assignmentsProcessed: 1, blockingErrorCount: 1 });

    const person = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/students/${fixture.personId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(person.statusCode).toBe(200);
    expect(person.json<{ hesaId: string | null }>().hesaId).toBe('HESA000001');
    expect(events.find((e) => e.type === 'srs.regulatory.hesa-id-assigned')).toMatchObject({
      classification: 'regulatory',
    });

    const amendment = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/amendments`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(amendment.statusCode).toBe(201);
    const amendmentId = amendment.json<{ returnId: string }>().returnId;

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/hesa/returns/${amendmentId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.json<{ amendmentOfId: string | null }>().amendmentOfId).toBe(returnId);
  });

  it('returns validation errors for missing birth dates', async () => {
    await createHesaStudent('Hesa', 'Invalid');
    const returnId = await createReturn('2027-28');

    const validation = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/hesa/returns/${returnId}/validate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json<{ isValid: boolean; errors: Array<{ field: string }> }>()).toMatchObject({
      isValid: false,
      errors: expect.arrayContaining([expect.objectContaining({ field: 'BIRTHDTE' })]),
    });
  });

  it('does not expose returns across tenants', async () => {
    await createHesaStudent('Tenant', 'Scoped', '2001-01-01');
    await createReturn('2027-28');
    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/hesa/returns',
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>()).toEqual([]);
  });
});

describe('HESA return submission approval workflow', () => {
  async function createValidatedReturnWithFile(academicYear: string): Promise<string> {
    await createHesaStudent('Hesa', 'Workflow', '2000-05-05');
    const returnId = await createReturn(academicYear);
    await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/${returnId}/validate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    // Generates and persists the submission file as a side effect.
    await ctx.app.inject({
      method: 'GET', url: `/api/v1/regulatory/hesa/returns/${returnId}/file`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    return returnId;
  }

  it('rejects a submission request when no submission file has been generated yet', async () => {
    await createHesaStudent('Hesa', 'NoFile', '2000-01-01');
    const returnId = await createReturn('2028-29');
    const request = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/${returnId}/submission-requests`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    expect(request.statusCode).toBe(422);
  });

  it('approving a submission request marks the return submitted', async () => {
    const returnId = await createValidatedReturnWithFile('2028-30');

    const request = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/${returnId}/submission-requests`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { submissionReference: 'HESA-WF-001' },
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const pending = await ctx.app.inject({
      method: 'GET', url: '/api/v1/regulatory/hesa/returns/submission-requests',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<Array<{ workflowInstanceId: string }>>().some(r => r.workflowInstanceId === workflowInstanceId)).toBe(true);

    const decide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/submission-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(204);

    const detail = await ctx.app.inject({
      method: 'GET', url: `/api/v1/regulatory/hesa/returns/${returnId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.json<{ statusCode: string; submissionReference: string | null }>())
      .toMatchObject({ statusCode: 'submitted', submissionReference: 'HESA-WF-001' });
  });

  it('a rejected request leaves the return unsubmitted, and cannot be decided twice', async () => {
    const returnId = await createValidatedReturnWithFile('2028-31');
    const request = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/${returnId}/submission-requests`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const decide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/submission-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'rejected', reason: 'Needs another validation pass' },
    });
    expect(decide.statusCode).toBe(204);

    const detail = await ctx.app.inject({
      method: 'GET', url: `/api/v1/regulatory/hesa/returns/${returnId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.json<{ statusCode: string }>().statusCode).not.toBe('submitted');

    const secondDecide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/submission-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(secondDecide.statusCode).toBe(422);
  });

  it('rejects a decision from a role lacking regulatory:decide', async () => {
    const returnId = await createValidatedReturnWithFile('2028-32');
    const request = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/${returnId}/submission-requests`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {},
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const decide = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/hesa/returns/submission-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${moduleTutorJwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(403);
  });
});

async function createReturn(academicYear: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/regulatory/hesa/returns',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { academicYear },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ returnId: string }>().returnId;
}

async function createHesaStudent(
  legalFirstName: string,
  legalFamilyName: string,
  dateOfBirth?: string,
): Promise<{ personId: string; enrolmentId: string }> {
  const person = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/students',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      legalFirstName,
      legalFamilyName,
      ...(dateOfBirth ? { dateOfBirth } : {}),
    },
  });
  expect(person.statusCode).toBe(201);
  const personId = person.json<{ personId: string }>().personId;

  const enrolment = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: '2027-28',
      startDate: '2027-09-20',
      feeBandCode: 'home-undergraduate',
    },
  });
  expect(enrolment.statusCode).toBe(201);
  return { personId, enrolmentId: enrolment.json<{ enrolmentId: string }>().enrolmentId };
}
