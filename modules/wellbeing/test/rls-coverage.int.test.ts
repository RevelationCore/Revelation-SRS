/**
 * Row-level security coverage for the wellbeing schema (BL-034, BL-035), the
 * module counterpart of apps/api/test/rls-coverage.int.test.ts:
 * - every wellbeing table with a tenant_id has RLS enabled and forced;
 * - every tenant policy tolerates an unset tenant setting (NULLIF), so a
 *   query outside a tenant context sees nothing instead of failing;
 * - the service itself connects without superuser or BYPASSRLS, so these
 *   policies are what its tests exercise.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

let ctx: TestWellbeingApp;

beforeAll(async () => { ctx = await startTestApp(); }, 120_000);
afterAll(() => ctx.teardown());

describe('wellbeing row-level security', () => {
  it('is enabled and forced on every table with a tenant_id', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM   pg_class c
      JOIN   pg_namespace n ON n.oid = c.relnamespace
      JOIN   pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE  n.nspname = 'wellbeing' AND c.relkind = 'r'
      ORDER  BY c.relname`) as unknown as Array<{ table: string; enabled: boolean; forced: boolean }>;

    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.enabled || !r.forced).map((r) => r.table)).toEqual([]);
    expect(rows.map((r) => r.table)).toEqual(expect.arrayContaining(['srs_handoff_outbox', 'srs_ec_handoff_outbox']));
  });

  it('has a NULLIF-safe tenant policy on each of those tables', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT c.relname AS table,
             count(p.policyname) FILTER (WHERE p.qual LIKE '%NULLIF(current_setting(''app.current_tenant_id''%') AS safe,
             count(p.policyname) FILTER (WHERE p.qual LIKE '%current_setting(''app.current_tenant_id''%' AND p.qual NOT LIKE '%NULLIF%') AS unsafe
      FROM   pg_class c
      JOIN   pg_namespace n ON n.oid = c.relnamespace
      JOIN   pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      LEFT   JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
      WHERE  n.nspname = 'wellbeing' AND c.relkind = 'r'
      GROUP  BY c.relname`) as unknown as Array<{ table: string; safe: string; unsafe: string }>;

    expect(rows.filter((r) => Number(r.safe) === 0).map((r) => r.table)).toEqual([]);
    expect(rows.filter((r) => Number(r.unsafe) > 0).map((r) => r.table)).toEqual([]);
  });

  it('applies to the service: its connection is neither superuser nor BYPASSRLS, and sees no rows without a tenant', async () => {
    const [role] = await ctx.app.wellbeingDb.execute(sql`
      SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`) as unknown as Array<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>;
    expect(role).toMatchObject({ name: 'wellbeing_api_test', rolsuper: false, rolbypassrls: false });

    await ctx.db.execute(sql`
      INSERT INTO wellbeing.srs_ec_handoff_outbox (tenant_id, ec_claim_id, person_id, idempotency_key, payload, status_code)
      VALUES (${ctx.tenantId}, gen_random_uuid(), gen_random_uuid(), 'rls-coverage-probe', '{}'::jsonb, 'pending')`);
    const visible = await ctx.app.wellbeingDb.execute(sql`SELECT count(*)::int AS n FROM wellbeing.srs_ec_handoff_outbox`) as unknown as Array<{ n: number }>;
    expect(visible[0]?.n).toBe(0);
  });
});
