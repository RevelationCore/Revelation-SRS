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

describe('OfS reporting and FOI support', () => {
  it('generates and retrieves a B3 extract with metrics for the academic year', async () => {
    const completed = await createEnrolment('Ofs', 'Complete', '2027-28');
    await createAward(completed.enrolmentId, completed.personId);
    await createEnrolment('Ofs', 'Continue', '2027-28');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/b3-extracts',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2027-28' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      extractId: string;
      recordCount: number;
      payload: { metrics: { completion: { numerator: number }; continuation: { denominator: number } } };
    }>();
    expect(body.recordCount).toBeGreaterThanOrEqual(2);
    expect(body.payload.metrics.continuation.denominator).toBe(body.recordCount);
    expect(body.payload.metrics.completion.numerator).toBeGreaterThanOrEqual(1);
    expect(events.find((e) => e.type === 'srs.regulatory.ofs-extract-generated')).toMatchObject({
      classification: 'regulatory',
    });

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/ofs/b3-extracts/${body.extractId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ extractId: string; payload: { extractTypeCode: string } }>())
      .toMatchObject({ extractId: body.extractId, payload: { extractTypeCode: 'b3-student-outcomes' } });
  });

  it('generates participation reports using regulatory profile segmentation', async () => {
    const student = await createEnrolment('Ofs', 'Segment', '2028-29');
    await createRegulatoryProfile(student.personId, student.enrolmentId);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/participation-reports',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2028-29' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ recordCount: number; payload: { segments: Array<{ polar4Quintile: number | string; imdDecile: number | string }> } }>();
    expect(body.recordCount).toBeGreaterThanOrEqual(1);
    expect(body.payload.segments).toContainEqual(
      expect.objectContaining({ polar4Quintile: 2, imdDecile: 4 }),
    );
  });

  it('records FOI requests with a 20-working-day statutory deadline and generates aggregate extracts', async () => {
    await createEnrolment('Foi', 'Aggregate', '2029-30');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/foi/requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        requestReference: 'FOI-2029-001',
        receivedDate: '2029-01-08',
        description: 'Student outcome aggregates',
      },
    });
    expect(created.statusCode).toBe(201);
    const request = created.json<{ requestId: string; statutoryDeadlineDate: string }>();
    expect(request.statutoryDeadlineDate).toBe('2029-02-05');

    const extract = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/foi/requests/${request.requestId}/extract`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { querySummary: 'Aggregate enrolment counts by academic year' },
    });
    expect(extract.statusCode).toBe(201);
    const body = extract.json<{ payload: { piiIncluded: boolean; records: unknown[]; aggregates: unknown[] } }>();
    expect(body.payload.piiIncluded).toBe(false);
    expect(body.payload.records).toEqual([]);
    expect(body.payload.aggregates.length).toBeGreaterThan(0);
  });

  it('rejects FOI extract generation after a request has been responded', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/foi/requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        requestReference: 'FOI-RESP-001',
        receivedDate: '2029-03-05',
        description: 'Responded request',
      },
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json<{ requestId: string }>().requestId;

    const status = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/regulatory/foi/requests/${requestId}/status`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { statusCode: 'responded' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ statusCode: string; closedAt: string | null }>())
      .toMatchObject({ statusCode: 'responded', closedAt: expect.any(String) });

    const extract = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/foi/requests/${requestId}/extract`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { querySummary: 'Should be rejected' },
    });
    expect(extract.statusCode).toBe(422);
  });

  it('does not expose OfS extracts or FOI requests across tenants', async () => {
    await createEnrolment('Tenant', 'Isolation', '2030-31');
    const extract = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/b3-extracts',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { academicYear: '2030-31' },
    });
    expect(extract.statusCode).toBe(200);
    const extractId = extract.json<{ extractId: string }>().extractId;

    const foi = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/foi/requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        requestReference: 'FOI-TENANT-001',
        receivedDate: '2030-01-07',
        description: 'Tenant isolation',
      },
    });
    expect(foi.statusCode).toBe(201);
    const requestId = foi.json<{ requestId: string }>().requestId;
    const secondTenantJwt = await ctx.makeJwt({ tenantId: ctx.secondTenantId });

    const hiddenExtract = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/ofs/b3-extracts/${extractId}`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(hiddenExtract.statusCode).toBe(404);

    const hiddenRequest = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/foi/requests/${requestId}`,
      headers: { authorization: `Bearer ${secondTenantJwt}` },
    });
    expect(hiddenRequest.statusCode).toBe(404);
  });
});

describe('OfS extract generation approval workflow', () => {
  it('approving a B3 generation request produces a B3 extract', async () => {
    const completed = await createEnrolment('OfsWf', 'B3Approve', '2031-32');
    await createAward(completed.enrolmentId, completed.personId);

    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/generation-requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { extractTypeCode: 'b3-student-outcomes', academicYear: '2031-32' },
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const pending = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/regulatory/ofs/generation-requests',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<Array<{ workflowInstanceId: string }>>().some(r => r.workflowInstanceId === workflowInstanceId)).toBe(true);

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(200);
    const { extractId } = decide.json<{ extractId: string | null }>();
    expect(extractId).not.toBeNull();

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/regulatory/ofs/b3-extracts/${extractId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ payload: { extractTypeCode: string } }>().payload.extractTypeCode)
      .toBe('b3-student-outcomes');
  });

  it('approving a participation-progress generation request produces a participation report', async () => {
    const student = await createEnrolment('OfsWf', 'ParticipationApprove', '2032-33');
    await createRegulatoryProfile(student.personId, student.enrolmentId);

    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/generation-requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { extractTypeCode: 'access-participation-progress', academicYear: '2032-33' },
    });
    expect(request.statusCode).toBe(202);
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(decide.statusCode).toBe(200);
    const { extractId } = decide.json<{ extractId: string | null }>();
    expect(extractId).not.toBeNull();
  });

  it('a rejected request produces no extract, and cannot be decided twice', async () => {
    await createEnrolment('OfsWf', 'Reject', '2033-34');
    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/generation-requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { extractTypeCode: 'b3-student-outcomes', academicYear: '2033-34' },
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'rejected', reason: 'Not ready yet' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<{ extractId: string | null }>().extractId).toBeNull();

    const secondDecide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { decisionCode: 'approved' },
    });
    expect(secondDecide.statusCode).toBe(422);
  });

  it('rejects a decision from a role lacking regulatory:decide', async () => {
    await createEnrolment('OfsWf', 'WrongRole', '2034-35');
    const request = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/regulatory/ofs/generation-requests',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { extractTypeCode: 'b3-student-outcomes', academicYear: '2034-35' },
    });
    const { workflowInstanceId } = request.json<{ workflowInstanceId: string }>();

    const moduleTutorJwt = await ctx.makeJwt({ roles: ['module-tutor'] });
    const decide = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/regulatory/ofs/generation-requests/${workflowInstanceId}/decision`,
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

async function createEnrolment(
  legalFirstName: string,
  legalFamilyName: string,
  academicYear: string,
): Promise<{ personId: string; enrolmentId: string }> {
  const personId = await createPerson(legalFirstName, legalFamilyName);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/enrolments',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId,
      modeOfStudyCode: 'full-time',
      academicYearOfEntry: academicYear,
      startDate: `${academicYear.slice(0, 4)}-09-20`,
      feeBandCode: 'home-undergraduate',
    },
  });
  expect(res.statusCode).toBe(201);
  return { personId, enrolmentId: res.json<{ enrolmentId: string }>().enrolmentId };
}

async function createAward(enrolmentId: string, personId: string): Promise<void> {
  const now = new Date();
  const examBoardId = randomUUID();
  await ctx.db.execute(sql`
    INSERT INTO exam_board (id, tenant_id, board_type_code, academic_year, meeting_date, actor_id, created_at)
    VALUES (${examBoardId}, ${ctx.tenantId}, 'award', '2027-28', '2030-07-01', 'test-user', ${now})
  `);

  await ctx.db.execute(sql`
    INSERT INTO award (
      version_id,
      id,
      tenant_id,
      enrolment_id,
      person_id,
      exam_board_id,
      qualification_code,
      classification_code,
      award_date,
      actor_id,
      valid_from,
      valid_to,
      recorded_at,
      recorded_until
    )
    VALUES (
      ${randomUUID()},
      ${randomUUID()},
      ${ctx.tenantId},
      ${enrolmentId},
      ${personId},
      ${examBoardId},
      'BSc',
      'upper-second',
      '2030-07-15',
      'test-user',
      ${now},
      NULL,
      ${now},
      NULL
    )
  `);
}

async function createRegulatoryProfile(personId: string, enrolmentId: string): Promise<void> {
  const now = new Date();
  await ctx.db.execute(sql`
    INSERT INTO student_regulatory_profile (
      version_id,
      id,
      tenant_id,
      person_id,
      enrolment_id,
      ukvi_sponsorship_required,
      polar4_quintile,
      imd_decile,
      care_experienced,
      source_system,
      actor_id,
      valid_from,
      valid_to,
      recorded_at,
      recorded_until
    )
    VALUES (
      ${randomUUID()},
      ${randomUUID()},
      ${ctx.tenantId},
      ${personId},
      ${enrolmentId},
      false,
      2,
      4,
      true,
      'test',
      'test-user',
      ${now},
      NULL,
      ${now},
      NULL
    )
  `);
}
