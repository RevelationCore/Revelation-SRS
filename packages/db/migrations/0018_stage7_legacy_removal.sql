-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0018 — Stage 7: Legacy Removal and Schema Simplification
--
-- Removes the amount_pence column from fee_liability.
--
-- History:
--   Migration 0000 created fee_liability with amount_pence (integer, GBP-implicit).
--   Migration 0012 added amount_minor_units (bigint) and currency_code (text, default GBP)
--   as currency-aware replacements. All new records written after 0012 use
--   amount_minor_units; amount_pence has been set to NULL on every new insert
--   since migration 0012 was applied. The enrolment service never writes
--   amount_pence for records created in this codebase.
--
-- No data migration is required: this column has been null on all newly created
-- fee liabilities since migration 0012. Historical non-null values in production
-- must be migrated via a one-off data script before this migration runs on prod.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "fee_liability" DROP COLUMN IF EXISTS "amount_pence";
