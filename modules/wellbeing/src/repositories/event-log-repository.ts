import { createHash } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import { eventLog } from '../db/schema/event-tracking.js';

export const CONSUMER_GROUP = 'wellbeing.main';

/**
 * Returns true if this (eventId, consumerGroup) pair has already been recorded.
 * The caller should skip processing when this returns true.
 */
export async function isAlreadyProcessed(
  tx:            WellbeingTx,
  eventId:       string,
  consumerGroup: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: eventLog.id })
    .from(eventLog)
    .where(
      and(
        eq(eventLog.eventId, eventId),
        eq(eventLog.consumerGroup, consumerGroup),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Records a processed event.  Call after the projection update succeeds,
 * inside the same transaction.
 */
export async function markProcessed(
  tx:            WellbeingTx,
  opts: {
    eventId:       string;
    subject:       string;
    tenantId:      string;
    streamSeq?:    bigint;
    consumerGroup: string;
    payload:       unknown;
  },
): Promise<void> {
  const hash = createHash('sha256')
    .update(JSON.stringify(opts.payload))
    .digest('hex');

  await tx.insert(eventLog).values({
    eventId:       opts.eventId,
    subject:       opts.subject,
    tenantId:      opts.tenantId,
    streamSeq:     opts.streamSeq ?? null,
    consumerGroup: opts.consumerGroup,
    eventHash:     hash,
  });
}

/**
 * Returns the highest stream sequence number processed by this consumer group,
 * or null if no events have been processed yet.  Used as a restart checkpoint.
 */
export async function getLastOffset(
  tx:            WellbeingTx,
  tenantId:      string,
  consumerGroup: string,
): Promise<bigint | null> {
  const rows = await tx
    .select({ seq: eventLog.streamSeq })
    .from(eventLog)
    .where(
      and(
        eq(eventLog.tenantId, tenantId),
        eq(eventLog.consumerGroup, consumerGroup),
        sql`${eventLog.streamSeq} IS NOT NULL`,
      ),
    )
    .orderBy(desc(eventLog.streamSeq))
    .limit(1);

  return rows[0]?.seq ?? null;
}
