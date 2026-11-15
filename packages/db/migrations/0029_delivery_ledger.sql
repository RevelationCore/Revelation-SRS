-- 0029 — Platform delivery ledger for outbound flows to adjacent systems
--
-- Many capabilities outside the core SRS (library, CRM, accommodation, ...)
-- are not automated at every institution. Adjustments already handle this
-- with per-target fulfilment modes, an outbox and a manual task queue; this
-- generalises the same pattern to every outbound reference-model flow
-- (F-SIS-LIB-01 and so on) so each one has a working route from day one:
--
--   connected — an integration consumes srs.delivery.requested.<flow> and replies
--   manual    — the item is a task in the staff integration task queue
--   file      — collected by a file export
--   not-used  — nothing is recorded
--
-- One delivery_item per flow per change to a subject (e.g. an enrolment's
-- status). For state-sync flows a newer item supersedes an older one for the
-- same subject that has not been delivered yet: the target needs the latest
-- state, not every intermediate one.

CREATE TABLE IF NOT EXISTS "delivery_flow_config" (
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant" ("id"),
  "flow_code"              text        NOT NULL,
  "fulfilment_mode_code"   text        NOT NULL,
  "owner_description"      text,
  "alert_after_hours"      integer     NOT NULL DEFAULT 72
                             CHECK ("alert_after_hours" BETWEEN 1 AND 8760),
  "notify_email"           text,
  "last_overdue_notice_at" timestamptz,
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_by"             text        NOT NULL,
  PRIMARY KEY ("tenant_id", "flow_code")
);

ALTER TABLE "delivery_flow_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_flow_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "delivery_flow_config";
CREATE POLICY tenant_isolation ON "delivery_flow_config"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "delivery_item" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "flow_code"             text        NOT NULL,
  "target_system"         text        NOT NULL,
  "subject_type"          text        NOT NULL,   -- e.g. enrolment
  "subject_id"            uuid        NOT NULL,
  "person_id"             uuid,                   -- for the task queue's "who"
  -- Caller-supplied key for the change this item carries; a repeat is ignored.
  "idempotency_key"       text        NOT NULL,
  -- The minimal data the target needs; shown in the task queue and sent in
  -- the event. Never notes, evidence or special-category detail.
  "payload"               jsonb       NOT NULL DEFAULT '{}',
  "summary"               text        NOT NULL,   -- one line for the queue, e.g. "Set library access: active until 2027-06-30"
  "fulfilment_mode_code"  text        NOT NULL,   -- connected | manual | file
  -- pending | delivered | failed | superseded
  "status_code"           text        NOT NULL DEFAULT 'pending',
  "failure_reason"        text,
  "request_event_id"      uuid        NOT NULL DEFAULT gen_random_uuid(),
  "request_published_at"  timestamptz,
  "delivered_at"          timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "flow_code", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "delivery_item_subject_idx"
  ON "delivery_item" ("tenant_id", "flow_code", "subject_id", "created_at");
CREATE INDEX IF NOT EXISTS "delivery_item_open_manual_idx"
  ON "delivery_item" ("tenant_id", "flow_code", "created_at")
  WHERE "fulfilment_mode_code" = 'manual' AND "status_code" IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS "delivery_item_unpublished_idx"
  ON "delivery_item" ("tenant_id", "created_at")
  WHERE "fulfilment_mode_code" = 'connected' AND "status_code" = 'pending' AND "request_published_at" IS NULL;

ALTER TABLE "delivery_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_item" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "delivery_item";
CREATE POLICY tenant_isolation ON "delivery_item"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('delivery_flow_config', 'fulfilment_mode_code', 'distribution-fulfilment-mode-code', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "communication_template" (
  "id", "tenant_id", "template_key", "channel_code", "locale_code",
  "subject_template", "body_template", "version", "active", "created_by"
)
VALUES
  (gen_random_uuid(), NULL,
   'delivery-tasks.overdue', 'email', 'en-GB',
   '{overdueCount} overdue {flowName} tasks',
   'There are {overdueCount} {flowName} tasks waiting longer than {alertAfterHours} hours ({openCount} open in total; the oldest has waited since {oldestDueSince}). The {targetLabel} does not reflect these changes until someone applies them and confirms it. Open the queue: {queueUrl}',
   1, true, 'system')
ON CONFLICT DO NOTHING;
