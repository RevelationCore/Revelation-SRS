/**
 * Row-level security coverage for the attendance schema (BL-034), the module
 * counterpart of apps/api/test/rls-coverage.int.test.ts:
 * - every attendance table with a tenant_id has RLS enabled and forced;
 * - every tenant policy tolerates an unset tenant setting (NULLIF);
 * - the service itself connects without superuser or BYPASSRLS.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestAttendanceApp } from './helpers/test-db.js';

let ctx: TestAttendanceApp;

beforeAll(async () => { ctx = await startTestApp(); }, 120_000);
afterAll(() => ctx.teardown());

describe('attendance row-level security', () => {
  it('is enabled and forced on every table with a tenant_id, each with a NULLIF-safe policy', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             count(p.policyname) FILTER (WHERE p.qual LIKE '%NULLIF(current_setting(''app.current_tenant_id''%') AS safe,
             count(p.policyname) FILTER (WHERE p.qual LIKE '%current_setting(''app.current_tenant_id''%' AND p.qual NOT LIKE '%NULLIF%') AS unsafe
      FROM   pg_class c
      JOIN   pg_namespace n ON n.oid = c.relnamespace
      JOIN   pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      LEFT   JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
      WHERE  n.nspname = 'attendance' AND c.relkind = 'r'
      GROUP  BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER  BY c.relname`) as unknown as Array<{ table: string; enabled: boolean; forced: boolean; safe: string; unsafe: string }>;

    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.enabled || !r.forced).map((r) => r.table)).toEqual([]);
    expect(rows.filter((r) => Number(r.safe) === 0 || Number(r.unsafe) > 0).map((r) => r.table)).toEqual([]);
  });

  it('applies to the service: its connection is neither superuser nor BYPASSRLS, and a query outside a tenant sees nothing', async () => {
    const [role] = await ctx.app.attendanceDb.execute(sql`
      SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`) as unknown as Array<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>;
    expect(role).toMatchObject({ name: 'attendance_api_test', rolsuper: false, rolbypassrls: false });

    const visible = await ctx.app.attendanceDb.execute(sql`SELECT count(*)::int AS n FROM attendance.engagement_policy_version`) as unknown as Array<{ n: number }>;
    expect(visible[0]?.n).toBe(0);
  });
});
