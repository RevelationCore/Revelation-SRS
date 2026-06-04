import { sql } from 'drizzle-orm';

import type { Db } from './pool.js';

export type TenantScopedDb = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Enable Row-Level Security on a table and create the standard tenant
 * isolation policy.  Call once per table during migration.
 *
 * Policy: only rows whose tenant_id matches the current session setting
 * app.current_tenant_id are visible.
 *
 * The system-administrator PostgreSQL role is granted BYPASSRLS and uses
 * this only for platform-level operations (all audited separately).
 */
export function rlsPolicySql(tableName: string): string {
  return `
    ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${tableName}" FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation ON "${tableName}";
    CREATE POLICY tenant_isolation ON "${tableName}"
      USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
      );
  `;
}

/**
 * Execute all queries in fn within a transaction that has the tenant context
 * set for RLS evaluation.  Uses SET LOCAL so the setting is scoped to the
 * current transaction and will not leak to the next caller of the connection.
 */
export async function withTenantContext<T>(
  db: Db,
  tenantId: string,
  fn: (tx: TenantScopedDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Set tenant context at the session level (outside a transaction).
 * Use this when the request lifecycle wraps an entire sequence of DB calls.
 * The setting persists until overwritten; the connection pool overwrites it
 * on every new request, so leakage between requests is prevented.
 */
export async function setTenantContext(
  db: Db,
  tenantId: string,
): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`,
  );
}
