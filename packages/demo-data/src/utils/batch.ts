import type { Db } from '@revelation-srs/db';
import type { PgTable } from 'drizzle-orm/pg-core';

const BATCH_SIZE = 500;

/**
 * Insert rows in chunks of BATCH_SIZE, using ON CONFLICT DO NOTHING so the
 * operation is idempotent regardless of prior load state.
 */
export async function batchInsert<T extends Record<string, unknown>>(
  db: Db,
  table: PgTable,
  items: T[],
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (db.insert(table) as any).values(chunk).onConflictDoNothing();
  }
}
