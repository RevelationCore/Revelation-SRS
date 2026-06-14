-- Revelation SRS — Platform Workflow, Feature Flag, and Environment Schema
-- Migration: 0009_platform_workflow_feature_flags
--
-- Adds the configuration/audit substrate for workflow definitions, workflow
-- instances/tasks, feature flags, and environment promotion. No domain services
-- read these tables in Stage 1.

-- ── Environment Metadata ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "deployment_environment" (
  "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "environment_code"          text        NOT NULL,
  "display_name"              text        NOT NULL,
  "environment_type_code"     text        NOT NULL,
  "production_like"           boolean     NOT NULL DEFAULT false,
  "live_integrations_allowed" boolean     NOT NULL DEFAULT false,
  "configuration"             jsonb       NOT NULL DEFAULT '{}',
  "active"                    boolean     NOT NULL DEFAULT true,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "updated_at"                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deployment_environment_code_unique" UNIQUE ("environment_code")
);

CREATE TABLE IF NOT EXISTS "environment_configuration" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "environment_id"     uuid        NOT NULL REFERENCES "deployment_environment"("id"),
  "configuration_key"  text        NOT NULL,
  "configuration_value" jsonb      NOT NULL DEFAULT '{}',
  "secret_ref"         text,
  "active_from"        timestamptz NOT NULL DEFAULT now(),
  "active_to"          timestamptz,
  "created_by"         text        NOT NULL DEFAULT 'system',
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "environment_configuration_temporal_check"
    CHECK (active_to IS NULL OR active_to > active_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS "environment_configuration_current_unique"
  ON "environment_configuration" ("tenant_id", "environment_id", "configuration_key")
  WHERE "active_to" IS NULL;

ALTER TABLE "environment_configuration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "environment_configuration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "environment_configuration";
CREATE POLICY tenant_isolation ON "environment_configuration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "environment_promotion_record" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "source_environment_id" uuid        NOT NULL REFERENCES "deployment_environment"("id"),
  "target_environment_id" uuid        NOT NULL REFERENCES "deployment_environment"("id"),
  "artefact_type_code"    text        NOT NULL,
  "artefact_reference"    text        NOT NULL,
  "status_code"           text        NOT NULL,
  "requested_by"          text        NOT NULL,
  "approved_by"           text,
  "promoted_at"           timestamptz,
  "metadata"              jsonb       NOT NULL DEFAULT '{}',
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "environment_promotion_distinct_envs"
    CHECK (source_environment_id <> target_environment_id)
);

CREATE INDEX IF NOT EXISTS "environment_promotion_tenant_status_idx"
  ON "environment_promotion_record" ("tenant_id", "status_code", "created_at");

ALTER TABLE "environment_promotion_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "environment_promotion_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "environment_promotion_record";
CREATE POLICY tenant_isolation ON "environment_promotion_record"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Workflow Definition and Runtime Ledger ──────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_definition" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        REFERENCES "tenant"("id"),
  "definition_code"        text        NOT NULL,
  "display_name"           text        NOT NULL,
  "owner_module_code"      text        NOT NULL,
  "status_code"            text        NOT NULL DEFAULT 'draft',
  "current_version_number" integer,
  "description"            text,
  "created_by"             text        NOT NULL DEFAULT 'system',
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definition_scope_code_unique"
  ON "workflow_definition" (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code");

ALTER TABLE "workflow_definition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_definition";
CREATE POLICY tenant_or_platform_visibility ON "workflow_definition"
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS "workflow_definition_version" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_definition_id" uuid        NOT NULL REFERENCES "workflow_definition"("id"),
  "version_number"         integer     NOT NULL,
  "status_code"            text        NOT NULL DEFAULT 'draft',
  "definition_json"        jsonb       NOT NULL DEFAULT '{}',
  "bpmn_source_id"         text,
  "effective_from"         timestamptz,
  "effective_to"           timestamptz,
  "created_by"             text        NOT NULL DEFAULT 'system',
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_definition_version_temporal_check"
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
  CONSTRAINT "workflow_definition_version_unique"
    UNIQUE ("workflow_definition_id", "version_number")
);

ALTER TABLE "workflow_definition_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definition_version" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_definition_version";
CREATE POLICY tenant_or_platform_visibility ON "workflow_definition_version"
  USING (
    EXISTS (
      SELECT 1
      FROM "workflow_definition" wd
      WHERE wd."id" = "workflow_definition_version"."workflow_definition_id"
        AND (
          wd."tenant_id" IS NULL
          OR wd."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
        )
    )
  );

CREATE TABLE IF NOT EXISTS "workflow_step" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_definition_version_id" uuid        NOT NULL REFERENCES "workflow_definition_version"("id") ON DELETE CASCADE,
  "step_key"                       text        NOT NULL,
  "step_type_code"                 text        NOT NULL,
  "display_name"                   text        NOT NULL,
  "owner_role_code"                text,
  "sort_order"                     integer     NOT NULL DEFAULT 0,
  "configuration"                  jsonb       NOT NULL DEFAULT '{}',
  "created_at"                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_step_version_key_unique"
    UNIQUE ("workflow_definition_version_id", "step_key")
);

ALTER TABLE "workflow_step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_step" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_step";
CREATE POLICY tenant_or_platform_visibility ON "workflow_step"
  USING (
    EXISTS (
      SELECT 1
      FROM "workflow_definition_version" wdv
      JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
      WHERE wdv."id" = "workflow_step"."workflow_definition_version_id"
        AND (
          wd."tenant_id" IS NULL
          OR wd."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
        )
    )
  );

CREATE TABLE IF NOT EXISTS "workflow_transition" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_definition_version_id" uuid        NOT NULL REFERENCES "workflow_definition_version"("id") ON DELETE CASCADE,
  "transition_key"                 text        NOT NULL,
  "from_step_key"                  text,
  "to_step_key"                    text        NOT NULL,
  "condition_expression"           text,
  "sort_order"                     integer     NOT NULL DEFAULT 0,
  "configuration"                  jsonb       NOT NULL DEFAULT '{}',
  "created_at"                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_transition_version_key_unique"
    UNIQUE ("workflow_definition_version_id", "transition_key")
);

ALTER TABLE "workflow_transition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_transition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_transition";
CREATE POLICY tenant_or_platform_visibility ON "workflow_transition"
  USING (
    EXISTS (
      SELECT 1
      FROM "workflow_definition_version" wdv
      JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
      WHERE wdv."id" = "workflow_transition"."workflow_definition_version_id"
        AND (
          wd."tenant_id" IS NULL
          OR wd."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
        )
    )
  );

CREATE TABLE IF NOT EXISTS "workflow_decision_gateway" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_definition_version_id" uuid        NOT NULL REFERENCES "workflow_definition_version"("id") ON DELETE CASCADE,
  "gateway_key"                    text        NOT NULL,
  "display_name"                   text        NOT NULL,
  "decision_type_code"             text        NOT NULL,
  "source_reference"               text,
  "configuration"                  jsonb       NOT NULL DEFAULT '{}',
  "created_at"                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_decision_gateway_version_key_unique"
    UNIQUE ("workflow_definition_version_id", "gateway_key")
);

ALTER TABLE "workflow_decision_gateway" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_decision_gateway" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_decision_gateway";
CREATE POLICY tenant_or_platform_visibility ON "workflow_decision_gateway"
  USING (
    EXISTS (
      SELECT 1
      FROM "workflow_definition_version" wdv
      JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
      WHERE wdv."id" = "workflow_decision_gateway"."workflow_definition_version_id"
        AND (
          wd."tenant_id" IS NULL
          OR wd."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
        )
    )
  );

CREATE TABLE IF NOT EXISTS "workflow_assignment_rule" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                      uuid        REFERENCES "tenant"("id"),
  "workflow_definition_version_id" uuid        NOT NULL REFERENCES "workflow_definition_version"("id") ON DELETE CASCADE,
  "step_key"                       text        NOT NULL,
  "rule_key"                       text        NOT NULL,
  "priority"                       integer     NOT NULL DEFAULT 100,
  "role_code"                      text,
  "organisational_unit_code"       text,
  "programme_id"                   uuid,
  "source_system_code"             text,
  "assignee_role_code"             text,
  "assignee_expression"            text,
  "configuration"                  jsonb       NOT NULL DEFAULT '{}',
  "active"                         boolean     NOT NULL DEFAULT true,
  "created_at"                     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_assignment_rule_scope_key_unique"
  ON "workflow_assignment_rule" (
    "workflow_definition_version_id",
    COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "rule_key"
  );

ALTER TABLE "workflow_assignment_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_assignment_rule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_assignment_rule";
CREATE POLICY tenant_or_platform_visibility ON "workflow_assignment_rule"
  USING (
    EXISTS (
      SELECT 1
      FROM "workflow_definition_version" wdv
      JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
      WHERE wdv."id" = "workflow_assignment_rule"."workflow_definition_version_id"
        AND (
          wd."tenant_id" IS NULL
          OR wd."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
        )
    )
  );

CREATE TABLE IF NOT EXISTS "workflow_trigger_rule" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                      uuid        REFERENCES "tenant"("id"),
  "environment_id"                 uuid        REFERENCES "deployment_environment"("id"),
  "workflow_definition_version_id" uuid        REFERENCES "workflow_definition_version"("id") ON DELETE CASCADE,
  "trigger_key"                    text        NOT NULL,
  "event_type"                     text        NOT NULL,
  "target_workflow_code"           text        NOT NULL,
  "condition_expression"           text,
  "configuration"                  jsonb       NOT NULL DEFAULT '{}',
  "active"                         boolean     NOT NULL DEFAULT true,
  "created_at"                     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_trigger_rule_scope_key_unique"
  ON "workflow_trigger_rule" (
    COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("environment_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "trigger_key"
  );

ALTER TABLE "workflow_trigger_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_trigger_rule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "workflow_trigger_rule";
CREATE POLICY tenant_or_platform_visibility ON "workflow_trigger_rule"
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS "workflow_instance" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                      uuid        NOT NULL REFERENCES "tenant"("id"),
  "environment_id"                 uuid        REFERENCES "deployment_environment"("id"),
  "workflow_definition_version_id" uuid        NOT NULL REFERENCES "workflow_definition_version"("id"),
  "workflow_code"                  text        NOT NULL,
  "subject_entity_type"            text        NOT NULL,
  "subject_entity_id"              uuid,
  "status_code"                    text        NOT NULL DEFAULT 'pending',
  "correlation_id"                 uuid,
  "started_by"                     text        NOT NULL DEFAULT 'system',
  "started_at"                     timestamptz NOT NULL DEFAULT now(),
  "completed_at"                   timestamptz,
  "context"                        jsonb       NOT NULL DEFAULT '{}',
  "created_at"                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_instance_subject_idx"
  ON "workflow_instance" ("tenant_id", "subject_entity_type", "subject_entity_id");

CREATE INDEX IF NOT EXISTS "workflow_instance_status_idx"
  ON "workflow_instance" ("tenant_id", "status_code", "started_at");

ALTER TABLE "workflow_instance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_instance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_instance";
CREATE POLICY tenant_isolation ON "workflow_instance"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "workflow_task" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "workflow_instance_id" uuid        NOT NULL REFERENCES "workflow_instance"("id") ON DELETE CASCADE,
  "step_key"             text        NOT NULL,
  "task_type_code"       text        NOT NULL DEFAULT 'human-task',
  "status_code"          text        NOT NULL DEFAULT 'pending',
  "assignee_actor_id"    text,
  "assignee_role_code"   text,
  "due_at"               timestamptz,
  "completed_by"         text,
  "completed_at"         timestamptz,
  "payload"              jsonb       NOT NULL DEFAULT '{}',
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_task_assignee_idx"
  ON "workflow_task" ("tenant_id", "status_code", "assignee_role_code", "assignee_actor_id");

ALTER TABLE "workflow_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_task" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_task";
CREATE POLICY tenant_isolation ON "workflow_task"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "workflow_decision_audit" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "workflow_instance_id" uuid        NOT NULL REFERENCES "workflow_instance"("id") ON DELETE CASCADE,
  "gateway_key"          text        NOT NULL,
  "decision_code"        text        NOT NULL,
  "condition_summary"    text,
  "input_hash"           text,
  "outcome_step_key"     text,
  "actor_id"             text        NOT NULL DEFAULT 'system',
  "metadata"             jsonb       NOT NULL DEFAULT '{}',
  "decided_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workflow_decision_audit_instance_idx"
  ON "workflow_decision_audit" ("tenant_id", "workflow_instance_id", "decided_at");

ALTER TABLE "workflow_decision_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_decision_audit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_decision_audit";
CREATE POLICY tenant_isolation ON "workflow_decision_audit"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Feature Flags ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "feature_flag" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "flag_key"            text        NOT NULL,
  "display_name"        text        NOT NULL,
  "description"         text,
  "owner_module_code"   text        NOT NULL,
  "status_code"         text        NOT NULL DEFAULT 'draft',
  "value_type_code"     text        NOT NULL DEFAULT 'boolean',
  "default_variant_key" text        NOT NULL DEFAULT 'off',
  "created_by"          text        NOT NULL DEFAULT 'system',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "feature_flag_key_unique" UNIQUE ("flag_key")
);

CREATE TABLE IF NOT EXISTS "feature_flag_variant" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "flag_id"      uuid        NOT NULL REFERENCES "feature_flag"("id") ON DELETE CASCADE,
  "variant_key"  text        NOT NULL,
  "display_name" text        NOT NULL,
  "value"        jsonb       NOT NULL,
  "sort_order"   integer     NOT NULL DEFAULT 0,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "feature_flag_variant_key_unique"
    UNIQUE ("flag_id", "variant_key")
);

CREATE TABLE IF NOT EXISTS "feature_flag_assignment" (
  "id"                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                      uuid        REFERENCES "tenant"("id"),
  "environment_id"                 uuid        REFERENCES "deployment_environment"("id"),
  "flag_id"                        uuid        NOT NULL REFERENCES "feature_flag"("id") ON DELETE CASCADE,
  "variant_id"                     uuid        REFERENCES "feature_flag_variant"("id"),
  "workflow_definition_version_id" uuid        REFERENCES "workflow_definition_version"("id"),
  "role_code"                      text,
  "cohort_code"                    text,
  "programme_id"                   uuid,
  "academic_year"                  text,
  "source_system_code"             text,
  "priority"                       integer     NOT NULL DEFAULT 100,
  "status_code"                    text        NOT NULL DEFAULT 'active',
  "rule_expression"                text,
  "configuration"                  jsonb       NOT NULL DEFAULT '{}',
  "active_from"                    timestamptz NOT NULL DEFAULT now(),
  "active_to"                      timestamptz,
  "created_by"                     text        NOT NULL DEFAULT 'system',
  "created_at"                     timestamptz NOT NULL DEFAULT now(),
  "updated_at"                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "feature_flag_assignment_temporal_check"
    CHECK (active_to IS NULL OR active_to > active_from)
);

CREATE INDEX IF NOT EXISTS "feature_flag_assignment_eval_idx"
  ON "feature_flag_assignment" (
    "flag_id",
    COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("environment_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "status_code",
    "priority"
  );

ALTER TABLE "feature_flag_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flag_assignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "feature_flag_assignment";
CREATE POLICY tenant_or_platform_visibility ON "feature_flag_assignment"
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS "feature_flag_evaluation_log" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        REFERENCES "tenant"("id"),
  "environment_id"        uuid        REFERENCES "deployment_environment"("id"),
  "flag_id"               uuid        NOT NULL REFERENCES "feature_flag"("id"),
  "assignment_id"         uuid        REFERENCES "feature_flag_assignment"("id"),
  "evaluated_variant_key" text        NOT NULL,
  "subject_type"          text,
  "subject_id"            uuid,
  "reason_code"           text        NOT NULL,
  "evaluation_context"    jsonb       NOT NULL DEFAULT '{}',
  "evaluated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "feature_flag_evaluation_log_flag_idx"
  ON "feature_flag_evaluation_log" ("flag_id", "evaluated_at");

ALTER TABLE "feature_flag_evaluation_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feature_flag_evaluation_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_platform_visibility ON "feature_flag_evaluation_log";
CREATE POLICY tenant_or_platform_visibility ON "feature_flag_evaluation_log"
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );

-- ── Seed Enrolment Trigger Rule Controls ───────────────────────────────────

WITH inserted_flag AS (
  INSERT INTO "feature_flag" (
    "flag_key",
    "display_name",
    "description",
    "owner_module_code",
    "status_code",
    "value_type_code",
    "default_variant_key",
    "created_by"
  ) VALUES (
    'enrolment.downstream-triggers.configured-mode',
    'Configured enrolment downstream trigger rules',
    'Switches enrolment downstream trigger creation from legacy service branching to workflow trigger rules.',
    'enrolment',
    'active',
    'boolean',
    'on',
    'system'
  )
  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name" = EXCLUDED."display_name",
    "description" = EXCLUDED."description",
    "owner_module_code" = EXCLUDED."owner_module_code",
    "status_code" = EXCLUDED."status_code",
    "value_type_code" = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at" = now()
  RETURNING "id"
),
selected_flag AS (
  SELECT "id" FROM inserted_flag
  UNION
  SELECT "id" FROM "feature_flag"
  WHERE "flag_key" = 'enrolment.downstream-triggers.configured-mode'
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT sf."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM selected_flag sf
JOIN (VALUES
  ('off', 'Legacy service branching', 'false', 10),
  ('on', 'Configured trigger rules', 'true', 20)
) AS v("variant_key", "display_name", "value", "sort_order") ON true
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value" = EXCLUDED."value",
  "sort_order" = EXCLUDED."sort_order";

INSERT INTO "workflow_trigger_rule" (
  "trigger_key",
  "event_type",
  "target_workflow_code",
  "condition_expression",
  "configuration",
  "active"
) VALUES
  (
    'enrolment-created-ucas-confirmation',
    'enrolment.created',
    'ucas-confirmation',
    'ucasPersonalId.present',
    '{"statutory": true, "source": "stage-5-default"}',
    true
  ),
  (
    'enrolment-created-slc-confirmation',
    'enrolment.created',
    'slc-confirmation',
    'slcFundingOrReference.present',
    '{"statutory": true, "source": "stage-5-default"}',
    true
  ),
  (
    'enrolment-created-ukvi-cas',
    'enrolment.created',
    'ukvi-cas',
    'ukviCasRequired.true',
    '{"statutory": true, "source": "stage-5-default"}',
    true
  ),
  (
    'enrolment-status-slc-confirmation',
    'enrolment.status-transition',
    'slc-confirmation',
    'slcReference.present-and-status.withdrawn-or-intermitting',
    '{"statutory": true, "source": "stage-5-default"}',
    true
  ),
  (
    'enrolment-created-future-communication',
    'enrolment.created',
    'future-communication-endpoint',
    'always',
    '{"statutory": false, "source": "stage-5-placeholder", "note": "Placeholder for future tenant communication endpoint rules."}',
    false
  )
ON CONFLICT DO NOTHING;

-- ── Seed Admissions Workflow Definitions and Flags ─────────────────────────

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES
  (
    'admissions-ucas-domestic',
    'Admissions - UCAS domestic route',
    'admissions',
    'active',
    1,
    'Domestic undergraduate admissions workflow for UCAS-sourced applications.',
    'system'
  ),
  (
    'admissions-direct-domestic',
    'Admissions - direct domestic route',
    'admissions',
    'active',
    1,
    'Domestic admissions workflow for direct/manual applications.',
    'system'
  ),
  (
    'admissions-international-direct',
    'Admissions - international direct route',
    'admissions',
    'active',
    1,
    'International admissions workflow for direct applicant submissions including CAS pre-check decisions.',
    'system'
  ),
  (
    'admissions-international-agent',
    'Admissions - international agent route',
    'admissions',
    'active',
    1,
    'International admissions workflow for authorised agent-supported applications including CAS pre-check decisions.',
    'system'
  ),
  (
    'admissions-clearing',
    'Admissions - clearing route',
    'admissions',
    'active',
    1,
    'Clearing admissions workflow for rapid eligibility, vacancy and conversion decisions.',
    'system'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "bpmn_source_id",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'routeCode', wd."definition_code",
    'source', 'docs/reference/revelation_ucas_domestic_admissions_bpmn_lite_granular_decisions.json',
    'handoffStepKey', 'handoff-to-srs-enrolment',
    'decisionGatewayAuditTable', 'workflow_decision_audit',
    'usesGenericDecisionAudit', true
  ),
  'revelation_ucas_domestic_admissions_bpmn_lite_granular_decisions.json',
  '2026-06-13T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" IN (
  'admissions-ucas-domestic',
  'admissions-direct-domestic',
  'admissions-international-direct',
  'admissions-international-agent',
  'admissions-clearing'
)
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" (
  "workflow_definition_version_id",
  "step_key",
  "step_type_code",
  "display_name",
  "owner_role_code",
  "sort_order",
  "configuration"
)
SELECT
  wdv."id",
  s."step_key",
  s."step_type_code",
  s."display_name",
  s."owner_role_code",
  s."sort_order",
  s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('application-received', 'start', 'Application received', 'registry-administrator', 10, '{"sourceNeutral": true}'),
  ('application-assessment', 'human-task', 'Application assessment', 'registry-administrator', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Admissions decision gateway', 'registry-administrator', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('handoff-to-srs-enrolment', 'integration', 'Handoff to SRS enrolment', 'registry-administrator', 40, '{"targetService": "EnrolmentService", "handoffMode": "workflow", "retiredLegacyFlag": "admissions.legacy-ucas-auto-enrolment.enabled"}'),
  ('application-closed', 'end', 'Application workflow closed', null, 50, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" IN (
  'admissions-ucas-domestic',
  'admissions-direct-domestic',
  'admissions-international-direct',
  'admissions-international-agent',
  'admissions-clearing'
)
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id",
  "gateway_key",
  "display_name",
  "decision_type_code",
  "source_reference",
  "configuration"
)
SELECT
  wdv."id",
  g."gateway_key",
  g."display_name",
  'exclusive',
  'revelation_ucas_domestic_admissions_bpmn_lite_granular_decisions.json',
  jsonb_build_object(
    'bpmnGatewayId', g."gateway_key",
    'ownerRole', g."owner_role",
    'policySource', g."policy_source",
    'routeFamily', g."route_family"
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Is academic review or interview required?', 'Admissions', 'Admissions Policy and programme selection criteria', 'domestic'),
  ('G02', 'Decision outcome?', 'Admissions', 'Admissions Policy, entry requirements and delegated admissions authority', 'domestic'),
  ('G03', 'Meets offer conditions?', 'Admissions', 'Confirmation and Clearing policy, UCAS results processing rules', 'domestic'),
  ('G04', 'Applicant reply outcome?', 'Admissions', 'UCAS reply processing and university admissions policy', 'domestic'),
  ('G05', 'Clearing applicant eligible and vacancy available?', 'Admissions', 'Clearing policy, course capacity and admissions criteria', 'clearing'),
  ('G09', 'International application source?', 'Admissions / International Recruitment', 'International recruitment policy and agent management rules', 'international'),
  ('G10', 'International evidence and sponsorship route viable?', 'Admissions / International Recruitment', 'International admissions policy, UKVI sponsor guidance, ATAS and sanctions checks', 'international'),
  ('G11', 'International acceptance, deposit and CAS pre-check complete?', 'Admissions / International Recruitment', 'International admissions policy, tuition fee deposit policy and UKVI sponsor guidance', 'international')
) AS g("gateway_key", "display_name", "owner_role", "policy_source", "route_family") ON true
WHERE wd."definition_code" IN (
  'admissions-ucas-domestic',
  'admissions-direct-domestic',
  'admissions-international-direct',
  'admissions-international-agent',
  'admissions-clearing'
)
  AND wdv."version_number" = 1
  AND (
    g."route_family" = 'domestic'
    OR (g."route_family" = 'clearing' AND wd."definition_code" = 'admissions-clearing')
    OR (g."route_family" = 'international' AND wd."definition_code" IN ('admissions-international-direct', 'admissions-international-agent'))
  )
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

WITH admissions_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key",
    "display_name",
    "description",
    "owner_module_code",
    "status_code",
    "value_type_code",
    "default_variant_key",
    "created_by"
  ) VALUES
    ('admissions.enabled', 'Admissions module enabled', 'Enables first-party source-neutral Admissions workflow capabilities.', 'admissions', 'active', 'boolean', 'on', 'system'),
    ('admissions.ucas-adapter.enabled', 'Admissions UCAS adapter enabled', 'Routes UCAS application ingress through the Admissions module adapter.', 'admissions', 'active', 'boolean', 'on', 'system'),
    ('admissions.direct-applications.enabled', 'Admissions direct applications enabled', 'Enables direct/manual domestic application intake.', 'admissions', 'active', 'boolean', 'off', 'system'),
    ('admissions.agent-applications.enabled', 'Admissions agent applications enabled', 'Enables authorised agent-supported application intake.', 'admissions', 'active', 'boolean', 'off', 'system'),
    ('admissions.international-route.enabled', 'Admissions international route enabled', 'Enables international direct and agent application workflows.', 'admissions', 'active', 'boolean', 'off', 'system'),
    ('admissions.cas-precheck.required', 'Admissions CAS pre-check required', 'Requires CAS and sponsorship readiness decisions before international handoff.', 'admissions', 'active', 'boolean', 'on', 'system'),
    ('admissions.legacy-ucas-auto-enrolment.enabled', 'Legacy UCAS auto-enrolment retired', 'Retired migration flag retained for audit; confirmed UCAS applications now use Admissions workflow handoff rather than direct enrolment creation.', 'admissions', 'retired', 'boolean', 'off', 'system')
  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name" = EXCLUDED."display_name",
    "description" = EXCLUDED."description",
    "owner_module_code" = EXCLUDED."owner_module_code",
    "status_code" = EXCLUDED."status_code",
    "value_type_code" = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at" = now()
  RETURNING "id"
),
selected_admissions_flags AS (
  SELECT "id" FROM admissions_flags
  UNION
  SELECT "id" FROM "feature_flag"
  WHERE "flag_key" IN (
    'admissions.enabled',
    'admissions.ucas-adapter.enabled',
    'admissions.direct-applications.enabled',
    'admissions.agent-applications.enabled',
    'admissions.international-route.enabled',
    'admissions.cas-precheck.required',
    'admissions.legacy-ucas-auto-enrolment.enabled'
  )
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT sf."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM selected_admissions_flags sf
JOIN (VALUES
  ('off', 'Off', 'false', 10),
  ('on', 'On', 'true', 20)
) AS v("variant_key", "display_name", "value", "sort_order") ON true
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value" = EXCLUDED."value",
  "sort_order" = EXCLUDED."sort_order";

-- ── Seed Platform Environments ──────────────────────────────────────────────

INSERT INTO "deployment_environment" (
  "environment_code",
  "display_name",
  "environment_type_code",
  "production_like",
  "live_integrations_allowed"
) VALUES
  ('local', 'Local Development', 'local', false, false),
  ('test', 'Test', 'test', false, false),
  ('uat', 'User Acceptance Testing', 'uat', true, false),
  ('preprod', 'Pre-production', 'pre-production', true, false),
  ('prod', 'Production', 'production', true, true)
ON CONFLICT ("environment_code") DO NOTHING;

-- ── Seed Value Sets ─────────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('workflow-definition-status-code', 'Workflow definition status code', 'srs-internal', '2026-06-13', 'Lifecycle status for workflow definitions and versions.', false),
  ('workflow-step-type-code', 'Workflow step type code', 'srs-internal', '2026-06-13', 'Types of workflow steps in platform workflow definitions.', false),
  ('workflow-instance-status-code', 'Workflow instance status code', 'srs-internal', '2026-06-13', 'Runtime lifecycle status for workflow instances.', false),
  ('workflow-task-status-code', 'Workflow task status code', 'srs-internal', '2026-06-13', 'Runtime lifecycle status for workflow tasks.', false),
  ('workflow-decision-code', 'Workflow decision code', 'srs-internal', '2026-06-13', 'Decision outcomes recorded at workflow gateways.', true),
  ('feature-flag-status-code', 'Feature flag status code', 'srs-internal', '2026-06-13', 'Lifecycle status for feature flags.', false),
  ('feature-flag-assignment-status-code', 'Feature flag assignment status code', 'srs-internal', '2026-06-13', 'Lifecycle status for feature flag assignments.', false),
  ('feature-flag-value-type-code', 'Feature flag value type code', 'srs-internal', '2026-06-13', 'Value type for feature flag variants.', false),
  ('deployment-environment-type-code', 'Deployment environment type code', 'srs-internal', '2026-06-13', 'Environment classes used for promotion and integration safety.', false),
  ('environment-promotion-status-code', 'Environment promotion status code', 'srs-internal', '2026-06-13', 'Lifecycle status for environment promotion records.', false),
  ('environment-promotion-artefact-type-code', 'Environment promotion artefact type code', 'srs-internal', '2026-06-13', 'Artefact types promoted between environments.', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('workflow-definition-status-code', 'draft', 'Draft', 10),
  ('workflow-definition-status-code', 'active', 'Active', 20),
  ('workflow-definition-status-code', 'retired', 'Retired', 30),
  ('workflow-step-type-code', 'start', 'Start', 10),
  ('workflow-step-type-code', 'human-task', 'Human task', 20),
  ('workflow-step-type-code', 'decision', 'Decision', 30),
  ('workflow-step-type-code', 'timer', 'Timer', 40),
  ('workflow-step-type-code', 'integration', 'Integration', 50),
  ('workflow-step-type-code', 'end', 'End', 60),
  ('workflow-instance-status-code', 'pending', 'Pending', 10),
  ('workflow-instance-status-code', 'running', 'Running', 20),
  ('workflow-instance-status-code', 'suspended', 'Suspended', 30),
  ('workflow-instance-status-code', 'completed', 'Completed', 40),
  ('workflow-instance-status-code', 'cancelled', 'Cancelled', 50),
  ('workflow-instance-status-code', 'failed', 'Failed', 60),
  ('workflow-task-status-code', 'pending', 'Pending', 10),
  ('workflow-task-status-code', 'assigned', 'Assigned', 20),
  ('workflow-task-status-code', 'in-progress', 'In progress', 30),
  ('workflow-task-status-code', 'completed', 'Completed', 40),
  ('workflow-task-status-code', 'cancelled', 'Cancelled', 50),
  ('workflow-task-status-code', 'escalated', 'Escalated', 60),
  ('workflow-decision-code', 'approved', 'Approved', 10),
  ('workflow-decision-code', 'rejected', 'Rejected', 20),
  ('workflow-decision-code', 'routed', 'Routed', 30),
  ('workflow-decision-code', 'timed-out', 'Timed out', 40),
  ('feature-flag-status-code', 'draft', 'Draft', 10),
  ('feature-flag-status-code', 'active', 'Active', 20),
  ('feature-flag-status-code', 'retired', 'Retired', 30),
  ('feature-flag-assignment-status-code', 'active', 'Active', 10),
  ('feature-flag-assignment-status-code', 'paused', 'Paused', 20),
  ('feature-flag-assignment-status-code', 'retired', 'Retired', 30),
  ('feature-flag-value-type-code', 'boolean', 'Boolean', 10),
  ('feature-flag-value-type-code', 'string', 'String', 20),
  ('feature-flag-value-type-code', 'number', 'Number', 30),
  ('feature-flag-value-type-code', 'json', 'JSON', 40),
  ('feature-flag-value-type-code', 'variant', 'Variant', 50),
  ('deployment-environment-type-code', 'local', 'Local', 10),
  ('deployment-environment-type-code', 'test', 'Test', 20),
  ('deployment-environment-type-code', 'uat', 'UAT', 30),
  ('deployment-environment-type-code', 'pre-production', 'Pre-production', 40),
  ('deployment-environment-type-code', 'production', 'Production', 50),
  ('environment-promotion-status-code', 'requested', 'Requested', 10),
  ('environment-promotion-status-code', 'approved', 'Approved', 20),
  ('environment-promotion-status-code', 'promoted', 'Promoted', 30),
  ('environment-promotion-status-code', 'failed', 'Failed', 40),
  ('environment-promotion-status-code', 'cancelled', 'Cancelled', 50),
  ('environment-promotion-artefact-type-code', 'schema', 'Schema', 10),
  ('environment-promotion-artefact-type-code', 'workflow-definition', 'Workflow definition', 20),
  ('environment-promotion-artefact-type-code', 'feature-flag', 'Feature flag', 30),
  ('environment-promotion-artefact-type-code', 'integration-configuration', 'Integration configuration', 40),
  ('environment-promotion-artefact-type-code', 'release', 'Release', 50)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('workflow_definition', 'status_code', 'workflow-definition-status-code', 'Workflow definition lifecycle status.'),
  ('workflow_definition_version', 'status_code', 'workflow-definition-status-code', 'Workflow definition version lifecycle status.'),
  ('workflow_step', 'step_type_code', 'workflow-step-type-code', 'Workflow step type.'),
  ('workflow_instance', 'status_code', 'workflow-instance-status-code', 'Workflow instance runtime status.'),
  ('workflow_task', 'status_code', 'workflow-task-status-code', 'Workflow task runtime status.'),
  ('workflow_decision_audit', 'decision_code', 'workflow-decision-code', 'Workflow gateway decision outcome.'),
  ('feature_flag', 'status_code', 'feature-flag-status-code', 'Feature flag lifecycle status.'),
  ('feature_flag', 'value_type_code', 'feature-flag-value-type-code', 'Feature flag variant value type.'),
  ('feature_flag_assignment', 'status_code', 'feature-flag-assignment-status-code', 'Feature flag assignment lifecycle status.'),
  ('deployment_environment', 'environment_type_code', 'deployment-environment-type-code', 'Deployment environment class.'),
  ('environment_promotion_record', 'status_code', 'environment-promotion-status-code', 'Environment promotion lifecycle status.'),
  ('environment_promotion_record', 'artefact_type_code', 'environment-promotion-artefact-type-code', 'Environment promotion artefact type.')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
