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
    max:       10,
    idle_timeout: 30,
    onnotice: () => { /* suppress NOTICE from migrations */ },
  });

  return drizzle(client, { schema, logger: false });
}
