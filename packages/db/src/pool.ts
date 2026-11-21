import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Db = ReturnType<typeof createDb>;

/**
 * Create a Drizzle database instance.
 *
 * In production the connection string comes from OpenBao via the container
 * environment.  In development it comes from .env / DATABASE_URL.
 */
/**
 * Timeouts (BL-011, readiness 2.3). A connection attempt always gives up
 * after 10 s. Statement and idle-in-transaction limits are set by services
 * that serve requests (the API: 30 s and 60 s; the worker: 5 minutes), and
 * left off for migrations, seeding and bulk loads, which can legitimately
 * run longer.
 */
export interface DbTimeouts {
  /** Postgres statement_timeout for every statement on this pool. */
  statementTimeoutMs?: number;
  /** Postgres idle_in_transaction_session_timeout: ends a transaction left open. */
  idleInTransactionTimeoutMs?: number;
}

export function createDb(connectionString: string, timeouts: DbTimeouts = {}): ReturnType<typeof drizzle<typeof schema>> {
  const connection: Record<string, number> = {};
  if (timeouts.statementTimeoutMs !== undefined) connection['statement_timeout'] = timeouts.statementTimeoutMs;
  if (timeouts.idleInTransactionTimeoutMs !== undefined) connection['idle_in_transaction_session_timeout'] = timeouts.idleInTransactionTimeoutMs;
  const client = postgres(connectionString, {
    max:          10,
    idle_timeout: 30,
    connect_timeout: 10,
    connection,
    prepare:      false,   // avoid named prepared statements; required for pgBouncer compatibility
    onnotice: () => { /* suppress NOTICE from migrations */ },
  });

  const db = drizzle(client, { schema, logger: false });

  // Drizzle replaces postgres.js date serializers with identity functions so its
  // ORM-level query builder can control date encoding. This breaks raw sql``
  // queries that pass Date objects directly. Restore ISO-string serialization so
  // both paths work correctly.
  const toIso = (d: unknown) => d instanceof Date ? d.toISOString() : d as string;
  for (const oid of [1082, 1083, 1114, 1184] as const) {
    (client.options.serializers as Record<number, typeof toIso>)[oid] = toIso;
  }

  return db;
}
