/**
 * EC claim integrity (ADR-028, BL-170):
 * - only a determination sets upheld or not_upheld; status changes follow
 *   EC_CLAIM_TRANSITIONS and anything else is 409 with the allowed next statuses;
 * - the reviewer and the authoriser are the signed-in user, and a request
 *   naming its own is refused;
 * - a withdrawn claim cannot be determined, so it never reaches SRS;
 * - EC audit rows are recorded as resourceType 'ec-claim'.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SrsEcStubClient } from '../src/srs/srs-ec-client.js';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

const PERSON_ID    = '10000000-0000-0000-0000-000000000071';
const ENROLMENT_ID = '22000000-0000-0000-0000-000000000071';
const OFFICER      = 'ec-officer-071';

let ctx:    TestWellbeingApp;
let ecStub: SrsEcStubClient;
let jwt:    string;
let period = 0;

async function call(app: FastifyInstance, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${jwt}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

async function newClaim(): Promise<string> {
  const res = await call(ctx.app, 'POST', '/api/v1/ec-claims', {
    personId: PERSON_ID, enrolmentId: ENROLMENT_ID, assessmentPeriodRef: `integrity-${++period}`, affectedModuleCodes: ['MOD071'],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

const determine = (claimId: string, extra: Record<string, unknown> = {}) => call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/determine`, {
  determinationCode: 'upheld', determinedAt: '2026-11-20T10:00:00Z', moduleOutcomes: [{ moduleCode: 'MOD071', outcome: 'defer_assessment' }], ...extra,
});

beforeAll(async () => {
  ecStub = new SrsEcStubClient();
  ctx    = await startTestApp({ srsEcClient: ecStub });
  jwt    = ctx.makeJwt({ sub: OFFICER });
}, 120_000);

afterAll(() => ctx.teardown());

beforeEach(() => { ecStub.submissions.length = 0; });

describe('EC claim status changes', () => {
  it.each(['upheld', 'not_upheld'])('cannot set %s by a status change; only a determination can', async (status) => {
    const claimId = await newClaim();
    const res = await call(ctx.app, 'PATCH', `/api/v1/ec-claims/${claimId}/status`, { statusCode: status });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json<{ allowedNextStatuses: string[] }>().allowedNextStatuses).toEqual(['evidence_pending', 'under_review', 'closed']);

    const detail = await call(ctx.app, 'GET', `/api/v1/ec-claims/${claimId}`);
    expect(detail.json<{ statusCode: string }>().statusCode).toBe('submitted');
    expect(ecStub.submissions).toHaveLength(0);
  });

  it('refuses an unknown status and any change from closed', async () => {
    const claimId = await newClaim();
    expect((await call(ctx.app, 'PATCH', `/api/v1/ec-claims/${claimId}/status`, { statusCode: 'approved' })).statusCode).toBe(409);

    expect((await call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/withdraw`, { reason: 'Student asked' })).statusCode).toBe(204);
    const reopen = await call(ctx.app, 'PATCH', `/api/v1/ec-claims/${claimId}/status`, { statusCode: 'under_review' });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json<{ allowedNextStatuses: string[] }>().allowedNextStatuses).toEqual([]);
    expect((await call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/withdraw`, {})).statusCode).toBe(409);
  });

  it('allows the documented path, and an upheld claim can still be closed', async () => {
    const claimId = await newClaim();
    for (const status of ['evidence_pending', 'under_review']) {
      expect((await call(ctx.app, 'PATCH', `/api/v1/ec-claims/${claimId}/status`, { statusCode: status })).statusCode).toBe(204);
    }
    expect((await determine(claimId)).statusCode).toBe(202);
    expect((await call(ctx.app, 'PATCH', `/api/v1/ec-claims/${claimId}/status`, { statusCode: 'closed' })).statusCode).toBe(204);
  });
});

describe('the acting user comes from the token', () => {
  it('records the signed-in user as the evidence reviewer, and refuses a named one', async () => {
    const claimId = await newClaim();
    const named = await call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/evidence-reviews`, {
      reviewerId: 'someone-else', reviewedAt: '2026-11-20T09:00:00Z', evidenceStatusCode: 'sufficient',
    });
    expect(named.statusCode).toBe(400);
    expect(named.json<{ detail: string }>().detail).toMatch(/reviewerId is not accepted/);

    const ok = await call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/evidence-reviews`, {
      reviewedAt: '2026-11-20T09:00:00Z', evidenceStatusCode: 'sufficient',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const detail = await call(ctx.app, 'GET', `/api/v1/ec-claims/${claimId}`);
    const reviews = detail.json<{ evidenceReviews: Array<{ reviewerId: string }> }>().evidenceReviews;
    expect(reviews.map((r) => r.reviewerId)).toEqual([OFFICER]);
  });

  it('records the signed-in user as the authoriser, and refuses a named one', async () => {
    const claimId = await newClaim();
    const named = await determine(claimId, { authorisedById: 'panel-chair-001' });
    expect(named.statusCode).toBe(400);
    expect(named.json<{ detail: string }>().detail).toMatch(/authorisedById is not accepted/);
    expect(ecStub.submissions).toHaveLength(0);

    expect((await determine(claimId)).statusCode).toBe(202);
    const detail = await call(ctx.app, 'GET', `/api/v1/ec-claims/${claimId}`);
    expect(detail.json<{ determination: { authorisedById: string } }>().determination.authorisedById).toBe(OFFICER);
  });
});

describe('a withdrawn claim', () => {
  it('cannot be determined, so it never reaches SRS', async () => {
    const claimId = await newClaim();
    expect((await call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/withdraw`, {})).statusCode).toBe(204);

    const res = await determine(claimId);
    expect(res.statusCode).toBe(409);
    expect(ecStub.submissions).toHaveLength(0);
    const detail = await call(ctx.app, 'GET', `/api/v1/ec-claims/${claimId}`);
    expect(detail.json<{ statusCode: string; determination: unknown }>()).toMatchObject({ statusCode: 'closed', determination: null });
  });
});

describe('EC audit rows', () => {
  it('are recorded as ec-claim, including status changes and the withdrawal reason', async () => {
    const claimId = await newClaim();
    await call(ctx.app, 'PATCH', `/api/v1/ec-claims/${claimId}/status`, { statusCode: 'under_review' });
    await call(ctx.app, 'POST', `/api/v1/ec-claims/${claimId}/withdraw`, { reason: 'Student asked' });

    const rows = await ctx.db.execute(sql`
      SELECT resource_type, context->>'action' AS action, context->>'reason' AS reason
      FROM   wellbeing.audit_log
      WHERE  resource_id = ${claimId}::uuid
      ORDER  BY recorded_at`);
    const entries = rows as unknown as Array<{ resource_type: string; action: string; reason: string | null }>;
    expect(entries.map((e) => e.action)).toEqual(['create-ec-claim', 'status-transition', 'withdraw']);
    expect(new Set(entries.map((e) => e.resource_type))).toEqual(new Set(['ec-claim']));
    expect(entries.at(-1)?.reason).toBe('Student asked');
  });
});
