-- ─────────────────────────────────────────────────────────────────────────────
-- 0023 — Live Temporal execution foundations
--
-- See docs/architecture/temporal-integration-plan.md (Stage 2) and
-- docs/decisions/ADR-024-live-temporal-execution.md.
--
-- 1. Execution metadata on workflow_instance. Every existing instance is
--    backfilled as 'legacy' by the column default; the backend is fixed at
--    start and never changes.
-- 2. A revision counter on workflow_task, so decisions, escalations and
--    cancellations can be serialised against one task version.
-- 3. workflow_command: one accepted decision or cancellation per task
--    revision, saved before Temporal is contacted.
-- 4. workflow_operation_receipt: one row per applied effect, keyed by a
--    stable operation key, so a retried activity returns the first result.
-- 5. workflow_event_outbox: workflow events saved in the same transaction
--    as the state change, published afterwards.
-- 6. The 'workflow.temporal-execution' rollout flag, default off.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Execution metadata ────────────────────────────────────────────────────

ALTER TABLE "workflow_instance"
  ADD COLUMN IF NOT EXISTS "execution_backend"          text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "execution_status"           text,
  ADD COLUMN IF NOT EXISTS "temporal_namespace"         text,
  ADD COLUMN IF NOT EXISTS "temporal_task_queue"        text,
  ADD COLUMN IF NOT EXISTS "temporal_workflow_id"       text,
  ADD COLUMN IF NOT EXISTS "temporal_run_id"            text,
  ADD COLUMN IF NOT EXISTS "execution_contract_version" integer,
  ADD COLUMN IF NOT EXISTS "execution_status_detail"    text,
  ADD COLUMN IF NOT EXISTS "execution_updated_at"       timestamp with time zone;

ALTER TABLE "workflow_instance" DROP CONSTRAINT IF EXISTS "workflow_instance_execution_backend_check";
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_execution_backend_check"
  CHECK ("execution_backend" IN ('legacy', 'temporal'));

ALTER TABLE "workflow_instance" DROP CONSTRAINT IF EXISTS "workflow_instance_execution_status_check";
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_execution_status_check"
  CHECK (
    ("execution_backend" = 'legacy' AND "execution_status" IS NULL)
    OR ("execution_backend" = 'temporal' AND "execution_status" IN (
      'starting', 'awaiting-decision', 'applying', 'needs-attention', 'completed', 'cancelled', 'failed'
    ))
  );

ALTER TABLE "workflow_instance" DROP CONSTRAINT IF EXISTS "workflow_instance_temporal_identity_check";
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_temporal_identity_check"
  CHECK (
    "execution_backend" = 'legacy'
    OR ("temporal_namespace" IS NOT NULL AND "temporal_task_queue" IS NOT NULL
        AND "temporal_workflow_id" IS NOT NULL AND "execution_contract_version" IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instance_temporal_workflow_id_uq"
  ON "workflow_instance" ("temporal_namespace", "temporal_workflow_id")
  WHERE "temporal_workflow_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "workflow_instance_execution_status_idx"
  ON "workflow_instance" ("tenant_id", "execution_status")
  WHERE "execution_backend" = 'temporal';

-- ── 2. Task revisions ────────────────────────────────────────────────────────

ALTER TABLE "workflow_task"
  ADD COLUMN IF NOT EXISTS "revision"              integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "escalated_at"          timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "attention_reason_code" text;

-- ── 3. Accepted commands ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_command" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid NOT NULL REFERENCES "tenant"("id"),
  "workflow_instance_id" uuid NOT NULL REFERENCES "workflow_instance"("id"),
  "workflow_task_id"     uuid REFERENCES "workflow_task"("id"),
  "task_revision"        integer,
  "command_type"         text NOT NULL,
  "idempotency_key"      text NOT NULL,
  "payload_hash"         text NOT NULL,
  "decision_code"        text,
  "payload"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actor_id"             text NOT NULL,
  "accepted_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "delivery_state"       text NOT NULL DEFAULT 'pending',
  "delivery_attempts"    integer NOT NULL DEFAULT 0,
  "next_delivery_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at"         timestamp with time zone,
  "applied_at"           timestamp with time zone,
  "result"               jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code"           text,
  "error_detail"         text,
  CONSTRAINT "workflow_command_type_check"
    CHECK ("command_type" IN ('decision', 'cancellation')),
  CONSTRAINT "workflow_command_delivery_state_check"
    CHECK ("delivery_state" IN ('pending', 'delivered', 'applied', 'superseded', 'failed')),
  CONSTRAINT "workflow_command_decision_code_check"
    CHECK ("command_type" <> 'decision' OR "decision_code" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_command_idempotency_uq"
  ON "workflow_command" ("tenant_id", "idempotency_key");

-- One accepted command per task revision: a second decision, or a
-- decision racing a cancellation, loses on this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_command_task_revision_uq"
  ON "workflow_command" ("workflow_task_id", "task_revision")
  WHERE "workflow_task_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "workflow_command_undelivered_idx"
  ON "workflow_command" ("next_delivery_at")
  WHERE "delivery_state" = 'pending';

CREATE INDEX IF NOT EXISTS "workflow_command_instance_idx"
  ON "workflow_command" ("workflow_instance_id", "accepted_at");

ALTER TABLE "workflow_command" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_command" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_command";
CREATE POLICY tenant_isolation ON "workflow_command"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── 4. Operation receipts ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_operation_receipt" (
  "tenant_id"            uuid NOT NULL REFERENCES "tenant"("id"),
  "operation_key"        text NOT NULL,
  "workflow_instance_id" uuid NOT NULL REFERENCES "workflow_instance"("id"),
  "result"               jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "operation_key")
);

ALTER TABLE "workflow_operation_receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_operation_receipt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_operation_receipt";
CREATE POLICY tenant_isolation ON "workflow_operation_receipt"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── 5. Workflow event outbox ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_event_outbox" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid NOT NULL REFERENCES "tenant"("id"),
  "event_type"          text NOT NULL,
  "event_version"       text NOT NULL,
  "correlation_id"      text NOT NULL,
  "data_classification" text NOT NULL DEFAULT 'standard',
  "payload"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "published_at"        timestamp with time zone,
  "publish_attempts"    integer NOT NULL DEFAULT 0,
  "next_attempt_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "last_error"          text
);

CREATE INDEX IF NOT EXISTS "workflow_event_outbox_unpublished_idx"
  ON "workflow_event_outbox" ("next_attempt_at")
  WHERE "published_at" IS NULL;

ALTER TABLE "workflow_event_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_event_outbox" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_event_outbox";
CREATE POLICY tenant_isolation ON "workflow_event_outbox"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── 6. Rollout flag ──────────────────────────────────────────────────────────

WITH temporal_flag AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by",
    "flag_class_code", "risk_class_code", "retirement_condition"
  )
  VALUES (
    'workflow.temporal-execution',
    'Live Temporal workflow execution',
    'When on, newly started reviews for the assigned tenant, environment and workflow '
    'definition version run on Temporal. Existing instances keep the backend they started on. '
    'Requires the API to be configured with TEMPORAL_EXECUTION_ENABLED=true and a running worker.',
    'platform', 'active', 'boolean', 'off', 'system',
    'release', 'high',
    'Retire once every workflow family runs on Temporal and no legacy instances remain.'
  )
  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "updated_at"          = now()
  RETURNING "id"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM temporal_flag f
CROSS JOIN (VALUES
  ('off', 'Off', 'false', 10),
  ('on',  'On',  'true',  20)
) AS v("variant_key", "display_name", "value", "sort_order")
ON CONFLICT ("flag_id", "variant_key") DO NOTHING;
