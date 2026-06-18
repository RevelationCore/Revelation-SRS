import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { withWellbeingTenantContext } from '../src/db/client.js';
import { wellbeingCases, disabilitySupportCases } from '../src/db/schema/index.js';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

let ctx: TestWellbeingApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
});

// ── Migration correctness ─────────────────────────────────────────────────────

describe('Stage 1 — migration: all wellbeing tables exist', () => {
  const tables = [
    'wellbeing_case',
    'srs_context_projection',
    'early_warning_alert',
    'disability_support_case',
    'dsa_entitlement',
    'evidence_reference',
    'adjustment_case',
    'adjustment_assessment',
    'adjustment_panel_decision',
    'ec_claim',
    'ec_evidence_review',
    'ec_determination',
    'mental_health_case',
    'intervention_plan',
  ];

  for (const table of tables) {
    it(`table wellbeing.${table} exists`, async () => {
      const result = await ctx.db.execute(sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'wellbeing'
          AND table_name   = ${table}
      `);
      expect(result.length).toBe(1);
    });
  }

  it('wellbeing schema exists', async () => {
    const result = await ctx.db.execute(sql`
      SELECT 1 FROM information_schema.schemata WHERE schema_name = 'wellbeing'
    `);
    expect(result.length).toBe(1);
  });
});

// ── RLS — tenant isolation ────────────────────────────────────────────────────
//
// Testcontainers connects as the postgres superuser, which has BYPASSRLS.
// Raw-DB isolation tests therefore cannot use the superuser connection.
// Instead we verify:
//   (a) the RLS policy is configured correctly in pg_policies
//   (b) withWellbeingTenantContext sets app.current_tenant_id for the session
//   (c) data can be inserted and read within a context (smoke test)
// Full cross-tenant isolation is tested at the HTTP layer in Stage 2+ tests.

describe('Stage 1 — RLS: policy configuration on wellbeing tables', () => {
  const rls_tables = [
    'wellbeing_case',
    'disability_support_case',
    'adjustment_case',
    'ec_claim',
    'mental_health_case',
  ];

  for (const table of rls_tables) {
    it(`tenant_isolation policy exists on wellbeing.${table}`, async () => {
      const result = await ctx.db.execute<{ policyname: string }>(sql`
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'wellbeing'
          AND tablename  = ${table}
          AND policyname = 'tenant_isolation'
      `);
      expect(result.length).toBe(1);
    });
  }

  it('withWellbeingTenantContext sets app.current_tenant_id for the transaction', async () => {
    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      const result = await tx.execute<{ setting: string }>(
        sql`SELECT current_setting('app.current_tenant_id', true) AS setting`,
      );
      expect(result[0]?.setting).toBe(ctx.tenantId);
    });
  });

  it('inserts a case within tenant context and reads it back', async () => {
    const now = new Date();
    await withWellbeingTenantContext(ctx.db, ctx.tenantId, async (tx) => {
      await tx.insert(wellbeingCases).values({
        tenantId:   ctx.tenantId,
        personId:   '00000000-0000-0000-0001-000000000001',
        caseRef:    'WB-T1-001',
        statusCode: 'active',
        openedAt:   now,
      });

      const rows = await tx.select().from(wellbeingCases);
      expect(rows.some((r) => r.caseRef === 'WB-T1-001')).toBe(true);
    });
  });
});

// ── Bitemporal constraints ────────────────────────────────────────────────────
//
// Constraint violations abort the postgres transaction. Each failing insert
// must be the *only* statement in its transaction so the outer await can
// correctly observe the rejection.

describe('Stage 1 — bitemporal: constraints enforced on disability_support_case', () => {
  const personId  = '00000000-0000-0000-0001-000000000002';
  const logicalId = '00000000-0000-0000-0001-aaa000000001';
  const now       = new Date();
  const past      = new Date(now.getTime() - 86400_000);
  const future    = new Date(now.getTime() + 86400_000);
  // Use a fixed UUID — no FK on wellbeing_case_id in this table.
  const caseId    = '00000000-0000-0000-0001-ccc000000001';

  it('inserts a bitemporal row with open valid_to', async () => {
    await ctx.db.insert(disabilitySupportCases).values({
      id:                    logicalId,
      tenantId:              ctx.tenantId,
      wellbeingCaseId:       caseId,
      personId,
      supportTypeCode:       'dsa',
      statusCode:            'assessment_pending',
      supportPlanStatusCode: 'none',
      actorId:               'test-actor',
      validFrom:             past,
      validTo:               null,
      recordedAt:            now,
      recordedUntil:         null,
    });

    const rows = await ctx.db.select().from(disabilitySupportCases);
    expect(rows.some((r) => r.id === logicalId)).toBe(true);
  });

  it('rejects valid_to before valid_from (temporal_check_valid)', async () => {
    await expect(
      ctx.db.insert(disabilitySupportCases).values({
        id:                    '00000000-0000-0000-0001-aaa000000002',
        tenantId:              ctx.tenantId,
        wellbeingCaseId:       caseId,
        personId,
        supportTypeCode:       'dsa',
        statusCode:            'active',
        supportPlanStatusCode: 'none',
        actorId:               'test-actor',
        validFrom:             now,
        validTo:               past,    // INVALID: validTo < validFrom
        recordedAt:            now,
        recordedUntil:         null,
      }),
    ).rejects.toThrow();
  });

  it('enforces unique current version per logical id (no duplicate open rows)', async () => {
    // The open row for logicalId was inserted above. A second open row
    // (same tenant + id, recordedUntil IS NULL) violates the unique index.
    await expect(
      ctx.db.insert(disabilitySupportCases).values({
        id:                    logicalId,
        tenantId:              ctx.tenantId,
        wellbeingCaseId:       caseId,
        personId,
        supportTypeCode:       'dsa',
        statusCode:            'active',
        supportPlanStatusCode: 'none',
        actorId:               'test-actor',
        validFrom:             future,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,    // second open row → unique index violation
      }),
    ).rejects.toThrow();
  });
});

// ── Health endpoints ──────────────────────────────────────────────────────────

describe('Stage 1 — health routes', () => {
  it('GET /health returns 200 with service: wellbeing', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; service: string }>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('wellbeing');
  });

  it('GET /ready returns 200 when DB is healthy', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; checks: Record<string, { status: string }> }>();
    expect(body.status).toBe('ok');
    expect(body.checks['database']?.status).toBe('ok');
  });

  it('GET /metrics returns Prometheus text format', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('wellbeing_uptime_seconds');
  });
});
