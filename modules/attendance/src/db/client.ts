import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type AttendanceDb = ReturnType<typeof createAttendanceDb>;
export type AttendanceTx = Parameters<Parameters<AttendanceDb['transaction']>[0]>[0];

export function createAttendanceDb(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  const client = postgres(connectionString, {
    max:          10,
    idle_timeout: 30,
    prepare:      false,
    onnotice: () => { /* suppress NOTICE from migrations */ },
  });

  const db = drizzle(client, { schema, logger: false });

  // Restore ISO-string serialization for raw sql`` queries using Date objects.
  // Same fix as packages/db/src/pool.ts — Drizzle replaces postgres.js date
  // serializers with identity functions which breaks direct Date usage.
  const toIso = (d: unknown) => d instanceof Date ? d.toISOString() : d as string;
  for (const oid of [1082, 1083, 1114, 1184] as const) {
    (client.options.serializers as Record<number, typeof toIso>)[oid] = toIso;
  }

  return db;
}

/**
 * Execute all queries in fn within a transaction that has the tenant context
 * set for RLS evaluation. Uses SET LOCAL (true) to scope to this transaction.
 *
 * Typed for AttendanceDb rather than Db, so it cannot be confused with the
 * SRS database's withTenantContext helper in packages/db.
 */
export async function withAttendanceTenantContext<T>(
  db: AttendanceDb,
  tenantId: string,
  fn: (tx: AttendanceTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}
