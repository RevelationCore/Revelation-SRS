import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type VleDb = ReturnType<typeof createVleDb>;
export type VleTx = Parameters<Parameters<VleDb['transaction']>[0]>[0];

export function createVleDb(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  const client = postgres(connectionString, {
    max:          10,
    idle_timeout: 30,
    prepare:      false,
    onnotice: () => { /* suppress NOTICE from migrations */ },
  });

  const db = drizzle(client, { schema, logger: false });

  const toIso = (d: unknown) => d instanceof Date ? d.toISOString() : d as string;
  for (const oid of [1082, 1083, 1114, 1184] as const) {
    (client.options.serializers as Record<number, typeof toIso>)[oid] = toIso;
  }

  return db;
}
