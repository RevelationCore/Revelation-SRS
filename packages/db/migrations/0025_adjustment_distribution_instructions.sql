-- 0025 — Adjustment distribution instructions (AJ-21 finding 1)
--
-- Target systems were never told to apply an adjustment: the only event
-- carrying a distributionId (srs.adjustment.distributed) was published after a
-- target acknowledged, and targets were told to wait for it. This migration
-- adds what the per-target instruction events need:
--
--   1. A structured amount on reasonable_adjustment (e.g. 25 percent of the
--      assessment's duration), so an integration layer can compute a concrete
--      value per assessment instead of parsing free-text notes.
--   2. Outbox columns on adjustment_distribution. Each row already records the
--      intent to deliver to one target; it now also records the instruction's
--      event id and when it was published, so a periodic dispatcher can
--      republish anything lost when the bus was unavailable. The event id is
--      reused on every attempt, so JetStream's duplicate window and the
--      consumer's distributionId check both absorb a republish.
--   3. A withdrawal lifecycle (withdrawal-requested -> withdrawn) for
--      distributions whose instruction was already sent when the adjustment
--      expires: VLE overrides do not lapse on their own.

-- ── 1. Structured amount ─────────────────────────────────────────────────────

ALTER TABLE "reasonable_adjustment"
  ADD COLUMN IF NOT EXISTS "amount_value"     numeric(8,2),
  ADD COLUMN IF NOT EXISTS "amount_unit_code" text;

ALTER TABLE "reasonable_adjustment"
  DROP CONSTRAINT IF EXISTS "reasonable_adjustment_amount_pair_check";
ALTER TABLE "reasonable_adjustment"
  ADD CONSTRAINT "reasonable_adjustment_amount_pair_check"
  CHECK (("amount_value" IS NULL) = ("amount_unit_code" IS NULL));

ALTER TABLE "reasonable_adjustment"
  DROP CONSTRAINT IF EXISTS "reasonable_adjustment_amount_positive_check";
ALTER TABLE "reasonable_adjustment"
  ADD CONSTRAINT "reasonable_adjustment_amount_positive_check"
  CHECK ("amount_value" IS NULL OR "amount_value" > 0);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('adjustment-amount-unit-code', 'Reasonable Adjustment Amount Unit', 'srs-internal', NULL,
   'Unit of a reasonable adjustment''s structured amount', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('percent-of-duration', 'Percent of duration', 'Additional time as a percentage of the assessment''s duration (e.g. 25)', 10),
  ('minutes-per-hour',    'Minutes per hour',    'Additional minutes for each hour of the assessment''s duration (e.g. 15)', 20),
  ('days',                'Days',                'Calendar days (e.g. the most a deadline may be extended by)',            30)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'adjustment-amount-unit-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('reasonable_adjustment', 'amount_unit_code', 'adjustment-amount-unit-code', NULL)
ON CONFLICT DO NOTHING;

-- ── 2. Instruction outbox on the distribution ledger ─────────────────────────

ALTER TABLE "adjustment_distribution"
  ADD COLUMN IF NOT EXISTS "request_event_id"        uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "request_published_at"    timestamptz,
  ADD COLUMN IF NOT EXISTS "withdrawal_event_id"     uuid,
  ADD COLUMN IF NOT EXISTS "withdrawal_requested_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "withdrawal_published_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "withdrawn_at"            timestamptz;

-- Rows a target already acknowledged were applied without an instruction
-- event; mark them as instructed so the dispatcher never sends one late.
-- Pending rows stay unpublished: they never reached a target, and the
-- dispatcher now delivers them.
UPDATE "adjustment_distribution"
SET "request_published_at" = COALESCE("distributed_at", "updated_at")
WHERE "status_code" = 'distributed' AND "request_published_at" IS NULL;

-- Dispatcher scans: unpublished requests and unpublished withdrawals.
CREATE INDEX IF NOT EXISTS "adjustment_distribution_unpublished_request_idx"
  ON "adjustment_distribution" ("tenant_id", "created_at")
  WHERE "status_code" = 'pending' AND "request_published_at" IS NULL;
CREATE INDEX IF NOT EXISTS "adjustment_distribution_unpublished_withdrawal_idx"
  ON "adjustment_distribution" ("tenant_id", "withdrawal_requested_at")
  WHERE "status_code" = 'withdrawal-requested' AND "withdrawal_published_at" IS NULL;

-- ── 3. Withdrawal statuses ───────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('withdrawal-requested', 'Withdrawal requested', 'The target was told to remove an adjustment it may have applied', 50),
  ('withdrawn',            'Withdrawn',            'The target confirmed it removed the adjustment',                   60)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'distribution-status-code'
ON CONFLICT DO NOTHING;
