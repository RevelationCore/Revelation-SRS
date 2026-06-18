/**
 * Stage 1 — Connector Scaffold and Stub VLE.
 *
 * Verifies:
 * - All six connector persistence tables exist in the vle_connector schema.
 * - Connector health and readiness endpoints respond correctly.
 * - Stub VLE health endpoint responds.
 * - Stub VLE state inspection: courses, enrolments, adjustments, marks.
 * - Stub VLE reset clears all state.
 */

import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startTestApp, type TestVleApp } from './helpers/test-app.js';

describe('Stage 1 — Connector Scaffold and Stub VLE', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  // ── Database schema ─────────────────────────────────────────────────────────

  describe('Database schema', () => {
    const EXPECTED_TABLES = [
      'vle_event_ledger',
      'vle_course_map',
      'vle_enrolment_map',
      'vle_adjustment_map',
      'vle_mark_receipt',
      'vle_reconciliation_run',
    ];

    it.each(EXPECTED_TABLES)('table vle_connector.%s exists', async (table) => {
      const rows = await ctx.db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE  table_schema = 'vle_connector'
        AND    table_name   = ${table}
      `);
      expect(rows.length).toBe(1);
    });
  });

  // ── Connector health ─────────────────────────────────────────────────────────

  describe('Connector health endpoints', () => {
    it('GET /health returns 200 with service name', async () => {
      const res = await ctx.connector.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; service: string }>();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('vle-connector');
    });

    it('GET /ready returns 200 when database is reachable', async () => {
      const res = await ctx.connector.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('ready');
    });
  });

  // ── Stub VLE health ──────────────────────────────────────────────────────────

  describe('Stub VLE health', () => {
    it('GET /stub/health returns 200', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('ok');
    });
  });

  // ── Stub VLE courses ─────────────────────────────────────────────────────────

  describe('Stub VLE — course management', () => {
    const moduleId = 'mod-stage1-001';

    beforeAll(async () => {
      await ctx.stubVle.inject({ method: 'DELETE', url: '/stub/reset' });
    });

    it('GET /stub/courses returns empty initially', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/courses' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
    });

    it('POST /stub/courses creates a course shell', async () => {
      const res = await ctx.stubVle.inject({
        method:  'POST',
        url:     '/stub/courses',
        payload: { moduleId, code: 'CS3010', title: 'Algorithms', creditValue: 15 },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ moduleId: string; vleCourseId: string; code: string }>();
      expect(body.moduleId).toBe(moduleId);
      expect(body.vleCourseId).toBeTruthy();
      expect(body.code).toBe('CS3010');
    });

    it('POST /stub/courses is idempotent (upserts on moduleId)', async () => {
      await ctx.stubVle.inject({
        method:  'POST',
        url:     '/stub/courses',
        payload: { moduleId, code: 'CS3010', title: 'Algorithms — Updated', creditValue: 15 },
      });
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/courses' });
      expect(res.json<{ items: unknown[] }>().items).toHaveLength(1);
    });

    it('GET /stub/courses/:moduleId returns course with empty enrolments', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: `/stub/courses/${moduleId}` });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ title: string; enrolments: unknown[] }>();
      expect(body.title).toBe('Algorithms — Updated');
      expect(body.enrolments).toHaveLength(0);
    });

    it('GET /stub/courses/:moduleId returns 404 for unknown module', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/courses/nonexistent' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Stub VLE enrolments ──────────────────────────────────────────────────────

  describe('Stub VLE — enrolment roster', () => {
    const moduleId             = 'mod-stage1-002';
    const moduleRegistrationId = 'mreg-stage1-001';
    const personId             = 'person-stage1-001';

    beforeAll(async () => {
      await ctx.stubVle.inject({ method: 'DELETE', url: '/stub/reset' });
      await ctx.stubVle.inject({
        method:  'POST',
        url:     '/stub/courses',
        payload: { moduleId, code: 'MA201', title: 'Calculus', creditValue: 15 },
      });
    });

    it('POST /stub/courses/:moduleId/enrolments enrols a student', async () => {
      const res = await ctx.stubVle.inject({
        method:  'POST',
        url:     `/stub/courses/${moduleId}/enrolments`,
        payload: { moduleRegistrationId, personId, enrolmentId: 'enr-001' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ statusCode: string; vleEnrolmentId: string }>();
      expect(body.statusCode).toBe('active');
      expect(body.vleEnrolmentId).toBeTruthy();
    });

    it('GET /stub/courses/:moduleId/enrolments lists the enrolment', async () => {
      const res = await ctx.stubVle.inject({
        method: 'GET',
        url:    `/stub/courses/${moduleId}/enrolments`,
      });
      expect(res.statusCode).toBe(200);
      const items = res.json<{ items: Array<{ moduleRegistrationId: string }> }>().items;
      expect(items).toHaveLength(1);
      expect(items[0]?.moduleRegistrationId).toBe(moduleRegistrationId);
    });

    it('PATCH /stub/courses/:moduleId/enrolments/:id updates access status', async () => {
      const res = await ctx.stubVle.inject({
        method:  'PATCH',
        url:     `/stub/courses/${moduleId}/enrolments/${moduleRegistrationId}`,
        payload: { statusCode: 'suspended' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ statusCode: string }>().statusCode).toBe('suspended');
    });

    it('GET /stub/courses/:moduleId shows updated enrolment in roster', async () => {
      const res  = await ctx.stubVle.inject({ method: 'GET', url: `/stub/courses/${moduleId}` });
      const body = res.json<{ enrolments: Array<{ statusCode: string }> }>();
      expect(body.enrolments[0]?.statusCode).toBe('suspended');
    });

    it('PATCH on unknown enrolment returns 404', async () => {
      const res = await ctx.stubVle.inject({
        method:  'PATCH',
        url:     `/stub/courses/${moduleId}/enrolments/nonexistent`,
        payload: { statusCode: 'withdrawn' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Stub VLE adjustments ─────────────────────────────────────────────────────

  describe('Stub VLE — adjustments', () => {
    beforeAll(async () => {
      await ctx.stubVle.inject({ method: 'DELETE', url: '/stub/reset' });
    });

    it('POST /stub/adjustments records an applied adjustment', async () => {
      const res = await ctx.stubVle.inject({
        method:  'POST',
        url:     '/stub/adjustments',
        payload: {
          adjustmentId:       'adj-001',
          distributionId:     'dist-001',
          personId:           'person-001',
          enrolmentId:        'enr-001',
          adjustmentTypeCode: 'extra-time',
          scopeCode:          'all',
          validFrom:          '2026-09-01T00:00:00Z',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ adjustmentTypeCode: string; appliedAt: string }>();
      expect(body.adjustmentTypeCode).toBe('extra-time');
      expect(body.appliedAt).toBeTruthy();
    });

    it('GET /stub/adjustments lists all adjustments', async () => {
      const res   = await ctx.stubVle.inject({ method: 'GET', url: '/stub/adjustments' });
      const items = res.json<{ items: unknown[] }>().items;
      expect(items).toHaveLength(1);
    });

    it('GET /stub/adjustments/:id returns the adjustment', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/adjustments/adj-001' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ adjustmentId: string }>().adjustmentId).toBe('adj-001');
    });

    it('GET /stub/adjustments/:id returns 404 for unknown id', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/adjustments/unknown' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Stub VLE marks ───────────────────────────────────────────────────────────

  describe('Stub VLE — marks', () => {
    beforeAll(async () => {
      await ctx.stubVle.inject({ method: 'DELETE', url: '/stub/reset' });
    });

    it('POST /stub/marks records a submitted mark', async () => {
      const res = await ctx.stubVle.inject({
        method:  'POST',
        url:     '/stub/marks',
        payload: {
          moduleRegistrationId:  'mreg-001',
          assessmentComponentId: 'comp-001',
          rawMark:               72,
          sourceReference:       'vle-assign-99-stu-01-attempt1',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<{ markId: string; rawMark: number }>();
      expect(body.markId).toBeTruthy();
      expect(body.rawMark).toBe(72);
    });

    it('GET /stub/marks lists submitted marks', async () => {
      const res = await ctx.stubVle.inject({ method: 'GET', url: '/stub/marks' });
      expect(res.json<{ items: unknown[] }>().items).toHaveLength(1);
    });
  });

  // ── Stub VLE reset ───────────────────────────────────────────────────────────

  describe('Stub VLE — reset', () => {
    it('DELETE /stub/reset clears all state', async () => {
      // Seed some state
      await ctx.stubVle.inject({
        method: 'POST', url: '/stub/courses',
        payload: { moduleId: 'mod-reset-test', code: 'X001', title: 'Test', creditValue: 0 },
      });
      await ctx.stubVle.inject({
        method: 'POST', url: '/stub/marks',
        payload: { moduleRegistrationId: 'mreg-x', assessmentComponentId: 'comp-x', rawMark: 50, sourceReference: 'ref-x' },
      });

      const reset = await ctx.stubVle.inject({ method: 'DELETE', url: '/stub/reset' });
      expect(reset.statusCode).toBe(204);

      const courses = await ctx.stubVle.inject({ method: 'GET', url: '/stub/courses' });
      const marks   = await ctx.stubVle.inject({ method: 'GET', url: '/stub/marks' });
      expect(courses.json<{ items: unknown[] }>().items).toHaveLength(0);
      expect(marks.json<{ items: unknown[] }>().items).toHaveLength(0);
    });
  });
});
