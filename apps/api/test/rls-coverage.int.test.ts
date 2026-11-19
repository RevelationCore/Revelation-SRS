import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * Every core table that holds tenant data is isolated by row-level security
 * (enterprise readiness plan, item 1.3). A new migration that adds a
 * tenant_id column without RLS, without FORCE, or without a policy fails
 * here, naming the table.
 */

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('row-level security coverage', () => {
  it('enables and forces RLS, with a policy, on every table with a tenant_id', async () => {
    const rows = await ctx.db.execute<{ table: string; enabled: boolean; forced: boolean; policies: number }>(sql`
      SELECT n.nspname || '.' || c.relname AS table,
             c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname IN ('public', 'documents')
        AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
      ORDER BY 1
    `);
    expect(rows.length).toBeGreaterThan(200);
    const unprotected = rows.filter((r) => !r.enabled || !r.forced || r.policies === 0).map((r) => r.table);
    expect(unprotected).toEqual([]);
  });

  it('reads the tenant setting through NULLIF in every policy, so no context matches no rows', async () => {
    const rows = await ctx.db.execute<{ policy: string }>(sql`
      SELECT c.relname || '.' || p.polname AS policy
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
            ~ '\\(current_setting\\(''app\\.current_tenant_id''::text, true\\)\\)::uuid'
    `);
    expect(rows.map((r) => r.policy)).toEqual([]);
  });
});
