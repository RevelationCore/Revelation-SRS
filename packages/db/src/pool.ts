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
export function createDb(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  const client = postgres(connectionString, {
    max:          10,
    idle_timeout: 30,
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
