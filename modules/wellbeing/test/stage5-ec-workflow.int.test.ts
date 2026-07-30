/**
 * Stage 5 — Exceptional Circumstances Workflow integration tests.
 *
 * Covers the full EC claim lifecycle: create → evidence review → determination,
 * with the key data-governance requirement that only upheld/partially_upheld
 * claims reach SRS board preparation (F-WELL-SIS-02 handoff), while not_upheld
 * determinations and withdrawn claims stay entirely local.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { SrsEcStubClient } from '../src/srs/srs-ec-client.js';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERSON_ID    = '10000000-0000-0000-0000-000000000001';
const ENROLMENT_ID = '22000000-0000-0000-0000-000000000001';

// ── Test helpers ──────────────────────────────────────────────────────────────

async function createEcClaim(
  app: FastifyInstance,
  jwt: string,
  opts: Partial<{
    enrolmentId:         string;
    assessmentPeriodRef: string;
    affectedModuleCodes: string[];
  }> = {},
): Promise<string> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/ec-claims',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId:               PERSON_ID,
      enrolmentId:            opts.enrolmentId        ?? ENROLMENT_ID,
      assessmentPeriodRef:    opts.assessmentPeriodRef ?? '2024-25/Semester1',
      affectedModuleCodes:    opts.affectedModuleCodes ?? ['MOD101', 'MOD102'],
      circumstancesNarrative: 'Student suffered bereavement during exam period.',
    },
  });
  expect(res.statusCode, `POST /api/v1/ec-claims failed: ${res.body}`).toBe(201);
  return res.json<{ id: string }>().id;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Stage 5 — Exceptional Circumstances Workflow', () => {
  let ctx:    TestWellbeingApp;
  let ecStub: SrsEcStubClient;
  let jwt:    string;

  beforeAll(async () => {
    ecStub = new SrsEcStubClient();
    ctx    = await startTestApp({ srsEcClient: ecStub });
    jwt    = ctx.makeJwt();
  });

  afterAll(() => ctx.teardown());

  beforeEach(() => {
    ecStub.submissions.length = 0;
  });

  // ── Create ────────────────────────────────────────────────────────────────

  describe('POST /api/v1/ec-claims', () => {
    it('creates an EC claim in submitted status', async () => {
      const claimId = await createEcClaim(ctx.app, jwt);

      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        id:                  string;
        statusCode:          string;
        affectedModuleCodes: string[];
        boardVisible:        boolean;
      }>();
      expect(body.id).toBe(claimId);
      expect(body.statusCode).toBe('submitted');
      expect(body.affectedModuleCodes).toEqual(['MOD101', 'MOD102']);
      expect(body.boardVisible).toBe(false);
    });

    it('returns 201 with id and wellbeingCaseId', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/ec-claims',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          personId:            PERSON_ID,
          enrolmentId:         ENROLMENT_ID,
          assessmentPeriodRef: '2024-25/Semester2',
          affectedModuleCodes: ['MOD201'],
          evidenceDeadline:    '2025-02-28',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; wellbeingCaseId: string }>();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.wellbeingCaseId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe('GET /api/v1/ec-claims?personId=', () => {
    it('lists claims for a person', async () => {
      await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/list-test',
        affectedModuleCodes: ['MOD301'],
      });

      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims?personId=${PERSON_ID}`,
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[]; total: number }>();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 when personId is omitted', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/ec-claims',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for an unknown claim', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/ec-claims/00000000-0000-0000-0000-999999999999',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Status transition ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/ec-claims/:claimId/status', () => {
    it('transitions status and the change is reflected in GET', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/status-patch',
        affectedModuleCodes: ['MOD111'],
      });

      const patch = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/ec-claims/${claimId}/status`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { statusCode: 'under_review' },
      });
      expect(patch.statusCode).toBe(204);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(detail.json<{ statusCode: string }>().statusCode).toBe('under_review');
    });
  });

  // ── Evidence review ───────────────────────────────────────────────────────

  describe('POST /api/v1/ec-claims/:claimId/evidence-reviews', () => {
    it('records an evidence review', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/ev-review',
        affectedModuleCodes: ['MOD401'],
      });

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/evidence-reviews`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          reviewerId:         'reviewer-001',
          reviewedAt:         '2025-10-15T14:00:00Z',
          evidenceStatusCode: 'pending',
          reviewNotes:        'Awaiting GP letter.',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json<{ id: string }>().id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('auto-advances status to under_review when evidence is marked sufficient', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/auto-advance',
        affectedModuleCodes: ['MOD501'],
      });

      await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/ec-claims/${claimId}/status`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { statusCode: 'evidence_pending' },
      });

      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/evidence-reviews`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          reviewerId:         'reviewer-001',
          reviewedAt:         '2025-10-20T09:00:00Z',
          evidenceStatusCode: 'sufficient',
        },
      });

      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.json<{ statusCode: string }>().statusCode).toBe('under_review');
    });
  });

  // ── Determination — upheld → SRS handoff ─────────────────────────────────

  describe('POST /api/v1/ec-claims/:claimId/determine — upheld', () => {
    it('an upheld EC claim is visible to SRS exam board preparation', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/upheld',
        affectedModuleCodes: ['MOD601'],
      });

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/determine`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          authorisedById:    'panel-chair-001',
          determinationCode: 'upheld',
          determinedAt:      '2025-11-01T10:00:00Z',
          moduleOutcomes: [{ moduleCode: 'MOD601', outcome: 'defer_assessment' }],
        },
      });

      expect(res.statusCode, `Determine failed: ${res.body}`).toBe(202);
      const body = res.json<{ status: string; exceptionalCircumstancesId: string }>();
      expect(body.status).toBe('submitted');
      expect(body.exceptionalCircumstancesId).toMatch(/^stub-ec-/);

      // SRS stub called once with correct personId and outcomeCode
      expect(ecStub.submissions).toHaveLength(1);
      expect(ecStub.submissions[0]?.personId).toBe(PERSON_ID);
      expect(ecStub.submissions[0]?.outcomeCode).toBe('upheld');

      // GET reflects final state
      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const d = detail.json<{
        statusCode:       string;
        boardVisible:     boolean;
        srsHandoffStatus: string;
      }>();
      expect(d.statusCode).toBe('upheld');
      expect(d.boardVisible).toBe(true);
      expect(d.srsHandoffStatus).toBe('sent');
    });

    it('re-determine is idempotent — SRS is not called again', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/idempotent',
        affectedModuleCodes: ['MOD701'],
      });

      const payload = {
        authorisedById:    'panel-chair-001',
        determinationCode: 'upheld',
        determinedAt:      '2025-11-05T10:00:00Z',
        moduleOutcomes: [{ moduleCode: 'MOD701', outcome: 'defer_assessment' }],
      };

      const first = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/determine`,
        headers: { authorization: `Bearer ${jwt}` },
        payload,
      });
      expect(first.statusCode).toBe(202);

      ecStub.submissions.length = 0;

      const second = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/determine`,
        headers: { authorization: `Bearer ${jwt}` },
        payload,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json<{ status: string }>().status).toBe('already_sent');
      expect(ecStub.submissions).toHaveLength(0);
    });
  });

  // ── Determination — not_upheld → no SRS handoff ───────────────────────────

  describe('POST /api/v1/ec-claims/:claimId/determine — not_upheld', () => {
    it('withdrawn/rejected claims do not leak into SRS board data', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/not-upheld',
        affectedModuleCodes: ['MOD801'],
      });

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/determine`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          authorisedById:    'panel-chair-001',
          determinationCode: 'not_upheld',
          determinedAt:      '2025-11-10T10:00:00Z',
          moduleOutcomes: [{ moduleCode: 'MOD801', outcome: 'no_action' }],
        },
      });

      expect(res.statusCode).toBe(204);
      expect(ecStub.submissions).toHaveLength(0);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const d = detail.json<{
        statusCode:       string;
        boardVisible:     boolean;
        srsHandoffStatus: string | null;
      }>();
      expect(d.statusCode).toBe('not_upheld');
      expect(d.boardVisible).toBe(false);
      expect(d.srsHandoffStatus).toBeNull();
    });
  });

  // ── Withdraw ──────────────────────────────────────────────────────────────

  describe('POST /api/v1/ec-claims/:claimId/withdraw', () => {
    it('withdraws a claim and does not trigger SRS', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/withdraw',
        affectedModuleCodes: ['MOD901'],
      });

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/ec-claims/${claimId}/withdraw`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { reason: 'Student requested withdrawal.' },
      });

      expect(res.statusCode).toBe(204);
      expect(ecStub.submissions).toHaveLength(0);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(detail.json<{ statusCode: string }>().statusCode).toBe('closed');
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    it("one tenant cannot see another tenant's EC claims", async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/isolation',
        affectedModuleCodes: ['MOD999'],
      });

      const otherJwt = ctx.makeJwt({ tenantId: ctx.secondTenantId });
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${otherJwt}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Audit log ─────────────────────────────────────────────────────────────

  describe('Audit log', () => {
    it('write and read operations are both recorded in the audit log', async () => {
      const claimId = await createEcClaim(ctx.app, jwt, {
        assessmentPeriodRef: '2024-25/audit',
        affectedModuleCodes: ['MOD888'],
      });

      // GET triggers audit read entry
      await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/ec-claims/${claimId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });

      const rows = await ctx.db.execute(sql`
        SELECT action_code FROM wellbeing.audit_log
        WHERE  person_id  = ${PERSON_ID}::uuid
        AND    tenant_id  = ${ctx.tenantId}::uuid
        ORDER  BY recorded_at
      `);

      const codes = (rows as Array<{ action_code: string }>).map((r) => r.action_code);
      expect(codes).toContain('write');
      expect(codes).toContain('read');
    });
  });
});
