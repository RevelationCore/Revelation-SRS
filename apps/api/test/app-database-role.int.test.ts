import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * The API suite runs as the application role, as every deployment does
 * (enterprise readiness plan, item 1.2). If the helper ever went back to the
 * superuser, row-level security would silently stop applying to every test;
 * this file fails first.
 */

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

describe('application database role', () => {
  it('connects as a login role that inherits srs_app, with no way round RLS', async () => {
    const [role] = await ctx.app.db.execute<{ name: string; superuser: boolean; bypassrls: boolean; app: boolean }>(sql`
      SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
             pg_has_role(current_user, 'srs_app', 'MEMBER') AS app
      FROM pg_roles r WHERE r.rolname = current_user
    `);
    expect(role).toEqual({ name: 'srs_api_test', superuser: false, bypassrls: false, app: true });
  });

  it('owns no tables, so FORCE is not what keeps RLS on', async () => {
    const [row] = await ctx.app.db.execute<{ owned: number }>(sql`
      SELECT count(*)::int AS owned FROM pg_tables WHERE tableowner = current_user
    `);
    expect(row?.owned).toBe(0);
  });

  it('sees no tenant rows without a tenant context, and no error either', async () => {
    await ctx.db.execute(sql`
      INSERT INTO person (id, tenant_id, student_number) VALUES (gen_random_uuid(), ${ctx.tenantId}, 'ROLE-TEST-1')
    `);
    const [owner] = await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person WHERE student_number = 'ROLE-TEST-1'`);
    expect(owner?.n).toBe(1);
    const [app] = await ctx.app.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person WHERE student_number = 'ROLE-TEST-1'`);
    expect(app?.n).toBe(0);
  });

  it('cannot change or remove the audit trail', async () => {
    const cause = async (query: Promise<unknown>) => {
      try { await query; return 'succeeded'; } catch (err) { return String((err as { cause?: unknown }).cause ?? err); }
    };
    expect(await cause(ctx.app.db.execute(sql`DELETE FROM audit_record`))).toMatch(/permission denied/);
    expect(await cause(ctx.app.db.execute(sql`UPDATE audit_record SET reason_text = 'x'`))).toMatch(/permission denied/);
  });
});
