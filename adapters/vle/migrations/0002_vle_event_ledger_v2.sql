-- Phase 9 Stage 3 — Event Consumer Foundation
-- Extends vle_event_ledger with columns needed for replay checkpointing,
-- payload hashing (observability), and per-attempt error tracking.
--
-- The unique constraint on (tenant_id, event_id) is intentionally dropped.
-- Idempotency is enforced at query time by filtering for status_code = 'processed'.
-- Keeping the constraint would prevent recording multiple failed attempts for
-- the same event, breaking retry observability.

ALTER TABLE vle_connector.vle_event_ledger
  ADD COLUMN IF NOT EXISTS "stream_seq"     bigint,
  ADD COLUMN IF NOT EXISTS "event_hash"     text,
  ADD COLUMN IF NOT EXISTS "attempt_count"  integer NOT NULL DEFAULT 1;

ALTER TABLE vle_connector.vle_event_ledger
  DROP CONSTRAINT IF EXISTS vle_event_ledger_tenant_id_event_id_key;

-- Idempotency lookup: (tenant_id, event_id, status_code)
CREATE INDEX IF NOT EXISTS vle_event_ledger_idempotency_idx
  ON vle_connector.vle_event_ledger ("tenant_id", "event_id", "status_code");

-- Replay checkpoint: highest stream_seq per tenant
CREATE INDEX IF NOT EXISTS vle_event_ledger_stream_seq_idx
  ON vle_connector.vle_event_ledger ("tenant_id", "stream_seq" DESC NULLS LAST);
