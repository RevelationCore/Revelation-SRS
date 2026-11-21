import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type VleDb = ReturnType<typeof createVleDb>;
export type VleTx = Parameters<Parameters<VleDb['transaction']>[0]>[0];

/** Timeouts (BL-011): connect always 10 s; statement and idle-in-transaction limits when a request-serving app asks (migrations leave them off). */
export function createVleDb(
  connectionString: string,
  timeouts: { statementTimeoutMs?: number; idleInTransactionTimeoutMs?: number } = {},
): ReturnType<typeof drizzle<typeof schema>> {
  const connection: Record<string, number> = {};
  if (timeouts.statementTimeoutMs !== undefined) connection['statement_timeout'] = timeouts.statementTimeoutMs;
  if (timeouts.idleInTransactionTimeoutMs !== undefined) connection['idle_in_transaction_session_timeout'] = timeouts.idleInTransactionTimeoutMs;
  const client = postgres(connectionString, {
    max:          10,
    idle_timeout: 30,
    connect_timeout: 10,
    connection,
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
