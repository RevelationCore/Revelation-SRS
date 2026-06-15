import { eq, sql } from 'drizzle-orm';

import type { WellbeingDb, WellbeingTx } from '../db/client.js';
import { srsEcHandoffOutbox } from '../db/schema/srs-ec-handoff.js';

/** Idempotency key for an EC claim handoff. */
export function ecHandoffKey(ecClaimId: string): string {
  return `ec-handoff-${ecClaimId}`;
}

/**
 * Insert a pending EC handoff record in the same transaction as the upheld
 * status transition.  ON CONFLICT DO NOTHING ensures exactly-once enqueue.
 */
export async function enqueueEcHandoff(
  tx:        WellbeingTx,
  tenantId:  string,
  ecClaimId: string,
  personId:  string,
  payload:   Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO wellbeing.srs_ec_handoff_outbox
      (tenant_id, ec_claim_id, person_id, idempotency_key, payload)
    VALUES
      (${tenantId}::uuid, ${ecClaimId}::uuid, ${personId}::uuid,
       ${ecHandoffKey(ecClaimId)}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
}

/** Fetch the outbox record for an EC claim (null if not yet enqueued). */
export async function findEcHandoffForClaim(
  db:        WellbeingDb | WellbeingTx,
  ecClaimId: string,
) {
  const rows = await db
    .select()
    .from(srsEcHandoffOutbox)
    .where(eq(srsEcHandoffOutbox.ecClaimId, ecClaimId))
    .limit(1);
  return rows[0] ?? null;
}

/** Mark an EC handoff record as successfully sent. */
export async function markEcHandoffSent(
  db:          WellbeingDb | WellbeingTx,
  outboxId:    string,
  srsResponse: Record<string, unknown>,
): Promise<void> {
  await db
    .update(srsEcHandoffOutbox)
    .set({ statusCode: 'sent', sentAt: new Date(), srsResponse, updatedAt: new Date() })
    .where(eq(srsEcHandoffOutbox.id, outboxId));
}

/** Mark an EC handoff record as failed and record the error. */
export async function markEcHandoffFailed(
  db:          WellbeingDb | WellbeingTx,
  outboxId:    string,
  errorDetail: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE wellbeing.srs_ec_handoff_outbox
    SET    status_code       = 'failed',
           attempt_count     = attempt_count + 1,
           last_attempted_at = now(),
           error_detail      = ${errorDetail},
           updated_at        = now()
    WHERE  id = ${outboxId}::uuid
  `);
}
