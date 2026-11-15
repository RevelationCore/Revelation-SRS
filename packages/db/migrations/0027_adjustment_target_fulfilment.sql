-- 0027 — How each adjustment target is fulfilled, per tenant
--
-- Which systems an adjustment reaches was hard-coded by scope, so every
-- institution got an attendance distribution that waited forever whether or
-- not it had an attendance system: "pending" meant both "waiting for a system
-- that exists" and "nothing will ever do this". Each tenant now says, per
-- target, how it is fulfilled:
--
--   connected — an integration connector consumes the per-target instruction
--               event and replies through the API (e.g. the VLE adapter)
--   manual    — no automation: the instruction becomes a task in the staff
--               adjustment task queue; a person applies it and confirms
--   file      — delivered through a file exchange the SRS produces (exams:
--               exam entries, exam-scheduling.v1)
--   not-used  — the institution does not deliver adjustments to this target;
--               no distribution is created
--
-- Tenants without a row use the platform default for the target (code:
-- DEFAULT_FULFILMENT_MODES). The mode in force is copied onto each
-- distribution when it is created, so changing it later affects new
-- distributions only and history stays truthful.

CREATE TABLE IF NOT EXISTS "adjustment_target_config" (
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant" ("id"),
  "target_system"        text        NOT NULL,
  "fulfilment_mode_code" text        NOT NULL,
  -- Who works manual tasks for this target, for the queue (e.g. "Attendance team").
  "owner_description"    text,
  -- A manual task older than this is flagged overdue in the queue.
  "alert_after_hours"    integer     NOT NULL DEFAULT 72
                           CHECK ("alert_after_hours" BETWEEN 1 AND 8760),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_by"           text        NOT NULL,
  PRIMARY KEY ("tenant_id", "target_system")
);

ALTER TABLE "adjustment_target_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_target_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_target_config";
CREATE POLICY tenant_isolation ON "adjustment_target_config"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- Existing distributions were all sent as events: connected.
ALTER TABLE "adjustment_distribution"
  ADD COLUMN IF NOT EXISTS "fulfilment_mode_code" text NOT NULL DEFAULT 'connected';

CREATE INDEX IF NOT EXISTS "adjustment_distribution_manual_open_idx"
  ON "adjustment_distribution" ("tenant_id", "target_system", "created_at")
  WHERE "fulfilment_mode_code" = 'manual'
    AND "status_code" IN ('pending', 'failed', 'withdrawal-requested');

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('distribution-fulfilment-mode-code', 'Adjustment Target Fulfilment Mode', 'srs-internal', NULL,
   'How an institution fulfils reasonable-adjustment instructions for a target system', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('connected', 'Connected system', 'An integration connector consumes the instruction and replies', 10),
  ('manual',    'Manual task',      'Staff apply the instruction and confirm it in the task queue',   20),
  ('file',      'File exchange',    'Delivered through a file exchange the SRS produces',             30),
  ('not-used',  'Not used',         'No adjustments are delivered to this target',                    40)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'distribution-fulfilment-mode-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('adjustment_target_config', 'fulfilment_mode_code', 'distribution-fulfilment-mode-code', NULL)
ON CONFLICT DO NOTHING;
