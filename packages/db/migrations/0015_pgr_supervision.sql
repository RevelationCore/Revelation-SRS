-- Revelation SRS — PGR supervision and research context
-- Migration: 0015_pgr_supervision
--
-- Stage 1 of the PGR lifecycle build (BP-03-007, BPR-D07 part 1). Per
-- ADR-023, pgr_supervision_case extends the shared business_case primitive
-- (0004_business_process_foundations) via business_case_id rather than
-- re-implementing case status/ownership. staff_assignment is the durable,
-- bitemporal effect of an approved case: a change of supervisor end-dates
-- the superseded assignment and creates a new one, never overwriting history.

CREATE TABLE "pgr_supervision_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "degree_aim" text,
  "research_area" text,
  "school_owner" text,
  "intended_start_date" date,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_supervision_case_business_case_idx"
  ON "pgr_supervision_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_supervision_case_enrolment_idx"
  ON "pgr_supervision_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_supervision_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_supervision_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_supervision_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Proposed nominees — working data only, never a source of current authority.

CREATE TABLE "pgr_supervisor_nomination" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "supervision_case_id" uuid NOT NULL REFERENCES "pgr_supervision_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "role_detail_code" text NOT NULL,
  "org_owner" text,
  "external_organisation" text,
  "contractual_status_code" text,
  "access_level_code" text,
  "eligibility_checked_at" timestamptz,
  "nominated_by" text NOT NULL,
  "nominated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_supervisor_nomination_case_idx"
  ON "pgr_supervisor_nomination" ("tenant_id", "supervision_case_id");

ALTER TABLE "pgr_supervisor_nomination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_supervisor_nomination" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_supervisor_nomination"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "staff_assignment" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "supervision_case_id" uuid NOT NULL REFERENCES "pgr_supervision_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "assignment_type_code" text NOT NULL,
  "role_detail_code" text NOT NULL,
  "org_owner" text,
  "external_organisation" text,
  "contractual_status_code" text,
  "access_level_code" text,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "staff_assignment_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "staff_assignment_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX "staff_assignment_unique_logical_transaction"
  ON "staff_assignment" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX "staff_assignment_current_version_unique"
  ON "staff_assignment" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX "staff_assignment_enrolment_idx"
  ON "staff_assignment" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;
CREATE INDEX "staff_assignment_supervision_case_idx"
  ON "staff_assignment" ("tenant_id", "supervision_case_id");

ALTER TABLE "staff_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_assignment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-supervisor-role-code', 'PGR Supervisor Role', 'srs-internal', 'Role of a supervisor within a PGR supervisory team', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('principal',  'Principal supervisor',  10),
  ('additional', 'Additional supervisor',  20),
  ('external',   'External supervisor',    30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'pgr-supervisor-role-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('staff_assignment', 'assignment_type_code', 'staff-assignment-type'),
  ('staff_assignment', 'role_detail_code',     'pgr-supervisor-role-code'),
  ('pgr_supervisor_nomination', 'role_detail_code', 'pgr-supervisor-role-code')
ON CONFLICT DO NOTHING;
