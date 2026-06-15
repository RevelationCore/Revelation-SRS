-- Migration 0007: retention metadata + SAR export audit log
-- Adds data governance columns to wellbeing_case and a log table for GDPR SAR exports.

ALTER TABLE wellbeing.wellbeing_case
  ADD COLUMN IF NOT EXISTS lawful_basis_code       TEXT NOT NULL DEFAULT 'gdpr-art6-e',
  ADD COLUMN IF NOT EXISTS data_classification_code TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS retention_due_date       TIMESTAMPTZ;

-- SAR export log — one row per Subject Access Request export run.
-- Immutable: no UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS wellbeing.sar_export_log (
  "id"                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              UUID        NOT NULL REFERENCES "tenant" ("id"),
  "exported_for_person_id" UUID        NOT NULL,
  "requested_by_actor_id"  TEXT        NOT NULL,
  "exported_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "record_counts"          JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS sar_export_log_tenant_person
  ON wellbeing.sar_export_log (tenant_id, exported_for_person_id);

ALTER TABLE wellbeing.sar_export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY sar_export_log_tenant_isolation
  ON wellbeing.sar_export_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
