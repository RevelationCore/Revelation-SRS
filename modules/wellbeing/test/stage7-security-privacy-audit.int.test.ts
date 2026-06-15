/**
 * Stage 7 — Security, Privacy, Audit, and Retention Hardening.
 *
 * Exit criteria:
 * - Unauthorized users cannot read or mutate Wellbeing records (401 / 403).
 * - Role separation is enforced at route level:
 *     - Session notes → wellbeing-mental-health-advisor only
 *     - Panel decisions, approve, reject → wellbeing-panel-chair only
 *     - SAR export → wellbeing-auditor / dpo only
 *     - Retention management → wellbeing-auditor / registry-administrator only
 * - Sensitive reads (session notes, SAR exports) are audit-logged.
 * - Retention due dates can be scheduled; /apply closes overdue cases.
 * - SAR export returns all Wellbeing-owned data for a person.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERSON_ID = '70000000-0000-0000-0000-000000000001';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createMhCase(app: FastifyInstance, jwt: string): Promise<string> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/mental-health-cases',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      personId:              PERSON_ID,
      presentingConcernCode: 'anxiety',
    },
  });
  expect(res.statusCode, `MH case creation failed: ${res.body}`).toBe(201);
  return res.json<{ id: string }>().id;
}

async function createDisabilityCase(app: FastifyInstance, jwt: string): Promise<{ id: string; wellbeingCaseId: string }> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/disability-cases',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { personId: PERSON_ID, supportTypeCode: 'ni' },
  });
  expect(res.statusCode, `Disability case creation failed: ${res.body}`).toBe(201);
  return res.json<{ id: string; wellbeingCaseId: string }>();
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Stage 7 — Security, Privacy, Audit, and Retention Hardening', () => {
  let ctx:        TestWellbeingApp;
  let advisorJwt: string;  // wellbeing-advisor
  let mhJwt:      string;  // wellbeing-mental-health-advisor
  let panelJwt:   string;  // wellbeing-panel-chair
  let auditorJwt: string;  // wellbeing-auditor

  beforeAll(async () => {
    ctx        = await startTestApp();
    advisorJwt = ctx.makeJwt({ roles: ['wellbeing-advisor'] });
    mhJwt      = ctx.makeJwt({ roles: ['wellbeing-mental-health-advisor'] });
    panelJwt   = ctx.makeJwt({ roles: ['wellbeing-panel-chair'] });
    auditorJwt = ctx.makeJwt({ roles: ['wellbeing-auditor'] });
  });

  afterAll(() => ctx.teardown());

  // ── Authentication boundary ───────────────────────────────────────────────

  describe('Authentication — no JWT returns 401', () => {
    it('disability cases require authentication', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/disability-cases?personId=anything' });
      expect(res.statusCode).toBe(401);
    });

    it('mental health cases require authentication', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/mental-health-cases?personId=anything' });
      expect(res.statusCode).toBe(401);
    });

    it('SAR export requires authentication', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/sar/export/${PERSON_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it('retention management requires authentication', async () => {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/retention/apply' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Session note role enforcement ─────────────────────────────────────────

  describe('Session notes — wellbeing-mental-health-advisor required', () => {
    let mhCaseId: string;

    beforeAll(async () => {
      mhCaseId = await createMhCase(ctx.app, mhJwt);
    });

    it('wellbeing-advisor cannot POST session notes (403)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-01T14:00:00Z',
          sessionTypeCode: 'individual',
          content:         'Should be blocked.',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-advisor cannot GET session notes (403)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-panel-chair cannot GET session notes (403)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${panelJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-mental-health-advisor CAN POST and GET session notes', async () => {
      const postRes = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-01T14:00:00Z',
          sessionTypeCode: 'individual',
          content:         'Authorised note.',
        },
      });
      expect(postRes.statusCode).toBe(201);

      const getRes = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
      });
      expect(getRes.statusCode).toBe(200);
    });

    it('wellbeing-auditor CAN GET session notes (oversight role)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${auditorJwt}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Panel decision role enforcement ───────────────────────────────────────

  describe('Panel decisions — wellbeing-panel-chair required', () => {
    let wellbeingCaseId: string;
    let disabilityCaseId: string;
    let adjustmentCaseId: string;

    beforeAll(async () => {
      const dc = await createDisabilityCase(ctx.app, advisorJwt);
      disabilityCaseId = dc.id;
      wellbeingCaseId  = dc.wellbeingCaseId;

      const acRes = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          wellbeingCaseId,
          disabilitySupportCaseId: disabilityCaseId,
          personId:                PERSON_ID,
          adjustmentTypeCode:      'exam-time',
        },
      });
      expect(acRes.statusCode).toBe(201);
      adjustmentCaseId = acRes.json<{ id: string }>().id;
    });

    it('wellbeing-advisor cannot POST panel-decisions (403)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/panel-decisions`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          panelChairId: 'chair-001',
          panelDate:    '2026-06-20T14:00:00Z',
          decisionCode: 'upheld',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-advisor cannot approve a case (403)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/approve`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          enrolmentId:           '22222222-0000-0000-0000-000000000010',
          scopeCode:             'all-modules',
          recommendedAdjustment: 'Extra time',
          validFrom:             '2026-09-01T00:00:00Z',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-advisor cannot reject a case (403)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/reject`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { rationale: 'Should be blocked.' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-panel-chair CAN POST panel-decisions', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjustmentCaseId}/panel-decisions`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          panelChairId: 'chair-001',
          panelDate:    '2026-06-20T14:00:00Z',
          decisionCode: 'upheld',
        },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ── SAR export role enforcement ───────────────────────────────────────────

  describe('SAR export — wellbeing-auditor required', () => {
    it('wellbeing-advisor cannot export SAR (403)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-mental-health-advisor cannot export SAR (403)', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${mhJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-auditor CAN export SAR and response has expected shape', async () => {
      const res = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${auditorJwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        exportedAt:             string;
        personId:               string;
        tenantId:               string;
        wellbeingCases:         unknown[];
        mentalHealthCases:      unknown[];
        sessionNotes:           unknown[];
        disabilitySupportCases: unknown[];
        adjustmentCases:        unknown[];
        ecClaims:               unknown[];
        interventionPlans:      unknown[];
        earlyWarningAlerts:     unknown[];
      }>();
      expect(body.personId).toBe(PERSON_ID);
      expect(body.tenantId).toBe(ctx.tenantId);
      expect(body.exportedAt).toBeTruthy();
      expect(Array.isArray(body.wellbeingCases)).toBe(true);
      expect(Array.isArray(body.mentalHealthCases)).toBe(true);
      expect(Array.isArray(body.sessionNotes)).toBe(true);
    });

    it('SAR export is logged in sar_export_log table', async () => {
      await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${auditorJwt}` },
      });

      const rows = await ctx.db.execute(sql`
        SELECT exported_for_person_id, requested_by_actor_id
        FROM   wellbeing.sar_export_log
        WHERE  tenant_id               = ${ctx.tenantId}::uuid
        AND    exported_for_person_id  = ${PERSON_ID}::uuid
      `);
      const entries = rows as Array<{
        exported_for_person_id: string;
        requested_by_actor_id:  string;
      }>;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0]?.exported_for_person_id).toBe(PERSON_ID);
    });

    it('SAR export is audit-logged with export action', async () => {
      await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${auditorJwt}` },
      });

      const rows = await ctx.db.execute(sql`
        SELECT action_code, context
        FROM   wellbeing.audit_log
        WHERE  tenant_id    = ${ctx.tenantId}::uuid
        AND    action_code  = 'export'
        AND    person_id    = ${PERSON_ID}::uuid
      `);
      const entries = rows as Array<{ action_code: string; context: unknown }>;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0]?.action_code).toBe('export');
    });

    it('SAR export includes session notes (complete data subject copy)', async () => {
      // Create a session note for PERSON_ID
      const mhCaseId = await createMhCase(ctx.app, mhJwt);
      await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          practitionerId:  'practitioner-001',
          sessionDate:     '2025-10-01T14:00:00Z',
          sessionTypeCode: 'individual',
          content:         'SAR note content.',
        },
      });

      const sarRes = await ctx.app.inject({
        method:  'GET',
        url:     `/api/v1/sar/export/${PERSON_ID}`,
        headers: { authorization: `Bearer ${auditorJwt}` },
      });

      const body = sarRes.json<{ sessionNotes: Array<{ content: string }> }>();
      expect(body.sessionNotes.length).toBeGreaterThanOrEqual(1);
      expect(body.sessionNotes.some((n) => n.content === 'SAR note content.')).toBe(true);
    });
  });

  // ── Retention management ──────────────────────────────────────────────────

  describe('Retention management — wellbeing-auditor required', () => {
    let wellbeingCaseId: string;

    beforeAll(async () => {
      const dc = await createDisabilityCase(ctx.app, advisorJwt);
      wellbeingCaseId = dc.wellbeingCaseId;
    });

    it('wellbeing-advisor cannot schedule retention (403)', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/admin/retention/wellbeing-cases/${wellbeingCaseId}`,
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: { retentionDueDate: '2030-01-01T00:00:00Z' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-advisor cannot apply retention (403)', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/admin/retention/apply',
        headers: { authorization: `Bearer ${advisorJwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-auditor CAN schedule retention due date (204)', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     `/api/v1/admin/retention/wellbeing-cases/${wellbeingCaseId}`,
        headers: { authorization: `Bearer ${auditorJwt}` },
        payload: {
          retentionDueDate:       '2030-01-01T00:00:00Z',
          lawfulBasisCode:        'gdpr-art9-2h',
          dataClassificationCode: 'special-category',
        },
      });
      expect(res.statusCode).toBe(204);

      // Verify it's stored
      const rows = await ctx.db.execute(sql`
        SELECT retention_due_date, lawful_basis_code, data_classification_code
        FROM   wellbeing.wellbeing_case
        WHERE  id = ${wellbeingCaseId}::uuid
      `);
      const r = (rows as Array<Record<string, unknown>>)[0];
      expect(r?.['lawful_basis_code']).toBe('gdpr-art9-2h');
      expect(r?.['data_classification_code']).toBe('special-category');
      expect(r?.['retention_due_date']).toBeTruthy();
    });

    it('apply endpoint closes cases past their retention due date', async () => {
      // Create a new case and set its retention date in the past
      const dc = await createDisabilityCase(ctx.app, advisorJwt);
      const pastCaseId = dc.wellbeingCaseId;

      // Set retention date to the past via direct SQL (bypasses auditor check for test speed)
      await ctx.db.execute(sql`
        UPDATE wellbeing.wellbeing_case
        SET    retention_due_date = NOW() - INTERVAL '1 day',
               updated_at         = NOW()
        WHERE  id        = ${pastCaseId}::uuid
        AND    tenant_id = ${ctx.tenantId}::uuid
      `);

      const applyRes = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/admin/retention/apply',
        headers: { authorization: `Bearer ${auditorJwt}` },
      });
      expect(applyRes.statusCode).toBe(200);
      expect(applyRes.json<{ closedCases: number }>().closedCases).toBeGreaterThanOrEqual(1);

      // Verify the case is now closed
      const rows = await ctx.db.execute(sql`
        SELECT status_code, closed_at
        FROM   wellbeing.wellbeing_case
        WHERE  id = ${pastCaseId}::uuid
      `);
      const r = (rows as Array<Record<string, unknown>>)[0];
      expect(r?.['status_code']).toBe('closed');
      expect(r?.['closed_at']).toBeTruthy();
    });

    it('apply is idempotent: already-closed cases are not double-closed', async () => {
      const res = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/admin/retention/apply',
        headers: { authorization: `Bearer ${auditorJwt}` },
      });
      expect(res.statusCode).toBe(200);
      // Closed cases are excluded from the query, so count should be 0
      expect(res.json<{ closedCases: number }>().closedCases).toBe(0);
    });

    it('returns 404 when scheduling retention for unknown case', async () => {
      const res = await ctx.app.inject({
        method:  'PATCH',
        url:     '/api/v1/admin/retention/wellbeing-cases/00000000-0000-0000-0000-999999999999',
        headers: { authorization: `Bearer ${auditorJwt}` },
        payload: { retentionDueDate: '2030-01-01T00:00:00Z' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Data governance metadata ──────────────────────────────────────────────

  describe('Data governance — lawful basis and classification', () => {
    it('new wellbeing cases have default lawful basis and classification', async () => {
      const dc = await createDisabilityCase(ctx.app, advisorJwt);

      const rows = await ctx.db.execute(sql`
        SELECT lawful_basis_code, data_classification_code, retention_due_date
        FROM   wellbeing.wellbeing_case
        WHERE  id = ${dc.wellbeingCaseId}::uuid
      `);
      const r = (rows as Array<Record<string, unknown>>)[0];
      expect(r?.['lawful_basis_code']).toBe('gdpr-art6-e');
      expect(r?.['data_classification_code']).toBe('standard');
      expect(r?.['retention_due_date']).toBeNull();
    });
  });

  // ── Cross-role boundary tests ─────────────────────────────────────────────

  describe('Role separation — each role is limited to its domain', () => {
    it('wellbeing-panel-chair cannot POST session notes (403)', async () => {
      const mhCaseId = await createMhCase(ctx.app, mhJwt);
      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/mental-health-cases/${mhCaseId}/session-notes`,
        headers: { authorization: `Bearer ${panelJwt}` },
        payload: {
          practitionerId:  'p-001',
          sessionDate:     '2025-10-01T14:00:00Z',
          sessionTypeCode: 'individual',
          content:         'Should be forbidden.',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('wellbeing-mental-health-advisor cannot approve adjustment cases (403)', async () => {
      const dc = await createDisabilityCase(ctx.app, advisorJwt);
      const acRes = await ctx.app.inject({
        method:  'POST',
        url:     '/api/v1/adjustment-cases',
        headers: { authorization: `Bearer ${advisorJwt}` },
        payload: {
          wellbeingCaseId:         dc.wellbeingCaseId,
          disabilitySupportCaseId: dc.id,
          personId:                PERSON_ID,
          adjustmentTypeCode:      'exam-time',
        },
      });
      const adjId = acRes.json<{ id: string }>().id;

      const res = await ctx.app.inject({
        method:  'POST',
        url:     `/api/v1/adjustment-cases/${adjId}/approve`,
        headers: { authorization: `Bearer ${mhJwt}` },
        payload: {
          enrolmentId:           '22222222-0000-0000-0000-000000000010',
          scopeCode:             'all-modules',
          recommendedAdjustment: 'Extra time',
          validFrom:             '2026-09-01T00:00:00Z',
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
