-- 0001 — Adjustment instructions (AJ-21 finding 1)
--
-- The connector now acts on srs.adjustment.distribution-requested.vle and
-- ...distribution-withdrawal-requested.vle. The map row keeps the structured
-- amount, so the connector can recompute the time accommodation it should
-- hold for a student in each course (combining all their active adjustments)
-- whenever their courses or the course's assessments change, and records
-- withdrawal.
--
-- status_code: pending | applied | acknowledged | failed | withdrawn

ALTER TABLE vle_connector.vle_adjustment_map
  ADD COLUMN IF NOT EXISTS "amount_value"               numeric(8,2),
  ADD COLUMN IF NOT EXISTS "amount_unit_code"           text,
  ADD COLUMN IF NOT EXISTS "withdrawn_at"               timestamptz,
  ADD COLUMN IF NOT EXISTS "withdrawal_acknowledged_at" timestamptz;
