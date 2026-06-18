-- Phase 11 Stage 3 — Retention Anonymisation Tracking
-- Adds retention_anonymised_at column to the person table.
-- When set, this marks that personal identity data for this person has been
-- anonymised by the retention enforcement worker (NFR-PRIV-003).
-- The person root record and academic/award records are retained permanently;
-- only identifying personal data (identity, contact, address) is anonymised.

ALTER TABLE "person"
  ADD COLUMN IF NOT EXISTS "retention_anonymised_at"
  TIMESTAMPTZ DEFAULT NULL;

-- Index for the retention sweep query — quickly find persons not yet anonymised
CREATE INDEX IF NOT EXISTS "person_retention_not_anonymised_idx"
  ON "person" ("tenant_id")
  WHERE retention_anonymised_at IS NULL;
