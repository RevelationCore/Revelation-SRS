-- ============================================================
-- 0006_adjustments_integration_and_support
--
-- Partner-system contracts, reasonable-adjustment distribution and
-- fulfilment, live Temporal execution, the platform delivery ledger,
-- inbound records, and student support and employment.
--
-- Squashed on 2026-11-15 from migrations 0019–0032, which follow as
-- sections in their original order and with their original text. Nothing
-- has been run in production, so the history carries no data obligations.
-- scripts/verify-migration-squash.sh checked that the squashed set yields
-- the same schema and seed data.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- Originally 0019_partner_systems_contracts.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — Partner Systems Sandbox foundation
-- Migration: 0019_partner_systems_contracts
--
-- Seeds the 19 integration contracts (of the 20 already fully specified in
-- docs/architecture/integration-contract-catalogue.md) for the 10 reference-model
-- systems that previously had zero code and zero backlog entry anywhere in the
-- project: CRM, Library, Accommodation, Estates, Online ID Verification (OIV),
-- Student Evaluation of Teaching Software (SETS), Payroll, Research Proposals
-- (RP), Content Management Systems (CMS), IT Service Management (ITSM).
--
-- research-proposal-eligibility.v1 already exists (seeded in 0014_pgr_foundation
-- for the PGR lifecycle build) and is deliberately not touched here.
--
-- These contracts are exercised by apps/partner-systems-sandbox, a standalone
-- demo app that simulates both directions of each system's integration against
-- SRS's real integration registry/exchange surface. It is explicitly a
-- placeholder — see the sandbox's own README — intended to be replaced by a
-- genuine system integration without requiring any change to these contract
-- rows.

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('crm-admissions-feed.v1',              'CRM Admissions Feed',                'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'personal'),
  ('crm-student-lifecycle-updates.v1',    'CRM Student Lifecycle Updates',      'partner-systems', 'outbound', 'event-driven', '1.0.0', 'personal'),
  ('library-obligations.v1',              'Library Obligations',                'partner-systems', 'inbound',  'api',          '1.0.0', 'sensitive'),
  ('library-access-entitlement.v1',       'Library Access Entitlement',         'partner-systems', 'outbound', 'event-driven', '1.0.0', 'personal'),
  ('accommodation-eligibility.v1',        'Accommodation Eligibility',          'partner-systems', 'outbound', 'event-and-file', '1.0.0', 'personal'),
  ('accommodation-booking-status.v1',     'Accommodation Booking Status',       'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'personal'),
  ('estates-occupancy-forecast.v1',       'Estates Occupancy Forecast',         'partner-systems', 'outbound', 'event-and-file', '1.0.0', 'aggregate'),
  ('estates-room-availability.v1',        'Estates Room Availability',          'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'standard'),
  ('identity-verification-request.v1',    'Identity Verification Request',      'partner-systems', 'outbound', 'api',          '1.0.0', 'sensitive'),
  ('identity-verification-outcome.v1',    'Identity Verification Outcome',      'partner-systems', 'inbound',  'api',          '1.0.0', 'sensitive'),
  ('sets-survey-roster.v1',               'SETS Survey Roster',                 'partner-systems', 'outbound', 'api-and-file', '1.0.0', 'personal'),
  ('sets-survey-summary.v1',              'SETS Survey Summary',                'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'aggregate'),
  ('payroll-student-pay-authorisation.v1','Payroll Student Pay Authorisation',  'partner-systems', 'outbound', 'api-and-file', '1.0.0', 'sensitive'),
  ('payroll-payment-confirmation.v1',     'Payroll Payment Confirmation',       'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'sensitive'),
  ('research-studentship-award.v1',       'Research Studentship Award',         'partner-systems', 'inbound',  'api',          '1.0.0', 'sensitive'),
  ('cms-cohort-personalisation.v1',       'CMS Cohort Personalisation',         'partner-systems', 'outbound', 'api-and-event', '1.0.0', 'personal'),
  ('cms-policy-publication.v1',           'CMS Policy Publication',             'partner-systems', 'inbound',  'api-and-event', '1.0.0', 'regulatory'),
  ('itsm-student-context.v1',             'ITSM Student Context',               'partner-systems', 'outbound', 'api',          '1.0.0', 'sensitive'),
  ('itsm-account-impact.v1',              'ITSM Account Impact',                'partner-systems', 'inbound',  'api-and-event', '1.0.0', 'sensitive')
ON CONFLICT ("contract_id") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0020_reasonable_adjustment_source_case.sql
-- ════════════════════════════════════════════════════════════

-- Reasonable adjustments production hardening: trace a distributed
-- reasonable_adjustment record back to the wellbeing module case that
-- approved it. Opaque cross-service reference (wellbeing module has its
-- own database) — not a foreign key.

ALTER TABLE "reasonable_adjustment" ADD COLUMN "source_case_id" uuid;


-- ════════════════════════════════════════════════════════════
-- Originally 0021_adjustment_outcome_documents.sql
-- ════════════════════════════════════════════════════════════

-- Reasonable adjustments: core-SRS-owned outcome-document storage.
--
-- packages/documents' pluggable table set, installed into this service's
-- own database (a second, independent install alongside the one in the
-- wellbeing module's database — deliberately duplicated storage rather
-- than a cross-service reference, so this record's document survives
-- independently of the wellbeing module and is retrievable by anyone who
-- can already see the adjustment record, with no wellbeing-module role
-- required).

CREATE SCHEMA IF NOT EXISTS documents;

CREATE TABLE IF NOT EXISTS documents."document" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "owner_service"    text        NOT NULL,
  "owner_ref"        text        NOT NULL,
  "filename"         text        NOT NULL,
  "mime_type"        text        NOT NULL,
  "size_bytes"       integer     NOT NULL,
  "checksum_sha256"  text        NOT NULL,
  "content"          bytea,
  "status_code"      text        NOT NULL DEFAULT 'pending-scan',
  "uploaded_by"      text        NOT NULL,
  "uploaded_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"       timestamptz,
  "deleted_by"       text,
  "deleted_reason"   text
);

CREATE INDEX IF NOT EXISTS "document_owner_idx"
  ON documents."document" ("tenant_id", "owner_service", "owner_ref");

CREATE TABLE IF NOT EXISTS documents."document_access_log" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id"  uuid        NOT NULL,
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant" ("id"),
  "actor_id"     text        NOT NULL,
  "action"       text        NOT NULL,
  "occurred_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "document_access_log_document_idx"
  ON documents."document_access_log" ("document_id");

-- Row-level security matches this service's existing convention (same
-- app.current_tenant_id session variable already used by
-- reasonable_adjustment, adjustment_distribution, and every other
-- tenant-scoped table here).
ALTER TABLE documents."document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents."document" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents."document";
CREATE POLICY tenant_isolation ON documents."document"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE documents."document_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents."document_access_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents."document_access_log";
CREATE POLICY tenant_isolation ON documents."document_access_log"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "reasonable_adjustment"
  ADD COLUMN "outcome_document_id" uuid REFERENCES documents."document" ("id");


-- ════════════════════════════════════════════════════════════
-- Originally 0022_retire_support_outcome.sql
-- ════════════════════════════════════════════════════════════

-- Retire support_outcome — reverses migration 0004's (originally
-- 0046_support_outcome_distribution's) stated intent to replace
-- adjustment_distribution with this table and the shared distribution_item
-- primitives.
--
-- That replacement never reached parity: no route anywhere in the codebase
-- ever drove a distribution_item past creation (recordAttempt/
-- recordAcknowledgement on BusinessCaseService had zero callers — no
-- acknowledge/reconcile path existed for it), it published no domain
-- events, and no writer ever set one to 'superseded'. adjustment_distribution
-- meanwhile remained the live, fully tested path, with two documented
-- external adapter contracts (VLE — F-SIS-VLE-02, attendance — F-SIS-AM-02)
-- keying their idempotency on it. Rather than finish an unused, untested
-- replacement and migrate a live Equality Act compliance flow plus two real
-- external contracts onto it, support_outcome is retired here.
--
-- Out of scope, deliberately untouched: business_case, case_decision,
-- distribution_item, distribution_attempt, distribution_acknowledgement,
-- and BusinessCaseService#createDistributionItem all remain — they are
-- genuinely used by correction-service.ts (BPR-D13) and by PGR, identity
-- resolution, audit review and rights-requests (business_case/case_decision
-- half only). support_outcome was their only adjustments-facing consumer.

DELETE FROM "field_value_set"
WHERE "entity_name" = 'support_outcome';

DELETE FROM "value_set_member"
WHERE "value_set_id" IN (
  SELECT "id" FROM "value_set"
  WHERE "set_code" IN ('support-outcome-type-code', 'support-outcome-visibility-scope-code')
);

DELETE FROM "value_set"
WHERE "set_code" IN ('support-outcome-type-code', 'support-outcome-visibility-scope-code');

DROP TABLE IF EXISTS "support_outcome";


-- ════════════════════════════════════════════════════════════
-- Originally 0023_temporal_execution.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0024_adjustment_request_idempotency.sql
-- ════════════════════════════════════════════════════════════

-- Reasonable adjustments: idempotent recording (AJ-21 A21-AC04).
--
-- The wellbeing module sends an x-idempotency-key with each approved-outcome
-- handoff. If the SRS commits the adjustment but the response is lost, the
-- module's retry must return the original adjustment rather than create a
-- second one with its own distributions. One row per accepted request key;
-- the payload hash detects reuse of a key for a different request.
--
-- A separate table rather than columns on reasonable_adjustment, because that
-- table is bitemporal: a key belongs to the logical request, not to any one
-- recorded version.

CREATE TABLE IF NOT EXISTS "adjustment_request" (
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "idempotency_key"  text        NOT NULL,
  "payload_hash"     text        NOT NULL,
  "adjustment_id"    uuid        NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "idempotency_key")
);

ALTER TABLE "adjustment_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_request";
CREATE POLICY tenant_isolation ON "adjustment_request"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);


-- ════════════════════════════════════════════════════════════
-- Originally 0025_adjustment_distribution_instructions.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0026_assessment_component_duration.sql
-- ════════════════════════════════════════════════════════════

-- 0026 — Assessment component duration (AJ-21 finding 2)
--
-- An approved extra-time adjustment is a percentage of an assessment's
-- duration (25% of a 120-minute exam = 30 minutes, 150 in total). Nothing
-- recorded how long an exam is, so no exam entry could state the time a
-- candidate is entitled to. Null for untimed components (most coursework).

ALTER TABLE "assessment_component"
  ADD COLUMN IF NOT EXISTS "duration_minutes" integer;

ALTER TABLE "assessment_component"
  DROP CONSTRAINT IF EXISTS "assessment_component_duration_positive_check";
ALTER TABLE "assessment_component"
  ADD CONSTRAINT "assessment_component_duration_positive_check"
  CHECK ("duration_minutes" IS NULL OR ("duration_minutes" > 0 AND "duration_minutes" <= 1440));


-- ════════════════════════════════════════════════════════════
-- Originally 0027_adjustment_target_fulfilment.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0028_adjustment_task_overdue_notice.sql
-- ════════════════════════════════════════════════════════════

-- 0028 — Overdue notices for the manual adjustment task queue
--
-- An overdue flag on the queue page only helps if someone opens it. Each
-- target can now name a team mailbox; the worker's reconcile loop sends that
-- mailbox at most one overdue digest per target per day, through the
-- communications dispatch log (the SRS records what to send; an external
-- service delivers it, behind communications.channel.email.enabled). The
-- digest carries counts and a link to the queue, never student details.

ALTER TABLE "adjustment_target_config"
  ADD COLUMN IF NOT EXISTS "notify_email"           text,
  ADD COLUMN IF NOT EXISTS "last_overdue_notice_at" timestamptz;

INSERT INTO "communication_template" (
  "id", "tenant_id", "template_key", "channel_code", "locale_code",
  "subject_template", "body_template", "version", "active", "created_by"
)
VALUES
  (gen_random_uuid(), NULL,
   'adjustment-tasks.overdue', 'email', 'en-GB',
   '{overdueCount} overdue {targetLabel} adjustment tasks',
   'There are {overdueCount} reasonable-adjustment tasks for {targetLabel} waiting longer than {alertAfterHours} hours ({openCount} open in total; the oldest has waited since {oldestDueSince}). Approved adjustments are not in effect for these students until someone applies them and confirms it. Open the queue: {queueUrl}',
   1, true, 'system')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0029_delivery_ledger.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0030_external_records.sql
-- ════════════════════════════════════════════════════════════

-- 0030 — Records other systems report about a student (inbound flows)
--
-- The inbound half of the adjacent-system pattern: what the library,
-- accommodation service and others tell the SRS (F-LIB-SIS-01 loans and
-- fines, F-ACC-SIS-01 allocation and check-in/out, ...). A connector posts
-- them (integration:manage); where none exists, staff enter them on the
-- student record. Append-only history; the latest observation per record
-- key (the library account, a booking reference) is current.
--
-- These records inform staff. They never change academic status: under
-- AJ-17 a library fine does not block results or an award, and Registry
-- relies on its own enrolment, not a housing check-in.

CREATE TABLE IF NOT EXISTS "external_record" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "flow_code"        text        NOT NULL,   -- e.g. F-LIB-SIS-01
  "person_id"        uuid        NOT NULL,
  "record_key"       text        NOT NULL,   -- e.g. 'account', a booking reference
  "payload"          jsonb       NOT NULL,
  "summary"          text        NOT NULL,
  "observed_at"      timestamptz NOT NULL,   -- when the source system says it was true
  "received_at"      timestamptz NOT NULL DEFAULT now(),
  "received_via"     text        NOT NULL CHECK ("received_via" IN ('connector', 'person')),
  "actor_id"         text        NOT NULL,
  "idempotency_key"  text        NOT NULL,
  UNIQUE ("tenant_id", "flow_code", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "external_record_person_idx"
  ON "external_record" ("tenant_id", "person_id", "flow_code", "record_key", "observed_at" DESC);

ALTER TABLE "external_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "external_record";
CREATE POLICY tenant_isolation ON "external_record"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('library-account-status-code', 'Library Account Status', 'srs-internal', NULL, 'Status of a student''s library account, as reported by the library', true),
  ('accommodation-booking-status-code', 'Accommodation Booking Status', 'srs-internal', NULL, 'Status of an accommodation booking, as reported by the accommodation service', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('library-account-status-code', 'active',    'Active',    10),
  ('library-account-status-code', 'suspended', 'Suspended', 20),
  ('library-account-status-code', 'closed',    'Closed',    30),
  ('accommodation-booking-status-code', 'reserved',    'Reserved',    10),
  ('accommodation-booking-status-code', 'allocated',   'Allocated',   20),
  ('accommodation-booking-status-code', 'checked-in',  'Checked in',  30),
  ('accommodation-booking-status-code', 'checked-out', 'Checked out', 40),
  ('accommodation-booking-status-code', 'cancelled',   'Cancelled',   50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('external_record_library', 'account_status', 'library-account-status-code', 'F-LIB-SIS-01'),
  ('external_record_accommodation', 'booking_status', 'accommodation-booking-status-code', 'F-ACC-SIS-01')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0031_inbound_flow_fields.sql
-- ════════════════════════════════════════════════════════════

-- 0031 — Picklists for the remaining per-student inbound flows
--
-- F-PAY-SIS-01 (bursary and stipend payments), F-RP-SIS-01 (funded
-- studentship awards) and F-ITSM-SIS-01 (service request outcomes) are now
-- recordable as external_record rows; their status fields are value-set
-- backed. Inbound flows that are not about one student (estates rooms,
-- survey aggregates, policy notices) or that have a dedicated route
-- (identity verification completion, admissions, catalogue) are not stored
-- here.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('payment-type-code', 'Student Payment Type', 'srs-internal', NULL, 'Kind of payment a payroll or finance system reports to a student', true),
  ('studentship-status-code', 'Studentship Award Status', 'srs-internal', NULL, 'Status of a funded research studentship award', true),
  ('service-request-outcome-code', 'Service Request Outcome', 'srs-internal', NULL, 'Outcome of an IT service request affecting a student account', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('payment-type-code', 'bursary',  'Bursary',  10),
  ('payment-type-code', 'stipend',  'Stipend',  20),
  ('payment-type-code', 'gta-pay',  'Graduate teaching assistant pay', 30),
  ('studentship-status-code', 'offered',   'Offered',   10),
  ('studentship-status-code', 'accepted',  'Accepted',  20),
  ('studentship-status-code', 'active',    'Active',    30),
  ('studentship-status-code', 'suspended', 'Suspended', 40),
  ('studentship-status-code', 'ended',     'Ended',     50),
  ('service-request-outcome-code', 'resolved',         'Resolved',         10),
  ('service-request-outcome-code', 'account-locked',   'Account locked',   20),
  ('service-request-outcome-code', 'account-unlocked', 'Account unlocked', 30),
  ('service-request-outcome-code', 'access-granted',   'Access granted',   40),
  ('service-request-outcome-code', 'access-removed',   'Access removed',   50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('external_record_payroll', 'payment_type', 'payment-type-code', 'F-PAY-SIS-01'),
  ('external_record_research', 'award_status', 'studentship-status-code', 'F-RP-SIS-01'),
  ('external_record_itsm', 'outcome', 'service-request-outcome-code', 'F-ITSM-SIS-01')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0032_student_support_and_employment.sql
-- ════════════════════════════════════════════════════════════

-- 0032 — Student support schedules and student employment links (payroll gap)
--
-- F-SIS-PAY-01 had no producer because the SRS held no authorised support
-- to send. AJ-32: support (a studentship stipend, a bursary) and teaching pay
-- are separate entitlements with separate authorities, and no system decides
-- entitlement.
--
--   support_award / support_instalment — the SRS records a student's support
--     award and its schedule; each instalment is approved by the award owner,
--     then sent to payroll as an F-SIS-PAY-01 instruction (stable operation
--     id = the instalment id). Payroll's confirmation (F-PAY-SIS-01, matched
--     on that id) marks it paid or rejected. An instruction being accepted is
--     not payment: only the confirmation makes it paid.
--
--   student_employment_link — not the employment appointment (HR owns the
--     contract, rate, right-to-work and pay) but the minimum the SRS needs
--     when a student is also employed: the HR reference, role, dates,
--     assigned modules and weekly hours. Checked against work_limit_rule
--     (visa term-time limit, studentship limit) and flagged to HR
--     (F-SIS-HR-01) when the student's study status changes.
--
--   work_limit_rule — per-tenant limits; tenants without a row use the
--     platform defaults in code (visa term time 20 h/week; studentship
--     6 h/week), which institutions must confirm against their own policy
--     and funders' terms.

CREATE TABLE IF NOT EXISTS "support_award" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"        uuid        NOT NULL,
  "enrolment_id"     uuid        NOT NULL,
  "award_type_code"  text        NOT NULL,          -- value set support-award-type-code
  "award_reference"  text        NOT NULL,
  "funder"           text        NOT NULL,
  "start_date"       date        NOT NULL,
  "end_date"         date,
  "status_code"      text        NOT NULL DEFAULT 'draft'
                       CHECK ("status_code" IN ('draft', 'approved', 'suspended', 'ended')),
  "created_by"       text        NOT NULL,
  "approved_by"      text,
  "approved_at"      timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "award_reference")
);

CREATE TABLE IF NOT EXISTS "support_instalment" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant" ("id"),
  "award_id"           uuid        NOT NULL REFERENCES "support_award" ("id"),
  "payment_type_code"  text        NOT NULL,        -- value set payment-type-code (stipend, bursary)
  "currency_code"      text        NOT NULL DEFAULT 'GBP',  -- ISO 4217; payroll pays in GBP today
  "amount_minor_units" integer     NOT NULL CHECK ("amount_minor_units" > 0),
  "period_start"       date        NOT NULL,
  "period_end"         date        NOT NULL,
  "due_date"           date        NOT NULL,
  -- planned | approved | paid | rejected | cancelled
  "status_code"        text        NOT NULL DEFAULT 'planned',
  "approved_by"        text,
  "approved_at"        timestamptz,
  "payment_reference"  text,
  "paid_on"            date,
  "paid_amount_minor_units" integer,
  "rejection_reason"   text,
  "created_by"         text        NOT NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CHECK ("period_end" >= "period_start")
);
CREATE INDEX IF NOT EXISTS "support_instalment_award_idx" ON "support_instalment" ("tenant_id", "award_id", "due_date");

CREATE TABLE IF NOT EXISTS "student_employment_link" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant" ("id"),
  "person_id"              uuid        NOT NULL,
  "hr_employment_reference" text       NOT NULL,
  "role_type_code"         text        NOT NULL,      -- value set employment-role-type-code
  "start_date"             date        NOT NULL,
  "end_date"               date,
  "weekly_hours"           numeric(5,2) NOT NULL CHECK ("weekly_hours" >= 0),
  "module_offering_ids"    jsonb       NOT NULL DEFAULT '[]',
  "supervisor_agreed_at"   timestamptz,
  "source_code"            text        NOT NULL CHECK ("source_code" IN ('connector', 'person')),
  "updated_by"             text        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "hr_employment_reference"),
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
);
CREATE INDEX IF NOT EXISTS "student_employment_link_person_idx" ON "student_employment_link" ("tenant_id", "person_id");

CREATE TABLE IF NOT EXISTS "work_limit_rule" (
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "rule_code"        text        NOT NULL,   -- student-visa-term-time | studentship
  "max_weekly_hours" numeric(5,2) NOT NULL CHECK ("max_weekly_hours" >= 0),
  "description"      text,
  "updated_by"       text        NOT NULL,
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "rule_code")
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_award', 'support_instalment', 'student_employment_link', 'work_limit_rule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('support-award-type-code', 'Student Support Award Type', 'srs-internal', NULL, 'Kind of student support award', true),
  ('employment-role-type-code', 'Student Employment Role Type', 'srs-internal', NULL, 'Role a student holds as an employee of the institution', true),
  ('payment-status-code', 'Payment Status', 'srs-internal', NULL, 'Outcome a payroll system reports for a payment instruction', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('support-award-type-code', 'studentship', 'Studentship', 10),
  ('support-award-type-code', 'bursary',     'Bursary',     20),
  ('support-award-type-code', 'scholarship', 'Scholarship', 30),
  ('support-award-type-code', 'hardship',    'Hardship award', 40),
  ('employment-role-type-code', 'gta',                'Graduate teaching assistant', 10),
  ('employment-role-type-code', 'demonstrator',       'Demonstrator',                20),
  ('employment-role-type-code', 'research-assistant', 'Research assistant',          30),
  ('employment-role-type-code', 'student-ambassador', 'Student ambassador',          40),
  ('employment-role-type-code', 'other',              'Other',                       50),
  ('payment-status-code', 'paid',     'Paid',     10),
  ('payment-status-code', 'rejected', 'Rejected', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('support_award', 'award_type_code', 'support-award-type-code', NULL),
  ('support_instalment', 'payment_type_code', 'payment-type-code', NULL),
  ('student_employment_link', 'role_type_code', 'employment-role-type-code', NULL),
  ('external_record_payroll', 'payment_status', 'payment-status-code', 'F-PAY-SIS-01')
ON CONFLICT DO NOTHING;
