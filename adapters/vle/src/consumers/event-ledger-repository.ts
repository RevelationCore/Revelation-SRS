import { createHash } from 'node:crypto';

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

import type { VleDb, VleTx } from '../db/client.js';
import { eventLedger } from '../db/schema/event-ledger.js';

/** Derives the durable NATS consumer name for a given tenant. */
export function consumerNameFor(tenantId: string): string {
  return `vle-connector-${tenantId}`;
}

/** Identifies this consumer in the event ledger and logs. */
export function consumerGroupFor(tenantId: string): string {
  return `vle.${tenantId}.main`;
}

/**
 * Returns true when the event has already been successfully processed.
 * Checks specifically for statusCode = 'processed' so that previous failed
 * attempts do not block a subsequent retry.
 */
export async function isAlreadyProcessed(
  db:       VleDb | VleTx,
  tenantId: string,
  eventId:  string,
): Promise<boolean> {
  const rows = await db
    .select({ id: eventLedger.id })
    .from(eventLedger)
    .where(
      and(
        eq(eventLedger.tenantId, tenantId),
        eq(eventLedger.eventId,  eventId),
        eq(eventLedger.statusCode, 'processed'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

interface LedgerWriteOpts {
  tenantId:      string;
  eventId:       string;
  subject:       string;
  statusCode:    'processed' | 'failed' | 'skipped';
  streamSeq?:    bigint;
  payload?:      unknown;
  errorDetail?:  string;
  attemptCount?: number;
}

/** Inserts a single row into the event ledger. */
export async function writeLedger(
  db:   VleDb | VleTx,
  opts: LedgerWriteOpts,
): Promise<void> {
  const eventHash = opts.payload
    ? createHash('sha256').update(JSON.stringify(opts.payload)).digest('hex')
    : null;

  await db.insert(eventLedger).values({
    tenantId:     opts.tenantId,
    eventId:      opts.eventId,
    subject:      opts.subject,
    statusCode:   opts.statusCode,
    streamSeq:    opts.streamSeq ?? null,
    eventHash:    eventHash,
    errorDetail:  opts.errorDetail ?? null,
    attemptCount: opts.attemptCount ?? 1,
  });
}

/**
 * Returns the highest stream sequence number recorded for this tenant,
 * or null if no events have been processed yet.
 * Used as a replay/restart checkpoint.
 */
export async function getLastStreamSeq(
  db:       VleDb | VleTx,
  tenantId: string,
): Promise<bigint | null> {
  const rows = await db
    .select({ seq: eventLedger.streamSeq })
    .from(eventLedger)
    .where(
      and(
        eq(eventLedger.tenantId, tenantId),
        isNotNull(eventLedger.streamSeq),
        sql`${eventLedger.statusCode} = 'processed'`,
      ),
    )
    .orderBy(desc(eventLedger.streamSeq))
    .limit(1);

  return rows[0]?.seq ?? null;
}

/** Lists recent ledger entries for a tenant (newest first). */
export async function listRecentLedger(
  db:       VleDb | VleTx,
  tenantId: string,
  limit:    number = 50,
): Promise<typeof eventLedger.$inferSelect[]> {
  return db
    .select()
    .from(eventLedger)
    .where(eq(eventLedger.tenantId, tenantId))
    .orderBy(desc(eventLedger.processedAt))
    .limit(limit);
}
