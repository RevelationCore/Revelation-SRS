import { eq, sql } from 'drizzle-orm';

import type { WellbeingDb, WellbeingTx } from '../db/client.js';
import { srsHandoffOutbox } from '../db/schema/srs-handoff.js';

// ── Outbox management ─────────────────────────────────────────────────────────

/**
 * Insert a pending handoff record for an approved adjustment case.
 *
 * The ON CONFLICT DO NOTHING on (idempotency_key) ensures that calling
 * approve more than once never results in multiple SRS submissions.
 *
 * Called inside the same transaction as the status transition to `approved`.
 */
export async function enqueueHandoff(
  tx:               WellbeingTx,
  tenantId:         string,
  adjustmentCaseId: string,
  personId:         string,
  payload:          Record<string, unknown>,
): Promise<string> {
  const idempotencyKey = `adj-handoff-${adjustmentCaseId}`;

  await tx.execute(sql`
    INSERT INTO wellbeing.srs_handoff_outbox
      (tenant_id, adjustment_case_id, person_id, idempotency_key, payload)
    VALUES
      (${tenantId}::uuid, ${adjustmentCaseId}::uuid, ${personId}::uuid,
       ${idempotencyKey}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
  `);

  return idempotencyKey;
}

/** Fetch the outbox record for an adjustment case (null if not yet enqueued). */
export async function findHandoffForCase(
  db:               WellbeingDb | WellbeingTx,
  adjustmentCaseId: string,
) {
  const rows = await db
    .select()
    .from(srsHandoffOutbox)
    .where(eq(srsHandoffOutbox.adjustmentCaseId, adjustmentCaseId))
    .limit(1);
  return rows[0] ?? null;
}

/** Mark a handoff record as successfully sent. */
export async function markHandoffSent(
  db:          WellbeingDb | WellbeingTx,
  outboxId:    string,
  srsResponse: Record<string, unknown>,
): Promise<void> {
  await db
    .update(srsHandoffOutbox)
    .set({
      statusCode:   'sent',
      sentAt:       new Date(),
      srsResponse,
      updatedAt:    new Date(),
    })
    .where(eq(srsHandoffOutbox.id, outboxId));
}

/** Mark a handoff record as failed and record the error. */
export async function markHandoffFailed(
  db:          WellbeingDb | WellbeingTx,
  outboxId:    string,
  errorDetail: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE wellbeing.srs_handoff_outbox
    SET    status_code       = 'failed',
           attempt_count     = attempt_count + 1,
           last_attempted_at = now(),
           error_detail      = ${errorDetail},
           updated_at        = now()
    WHERE  id = ${outboxId}::uuid
  `);
}
