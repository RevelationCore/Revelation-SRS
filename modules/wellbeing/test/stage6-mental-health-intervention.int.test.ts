/**
 * Stage 6 — Mental Health and Early Intervention integration tests.
 *
 * Exit criteria:
 * - An inbound alert can create or update an intervention workflow.
 * - Case notes remain Wellbeing-local (they live only in mh_session_note; the
 *   session-note content is never returned by case-detail or list endpoints).
 * - Reporting outputs expose counts only — no special-category detail.
 * - Bitemporal status and risk-level transitions are preserved.
 * - Tenant isolation: one tenant cannot read another's MH records.
 * - All read/write operations on special-category data are audit-logged.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERSON_ID = '30000000-0000-0000-0000-000000000001';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createMhCase(
  app: FastifyInstance,
  jwt: string,
  opts: Partial<{
    presentingConcernCode: string;
    riskLevelCode:         string;
  }> = {},
): Promise<string> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/mental-health-cases',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId:              PERSON_ID,
      presentingConcernCode: opts.presentingConcernCode ?? 'anxiety',
      ...(opts.riskLevelCode !== undefined ? { riskLevelCode: opts.riskLevelCode } : {}),
    },
  });
  expect(res.statusCode, `Create MH case failed: ${res.body}`).toBe(201);
  return res.json<{ id: string }>().id;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Stage 6 — Mental Health and Early Intervention', () => {
  let ctx: TestWellbeingApp;
  let jwt:   string;
  let mhJwt: string; // wellbeing-mental-health-advisor — required for session note endpoints

  beforeAll(async () => {
    ctx   = await startTestApp();
    jwt   = ctx.makeJwt();
    mhJwt = ctx.makeJwt({ roles: ['wellbeing-mental-health-advisor'] });
  });

  afterAll(() => ctx.teardown());

  // ── Create MH case ────────────────────────────────────────────────────────

  describe('POST /api/v1/mental-health-cases', () => {
    it('creates an MH case in referral_received status', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        id:                    string;
        statusCode:            string;
        riskLevelCode:         string;
        presentingConcernCode: string;
      }>();
      expect(body.id).toBe(caseId);
      expect(body.statusCode).toBe('referral_received');
      expect(body.riskLevelCode).toBe('low');
      expect(body.presentingConcernCode).toBe('anxiety');
    });

    it('returns 201 with id and wellbeingCaseId', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/mental-health-cases',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          personId:              PERSON_ID,
          presentingConcernCode: 'depression',
          riskLevelCode:         'medium',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ id: string; wellbeingCaseId: string }>();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.wellbeingCaseId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  // ── List ──────────────────────────────────────────────────────────────────

  describe('GET /api/v1/mental-health-cases?personId=', () => {
    it('lists MH cases for a person', async () => {
      await createMhCase(ctx.app, jwt, { presentingConcernCode: 'crisis' });

      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases?personId=${PERSON_ID}`,
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[]; total: number }>();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 when personId is omitted', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/mental-health-cases',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for an unknown case', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/mental-health-cases/00000000-0000-0000-0000-999999999999',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('list response does not include versionId', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases?personId=${PERSON_ID}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const items = res.json<{ items: Record<string, unknown>[] }>().items;
      for (const item of items) {
        expect(item).not.toHaveProperty('versionId');
      }
    });
  });

  // ── Status transition ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/mental-health-cases/:caseId/status', () => {
    it('transitions status and the change is visible in GET', async () => {
      const caseId = await createMhCase(ctx.app, jwt, { presentingConcernCode: 'other' });

      const patch = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/mental-health-cases/${caseId}/status`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { statusCode: 'assessment_pending' },
      });
      expect(patch.statusCode).toBe(204);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(detail.json<{ statusCode: string }>().statusCode).toBe('assessment_pending');
    });

    it('bitemporal: multiple versions are preserved in the database', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/mental-health-cases/${caseId}/status`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { statusCode: 'active' },
      });

      const rows = await ctx.db.execute(sql`
        SELECT count(*) AS cnt FROM wellbeing.mental_health_case
        WHERE id = ${caseId}::uuid
      `);
      expect(Number((rows as Array<{ cnt: string }>)[0]?.cnt)).toBe(2);
    });
  });

  // ── Risk level update ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/mental-health-cases/:caseId/risk', () => {
    it('updates risk level without changing status', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const patch = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/mental-health-cases/${caseId}/risk`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { riskLevelCode: 'high' },
      });
      expect(patch.statusCode).toBe(204);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const body = detail.json<{ riskLevelCode: string; statusCode: string }>();
      expect(body.riskLevelCode).toBe('high');
      expect(body.statusCode).toBe('referral_received');
    });
  });

  // ── Consent ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/mental-health-cases/:caseId/consent', () => {
    it('records consent and consentGiven becomes true', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/consent`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { consentDate: '2025-09-15T09:00:00Z' },
      });
      expect(res.statusCode).toBe(204);

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const body = detail.json<{ consentGiven: boolean; consentDate: string }>();
      expect(body.consentGiven).toBe(true);
      expect(body.consentDate).toBeTruthy();
    });
  });

  // ── Session notes — privacy boundary ─────────────────────────────────────

  describe('Session notes (special-category data)', () => {
    it('creates a session note and returns 201', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-01T14:00:00Z',
          sessionTypeCode: 'individual',
          content:         'Student reported improved sleep and reduced anxiety.',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ id: string }>().id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('case notes remain Wellbeing-local: case detail does not expose content', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-05T10:00:00Z',
          sessionTypeCode: 'crisis',
          content:         'CONFIDENTIAL — should not appear in case detail',
        },
      });

      // GET case detail must NOT include session note content
      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const body = detail.body;
      expect(body).not.toContain('CONFIDENTIAL');
      expect(body).not.toContain('should not appear');
    });

    it('lists session notes with content via dedicated endpoint', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-10T09:00:00Z',
          sessionTypeCode: 'individual',
          content:         'Progress noted.',
        },
      });

      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: Array<{ content: string }>; total: number }>();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0]?.content).toBe('Progress noted.');
    });

    it('session note access is audit-logged', async () => {
      const caseId = await createMhCase(ctx.app, jwt);
      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-12T09:00:00Z',
          sessionTypeCode: 'assessment',
          content:         'Note for audit test.',
        },
      });

      await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
      });

      const rows = await ctx.db.execute(sql`
        SELECT action_code, resource_type FROM wellbeing.audit_log
        WHERE  resource_type = 'mh-session-note'
        AND    tenant_id     = ${ctx.tenantId}::uuid
        ORDER  BY recorded_at
      `);
      const entries = rows as Array<{ action_code: string; resource_type: string }>;
      const writeEntry = entries.find((e) => e.action_code === 'write');
      const readEntry  = entries.find((e) => e.action_code === 'read');
      expect(writeEntry).toBeDefined();
      expect(readEntry).toBeDefined();
    });
  });

  // ── Intervention plans ────────────────────────────────────────────────────

  describe('Intervention plans', () => {
    it('creates an intervention plan in draft status', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/intervention-plans`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          planTypeCode:    'counselling',
          practitionerId:  'practitioner-001',
          sessionFrequencyCode: 'weekly',
          plannedSessionCount:  '8',
          goals: [{ goal: 'Reduce anxiety triggers' }, { goal: 'Build coping strategies' }],
          reviewDate: '2026-01-15T10:00:00Z',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<{ id: string }>().id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('plan appears in case detail', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/intervention-plans`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          planTypeCode:   'signposting',
          practitionerId: 'practitioner-002',
        },
      });

      const detail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const body = detail.json<{
        interventionPlans: Array<{ planTypeCode: string; statusCode: string }>;
      }>();
      expect(body.interventionPlans.length).toBeGreaterThanOrEqual(1);
      expect(body.interventionPlans[0]?.statusCode).toBe('draft');
    });

    it('plan status can be transitioned to active', async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const createRes = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${caseId}/intervention-plans`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          planTypeCode:   'crisis-support',
          practitionerId: 'practitioner-001',
        },
      });
      const planId = createRes.json<{ id: string }>().id;

      const patch = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/mental-health-cases/${caseId}/intervention-plans/${planId}/status`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: { statusCode: 'active' },
      });
      expect(patch.statusCode).toBe(204);

      const plans = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}/intervention-plans`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const body = plans.json<{ items: Array<{ id: string; statusCode: string }> }>();
      const updated = body.items.find((p) => p.id === planId);
      expect(updated?.statusCode).toBe('active');
    });

    it('an inbound alert can be linked to an intervention workflow', async () => {
      // Simulate a UKVI compliance alert arriving via the event consumer
      const alertId = '40000000-0000-0000-0000-000000000001';
      await ctx.db.execute(sql`
        INSERT INTO wellbeing.early_warning_alert
          (id, tenant_id, person_id, alert_type_code, alert_source_code, triage_status_code, alert_payload)
        VALUES
          (${alertId}::uuid, ${ctx.tenantId}::uuid, ${PERSON_ID}::uuid,
           'ukvi-compliance', 'ukvi', 'pending', '{"casReference":"CAS-12345"}'::jsonb)
        ON CONFLICT DO NOTHING
      `);

      // Create an MH case in response to the alert
      const caseId = await createMhCase(ctx.app, jwt, { presentingConcernCode: 'other' });

      // Triage the alert and assign it to the new case
      const triageRes = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/early-warning-alerts/${alertId}/triage`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          triageStatusCode: 'assigned',
          assignedCaseId:   caseId,
        },
      });
      expect(triageRes.statusCode).toBe(204);

      // Verify alert is now assigned
      const alertDetail = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/early-warning-alerts/${alertId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      const alert = alertDetail.json<{
        triageStatusCode: string;
        assignedCaseId:   string;
      }>();
      expect(alert.triageStatusCode).toBe('assigned');
      expect(alert.assignedCaseId).toBe(caseId);
    });
  });

  // ── Early warning alerts ──────────────────────────────────────────────────

  describe('Early warning alert queries', () => {
    beforeEach(async () => {
      // Seed a pending alert for person
      await ctx.db.execute(sql`
        INSERT INTO wellbeing.early_warning_alert
          (id, tenant_id, person_id, alert_type_code, alert_source_code, triage_status_code, alert_payload)
        VALUES
          (gen_random_uuid(), ${ctx.tenantId}::uuid, ${PERSON_ID}::uuid,
           'ukvi-compliance', 'ukvi', 'pending', '{}'::jsonb)
        ON CONFLICT DO NOTHING
      `);
    });

    it('GET ?personId= returns alerts for that person', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/early-warning-alerts?personId=${PERSON_ID}`,
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[]; total: number }>();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('GET ?triageStatus=pending returns the triage queue', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/early-warning-alerts?triageStatus=pending',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[] }>();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 with no filter', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/early-warning-alerts',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for unknown alert', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/early-warning-alerts/00000000-0000-0000-0000-999999999999',
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Reporting — privacy boundary ──────────────────────────────────────────

  describe('GET /api/v1/reports/wellbeing-summary', () => {
    it('returns aggregate counts only — no special-category detail', async () => {
      await createMhCase(ctx.app, jwt);

      const res = await ctx.app.inject({
        method:  'GET',
        url:     '/api/v1/reports/wellbeing-summary',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        openMentalHealthCases:   number;
        activeInterventionPlans: number;
        pendingAlerts:           number;
      }>();

      // Response must only contain numeric aggregates
      expect(typeof body.openMentalHealthCases).toBe('number');
      expect(typeof body.activeInterventionPlans).toBe('number');
      expect(typeof body.pendingAlerts).toBe('number');
      expect(body.openMentalHealthCases).toBeGreaterThanOrEqual(1);

      // No person identifiers or clinical details
      const raw = res.body;
      expect(raw).not.toContain('personId');
      expect(raw).not.toContain('content');
      expect(raw).not.toContain('presentingConcern');
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    it("one tenant cannot see another tenant's MH case", async () => {
      const caseId = await createMhCase(ctx.app, jwt);

      const otherJwt = ctx.makeJwt({ tenantId: ctx.secondTenantId });
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${otherJwt}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Audit log ─────────────────────────────────────────────────────────────

  describe('Audit log', () => {
    it('create and read operations are both audit-logged for MH cases', async () => {
      const caseId = await createMhCase(ctx.app, jwt, { presentingConcernCode: 'other' });

      // Read triggers an audit entry
      await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${caseId}`,
        headers: { authorization: `Bearer ${jwt}` },
      });

      const rows = await ctx.db.execute(sql`
        SELECT action_code FROM wellbeing.audit_log
        WHERE  resource_type = 'mental-health-case'
        AND    resource_id   = ${caseId}::uuid
        AND    tenant_id     = ${ctx.tenantId}::uuid
        ORDER  BY recorded_at
      `);

      const codes = (rows as Array<{ action_code: string }>).map((r) => r.action_code);
      expect(codes).toContain('write');
      expect(codes).toContain('read');
    });
  });
});
