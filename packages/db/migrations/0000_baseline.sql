-- Baseline: migrations 0000–0009 squashed on 2026-11-19 (enterprise readiness plan, item 4.1).
-- Each original is headed with an "-- Originally NNNN_name.sql" line.

-- Originally 0000_platform_foundations.sql

-- ============================================================
-- Originally: 0000_initial_platform_schema.sql
-- ============================================================

-- Revelation SRS — Phase 3 Platform Foundation Schema
-- Migration: 0000_initial_platform_schema
-- Applied by: packages/db/src/migrate.ts

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tenant ───────────────────────────────────────────────────────────────────
-- No RLS; managed by system-administrator role only.
CREATE TABLE IF NOT EXISTS "tenant" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"          text        NOT NULL,
  "name"          text        NOT NULL,
  "configuration" jsonb       NOT NULL DEFAULT '{}',
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "active"        boolean     NOT NULL DEFAULT true,
  CONSTRAINT "tenant_code_unique" UNIQUE ("code")
);

-- ── Audit Record ──────────────────────────────────────────────────────────────
-- Append-only; no RLS; application role has INSERT + SELECT only.
CREATE TABLE IF NOT EXISTS "audit_record" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid,
  "entity_type"          text        NOT NULL,
  "entity_id"            uuid        NOT NULL,
  "field_name"           text,
  "before_value"         jsonb,
  "after_value"          jsonb,
  "action_type"          text        NOT NULL,
  "actor_type"           text        NOT NULL,
  "actor_id"             text        NOT NULL,
  "actor_display_name"   text,
  "occurred_at"          timestamptz NOT NULL DEFAULT now(),
  "correlation_id"       uuid,
  "workflow_instance_id" text,
  "reason_code"          text,
  "reason_text"          text
);

-- Index for tenant + entity lookups
CREATE INDEX "audit_record_tenant_entity_idx"
  ON "audit_record" ("tenant_id", "entity_type", "entity_id");

-- ── Integration Contract Catalogue ───────────────────────────────────────────
-- Platform-level table; no RLS.
CREATE TABLE IF NOT EXISTS "integration_contract" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "contract_id"              text        NOT NULL,
  "display_name"             text        NOT NULL,
  "owner_module_code"        text        NOT NULL,
  "direction_code"           text        NOT NULL,
  "pattern_type"             text        NOT NULL,
  "current_contract_version" text        NOT NULL,
  "data_classification_code" text        NOT NULL,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_contract_id_unique" UNIQUE ("contract_id")
);

-- ── Integration Registration (Plugin Registry) ───────────────────────────────
-- Per-tenant; subject to RLS.
CREATE TABLE IF NOT EXISTS "integration_registration" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant"("id"),
  "integration_contract_id"     uuid        NOT NULL REFERENCES "integration_contract"("id"),
  "integration_code"            text        NOT NULL,
  "display_name"                text        NOT NULL,
  "contract_version"            text        NOT NULL,
  "transport_code"              text        NOT NULL,
  "subject_filter"              text,
  "consumer_group"              text,
  "endpoint_url"                text,
  "file_schedule"               text,
  "secret_ref"                  text,
  "replay_supported"            boolean     NOT NULL DEFAULT false,
  "retry_policy"                jsonb,
  "enabled"                     boolean     NOT NULL DEFAULT false,
  "configuration"               jsonb       NOT NULL DEFAULT '{}',
  "last_health_check_at"        timestamptz,
  "health_status_code"          text,
  "last_successful_exchange_at" timestamptz,
  "registered_at"               timestamptz NOT NULL DEFAULT now(),
  "last_updated_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_registration_tenant_code_unique" UNIQUE ("tenant_id", "integration_code")
);

ALTER TABLE "integration_registration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_registration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_registration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Integration Exchange Ledger ───────────────────────────────────────────────
-- Append-only per-tenant exchange log; subject to RLS.
CREATE TABLE IF NOT EXISTS "integration_exchange" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant"("id"),
  "integration_registration_id" uuid        NOT NULL REFERENCES "integration_registration"("id"),
  "contract_id"                 text        NOT NULL,
  "direction_code"              text        NOT NULL,
  "exchange_type_code"          text        NOT NULL,
  "idempotency_key"             text        NOT NULL,
  "correlation_id"              uuid,
  "source_reference"            text,
  "status_code"                 text        NOT NULL,
  "attempt_count"               smallint    NOT NULL DEFAULT 0,
  "last_attempt_at"             timestamptz,
  "last_error"                  text,
  "payload_hash"                text,
  "payload_summary"             jsonb,
  "received_at"                 timestamptz,
  "sent_at"                     timestamptz,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integration_exchange_idempotency_unique"
    UNIQUE ("tenant_id", "integration_registration_id", "idempotency_key")
);

ALTER TABLE "integration_exchange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_exchange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_exchange"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Valid Value Sets ─────────────────────────────────────────────────────────
-- Platform-level catalogue; no RLS (all authenticated users can read).
CREATE TABLE IF NOT EXISTS "value_set" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "set_code"       text        NOT NULL,
  "display_name"   text        NOT NULL,
  "source"         text        NOT NULL,
  "source_version" text,
  "description"    text,
  "is_extensible"  boolean     NOT NULL DEFAULT false,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "value_set_code_unique" UNIQUE ("set_code")
);

-- Individual values; RLS allows all tenants to see platform values
-- (tenant_id IS NULL) and each tenant to see its own extensions.
CREATE TABLE IF NOT EXISTS "value_set_member" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "value_set_id"    uuid        NOT NULL REFERENCES "value_set"("id"),
  "tenant_id"       uuid        REFERENCES "tenant"("id"),
  "code"            text        NOT NULL,
  "display_label"   text        NOT NULL,
  "description"     text,
  "sort_order"      smallint    NOT NULL DEFAULT 0,
  "active_from"     timestamptz NOT NULL DEFAULT now(),
  "active_to"       timestamptz,
  "source_metadata" jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

-- Platform codes unique within their set
CREATE UNIQUE INDEX "vsm_platform_code_unique"
  ON "value_set_member" ("value_set_id", "code")
  WHERE "tenant_id" IS NULL;

-- Tenant extension codes unique per tenant within their set
CREATE UNIQUE INDEX "vsm_tenant_code_unique"
  ON "value_set_member" ("value_set_id", "tenant_id", "code")
  WHERE "tenant_id" IS NOT NULL;

ALTER TABLE "value_set_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "value_set_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY value_set_member_visibility ON "value_set_member"
  USING (
    "tenant_id" IS NULL
    OR "tenant_id" = current_setting('app.current_tenant_id', true)::uuid
  );

-- Maps a data-model field to the value set that governs its valid codes.
CREATE TABLE IF NOT EXISTS "field_value_set" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_name"    text NOT NULL,
  "field_name"     text NOT NULL,
  "value_set_code" text NOT NULL REFERENCES "value_set"("set_code"),
  "description"    text,
  CONSTRAINT "field_value_set_unique" UNIQUE ("entity_name", "field_name")
);

-- ── Academic Rule (Bitemporal) ────────────────────────────────────────────────
-- Configuration-driven rules used by the rules engine; per-tenant; RLS.
CREATE TABLE IF NOT EXISTS "academic_rule" (
  "version_id"     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"             uuid        NOT NULL,
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id"   uuid,
  "rule_type_code" text        NOT NULL,
  "rule_key"       text        NOT NULL,
  "rule_value"     jsonb       NOT NULL,
  "description"    text,
  "applies_to_level" smallint,
  "valid_from"     timestamptz NOT NULL,
  "valid_to"       timestamptz,
  "recorded_at"    timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "academic_rule_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "academic_rule_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX "academic_rule_unique_logical_transaction"
  ON "academic_rule" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX "academic_rule_current_version_unique"
  ON "academic_rule" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "academic_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "academic_rule"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Originally: 0001_seed_value_sets.sql
-- ============================================================

-- Revelation SRS — Platform Value Set Seed Data
-- Migration: 0001_seed_value_sets
--
-- Seeds all platform-managed value sets with their initial values.
-- Sources:
--   HESA: HESA Student Record 2024-25 Coding Manual
--   SRS:  Revelation SRS internal enumerations
--
-- To update for a new HESA coding year, insert updated members with
-- active_from set to the start of the new academic year and active_to
-- set on retired codes.  Do NOT delete retired codes — they are required
-- for historical data reconstruction.

-- ── Helper: define all value sets ───────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  -- HESA statutory sets
  ('hesa-disability-code',       'HESA Disability Coding',              'hesa', '2024-25', 'HESA Student Record disability field codes',                         false),
  ('hesa-qualification-type',    'HESA Qualification Type',             'hesa', '2024-25', 'HESA qualification type codes for awards and programmes',             false),
  ('hesa-mode-of-study',         'HESA Mode of Study',                  'hesa', '2024-25', 'HESA mode of study codes',                                            false),
  ('hesa-domicile-code',         'HESA Domicile',                       'hesa', '2024-25', 'Country of domicile prior to study (ISO 3166-1)',                     false),
  ('hesa-ethnicity-code',        'HESA Ethnicity Coding',               'hesa', '2024-25', 'HESA ethnicity field codes (special category)',                       false),
  ('hesa-gender-code',           'HESA Gender',                         'hesa', '2024-25', 'HESA gender codes',                                                   false),
  ('hesa-nationality-code',      'Nationality (ISO 3166-1)',             'hesa', '2024-25', 'Country of nationality (ISO 3166-1 alpha-3)',                         false),
  -- SRS internal enumerations
  ('enrolment-status-code',      'Enrolment Status',                    'srs-internal', NULL, 'Student enrolment lifecycle status',                               false),
  ('person-status-code',         'Person Lifecycle Status',             'srs-internal', NULL, 'Person record lifecycle status (separate from enrolment status)',   false),
  ('mark-status-code',           'Mark Status',                         'srs-internal', NULL, 'Assessment mark status',                                            false),
  ('result-code',                'Module Result',                       'srs-internal', NULL, 'Outcome of a module registration',                                  false),
  ('assessment-component-type',  'Assessment Component Type',           'srs-internal', NULL, 'Type of assessment component',                                      true),
  ('hold-type-code',             'Student Hold Type',                   'srs-internal', NULL, 'Reason for a hold applied to a student account',                   true),
  ('mode-of-study-code',         'Mode of Study',                       'srs-internal', NULL, 'Student mode of study',                                             false),
  ('funding-source-code',        'Funding Source',                      'srs-internal', NULL, 'Source of tuition fee funding',                                     true),
  ('fheq-level',                 'FHEQ Level',                          'srs-internal', NULL, 'Framework for Higher Education Qualifications level (4-8)',         false),
  ('audit-action-type',          'Audit Action Type',                   'srs-internal', NULL, 'Type of action recorded in the audit trail',                        false),
  ('audit-actor-type',           'Audit Actor Type',                    'srs-internal', NULL, 'Type of actor that performed the audited action',                   false),
  ('data-classification-code',   'Data Classification',                 'srs-internal', NULL, 'Personal data sensitivity classification',                           false),
  ('integration-direction-code', 'Integration Direction',               'srs-internal', NULL, 'Direction of an integration contract from the SRS perspective',     false),
  ('integration-exchange-status','Integration Exchange Status',         'srs-internal', NULL, 'Status of an integration exchange attempt',                          false),
  ('integration-transport-code', 'Integration Transport',               'srs-internal', NULL, 'Integration transport mechanism',                                    false),
  ('integration-health-status',  'Integration Health Status',           'srs-internal', NULL, 'Current health state of a registered integration',                  false),
  ('visa-type-code',             'Visa Type',                           'srs-internal', NULL, 'Student visa category',                                              false),
  ('cas-request-type-code',      'CAS Request Type',                    'srs-internal', NULL, 'Type of Confirmation of Acceptance for Studies request',             false),
  ('declaration-status-code',    'Declaration Status',                  'srs-internal', NULL, 'Status of a student disability declaration',                         false),
  ('student-address-type',       'Student Address Type',                'srs-internal', NULL, 'Category of student address',                                        false),
  ('contact-type-code',          'Contact Method Type',                 'srs-internal', NULL, 'Type of student contact method',                                     false),
  ('staff-assignment-type',      'Staff Assignment Type',               'srs-internal', NULL, 'Type of staff-to-student/module assignment',                         false),
  ('research-milestone-type',    'Research Milestone Type',             'srs-internal', NULL, 'PGR research degree milestone type',                                 false)
ON CONFLICT ("set_code") DO NOTHING;

-- ── HESA Disability Codes (2024-25) ─────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'DISABLE')
FROM "value_set" vs,
(VALUES
  ('00',  'No disability',                                          'No known disability',                                                                   0),
  ('01',  'Specific learning difficulty',                           'e.g. dyslexia, dyspraxia or AD(H)D',                                                   10),
  ('02',  'General learning disability',                            'e.g. Down''s syndrome',                                                                 20),
  ('03',  'Social/communication impairment',                        'e.g. Asperger''s syndrome or other autistic spectrum disorder',                          30),
  ('04',  'Long standing illness or health condition',              'e.g. cancer, HIV, diabetes, chronic heart disease or epilepsy',                         40),
  ('05',  'Mental health condition',                                'e.g. depression, schizophrenia or anxiety disorder',                                    50),
  ('06',  'Physical impairment or mobility issues',                 'e.g. difficulty using arms, or using a wheelchair or crutches',                         60),
  ('07',  'Deaf or serious hearing impairment',                     NULL,                                                                                   70),
  ('08',  'Blind or a serious visual impairment',                   'Uncorrected by glasses',                                                                80),
  ('09',  'A disability, impairment or medical condition not listed above', NULL,                                                                            90),
  ('96',  'Prefer not to say',                                      NULL,                                                                                   96),
  ('99',  'Not known / not yet sought',                             NULL,                                                                                   99)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'hesa-disability-code'
ON CONFLICT DO NOTHING;

-- ── HESA Qualification Type Codes (key subset, 2024-25) ─────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'QUALSBJ')
FROM "value_set" vs,
(VALUES
  ('051', 'First degree',                                    10),
  ('055', 'Integrated master''s degree',                     20),
  ('056', 'Foundation degree',                               30),
  ('057', 'Diploma of Higher Education (DipHE)',             40),
  ('058', 'Higher National Certificate/Diploma (HNC/HND)',   50),
  ('100', 'Research-based higher degree (doctoral)',         60),
  ('200', 'Taught higher degree (master''s)',                70),
  ('205', 'Postgraduate Certificate in Education (PGCE)',    80),
  ('300', 'Postgraduate diploma',                            90),
  ('400', 'Professional qualification',                     100),
  ('900', 'Other qualification or award',                   110)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-qualification-type'
ON CONFLICT DO NOTHING;

-- ── HESA Mode of Study (2024-25) ─────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'MODESTU')
FROM "value_set" vs,
(VALUES
  ('01', 'Full-time',                  10),
  ('02', 'Part-time / sandwich',       20),
  ('31', 'Part-time',                  30),
  ('63', 'Flexible / distance',        40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-mode-of-study'
ON CONFLICT DO NOTHING;

-- ── HESA Gender Codes (2024-25) ───────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'SEXID')
FROM "value_set" vs,
(VALUES
  ('1', 'Male',           10),
  ('2', 'Female',         20),
  ('3', 'Other',          30),
  ('4', 'Not known',      40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-gender-code'
ON CONFLICT DO NOTHING;

-- ── HESA Ethnicity Codes (2024-25) ───────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'ETHNIC', 'category', 'special-category')
FROM "value_set" vs,
(VALUES
  ('10', 'White',                                                 10),
  ('15', 'White - English / Welsh / Scottish / Northern Irish',  11),
  ('16', 'White - Irish',                                        12),
  ('17', 'White - Gypsy or Irish Traveller',                     13),
  ('18', 'White - Roma',                                         14),
  ('19', 'White - Other White background',                       15),
  ('21', 'Mixed / Multiple ethnic groups',                       20),
  ('22', 'Mixed - White and Black Caribbean',                    21),
  ('23', 'Mixed - White and Black African',                      22),
  ('24', 'Mixed - White and Asian',                              23),
  ('29', 'Mixed - Any other Mixed / Multiple ethnic background', 24),
  ('31', 'Asian or Asian British',                               30),
  ('32', 'Asian - Indian',                                       31),
  ('33', 'Asian - Pakistani',                                    32),
  ('34', 'Asian - Bangladeshi',                                  33),
  ('35', 'Asian - Chinese',                                      34),
  ('39', 'Asian - Any other Asian background',                   35),
  ('41', 'Black, African, Caribbean or Black British',           40),
  ('42', 'Black - African',                                      41),
  ('43', 'Black - Caribbean',                                    42),
  ('49', 'Black - Any other Black / African / Caribbean background', 43),
  ('50', 'Arab',                                                 50),
  ('80', 'Other ethnic group',                                   80),
  ('90', 'Not known',                                            90),
  ('98', 'Information refused / prefer not to say',              98)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-ethnicity-code'
ON CONFLICT DO NOTHING;

-- ── FHEQ Levels ───────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order
FROM "value_set" vs,
(VALUES
  ('4', 'Level 4', 'Certificate of Higher Education',                             4),
  ('5', 'Level 5', 'Foundation Degree or Higher National Diploma',                5),
  ('6', 'Level 6', 'Bachelor''s degree with or without honours; Graduate Diploma', 6),
  ('7', 'Level 7', 'Master''s degree; Postgraduate Certificate / Diploma',        7),
  ('8', 'Level 8', 'Doctoral degree',                                             8)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'fheq-level'
ON CONFLICT DO NOTHING;

-- ── Enrolment Status ──────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('enrolled',    'Enrolled',     10),
  ('intermitting','Intermitting', 20),
  ('suspended',   'Suspended',    30),
  ('withdrawn',   'Withdrawn',    40),
  ('graduated',   'Graduated',    50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'enrolment-status-code'
ON CONFLICT DO NOTHING;

-- ── Person Lifecycle Status ───────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('prospective', 'Prospective student', 10),
  ('student',     'Enrolled student',    20),
  ('alumnus',     'Alumni',              30),
  ('deceased',    'Deceased',            40),
  ('merged',      'Merged (duplicate)',  50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'person-status-code'
ON CONFLICT DO NOTHING;

-- ── Mark Status ───────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('provisional', 'Provisional', 10),
  ('confirmed',   'Confirmed',   20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'mark-status-code'
ON CONFLICT DO NOTHING;

-- ── Module Result ─────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pass',         'Pass',                  10),
  ('fail',         'Fail',                  20),
  ('compensated',  'Pass (Compensated)',    30),
  ('condoned',     'Pass (Condoned)',       40),
  ('deferred',     'Deferred',             50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'result-code'
ON CONFLICT DO NOTHING;

-- ── Assessment Component Types ────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('exam',          'Examination',           10),
  ('coursework',    'Coursework',            20),
  ('practical',     'Practical',             30),
  ('portfolio',     'Portfolio',             40),
  ('dissertation',  'Dissertation / Thesis', 50),
  ('presentation',  'Presentation',          60),
  ('project',       'Project',               70)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'assessment-component-type'
ON CONFLICT DO NOTHING;

-- ── Hold Types ────────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('financial',     'Financial hold',           10),
  ('library',       'Library hold',             20),
  ('compliance',    'Compliance hold',          30),
  ('disciplinary',  'Disciplinary hold',        40),
  ('document',      'Document outstanding',     50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hold-type-code'
ON CONFLICT DO NOTHING;

-- ── Mode of Study ─────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('full-time',       'Full-time',        10),
  ('part-time',       'Part-time',        20),
  ('distance',        'Distance learning',30),
  ('sandwich',        'Sandwich',         40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'mode-of-study-code'
ON CONFLICT DO NOTHING;

-- ── Funding Source ────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('slc',              'Student Loans Company',   10),
  ('self-funded',      'Self-funded',             20),
  ('employer',         'Employer-sponsored',      30),
  ('international',    'International fee payer', 40),
  ('bursary',          'Institutional bursary',   50),
  ('research-council', 'Research council stipend',60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'funding-source-code'
ON CONFLICT DO NOTHING;

-- ── Audit Action Type ─────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('create', 'Create', 10),
  ('update', 'Update', 20),
  ('delete', 'Delete', 30),
  ('read',   'Read',   40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'audit-action-type'
ON CONFLICT DO NOTHING;

-- ── Audit Actor Type ──────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('user',        'Human user',         10),
  ('system',      'System process',     20),
  ('integration', 'Integration service',30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'audit-actor-type'
ON CONFLICT DO NOTHING;

-- ── Data Classification ───────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order
FROM "value_set" vs,
(VALUES
  ('standard',         'Standard',          'Non-personal configuration and reference data',           10),
  ('personal',         'Personal',          'Personal data (GDPR — standard personal)',                20),
  ('sensitive',        'Sensitive',         'Sensitive institutional data (marks, progression, holds)', 30),
  ('special-category', 'Special category',  'GDPR special category (disability, health, ethnicity)',   40),
  ('regulatory',       'Regulatory',        'Statutory exchange data (HESA, SLC, UKVI)',               50)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'data-classification-code'
ON CONFLICT DO NOTHING;

-- ── Integration Direction ─────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('inbound',       'Inbound',         10),
  ('outbound',      'Outbound',        20),
  ('bidirectional', 'Bidirectional',   30),
  ('context',       'Reference context (non-SIS-facing)', 40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-direction-code'
ON CONFLICT DO NOTHING;

-- ── Integration Exchange Status ───────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('received',     'Received',          10),
  ('validated',    'Validated',         20),
  ('processed',    'Processed',         30),
  ('sent',         'Sent',              40),
  ('failed',       'Failed',            50),
  ('dead-lettered','Dead-lettered',     60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-exchange-status'
ON CONFLICT DO NOTHING;

-- ── Integration Transport ─────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('rest',       'REST API',   10),
  ('event',      'Event (NATS JetStream)', 20),
  ('sftp',       'SFTP file exchange',     30),
  ('https-file', 'HTTPS file exchange',   40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-transport-code'
ON CONFLICT DO NOTHING;

-- ── Integration Health Status ─────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('healthy',     'Healthy',     10),
  ('degraded',    'Degraded',    20),
  ('unreachable', 'Unreachable', 30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-health-status'
ON CONFLICT DO NOTHING;

-- ── Visa Type ─────────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('student',  'Student visa',  10),
  ('graduate', 'Graduate visa', 20),
  ('other',    'Other',         30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'visa-type-code'
ON CONFLICT DO NOTHING;

-- ── CAS Request Type ──────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('new',     'New CAS',    10),
  ('renewal', 'Renewal',    20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'cas-request-type-code'
ON CONFLICT DO NOTHING;

-- ── Disability Declaration Status ────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('declared',  'Declared',   10),
  ('updated',   'Updated',    20),
  ('withdrawn', 'Withdrawn',  30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'declaration-status-code'
ON CONFLICT DO NOTHING;

-- ── Student Address Type ──────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('home',           'Home address',           10),
  ('term',           'Term-time address',      20),
  ('correspondence', 'Correspondence address', 30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'student-address-type'
ON CONFLICT DO NOTHING;

-- ── Contact Method Type ───────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('institutional-email', 'Institutional email', 10),
  ('personal-email',      'Personal email',      20),
  ('mobile-phone',        'Mobile phone',        30),
  ('landline',            'Landline',            40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'contact-type-code'
ON CONFLICT DO NOTHING;

-- ── Staff Assignment Type ─────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('personal-tutor',  'Personal tutor',     10),
  ('supervisor',      'Research supervisor',20),
  ('module-tutor',    'Module tutor',       30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'staff-assignment-type'
ON CONFLICT DO NOTHING;

-- ── Research Milestone Type ───────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('confirmation-of-registration', 'Confirmation of Registration', 10),
  ('upgrade',                      'Upgrade to PhD',               20),
  ('thesis-submission',            'Thesis submission',            30),
  ('viva',                         'Viva voce examination',        40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'research-milestone-type'
ON CONFLICT DO NOTHING;

-- ── Field → Value Set Mappings ───────────────────────────────────────────────
-- Maps each _code column in the data model to its governing value set.
-- Add new mappings here as domain entities are created in Phase 4+.

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  -- Audit
  ('audit_record',           'action_type',              'audit-action-type',         NULL),
  ('audit_record',           'actor_type',               'audit-actor-type',          NULL),
  -- Integration
  ('integration_contract',   'direction_code',           'integration-direction-code', NULL),
  ('integration_contract',   'data_classification_code', 'data-classification-code',  NULL),
  ('integration_registration','transport_code',          'integration-transport-code', NULL),
  ('integration_registration','health_status_code',      'integration-health-status', NULL),
  ('integration_exchange',   'status_code',              'integration-exchange-status',NULL),
  ('integration_exchange',   'direction_code',           'integration-direction-code', NULL),
  -- Value set members
  ('value_set_member',       'source_metadata',          'data-classification-code',  'Relevant when source_metadata indicates special category')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0002_phase4_domain_schema.sql
-- ============================================================

-- Revelation SRS — Phase 4 Domain Schema
-- Migration: 0002_phase4_domain_schema
-- Applied by: packages/db/src/migrate.ts
--
-- Creates: student identity tables, enrolment tables,
--          programme/module catalogue, academic calendar, module registration.
-- All tenant-scoped tables have RLS.
-- Bitemporal tables get temporal check constraints and current-version unique indexes.

-- ── Student number sequence ───────────────────────────────────────────────────
-- Platform-wide sequence; student numbers are formatted by the application.
CREATE SEQUENCE IF NOT EXISTS student_number_seq START WITH 1000001;

-- ── Person (student root record) ─────────────────────────────────────────────
-- Non-bitemporal: personal data changes are in person_identity.
CREATE TABLE IF NOT EXISTS "person" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "student_number"      text        NOT NULL,
  "hesa_id"             text,
  "person_status_code"  text        NOT NULL DEFAULT 'prospective'
                          CHECK ("person_status_code" IN ('prospective','student','alumnus','deceased','merged')),
  "source_system"       text,
  "source_reference"    text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "person_tenant_student_number_unique" UNIQUE ("tenant_id", "student_number")
);

CREATE INDEX IF NOT EXISTS "person_tenant_idx" ON "person" ("tenant_id");
CREATE INDEX IF NOT EXISTS "person_tenant_status_idx" ON "person" ("tenant_id", "person_status_code");

ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "person";
CREATE POLICY tenant_isolation ON "person"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Person Identity (Bitemporal) ─────────────────────────────────────────────
-- Legal name, demographics, contact details.  Includes special-category fields.
CREATE TABLE IF NOT EXISTS "person_identity" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"           uuid        NOT NULL REFERENCES "person"("id"),
  "legal_first_name"    text        NOT NULL,
  "legal_family_name"   text        NOT NULL,
  "preferred_name"      text,
  "date_of_birth"       date,
  "gender_code"         text,
  "nationality_code"    text,
  "domicile_code"       text,
  "ethnicity_code"      text,
  "email_institutional" text,
  "email_personal"      text,
  "phone_mobile"        text,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "person_identity_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "person_identity_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "person_identity_unique_logical_transaction"
  ON "person_identity" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "person_identity_current_version_unique"
  ON "person_identity" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "person_identity_person_idx" ON "person_identity" ("tenant_id", "person_id");

ALTER TABLE "person_identity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_identity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "person_identity";
CREATE POLICY tenant_isolation ON "person_identity"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Student Address (Bitemporal) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_address" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"        uuid        NOT NULL REFERENCES "person"("id"),
  "address_type_code" text       NOT NULL
                       CHECK ("address_type_code" IN ('home','term','correspondence')),
  "line1"            text        NOT NULL,
  "line2"            text,
  "city"             text,
  "postcode"         text,
  "country_code"     text,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "student_address_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "student_address_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_address_unique_logical_transaction"
  ON "student_address" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "student_address_current_version_unique"
  ON "student_address" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "student_address" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_address" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_address";
CREATE POLICY tenant_isolation ON "student_address"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Student Contact Method (Bitemporal) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_contact_method" (
  "version_id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                uuid        NOT NULL,
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"         uuid        NOT NULL REFERENCES "person"("id"),
  "contact_type_code" text        NOT NULL,
  "contact_value"     text        NOT NULL,
  "is_primary"        boolean     NOT NULL DEFAULT false,
  "verified_at"       timestamptz,
  "valid_from"        timestamptz NOT NULL,
  "valid_to"          timestamptz,
  "recorded_at"       timestamptz NOT NULL DEFAULT now(),
  "recorded_until"    timestamptz,
  CONSTRAINT "student_contact_method_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "student_contact_method_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_contact_method_unique_logical_transaction"
  ON "student_contact_method" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "student_contact_method_current_version_unique"
  ON "student_contact_method" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "student_contact_method" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_contact_method" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_contact_method";
CREATE POLICY tenant_isolation ON "student_contact_method"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Disability Declaration (Bitemporal) ──────────────────────────────────────
-- Special-category data; read audit mandatory.
CREATE TABLE IF NOT EXISTS "disability_declaration" (
  "version_id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                       uuid        NOT NULL,
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"                uuid        NOT NULL REFERENCES "person"("id"),
  "disability_category_code" text        NOT NULL,
  "declaration_status_code"  text        NOT NULL DEFAULT 'declared'
                               CHECK ("declaration_status_code" IN ('declared','withdrawn','updated')),
  "declared_at"              timestamptz NOT NULL DEFAULT now(),
  "valid_from"               timestamptz NOT NULL,
  "valid_to"                 timestamptz,
  "recorded_at"              timestamptz NOT NULL DEFAULT now(),
  "recorded_until"           timestamptz,
  CONSTRAINT "disability_declaration_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "disability_declaration_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "disability_declaration_unique_logical_transaction"
  ON "disability_declaration" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "disability_declaration_current_version_unique"
  ON "disability_declaration" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "disability_declaration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disability_declaration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "disability_declaration";
CREATE POLICY tenant_isolation ON "disability_declaration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Identity Verification Check (Bitemporal) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "identity_verification_check" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"           uuid        NOT NULL REFERENCES "person"("id"),
  "status_code"         text        NOT NULL
                          CHECK ("status_code" IN ('requested','verified','failed','fraud-flagged')),
  "confidence_score"    smallint,
  "fraud_flag"          boolean     NOT NULL DEFAULT false,
  "provider_reference"  text,
  "requested_at"        timestamptz NOT NULL DEFAULT now(),
  "completed_at"        timestamptz,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "identity_verification_check_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "identity_verification_check_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "identity_verification_check_unique_logical_transaction"
  ON "identity_verification_check" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "identity_verification_check_current_version_unique"
  ON "identity_verification_check" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "identity_verification_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_verification_check" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity_verification_check";
CREATE POLICY tenant_isolation ON "identity_verification_check"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment (Bitemporal) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enrolment" (
  "version_id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                   uuid        NOT NULL,
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"            uuid        NOT NULL REFERENCES "person"("id"),
  "programme_id"         uuid,
  "status_code"          text        NOT NULL DEFAULT 'enrolled'
                           CHECK ("status_code" IN ('enrolled','intermitting','withdrawn','suspended','graduated')),
  "mode_of_study_code"   text        NOT NULL
                           CHECK ("mode_of_study_code" IN ('full-time','part-time','distance','sandwich')),
  "attendance_type_code" text,
  "academic_year_of_entry" text      NOT NULL,
  "start_date"           date        NOT NULL,
  "expected_end_date"    date,
  "actual_end_date"      date,
  "fee_band_code"        text,
  "funding_source_code"  text
                           CHECK ("funding_source_code" IS NULL OR "funding_source_code" IN ('slc','self-funded','employer','international','bursary','research-council')),
  "slc_reference"        text,
  "ucas_personal_id"     text,
  "valid_from"           timestamptz NOT NULL,
  "valid_to"             timestamptz,
  "recorded_at"          timestamptz NOT NULL DEFAULT now(),
  "recorded_until"       timestamptz,
  CONSTRAINT "enrolment_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "enrolment_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_unique_logical_transaction"
  ON "enrolment" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_current_version_unique"
  ON "enrolment" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "enrolment_person_idx" ON "enrolment" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "enrolment_status_idx" ON "enrolment" ("tenant_id", "status_code") WHERE recorded_until IS NULL;

ALTER TABLE "enrolment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "enrolment";
CREATE POLICY tenant_isolation ON "enrolment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment Status Transition Ledger ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enrolment_status_transition" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"     uuid        NOT NULL,
  "from_status_code" text        NOT NULL,
  "to_status_code"   text        NOT NULL,
  "reason_code"      text,
  "reason_text"      text,
  "effective_at"     timestamptz NOT NULL,
  "actor_id"         text        NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "enrolment_status_transition_enrolment_idx"
  ON "enrolment_status_transition" ("tenant_id", "enrolment_id", "created_at");

ALTER TABLE "enrolment_status_transition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_status_transition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "enrolment_status_transition";
CREATE POLICY tenant_isolation ON "enrolment_status_transition"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Fee Liability Ledger (F009) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "fee_liability" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"        uuid        NOT NULL,
  "person_id"           uuid        NOT NULL REFERENCES "person"("id"),
  "academic_year"       text        NOT NULL,
  "fee_band_code"       text,
  "funding_source_code" text,
  "amount_pence"        integer,
  "status_code"         text        NOT NULL DEFAULT 'generated'
                           CHECK ("status_code" IN ('generated','superseded','cancelled')),
  "generated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "fee_liability_enrolment_idx"
  ON "fee_liability" ("tenant_id", "enrolment_id", "generated_at");

ALTER TABLE "fee_liability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fee_liability" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "fee_liability";
CREATE POLICY tenant_isolation ON "fee_liability"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Enrolment Downstream Trigger Ledger (F046/F049/F051) ────────────────────
CREATE TABLE IF NOT EXISTS "enrolment_downstream_trigger" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"      uuid        NOT NULL,
  "trigger_type_code" text        NOT NULL
                          CHECK ("trigger_type_code" IN ('ucas-confirmation','slc-confirmation','ukvi-cas')),
  "status_code"       text        NOT NULL DEFAULT 'pending'
                          CHECK ("status_code" IN ('pending','sent','acknowledged','failed','cancelled')),
  "payload_summary"   jsonb,
  "correlation_id"    uuid,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "sent_at"           timestamptz
);

CREATE INDEX IF NOT EXISTS "enrolment_downstream_trigger_enrolment_idx"
  ON "enrolment_downstream_trigger" ("tenant_id", "enrolment_id", "trigger_type_code");

ALTER TABLE "enrolment_downstream_trigger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_downstream_trigger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "enrolment_downstream_trigger";
CREATE POLICY tenant_isolation ON "enrolment_downstream_trigger"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Re-enrolment Period ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reenrolment_period" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_year" text        NOT NULL,
  "programme_id"  uuid,
  "opens_at"      timestamptz NOT NULL,
  "closes_at"     timestamptz NOT NULL,
  "reminder_at"   timestamptz,
  CONSTRAINT "reenrolment_period_closes_after_opens"
    CHECK ("closes_at" > "opens_at")
);

CREATE INDEX IF NOT EXISTS "reenrolment_period_tenant_idx" ON "reenrolment_period" ("tenant_id");

ALTER TABLE "reenrolment_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reenrolment_period" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reenrolment_period";
CREATE POLICY tenant_isolation ON "reenrolment_period"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Re-enrolment Confirmation (Bitemporal) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reenrolment_confirmation" (
  "version_id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                    uuid        NOT NULL,
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"          uuid        NOT NULL,
  "reenrolment_period_id" uuid        NOT NULL REFERENCES "reenrolment_period"("id"),
  "status_code"           text        NOT NULL DEFAULT 'pending'
                            CHECK ("status_code" IN ('pending','confirmed','lapsed')),
  "confirmed_at"          timestamptz,
  "valid_from"            timestamptz NOT NULL,
  "valid_to"              timestamptz,
  "recorded_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_until"        timestamptz,
  CONSTRAINT "reenrolment_confirmation_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "reenrolment_confirmation_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "reenrolment_confirmation_unique_logical_transaction"
  ON "reenrolment_confirmation" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "reenrolment_confirmation_current_version_unique"
  ON "reenrolment_confirmation" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "reenrolment_confirmation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reenrolment_confirmation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reenrolment_confirmation";
CREATE POLICY tenant_isolation ON "reenrolment_confirmation"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Awarding Body ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "awarding_body" (
  "id"        uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid    NOT NULL REFERENCES "tenant"("id"),
  "code"      text    NOT NULL,
  "name"      text    NOT NULL,
  "active"    boolean NOT NULL DEFAULT true,
  CONSTRAINT "awarding_body_tenant_code_unique" UNIQUE ("tenant_id", "code")
);

CREATE INDEX IF NOT EXISTS "awarding_body_tenant_idx" ON "awarding_body" ("tenant_id");

ALTER TABLE "awarding_body" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "awarding_body" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "awarding_body";
CREATE POLICY tenant_isolation ON "awarding_body"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Programme (Bitemporal) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "programme" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "code"                    text        NOT NULL,
  "title"                   text        NOT NULL,
  "qualification_type_code" text,
  "awarding_body_id"        uuid,
  "owning_school"           text,
  "credit_framework_code"   text,
  "fheq_level"              smallint,
  "credit_total"            smallint,
  "duration_years"          smallint,
  "mode_of_study_code"      text,
  "source_system_reference" text,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "programme_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "programme_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "programme_unique_logical_transaction"
  ON "programme" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "programme_current_version_unique"
  ON "programme" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "programme_tenant_code_idx" ON "programme" ("tenant_id", "code") WHERE recorded_until IS NULL;

ALTER TABLE "programme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programme";
CREATE POLICY tenant_isolation ON "programme"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Programme Route (Bitemporal) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "programme_route" (
  "version_id"  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"          uuid        NOT NULL,
  "tenant_id"   uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id" uuid       NOT NULL,
  "route_code"  text        NOT NULL,
  "title"       text        NOT NULL,
  "valid_from"  timestamptz NOT NULL,
  "valid_to"    timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "programme_route_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "programme_route_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "programme_route_unique_logical_transaction"
  ON "programme_route" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "programme_route_current_version_unique"
  ON "programme_route" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "programme_route" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme_route" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programme_route";
CREATE POLICY tenant_isolation ON "programme_route"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Programme Rule Set (Bitemporal) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "programme_rule_set" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id"        uuid        NOT NULL,
  "programme_route_id"  uuid,
  "entry_academic_year" text,
  "rule_set_code"       text        NOT NULL,
  "description"         text,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "programme_rule_set_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "programme_rule_set_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "programme_rule_set_unique_logical_transaction"
  ON "programme_rule_set" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "programme_rule_set_current_version_unique"
  ON "programme_rule_set" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "programme_rule_set" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme_rule_set" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programme_rule_set";
CREATE POLICY tenant_isolation ON "programme_rule_set"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module (Bitemporal) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "code"                    text        NOT NULL,
  "title"                   text        NOT NULL,
  "credit_value"            smallint,
  "fheq_level"              smallint,
  "source_system_reference" text,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "module_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_unique_logical_transaction"
  ON "module" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_current_version_unique"
  ON "module" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_tenant_code_idx" ON "module" ("tenant_id", "code") WHERE recorded_until IS NULL;

ALTER TABLE "module" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module";
CREATE POLICY tenant_isolation ON "module"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Relationship (Bitemporal) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_relationship" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_id"              uuid        NOT NULL,
  "related_module_id"      uuid        NOT NULL,
  "relationship_type_code" text        NOT NULL
                             CHECK ("relationship_type_code" IN ('prerequisite','co-requisite','exclusion')),
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "module_relationship_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_relationship_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_relationship_unique_logical_transaction"
  ON "module_relationship" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_relationship_current_version_unique"
  ON "module_relationship" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_relationship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_relationship" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_relationship";
CREATE POLICY tenant_isolation ON "module_relationship"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Assessment Pattern (Bitemporal) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "assessment_pattern" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_id"        uuid        NOT NULL,
  "pattern_code"     text        NOT NULL,
  "description"      text,
  "component_schema" jsonb,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "assessment_pattern_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "assessment_pattern_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "assessment_pattern_unique_logical_transaction"
  ON "assessment_pattern" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "assessment_pattern_current_version_unique"
  ON "assessment_pattern" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "assessment_pattern" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_pattern" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_pattern";
CREATE POLICY tenant_isolation ON "assessment_pattern"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Learning Outcome (Bitemporal) ─────────────────────────────────────────────
-- Exactly one of programme_id or module_id must be non-null.
CREATE TABLE IF NOT EXISTS "learning_outcome" (
  "version_id"   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"           uuid        NOT NULL,
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_id" uuid,
  "module_id"    uuid,
  "outcome_code" text        NOT NULL,
  "description"  text        NOT NULL,
  "valid_from"   timestamptz NOT NULL,
  "valid_to"     timestamptz,
  "recorded_at"  timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "learning_outcome_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "learning_outcome_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "learning_outcome_exactly_one_parent"
    CHECK (("programme_id" IS NOT NULL)::int + ("module_id" IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "learning_outcome_unique_logical_transaction"
  ON "learning_outcome" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "learning_outcome_current_version_unique"
  ON "learning_outcome" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "learning_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_outcome" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "learning_outcome";
CREATE POLICY tenant_isolation ON "learning_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Academic Period ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "academic_period" (
  "id"              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid  NOT NULL REFERENCES "tenant"("id"),
  "academic_year"   text  NOT NULL,
  "period_code"     text  NOT NULL,
  "period_type_code" text NOT NULL
                      CHECK ("period_type_code" IN ('semester','term','year')),
  "start_date"      date  NOT NULL,
  "end_date"        date  NOT NULL,
  CONSTRAINT "academic_period_tenant_year_code_unique"
    UNIQUE ("tenant_id", "academic_year", "period_code"),
  CONSTRAINT "academic_period_end_after_start"
    CHECK ("end_date" > "start_date")
);

CREATE INDEX IF NOT EXISTS "academic_period_tenant_year_idx" ON "academic_period" ("tenant_id", "academic_year");

ALTER TABLE "academic_period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_period" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "academic_period";
CREATE POLICY tenant_isolation ON "academic_period"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Offering ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_offering" (
  "id"                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid     NOT NULL REFERENCES "tenant"("id"),
  "module_id"         uuid     NOT NULL,
  "academic_period_id" uuid    NOT NULL REFERENCES "academic_period"("id"),
  "delivery_mode_code" text,
  "capacity"          smallint
);

CREATE INDEX IF NOT EXISTS "module_offering_tenant_idx" ON "module_offering" ("tenant_id");
CREATE INDEX IF NOT EXISTS "module_offering_period_idx" ON "module_offering" ("tenant_id", "academic_period_id");

ALTER TABLE "module_offering" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_offering" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_offering";
CREATE POLICY tenant_isolation ON "module_offering"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Registration (Bitemporal) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_registration" (
  "version_id"         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                 uuid  NOT NULL,
  "tenant_id"          uuid  NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"       uuid  NOT NULL,
  "module_offering_id" uuid  NOT NULL REFERENCES "module_offering"("id"),
  "status_code"        text  NOT NULL DEFAULT 'registered'
                         CHECK ("status_code" IN ('registered','withdrawn','completed')),
  "registration_date"  date  NOT NULL,
  "valid_from"         timestamptz NOT NULL,
  "valid_to"           timestamptz,
  "recorded_at"        timestamptz NOT NULL DEFAULT now(),
  "recorded_until"     timestamptz,
  CONSTRAINT "module_registration_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_registration_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_registration_unique_logical_transaction"
  ON "module_registration" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_registration_current_version_unique"
  ON "module_registration" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_registration_enrolment_idx"
  ON "module_registration" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_registration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_registration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_registration";
CREATE POLICY tenant_isolation ON "module_registration"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Originally: 0003_seed_phase4_field_mappings.sql
-- ============================================================

-- Revelation SRS — Phase 4 Field → Value Set Mappings
-- Migration: 0003_seed_phase4_field_mappings
--
-- Adds field_value_set entries for all Phase 4 domain entity _code columns.
-- Value set rows were pre-populated in 0001_seed_value_sets.sql.
-- This migration only adds mappings; it does not insert new value set members.

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  -- Person
  ('person',              'person_status_code',         'person-status-code',        NULL),
  -- Person Identity
  ('person_identity',     'gender_code',                'hesa-gender-code',          NULL),
  ('person_identity',     'nationality_code',           'hesa-nationality-code',     NULL),
  ('person_identity',     'domicile_code',              'hesa-domicile-code',        NULL),
  ('person_identity',     'ethnicity_code',             'hesa-ethnicity-code',       'Special category — read audit required'),
  -- Student Address
  ('student_address',     'address_type_code',          'student-address-type',      NULL),
  -- Student Contact Method
  ('student_contact_method', 'contact_type_code',       'contact-type-code',         NULL),
  -- Disability Declaration
  ('disability_declaration', 'disability_category_code', 'hesa-disability-code',    'Special category — read audit required'),
  ('disability_declaration', 'declaration_status_code', 'declaration-status-code',  NULL),
  -- Identity Verification Check
  -- (status_code uses a platform-internal enum with no external value set)
  -- Enrolment
  ('enrolment',           'status_code',                'enrolment-status-code',     NULL),
  ('enrolment',           'mode_of_study_code',         'mode-of-study-code',        NULL),
  ('enrolment',           'funding_source_code',        'funding-source-code',       NULL),
  -- Programme
  ('programme',           'qualification_type_code',    'hesa-qualification-type',   NULL),
  ('programme',           'mode_of_study_code',         'mode-of-study-code',        NULL),
  -- Module relationship
  -- (relationship_type_code is a closed platform enum; no separate value set entry)
  -- Module Registration
  -- (status_code is a closed platform enum)
  -- Academic Period
  -- (period_type_code is a closed platform enum)
  -- FHEQ levels (shared across programme and module)
  ('programme',           'fheq_level',                 'fheq-level',                NULL),
  ('module',              'fheq_level',                 'fheq-level',                NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0004_phase5_assessment_schema.sql
-- ============================================================

-- Revelation SRS — Phase 5 Assessment, Progression, and Awards Schema
-- Migration: 0004_phase5_assessment_schema
-- Applied by: packages/db/src/migrate.ts
--
-- Creates: assessment structure, marks, module results, reasonable adjustments,
--          exceptional circumstances, misconduct, exam board governance,
--          progression decisions, awards, post-ratification governance.
-- All tenant-scoped tables have RLS.
-- Bitemporal tables get temporal check constraints and current-version unique indexes.

-- ── Assessment Component ─────────────────────────────────────────────────────
-- Structural configuration per module offering. Immutable once marks ingested.
CREATE TABLE IF NOT EXISTS "assessment_component" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_offering_id"   uuid        NOT NULL,
  "component_type_code"  text        NOT NULL,
  "title"                text        NOT NULL,
  "weighting"            integer     NOT NULL CHECK ("weighting" BETWEEN 1 AND 100),
  "pass_mark_override"   numeric(5,2),
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "assessment_component_offering_idx"
  ON "assessment_component" ("tenant_id", "module_offering_id");

ALTER TABLE "assessment_component" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_component" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_component";
CREATE POLICY tenant_isolation ON "assessment_component"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Assessment Submission ────────────────────────────────────────────────────
-- Append-only intake record from source systems. Links to mark via mark.assessment_submission_id.
CREATE TABLE IF NOT EXISTS "assessment_submission" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "assessment_component_id" uuid        NOT NULL REFERENCES "assessment_component"("id"),
  "module_registration_id"  uuid        NOT NULL,
  "source_system"           text        NOT NULL,
  "source_reference"        text,
  "submitted_at"            timestamptz NOT NULL DEFAULT now(),
  "superseded_at"           timestamptz,
  "raw_payload"             jsonb
);

CREATE INDEX IF NOT EXISTS "assessment_submission_registration_idx"
  ON "assessment_submission" ("tenant_id", "module_registration_id");

ALTER TABLE "assessment_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_submission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_submission";
CREATE POLICY tenant_isolation ON "assessment_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Mark (Bitemporal) ────────────────────────────────────────────────────────
-- Authoritative assessment mark per component/registration.
-- locked = true after board ratification; mutations require upheld post-ratification case.
CREATE TABLE IF NOT EXISTS "mark" (
  "version_id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                       uuid        NOT NULL,
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id"   uuid        NOT NULL,
  "assessment_component_id"  uuid        NOT NULL REFERENCES "assessment_component"("id"),
  "assessment_submission_id" uuid        REFERENCES "assessment_submission"("id"),
  "attempt_number"           integer     NOT NULL DEFAULT 1,
  "raw_mark"                 numeric(5,2) NOT NULL,
  "adjusted_mark"            numeric(5,2) NOT NULL,
  "penalty_applied"          boolean     NOT NULL DEFAULT false,
  "penalty_percent"          numeric(5,2),
  "locked"                   boolean     NOT NULL DEFAULT false,
  "source_system"            text,
  "actor_id"                 text        NOT NULL,
  "valid_from"               timestamptz NOT NULL,
  "valid_to"                 timestamptz,
  "recorded_at"              timestamptz NOT NULL DEFAULT now(),
  "recorded_until"           timestamptz,
  CONSTRAINT "mark_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "mark_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "mark_unique_logical_transaction"
  ON "mark" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "mark_current_version_unique"
  ON "mark" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "mark_registration_idx"
  ON "mark" ("tenant_id", "module_registration_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "mark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mark";
CREATE POLICY tenant_isolation ON "mark"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Module Result (Bitemporal) ───────────────────────────────────────────────
-- Aggregate outcome per module registration. Derived from marks; never written directly by routes.
-- locked = true after board ratification.
CREATE TABLE IF NOT EXISTS "module_result" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id" uuid        NOT NULL,
  "aggregate_mark"         numeric(5,2) NOT NULL,
  "result_code"            text        NOT NULL
                             CHECK ("result_code" IN ('pass','fail','compensated','condoned','deferred','resit-required')),
  "locked"                 boolean     NOT NULL DEFAULT false,
  "calculated_at"          timestamptz NOT NULL DEFAULT now(),
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "module_result_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_result_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_result_unique_logical_transaction"
  ON "module_result" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "module_result_current_version_unique"
  ON "module_result" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "module_result_registration_current_unique"
  ON "module_result" ("tenant_id", "module_registration_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_result" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_result";
CREATE POLICY tenant_isolation ON "module_result"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Reasonable Adjustment (Bitemporal) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reasonable_adjustment" (
  "version_id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                   uuid        NOT NULL,
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"         uuid        NOT NULL,
  "person_id"            uuid        NOT NULL,
  "adjustment_type_code" text        NOT NULL,
  "scope_code"           text        NOT NULL,
  "notes"                text,
  "actor_id"             text        NOT NULL,
  "valid_from"           timestamptz NOT NULL,
  "valid_to"             timestamptz,
  "recorded_at"          timestamptz NOT NULL DEFAULT now(),
  "recorded_until"       timestamptz,
  CONSTRAINT "reasonable_adjustment_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "reasonable_adjustment_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "reasonable_adjustment_unique_logical_transaction"
  ON "reasonable_adjustment" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "reasonable_adjustment_current_version_unique"
  ON "reasonable_adjustment" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "reasonable_adjustment_enrolment_idx"
  ON "reasonable_adjustment" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "reasonable_adjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reasonable_adjustment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "reasonable_adjustment";
CREATE POLICY tenant_isolation ON "reasonable_adjustment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Adjustment Distribution ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "adjustment_distribution" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "adjustment_id"   uuid        NOT NULL,
  "target_system"   text        NOT NULL,
  "status_code"     text        NOT NULL DEFAULT 'pending'
                      CHECK ("status_code" IN ('pending','distributed','failed','superseded')),
  "distributed_at"  timestamptz,
  "failure_reason"  text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "adjustment_distribution_adjustment_idx"
  ON "adjustment_distribution" ("adjustment_id");

ALTER TABLE "adjustment_distribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_distribution" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_distribution";
CREATE POLICY tenant_isolation ON "adjustment_distribution"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exceptional Circumstances (Bitemporal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "exceptional_circumstances" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"        uuid        NOT NULL,
  "person_id"           uuid        NOT NULL,
  "module_offering_id"  uuid,
  "outcome_code"        text        NOT NULL,
  "determination_date"  date        NOT NULL,
  "notes"               text,
  "actor_id"            text        NOT NULL,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "exceptional_circumstances_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "exceptional_circumstances_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "exceptional_circumstances_unique_logical_transaction"
  ON "exceptional_circumstances" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "exceptional_circumstances_current_version_unique"
  ON "exceptional_circumstances" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "exceptional_circumstances_enrolment_idx"
  ON "exceptional_circumstances" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "exceptional_circumstances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exceptional_circumstances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exceptional_circumstances";
CREATE POLICY tenant_isolation ON "exceptional_circumstances"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── EC Board Visibility ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exceptional_circumstances_board_visibility" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant"("id"),
  "exceptional_circumstances_id" uuid        NOT NULL,
  "exam_board_data_pack_id"      uuid        NOT NULL,
  "added_at"                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "exceptional_circumstances_board_visibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exceptional_circumstances_board_visibility" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exceptional_circumstances_board_visibility";
CREATE POLICY tenant_isolation ON "exceptional_circumstances_board_visibility"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Misconduct Case Reference (Bitemporal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "misconduct_case_reference" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"     uuid        NOT NULL,
  "person_id"        uuid        NOT NULL,
  "case_reference"   text        NOT NULL,
  "case_status_code" text        NOT NULL,
  "actor_id"         text        NOT NULL,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "misconduct_case_reference_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "misconduct_case_reference_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_case_reference_unique_logical_transaction"
  ON "misconduct_case_reference" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_case_reference_current_version_unique"
  ON "misconduct_case_reference" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "misconduct_case_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misconduct_case_reference" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "misconduct_case_reference";
CREATE POLICY tenant_isolation ON "misconduct_case_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Misconduct Outcome (Bitemporal) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "misconduct_outcome" (
  "version_id"       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"               uuid        NOT NULL,
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "misconduct_case_id" uuid      NOT NULL,
  "enrolment_id"     uuid        NOT NULL,
  "penalty_code"     text        NOT NULL
                       CHECK ("penalty_code" IN ('mark-reduction','mark-cap','module-fail','progression-block','exclusion')),
  "effective_date"   date        NOT NULL,
  "actor_id"         text        NOT NULL,
  "valid_from"       timestamptz NOT NULL,
  "valid_to"         timestamptz,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  "recorded_until"   timestamptz,
  CONSTRAINT "misconduct_outcome_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "misconduct_outcome_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_outcome_unique_logical_transaction"
  ON "misconduct_outcome" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_outcome_current_version_unique"
  ON "misconduct_outcome" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "misconduct_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misconduct_outcome" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "misconduct_outcome";
CREATE POLICY tenant_isolation ON "misconduct_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Misconduct Penalty Effect (Bitemporal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "misconduct_penalty_effect" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "misconduct_outcome_id" uuid      NOT NULL,
  "target_entity_type"  text        NOT NULL,
  "target_entity_id"    uuid        NOT NULL,
  "penalty_detail"      text,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "misconduct_penalty_effect_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "misconduct_penalty_effect_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_penalty_effect_unique_logical_transaction"
  ON "misconduct_penalty_effect" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "misconduct_penalty_effect_current_version_unique"
  ON "misconduct_penalty_effect" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "misconduct_penalty_effect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "misconduct_penalty_effect" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "misconduct_penalty_effect";
CREATE POLICY tenant_isolation ON "misconduct_penalty_effect"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_board" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "board_type_code"   text        NOT NULL CHECK ("board_type_code" IN ('module','award')),
  "academic_year"     text        NOT NULL,
  "academic_period_id" uuid,
  "meeting_date"      text,
  "ratified_at"       timestamptz,
  "actor_id"          text        NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "exam_board_tenant_year_idx"
  ON "exam_board" ("tenant_id", "academic_year");

ALTER TABLE "exam_board" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board";
CREATE POLICY tenant_isolation ON "exam_board"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board Data Pack ─────────────────────────────────────────────────────
-- Snapshot payload is immutable once created. superseded_by_id is the only
-- mutable metadata field and is set when a newer pack is generated.
CREATE TABLE IF NOT EXISTS "exam_board_data_pack" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id"           uuid        NOT NULL REFERENCES "exam_board"("id"),
  "pack_version"            integer     NOT NULL DEFAULT 1,
  "superseded_by_id"        uuid        REFERENCES "exam_board_data_pack"("id"),
  "source_transaction_time" timestamptz NOT NULL,
  "candidate_count"         integer     NOT NULL DEFAULT 0,
  "generated_at"            timestamptz NOT NULL DEFAULT now(),
  "generated_by"            text        NOT NULL
);

CREATE INDEX IF NOT EXISTS "exam_board_data_pack_board_idx"
  ON "exam_board_data_pack" ("exam_board_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_board_data_pack_current_unique"
  ON "exam_board_data_pack" ("tenant_id", "exam_board_id")
  WHERE superseded_by_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exam_board_data_pack_version_unique"
  ON "exam_board_data_pack" ("tenant_id", "exam_board_id", "pack_version");

ALTER TABLE "exam_board_data_pack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_data_pack" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board_data_pack";
CREATE POLICY tenant_isolation ON "exam_board_data_pack"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board Candidate Profile ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_board_candidate_profile" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid        NOT NULL REFERENCES "tenant"("id"),
  "data_pack_id" uuid        NOT NULL REFERENCES "exam_board_data_pack"("id"),
  "enrolment_id" uuid        NOT NULL,
  "person_id"    uuid        NOT NULL,
  "profile_data" jsonb       NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "exam_board_candidate_profile_pack_idx"
  ON "exam_board_candidate_profile" ("data_pack_id");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_board_candidate_profile_pack_enrolment_unique"
  ON "exam_board_candidate_profile" ("data_pack_id", "enrolment_id");

ALTER TABLE "exam_board_candidate_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_candidate_profile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board_candidate_profile";
CREATE POLICY tenant_isolation ON "exam_board_candidate_profile"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Board Member Attendance ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_board_member_attendance" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid        NOT NULL REFERENCES "exam_board"("id"),
  "actor_id"      text        NOT NULL,
  "role_code"     text        NOT NULL,
  "attended_at"   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "exam_board_member_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_member_attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_board_member_attendance";
CREATE POLICY tenant_isolation ON "exam_board_member_attendance"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── External Examiner Sign-off ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "external_examiner_signoff" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid        NOT NULL REFERENCES "exam_board"("id"),
  "actor_id"      text        NOT NULL,
  "commentary"    text,
  "signed_off_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "external_examiner_signoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_examiner_signoff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "external_examiner_signoff";
CREATE POLICY tenant_isolation ON "external_examiner_signoff"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Progression Decision (Bitemporal) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "progression_decision" (
  "version_id"    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"            uuid        NOT NULL,
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"  uuid        NOT NULL,
  "academic_year" text        NOT NULL,
  "year_of_study" text        NOT NULL,
  "decision_code" text        NOT NULL
                    CHECK ("decision_code" IN ('progress','resit','repeat-year','withdraw')),
  "exam_board_id" uuid,
  "locked"        boolean     NOT NULL DEFAULT false,
  "actor_id"      text        NOT NULL,
  "valid_from"    timestamptz NOT NULL,
  "valid_to"      timestamptz,
  "recorded_at"   timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "progression_decision_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "progression_decision_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "progression_decision_unique_logical_transaction"
  ON "progression_decision" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "progression_decision_current_version_unique"
  ON "progression_decision" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "progression_decision_enrolment_year_current_unique"
  ON "progression_decision" ("tenant_id", "enrolment_id", "academic_year")
  WHERE recorded_until IS NULL;

ALTER TABLE "progression_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "progression_decision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "progression_decision";
CREATE POLICY tenant_isolation ON "progression_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Award (Bitemporal) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "award" (
  "version_id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                    uuid        NOT NULL,
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"          uuid        NOT NULL,
  "person_id"             uuid        NOT NULL,
  "exam_board_id"         uuid        NOT NULL REFERENCES "exam_board"("id"),
  "qualification_code"    text        NOT NULL,
  "classification_code"   text        NOT NULL,
  "award_date"            text        NOT NULL,
  "hear_generated_at"     timestamptz,
  "certificate_issued_at" timestamptz,
  "hear_document"         jsonb,
  "actor_id"              text        NOT NULL,
  "valid_from"            timestamptz NOT NULL,
  "valid_to"              timestamptz,
  "recorded_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_until"        timestamptz,
  CONSTRAINT "award_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "award_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "award_unique_logical_transaction"
  ON "award" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "award_current_version_unique"
  ON "award" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "award_enrolment_current_unique"
  ON "award" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "award" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "award" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "award";
CREATE POLICY tenant_isolation ON "award"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Post-Ratification Case (Bitemporal) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "post_ratification_case" (
  "version_id"    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"            uuid        NOT NULL,
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"  uuid        NOT NULL,
  "case_type_code" text       NOT NULL CHECK ("case_type_code" IN ('appeal','administrative-correction')),
  "status_code"   text        NOT NULL DEFAULT 'submitted'
                    CHECK ("status_code" IN ('submitted','under-review','upheld','dismissed','not-eligible')),
  "reference"     text,
  "actor_id"      text        NOT NULL,
  "valid_from"    timestamptz NOT NULL,
  "valid_to"      timestamptz,
  "recorded_at"   timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "post_ratification_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "post_ratification_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_ratification_case_unique_logical_transaction"
  ON "post_ratification_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "post_ratification_case_current_version_unique"
  ON "post_ratification_case" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "post_ratification_case_enrolment_idx"
  ON "post_ratification_case" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "post_ratification_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_ratification_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "post_ratification_case";
CREATE POLICY tenant_isolation ON "post_ratification_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Post-Ratification Amendment ──────────────────────────────────────────────
-- Append-only; the only authorised path to amend a locked entity.
CREATE TABLE IF NOT EXISTS "post_ratification_amendment" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "case_id"         uuid        NOT NULL,
  "entity_type"     text        NOT NULL CHECK ("entity_type" IN ('mark','module_result','progression_decision')),
  "entity_id"       uuid        NOT NULL,
  "before_value"    jsonb       NOT NULL,
  "after_value"     jsonb       NOT NULL,
  "authorised_by"   text        NOT NULL,
  "amended_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "post_ratification_amendment_case_idx"
  ON "post_ratification_amendment" ("case_id");

ALTER TABLE "post_ratification_amendment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_ratification_amendment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "post_ratification_amendment";
CREATE POLICY tenant_isolation ON "post_ratification_amendment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ============================================================
-- Originally: 0005_seed_phase5_field_mappings.sql
-- ============================================================

-- Revelation SRS — Phase 5 Value Sets and Field Mappings
-- Migration: 0005_seed_phase5_field_mappings
--
-- Adds new value sets for Phase 5 (assessment, adjustments, governance, progression).
-- Extends existing result-code value set with resit-required.
-- Adds field_value_set mappings for all new Phase 5 entity _code columns.

-- ── Extend existing value sets ───────────────────────────────────────────────

-- result-code: add resit-required (was missing from initial seed)
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('resit-required', 'Resit Required', 60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'result-code'
ON CONFLICT DO NOTHING;

-- ── New Phase 5 value set definitions ───────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('adjustment-type-code',               'Reasonable Adjustment Type',          'srs-internal', NULL, 'Type of disability/wellbeing accommodation',                          true),
  ('adjustment-scope-code',              'Reasonable Adjustment Scope',         'srs-internal', NULL, 'Assessment contexts the adjustment applies to',                       false),
  ('board-type-code',                    'Exam Board Type',                     'srs-internal', NULL, 'Whether a board considers module results or awards',                  false),
  ('decision-code',                      'Progression Decision',                'srs-internal', NULL, 'Year-end progression outcome for an enrolment',                       false),
  ('penalty-code',                       'Misconduct Penalty Type',             'srs-internal', NULL, 'Type of academic misconduct penalty',                                 false),
  ('distribution-status-code',           'Adjustment Distribution Status',      'srs-internal', NULL, 'Status of a downstream adjustment distribution',                      false),
  ('case-type-code',                     'Post-Ratification Case Type',         'srs-internal', NULL, 'Whether a post-ratification case is an appeal or admin correction',  false),
  ('post-ratification-case-status-code', 'Post-Ratification Case Status',       'srs-internal', NULL, 'Workflow status of a post-ratification case',                         false)
ON CONFLICT ("set_code") DO NOTHING;

-- ── Adjustment Type Codes ────────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('extra-time',          'Extra Time',              10),
  ('separate-room',       'Separate Room',           20),
  ('deadline-extension',  'Deadline Extension',      30),
  ('reader',              'Reader',                  40),
  ('scribe',              'Scribe',                  50),
  ('rest-breaks',         'Rest Breaks',             60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'adjustment-type-code'
ON CONFLICT DO NOTHING;

-- ── Adjustment Scope Codes ───────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('all',         'All assessments',     10),
  ('exam',        'Examinations only',   20),
  ('coursework',  'Coursework only',     30),
  ('attendance',  'Attendance only',     40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'adjustment-scope-code'
ON CONFLICT DO NOTHING;

-- ── Board Type Codes ─────────────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('module', 'Module Board', 10),
  ('award',  'Award Board',  20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'board-type-code'
ON CONFLICT DO NOTHING;

-- ── Progression Decision Codes ───────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('progress',     'Progress to Next Year',   10),
  ('resit',        'Resit Required',          20),
  ('repeat-year',  'Repeat Year',             30),
  ('withdraw',     'Withdraw',                40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'decision-code'
ON CONFLICT DO NOTHING;

-- ── Misconduct Penalty Codes ─────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('mark-reduction',    'Mark Reduction',     10),
  ('mark-cap',          'Mark Cap',           20),
  ('module-fail',       'Module Fail',        30),
  ('progression-block', 'Progression Block',  40),
  ('exclusion',         'Exclusion',          50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'penalty-code'
ON CONFLICT DO NOTHING;

-- ── Distribution Status Codes ────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pending',     'Pending',     10),
  ('distributed', 'Distributed', 20),
  ('failed',      'Failed',      30),
  ('superseded',  'Superseded',  40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'distribution-status-code'
ON CONFLICT DO NOTHING;

-- ── Post-Ratification Case Type Codes ───────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('appeal',                   'Appeal',                   10),
  ('administrative-correction','Administrative Correction', 20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'case-type-code'
ON CONFLICT DO NOTHING;

-- ── Post-Ratification Case Status Codes ─────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('submitted',    'Submitted',    10),
  ('under-review', 'Under Review', 20),
  ('upheld',       'Upheld',       30),
  ('dismissed',    'Dismissed',    40),
  ('not-eligible', 'Not Eligible', 50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'post-ratification-case-status-code'
ON CONFLICT DO NOTHING;

-- ── Field → Value Set Mappings ───────────────────────────────────────────────

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  -- Assessment Component
  ('assessment_component',     'component_type_code',         'assessment-component-type',           NULL),
  -- Mark (status is a closed platform enum; no value set entry)
  -- Module Result
  ('module_result',            'result_code',                 'result-code',                         NULL),
  -- Reasonable Adjustment
  ('reasonable_adjustment',    'adjustment_type_code',        'adjustment-type-code',                NULL),
  ('reasonable_adjustment',    'scope_code',                  'adjustment-scope-code',               NULL),
  -- Adjustment Distribution
  ('adjustment_distribution',  'status_code',                 'distribution-status-code',            NULL),
  -- Exceptional Circumstances (outcome_code is institution-defined; no platform value set)
  -- Misconduct Outcome
  ('misconduct_outcome',       'penalty_code',                'penalty-code',                        NULL),
  -- Exam Board
  ('exam_board',               'board_type_code',             'board-type-code',                     NULL),
  -- Progression Decision
  ('progression_decision',     'decision_code',               'decision-code',                       NULL),
  -- Award (qualification_code and classification_code are institution-defined; no platform value set)
  -- Post-Ratification Case
  ('post_ratification_case',   'case_type_code',              'case-type-code',                      NULL),
  ('post_ratification_case',   'status_code',                 'post-ratification-case-status-code',  NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0006_phase6_regulatory_schema.sql
-- ============================================================

-- Revelation SRS — Phase 6 Regulatory Compliance Schema
-- Migration: 0006_phase6_regulatory_schema
-- Applied by: packages/db/src/migrate.ts
--
-- Creates regulatory exchange, statutory return, FOI, regulatory profile, and
-- exam entry foundation tables. Tenant-owned tables have RLS. Bitemporal tables
-- get standard temporal checks and current-version indexes.

-- Phase 6 drains the Phase 4 downstream trigger queue. Extend the existing
-- terminal statuses so services can mark a trigger processed after writing the
-- integration exchange ledger row.
ALTER TABLE "enrolment_downstream_trigger"
  DROP CONSTRAINT IF EXISTS "enrolment_downstream_trigger_status_code_check";
ALTER TABLE "enrolment_downstream_trigger"
  ADD CONSTRAINT "enrolment_downstream_trigger_status_code_check"
    CHECK ("status_code" IN ('pending','sent','processed','acknowledged','failed','cancelled'));

-- ── UCAS Application (Bitemporal) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ucas_application" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "ucas_personal_id"    text        NOT NULL,
  "cycle"               text        NOT NULL,
  "status_code"         text        NOT NULL,
  "linked_enrolment_id" uuid,
  "raw_payload"         jsonb       NOT NULL DEFAULT '{}',
  "received_at"         timestamptz NOT NULL DEFAULT now(),
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "ucas_application_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "ucas_application_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ucas_application_unique_logical_transaction"
  ON "ucas_application" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ucas_application_current_version_unique"
  ON "ucas_application" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ucas_application_applicant_cycle_current_unique"
  ON "ucas_application" ("tenant_id", "ucas_personal_id", "cycle")
  WHERE recorded_until IS NULL;

ALTER TABLE "ucas_application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ucas_application" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ucas_application";
CREATE POLICY tenant_isolation ON "ucas_application"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── HESA Student Return ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hesa_student_return" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_year"        text        NOT NULL,
  "status_code"          text        NOT NULL DEFAULT 'draft',
  "submitted_at"         timestamptz,
  "validated_at"         timestamptz,
  "submission_reference" text,
  "amendment_of_id"      uuid        REFERENCES "hesa_student_return"("id"),
  "generated_by"         text        NOT NULL,
  "generated_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hesa_student_return_year_idx"
  ON "hesa_student_return" ("tenant_id", "academic_year");

ALTER TABLE "hesa_student_return" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_student_return" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_student_return";
CREATE POLICY tenant_isolation ON "hesa_student_return"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "hesa_student_return_record" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id" uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "enrolment_id"           uuid        NOT NULL,
  "hesa_id"                text,
  "record_payload"         jsonb       NOT NULL DEFAULT '{}',
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hesa_student_return_record_return_idx"
  ON "hesa_student_return_record" ("hesa_student_return_id");

ALTER TABLE "hesa_student_return_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_student_return_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_student_return_record";
CREATE POLICY tenant_isolation ON "hesa_student_return_record"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_student_return_record"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_submission" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id" uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "integration_exchange_id" uuid       NOT NULL REFERENCES "integration_exchange"("id"),
  "payload_hash"           text        NOT NULL,
  "payload_summary"        jsonb       NOT NULL DEFAULT '{}',
  "generated_at"           timestamptz NOT NULL DEFAULT now(),
  "generated_by"           text        NOT NULL,
  "submitted_at"           timestamptz,
  "submission_reference"   text
);

ALTER TABLE "hesa_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_submission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_submission";
CREATE POLICY tenant_isolation ON "hesa_submission"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_submission"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_validation_report" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id" uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "integration_exchange_id" uuid       REFERENCES "integration_exchange"("id"),
  "received_at"            timestamptz NOT NULL DEFAULT now(),
  "received_by"            text        NOT NULL,
  "raw_payload"            jsonb       NOT NULL DEFAULT '{}',
  "blocking_error_count"   integer     NOT NULL DEFAULT 0,
  "warning_count"          integer     NOT NULL DEFAULT 0
);

ALTER TABLE "hesa_validation_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_validation_report" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_validation_report";
CREATE POLICY tenant_isolation ON "hesa_validation_report"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_validation_report"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_validation_issue" (
  "id"                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_validation_report_id"     uuid        NOT NULL REFERENCES "hesa_validation_report"("id"),
  "hesa_student_return_record_id" uuid        REFERENCES "hesa_student_return_record"("id"),
  "enrolment_id"                  uuid,
  "field_code"                    text        NOT NULL,
  "severity_code"                 text        NOT NULL,
  "message"                       text        NOT NULL,
  "external_reference"            text,
  "created_at"                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "hesa_validation_issue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_validation_issue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_validation_issue";
CREATE POLICY tenant_isolation ON "hesa_validation_issue"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_validation_report" hvr
      JOIN "hesa_student_return" hsr ON hsr."id" = hvr."hesa_student_return_id"
      WHERE hvr."id" = "hesa_validation_issue"."hesa_validation_report_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

CREATE TABLE IF NOT EXISTS "hesa_identifier_assignment" (
  "id"                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "hesa_student_return_id"        uuid        NOT NULL REFERENCES "hesa_student_return"("id"),
  "hesa_student_return_record_id" uuid        NOT NULL REFERENCES "hesa_student_return_record"("id"),
  "person_id"                     uuid        NOT NULL REFERENCES "person"("id"),
  "enrolment_id"                  uuid        NOT NULL,
  "hesa_id"                       text        NOT NULL,
  "assigned_at"                   timestamptz NOT NULL DEFAULT now(),
  "assigned_by"                   text        NOT NULL
);

ALTER TABLE "hesa_identifier_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hesa_identifier_assignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hesa_identifier_assignment";
CREATE POLICY tenant_isolation ON "hesa_identifier_assignment"
  USING (
    EXISTS (
      SELECT 1
      FROM "hesa_student_return" hsr
      WHERE hsr."id" = "hesa_identifier_assignment"."hesa_student_return_id"
        AND hsr."tenant_id" = current_setting('app.current_tenant_id', true)::uuid
    )
  );

-- ── SLC ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "slc_notification" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"           uuid        NOT NULL,
  "notification_type_code" text        NOT NULL,
  "effective_date"         date        NOT NULL,
  "amount"                 numeric(12,2),
  "raw_payload"            jsonb       NOT NULL DEFAULT '{}',
  "received_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "slc_notification_enrolment_idx"
  ON "slc_notification" ("tenant_id", "enrolment_id");

ALTER TABLE "slc_notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slc_notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "slc_notification";
CREATE POLICY tenant_isolation ON "slc_notification"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── UKVI ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ukvi_cas_request" (
  "version_id"     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"             uuid        NOT NULL,
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"   uuid        NOT NULL,
  "cas_reference"  text,
  "status_code"    text        NOT NULL,
  "requested_at"   timestamptz NOT NULL DEFAULT now(),
  "valid_from"     timestamptz NOT NULL,
  "valid_to"       timestamptz,
  "recorded_at"    timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "ukvi_cas_request_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "ukvi_cas_request_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_cas_request_unique_logical_transaction"
  ON "ukvi_cas_request" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_cas_request_current_version_unique"
  ON "ukvi_cas_request" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "ukvi_cas_request_enrolment_idx"
  ON "ukvi_cas_request" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "ukvi_cas_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_cas_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_cas_request";
CREATE POLICY tenant_isolation ON "ukvi_cas_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "ukvi_attendance_report" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "submitted_at"       timestamptz NOT NULL DEFAULT now(),
  "report_payload"     jsonb       NOT NULL DEFAULT '{}',
  "submitted_by"       text        NOT NULL
);

ALTER TABLE "ukvi_attendance_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_attendance_report" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_attendance_report";
CREATE POLICY tenant_isolation ON "ukvi_attendance_report"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "ukvi_visa_status" (
  "version_id"     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"             uuid        NOT NULL,
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"   uuid        NOT NULL,
  "cas_reference"  text        NOT NULL,
  "status_code"    text        NOT NULL,
  "effective_date" date        NOT NULL,
  "raw_payload"    jsonb       NOT NULL DEFAULT '{}',
  "valid_from"     timestamptz NOT NULL,
  "valid_to"       timestamptz,
  "recorded_at"    timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "ukvi_visa_status_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "ukvi_visa_status_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_visa_status_unique_logical_transaction"
  ON "ukvi_visa_status" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_visa_status_current_version_unique"
  ON "ukvi_visa_status" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

ALTER TABLE "ukvi_visa_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_visa_status" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_visa_status";
CREATE POLICY tenant_isolation ON "ukvi_visa_status"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "ukvi_compliance_alert" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"    uuid        NOT NULL,
  "cas_reference"   text,
  "alert_type_code" text        NOT NULL,
  "triggered_at"    timestamptz NOT NULL DEFAULT now(),
  "resolved_at"     timestamptz,
  "resolved_by"     text
);

ALTER TABLE "ukvi_compliance_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_compliance_alert" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ukvi_compliance_alert";
CREATE POLICY tenant_isolation ON "ukvi_compliance_alert"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── OfS and FOI ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ofs_extract" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant"("id"),
  "extract_type_code" text        NOT NULL,
  "academic_year"     text        NOT NULL,
  "generated_at"      timestamptz NOT NULL DEFAULT now(),
  "generated_by"      text        NOT NULL,
  "record_count"      integer     NOT NULL DEFAULT 0,
  "extract_payload"   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "status_code"       text        NOT NULL DEFAULT 'generated'
);

ALTER TABLE "ofs_extract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ofs_extract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ofs_extract";
CREATE POLICY tenant_isolation ON "ofs_extract"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "foi_request" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "request_reference"       text        NOT NULL,
  "received_date"           date        NOT NULL,
  "statutory_deadline_date" date        NOT NULL,
  "description"             text        NOT NULL,
  "status_code"             text        NOT NULL,
  "legal_basis"             text,
  "closed_at"               timestamptz,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "foi_request_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "foi_request_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "foi_request_unique_logical_transaction"
  ON "foi_request" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "foi_request_current_version_unique"
  ON "foi_request" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "foi_request_reference_current_unique"
  ON "foi_request" ("tenant_id", "request_reference")
  WHERE recorded_until IS NULL;

ALTER TABLE "foi_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foi_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "foi_request";
CREATE POLICY tenant_isolation ON "foi_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "foi_extract" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "foi_request_id" uuid        NOT NULL,
  "generated_at"   timestamptz NOT NULL DEFAULT now(),
  "generated_by"   text        NOT NULL,
  "query_summary"  text        NOT NULL,
  "record_count"   integer     NOT NULL DEFAULT 0,
  "extract_payload" jsonb      NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE "foi_extract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "foi_extract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "foi_extract";
CREATE POLICY tenant_isolation ON "foi_extract"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Student Regulatory Profile (Bitemporal) ────────────────────────────────
CREATE TABLE IF NOT EXISTS "student_regulatory_profile" (
  "version_id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                        uuid        NOT NULL,
  "tenant_id"                 uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"                 uuid        NOT NULL REFERENCES "person"("id"),
  "enrolment_id"              uuid,
  "ukvi_sponsorship_required" boolean     NOT NULL DEFAULT false,
  "polar4_quintile"           integer     CHECK ("polar4_quintile" IS NULL OR "polar4_quintile" BETWEEN 1 AND 5),
  "imd_decile"                integer     CHECK ("imd_decile" IS NULL OR "imd_decile" BETWEEN 1 AND 10),
  "care_experienced"          boolean,
  "source_system"             text        NOT NULL,
  "actor_id"                  text        NOT NULL,
  "valid_from"                timestamptz NOT NULL,
  "valid_to"                  timestamptz,
  "recorded_at"               timestamptz NOT NULL DEFAULT now(),
  "recorded_until"            timestamptz,
  CONSTRAINT "student_regulatory_profile_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "student_regulatory_profile_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "student_regulatory_profile_unique_logical_transaction"
  ON "student_regulatory_profile" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "student_regulatory_profile_current_version_unique"
  ON "student_regulatory_profile" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE INDEX IF NOT EXISTS "student_regulatory_profile_person_idx"
  ON "student_regulatory_profile" ("tenant_id", "person_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "student_regulatory_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_regulatory_profile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_regulatory_profile";
CREATE POLICY tenant_isolation ON "student_regulatory_profile"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Exam Entry and Timetable Receipt ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exam_entry" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id" uuid        NOT NULL,
  "exam_board_id"          uuid        NOT NULL REFERENCES "exam_board"("id"),
  "candidate_number"       text,
  "scheduled_date"         date,
  "room_reference"         text,
  "status_code"            text        NOT NULL,
  "accommodations"         jsonb       NOT NULL DEFAULT '{}',
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "exam_entry_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "exam_entry_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "exam_entry_unique_logical_transaction"
  ON "exam_entry" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "exam_entry_current_version_unique"
  ON "exam_entry" ("tenant_id", "id")
  WHERE recorded_until IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exam_entry_registration_board_current_unique"
  ON "exam_entry" ("tenant_id", "module_registration_id", "exam_board_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "exam_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_entry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_entry";
CREATE POLICY tenant_isolation ON "exam_entry"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "exam_timetable_receipt" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid        NOT NULL REFERENCES "exam_board"("id"),
  "received_at"   timestamptz NOT NULL DEFAULT now(),
  "received_by"   text        NOT NULL,
  "payload"       jsonb       NOT NULL DEFAULT '{}'
);

ALTER TABLE "exam_timetable_receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_timetable_receipt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "exam_timetable_receipt";
CREATE POLICY tenant_isolation ON "exam_timetable_receipt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Regulatory Integration Contracts ────────────────────────────────────────
INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('ucas-admissions-exchange.{cycle}', 'UCAS Admissions Exchange', 'regulatory', 'bidirectional', 'file-and-api', '1.0.0', 'personal'),
  ('hesa-student-return.{year}',       'HESA Student Return',      'regulatory', 'bidirectional', 'file',         '1.0.0', 'regulatory'),
  ('slc-enrolment-exchange.v1',        'SLC Enrolment Exchange',   'regulatory', 'bidirectional', 'file-and-api', '1.0.0', 'sensitive'),
  ('ukvi-sponsor-compliance.v1',       'UKVI Sponsor Compliance',  'regulatory', 'bidirectional', 'api-and-file', '1.0.0', 'sensitive'),
  ('exam-scheduling.v1',               'Exam Scheduling Exchange', 'governance', 'bidirectional', 'api-and-file', '1.0.0', 'standard')
ON CONFLICT ("contract_id") DO NOTHING;


-- ============================================================
-- Originally: 0007_seed_phase6_field_mappings.sql
-- ============================================================

-- Revelation SRS — Phase 6 Value Sets and Field Mappings
-- Migration: 0007_seed_phase6_field_mappings
--
-- Adds new value sets and field mappings for regulatory compliance,
-- statutory reporting, FOI, UKVI, SLC, UCAS, and exam scheduling exchange.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('ucas-application-status-code', 'UCAS Application Status',       'srs-internal', NULL, 'Lifecycle status for staged UCAS applications',                false),
  ('hesa-return-status-code',      'HESA Return Status',            'srs-internal', NULL, 'Lifecycle status for HESA student returns',                    false),
  ('hesa-validation-severity-code','HESA Validation Severity',      'srs-internal', NULL, 'Severity for HESA validation report issues',                  false),
  ('slc-notification-type-code',   'SLC Notification Type',         'srs-internal', NULL, 'Inbound Student Loans Company notification types',             false),
  ('cas-status-code',              'UKVI CAS Status',               'srs-internal', NULL, 'Lifecycle status for UKVI CAS requests',                       false),
  ('ukvi-visa-status-code',        'UKVI Visa Status',              'srs-internal', NULL, 'Inbound UKVI visa status outcomes',                            false),
  ('ukvi-alert-type-code',         'UKVI Compliance Alert Type',    'srs-internal', NULL, 'Compliance alert categories for sponsored students',           false),
  ('ofs-extract-type-code',        'OfS Extract Type',              'srs-internal', NULL, 'OfS and regulatory extract categories',                        false),
  ('regulatory-report-status-code','Regulatory Report Status',      'srs-internal', NULL, 'Lifecycle status for generated regulatory report artefacts',   false),
  ('foi-request-status-code',      'FOI Request Status',            'srs-internal', NULL, 'Freedom of Information request workflow status',               false),
  ('exam-entry-status-code',       'Exam Entry Status',             'srs-internal', NULL, 'Exam scheduling entry lifecycle status',                       false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('received',       'Received',       10),
  ('offer-made',     'Offer Made',     20),
  ('offer-accepted', 'Offer Accepted', 30),
  ('confirmed',      'Confirmed',      40),
  ('deferred',       'Deferred',       50),
  ('withdrawn',      'Withdrawn',      60),
  ('not-registered', 'Not Registered', 70),
  ('clearing',       'Clearing',       80)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ucas-application-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('draft',                      'Draft',                      10),
  ('validated',                  'Validated',                  20),
  ('submitted',                  'Submitted',                  30),
  ('validation-report-received', 'Validation Report Received', 40),
  ('amendment-required',         'Amendment Required',         50),
  ('final',                      'Final',                      60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-return-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('error',   'Error',   10),
  ('warning', 'Warning', 20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-validation-severity-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('entitlement-confirmed', 'Entitlement Confirmed', 10),
  ('payment-received',      'Payment Received',      20),
  ('overpayment-notified',  'Overpayment Notified',  30),
  ('recovery-initiated',    'Recovery Initiated',    40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'slc-notification-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pending',   'Pending',   10),
  ('assigned',  'Assigned',  20),
  ('used',      'Used',      30),
  ('withdrawn', 'Withdrawn', 40),
  ('expired',   'Expired',   50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'cas-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('granted',        'Granted',        10),
  ('refused',        'Refused',        20),
  ('curtailed',      'Curtailed',      30),
  ('expired',        'Expired',        40),
  ('lapse-of-leave', 'Lapse of Leave', 50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ukvi-visa-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('attendance-threshold-breach', 'Attendance Threshold Breach', 10),
  ('visa-curtailed',              'Visa Curtailed',              20),
  ('sponsor-compliance-breach',   'Sponsor Compliance Breach',   30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ukvi-alert-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('b3-student-outcomes',          'B3 Student Outcomes',          10),
  ('access-participation-progress','Access Participation Progress',20),
  ('prevent-duty',                 'Prevent Duty',                 30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ofs-extract-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('draft',     'Draft',     10),
  ('generated', 'Generated', 20),
  ('submitted', 'Submitted', 30),
  ('accepted',  'Accepted',  40),
  ('rejected',  'Rejected',  50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'regulatory-report-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('received',    'Received',    10),
  ('in-progress', 'In Progress', 20),
  ('extended',    'Extended',    30),
  ('responded',   'Responded',   40),
  ('refused',     'Refused',     50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'foi-request-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pending',                 'Pending',                 10),
  ('submitted-to-scheduling', 'Submitted to Scheduling', 20),
  ('scheduled',               'Scheduled',               30),
  ('cancelled',               'Cancelled',               40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'exam-entry-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('ucas_application',        'status_code',             'ucas-application-status-code', NULL),
  ('hesa_student_return',     'status_code',             'hesa-return-status-code',      NULL),
  ('hesa_validation_issue',   'severity_code',           'hesa-validation-severity-code',NULL),
  ('slc_notification',        'notification_type_code',  'slc-notification-type-code',   NULL),
  ('ukvi_cas_request',        'status_code',             'cas-status-code',              NULL),
  ('ukvi_visa_status',        'status_code',             'ukvi-visa-status-code',        NULL),
  ('ukvi_compliance_alert',   'alert_type_code',         'ukvi-alert-type-code',         NULL),
  ('ofs_extract',             'extract_type_code',       'ofs-extract-type-code',        NULL),
  ('ofs_extract',             'status_code',             'regulatory-report-status-code',NULL),
  ('foi_request',             'status_code',             'foi-request-status-code',      NULL),
  ('exam_entry',              'status_code',             'exam-entry-status-code',       NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0008_phase6_remediation.sql
-- ============================================================

-- Revelation SRS — Phase 6 Remediation
-- Migration: 0008_phase6_remediation
--
-- 1. Add source_code discriminator to hesa_validation_report so internal pre-submission
--    validation runs are distinguished from official HESA authority reports.
-- 2. Add unique partial index on ukvi_compliance_alert to prevent duplicate open alerts
--    under concurrent evaluateComplianceAlerts calls.
-- 3. Add amendment_diff JSONB column to hesa_student_return_record to support HES-005
--    delta tracking when an amendment return is generated.

-- ── 1. hesa_validation_report.source_code ───────────────────────────────────

ALTER TABLE "hesa_validation_report"
  ADD COLUMN IF NOT EXISTS "source_code" text NOT NULL DEFAULT 'internal';

COMMENT ON COLUMN "hesa_validation_report"."source_code" IS
  'Discriminator: ''internal'' for pre-submission validation runs; ''hesa-authority'' for official HESA validation reports.';

-- Back-fill: rows with a non-null integration_exchange_id are authority reports.
UPDATE "hesa_validation_report"
  SET "source_code" = 'hesa-authority'
  WHERE "integration_exchange_id" IS NOT NULL;

-- ── 2. ukvi_compliance_alert unique partial index ────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "ukvi_compliance_alert_open_unique"
  ON "ukvi_compliance_alert" ("tenant_id", "enrolment_id", "alert_type_code")
  WHERE "resolved_at" IS NULL;

-- ── 3. hesa_student_return_record.amendment_diff ────────────────────────────

ALTER TABLE "hesa_student_return_record"
  ADD COLUMN IF NOT EXISTS "amendment_diff" jsonb;

COMMENT ON COLUMN "hesa_student_return_record"."amendment_diff" IS
  'Null on original returns. On amendment returns, contains a field-level diff against the corresponding record in the original return (amendmentOfId). Keyed by HESA field code; each value is {previous, current}.';


-- ============================================================
-- Originally: 0009_platform_workflow_feature_flags.sql
-- ============================================================

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

-- uat/preprod/prod are seeded inactive: a fresh install has not been promoted
-- to any of these environments yet. An operator activates the corresponding
-- row via the environment/promotion admin tooling as part of that real
-- deployment — only then does demo-data's production-like safety gate
-- (packages/demo-data/src/safety.ts assertResetAllowed Gate 5) correctly block it.
INSERT INTO "deployment_environment" (
  "environment_code",
  "display_name",
  "environment_type_code",
  "production_like",
  "live_integrations_allowed",
  "active"
) VALUES
  ('local', 'Local Development', 'local', false, false, true),
  ('test', 'Test', 'test', false, false, true),
  ('uat', 'User Acceptance Testing', 'uat', true, false, false),
  ('preprod', 'Pre-production', 'pre-production', true, false, false),
  ('prod', 'Production', 'production', true, true, false)
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


-- ============================================================
-- Originally: 0010_relax_extensible_code_checks.sql
-- ============================================================

-- Revelation SRS — Relax Extensible Business Code Checks
-- Migration: 0010_relax_extensible_code_checks
--
-- Stage 8 of the platform alignment plan moves institution/process variation to
-- value sets, workflow definitions, trigger rules, and feature flags. Database
-- constraints remain for temporal, ownership, uniqueness, range, and structural
-- invariants, but tenant-extensible business code lists are validated in
-- services through field_value_set mappings.

-- Phase 4 extensible code fields
ALTER TABLE "person" DROP CONSTRAINT IF EXISTS "person_person_status_code_check";
ALTER TABLE "student_address" DROP CONSTRAINT IF EXISTS "student_address_address_type_code_check";
ALTER TABLE "disability_declaration" DROP CONSTRAINT IF EXISTS "disability_declaration_declaration_status_code_check";
ALTER TABLE "identity_verification_check" DROP CONSTRAINT IF EXISTS "identity_verification_check_status_code_check";
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_status_code_check";
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_mode_of_study_code_check";
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_funding_source_code_check";
ALTER TABLE "fee_liability" DROP CONSTRAINT IF EXISTS "fee_liability_status_code_check";
ALTER TABLE "enrolment_downstream_trigger" DROP CONSTRAINT IF EXISTS "enrolment_downstream_trigger_trigger_type_code_check";
ALTER TABLE "enrolment_downstream_trigger" DROP CONSTRAINT IF EXISTS "enrolment_downstream_trigger_status_code_check";
ALTER TABLE "reenrolment_confirmation" DROP CONSTRAINT IF EXISTS "reenrolment_confirmation_status_code_check";
ALTER TABLE "module_relationship" DROP CONSTRAINT IF EXISTS "module_relationship_relationship_type_code_check";
ALTER TABLE "academic_period" DROP CONSTRAINT IF EXISTS "academic_period_period_type_code_check";
ALTER TABLE "module_registration" DROP CONSTRAINT IF EXISTS "module_registration_status_code_check";

-- Phase 5 extensible code fields
ALTER TABLE "module_result" DROP CONSTRAINT IF EXISTS "module_result_result_code_check";
ALTER TABLE "adjustment_distribution" DROP CONSTRAINT IF EXISTS "adjustment_distribution_status_code_check";
ALTER TABLE "misconduct_penalty_effect" DROP CONSTRAINT IF EXISTS "misconduct_penalty_effect_penalty_code_check";
ALTER TABLE "exam_board" DROP CONSTRAINT IF EXISTS "exam_board_board_type_code_check";
ALTER TABLE "progression_decision" DROP CONSTRAINT IF EXISTS "progression_decision_decision_code_check";
ALTER TABLE "post_ratification_case" DROP CONSTRAINT IF EXISTS "post_ratification_case_case_type_code_check";
ALTER TABLE "post_ratification_case" DROP CONSTRAINT IF EXISTS "post_ratification_case_status_code_check";
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_entity_type_check";

-- Preserve non-code CHECK constraints such as temporal validity, percentages,
-- mutually-exclusive references, date ordering, and statutory numeric ranges.


-- Originally 0001_platform_hardening_and_refinements.sql

-- ============================================================
-- Originally: 0011_environment_promotion_hardening.sql
-- ============================================================

-- Revelation SRS — Environment Promotion Hardening
-- Migration: 0011_environment_promotion_hardening
--
-- Stage 9 makes environment identity and integration endpoint safety explicit.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('integration-endpoint-safety-class', 'Integration endpoint safety class', 'srs-internal', '2026-06-14', 'Safety classification for configured integration endpoints.', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('integration-endpoint-safety-class', 'simulator', 'Simulator', 10),
  ('integration-endpoint-safety-class', 'external-test', 'External test endpoint', 20),
  ('integration-endpoint-safety-class', 'external-production', 'External production endpoint', 30)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

UPDATE "deployment_environment"
SET "configuration" = "configuration" || jsonb_build_object(
  'defaultEndpointSafetyClass',
  CASE
    WHEN "environment_code" = 'prod' THEN 'external-production'
    WHEN "environment_code" IN ('uat', 'preprod') THEN 'external-test'
    ELSE 'simulator'
  END,
  'requiresLiveTrafficApproval',
  CASE
    WHEN "environment_code" = 'prod' THEN false
    ELSE true
  END
),
"updated_at" = now()
WHERE "environment_code" IN ('local', 'test', 'uat', 'preprod', 'prod');

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('integration_registration.configuration', 'endpointSafetyClass', 'integration-endpoint-safety-class', 'Integration endpoint safety class stored in registration configuration JSON.')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0012_globalisation_foundation.sql
-- ============================================================

-- Revelation SRS — Globalisation Foundation
-- Migration: 0012_globalisation_foundation
--
-- Stage 1 of the Clean SRS Convergence: makes locale, time zone, and currency
-- first-class platform concerns rather than implicit GBP/en-GB assumptions.
--
-- New tables:
--   locale_resource_pack         - registry of available BCP-47 locale packs
--   tenant_locale_config         - per-tenant locale and time-zone settings
--   value_set_member_label       - translated display labels for value set members
--   currency                     - ISO 4217 currency registry
--   exchange_rate                - effective-dated, auditable exchange rates
--   tenant_currency_config       - per-tenant currency settings
--
-- Column additions:
--   person_identity.communication_locale_code
--   person_identity.preferred_time_zone
--   fee_liability.currency_code
--   fee_liability.amount_minor_units

-- ── Locale Resource Pack ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "locale_resource_pack" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "locale_code"         text        NOT NULL,
  "display_name"        text        NOT NULL,
  "native_display_name" text        NOT NULL,
  "is_rtl"              boolean     NOT NULL DEFAULT false,
  "is_platform_default" boolean     NOT NULL DEFAULT false,
  "active"              boolean     NOT NULL DEFAULT true,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "locale_resource_pack_code_unique" UNIQUE ("locale_code")
);

-- ── Tenant Locale Configuration ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_locale_config" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "default_locale"     text        NOT NULL DEFAULT 'en-GB',
  "fallback_locale"    text        NOT NULL DEFAULT 'en-GB',
  "supported_locales"  text[]      NOT NULL DEFAULT '{en-GB}',
  "default_time_zone"  text        NOT NULL DEFAULT 'Europe/London',
  "date_format_code"   text        NOT NULL DEFAULT 'iso',
  "first_day_of_week"  smallint    NOT NULL DEFAULT 1,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_locale_config_tenant_unique" UNIQUE ("tenant_id"),
  CONSTRAINT "tenant_locale_config_day_check" CHECK ("first_day_of_week" BETWEEN 1 AND 7)
);

ALTER TABLE "tenant_locale_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_locale_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_locale_config";
CREATE POLICY tenant_isolation ON "tenant_locale_config"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Translated Value Set Member Labels ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS "value_set_member_label" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "value_set_member_id" uuid        NOT NULL REFERENCES "value_set_member"("id"),
  "locale_code"         text        NOT NULL,
  "display_label"       text        NOT NULL,
  "description"         text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "value_set_member_label_unique" UNIQUE ("value_set_member_id", "locale_code")
);

CREATE INDEX IF NOT EXISTS "value_set_member_label_member_idx"
  ON "value_set_member_label" ("value_set_member_id");

-- ── Currency Registry ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "currency" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "currency_code" text       NOT NULL,
  "numeric_code"  text,
  "display_name"  text       NOT NULL,
  "symbol"        text,
  "minor_units"   smallint   NOT NULL DEFAULT 2,
  "active"        boolean    NOT NULL DEFAULT true,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "currency_code_unique" UNIQUE ("currency_code"),
  CONSTRAINT "currency_minor_units_check" CHECK ("minor_units" >= 0 AND "minor_units" <= 4)
);

-- ── Exchange Rates ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "exchange_rate" (
  "id"                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_currency_code" text           NOT NULL REFERENCES "currency"("currency_code"),
  "to_currency_code"   text           NOT NULL REFERENCES "currency"("currency_code"),
  "rate"               numeric(20,10) NOT NULL,
  "effective_date"     date           NOT NULL,
  "source"             text           NOT NULL,
  "source_reference"   text,
  "recorded_at"        timestamptz    NOT NULL DEFAULT now(),
  "recorded_by"        text           NOT NULL DEFAULT 'system',
  CONSTRAINT "exchange_rate_different_currencies"
    CHECK ("from_currency_code" <> "to_currency_code"),
  CONSTRAINT "exchange_rate_positive_rate"
    CHECK ("rate" > 0),
  CONSTRAINT "exchange_rate_unique"
    UNIQUE ("from_currency_code", "to_currency_code", "effective_date")
);

CREATE INDEX IF NOT EXISTS "exchange_rate_lookup_idx"
  ON "exchange_rate" ("from_currency_code", "to_currency_code", "effective_date" DESC);

-- ── Tenant Currency Configuration ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_currency_config" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant"("id"),
  "default_currency_code"        text        NOT NULL DEFAULT 'GBP' REFERENCES "currency"("currency_code"),
  "accepted_currencies"          text[]      NOT NULL DEFAULT '{GBP}',
  "requires_conversion_evidence" boolean     NOT NULL DEFAULT false,
  "created_at"                   timestamptz NOT NULL DEFAULT now(),
  "updated_at"                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_currency_config_tenant_unique" UNIQUE ("tenant_id")
);

ALTER TABLE "tenant_currency_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_currency_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_currency_config";
CREATE POLICY tenant_isolation ON "tenant_currency_config"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── Person Identity: locale and time-zone preferences ───────────────────────

ALTER TABLE "person_identity"
  ADD COLUMN IF NOT EXISTS "communication_locale_code" text,
  ADD COLUMN IF NOT EXISTS "preferred_time_zone"       text;

-- ── Fee Liability: currency-aware monetary amount ────────────────────────────
-- amount_pence (legacy, GBP-implicit) is retained for backward compatibility.
-- amount_minor_units (new) stores the amount in the minor units of currency_code.
-- Stage 7 removes amount_pence once all fee records are migrated.

ALTER TABLE "fee_liability"
  ADD COLUMN IF NOT EXISTS "currency_code"      text DEFAULT 'GBP' REFERENCES "currency"("currency_code"),
  ADD COLUMN IF NOT EXISTS "amount_minor_units" bigint;

-- Back-fill currency_code and amount_minor_units for existing rows.
-- GBP minor units = pence, so amount_minor_units = amount_pence for existing rows.
UPDATE "fee_liability"
SET
  "currency_code"      = 'GBP',
  "amount_minor_units" = "amount_pence"
WHERE "currency_code" IS NULL OR "amount_minor_units" IS NULL;

-- Make currency_code NOT NULL now that all rows have a value.
ALTER TABLE "fee_liability"
  ALTER COLUMN "currency_code" SET NOT NULL;

-- ── Value Sets for locale and time-zone codes ────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible")
VALUES
  ('communication-locale-code', 'Communication Locale', 'srs-internal',
   'BCP-47 locale codes used for student/applicant communication preferences', false),
  ('time-zone-code', 'Time Zone', 'srs-internal',
   'IANA time zone identifiers supported by the platform', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('person_identity', 'communication_locale_code', 'communication-locale-code',
   'BCP-47 locale preference for student-facing communications'),
  ('person_identity', 'preferred_time_zone', 'time-zone-code',
   'IANA time zone preference for deadline and calendar display')
ON CONFLICT DO NOTHING;

-- ── Locale Resource Pack Seed Data ──────────────────────────────────────────

INSERT INTO "locale_resource_pack"
  ("locale_code", "display_name", "native_display_name", "is_rtl", "is_platform_default", "active")
VALUES
  ('en-GB', 'English (United Kingdom)', 'English (United Kingdom)', false, true,  true),
  ('en-US', 'English (United States)',  'English (United States)',  false, false, true),
  ('cy-GB', 'Welsh (United Kingdom)',   'Cymraeg (Y Deyrnas Unedig)', false, false, true),
  ('fr-FR', 'French (France)',          'Français (France)',         false, false, true),
  ('de-DE', 'German (Germany)',         'Deutsch (Deutschland)',     false, false, true),
  ('es-ES', 'Spanish (Spain)',          'Español (España)',          false, false, true),
  ('ar-SA', 'Arabic (Saudi Arabia)',    'العربية (المملكة العربية السعودية)', true, false, true),
  ('zh-CN', 'Chinese (Simplified)',     '中文（简体）',              false, false, true),
  ('hi-IN', 'Hindi (India)',            'हिन्दी (भारत)',             false, false, true),
  ('pt-BR', 'Portuguese (Brazil)',      'Português (Brasil)',        false, false, true)
ON CONFLICT ("locale_code") DO NOTHING;

-- Seed communication-locale-code value set members
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('communication-locale-code', 'en-GB', 'English (United Kingdom)', 10),
  ('communication-locale-code', 'en-US', 'English (United States)',  20),
  ('communication-locale-code', 'cy-GB', 'Welsh (United Kingdom)',   30),
  ('communication-locale-code', 'fr-FR', 'French (France)',          40),
  ('communication-locale-code', 'de-DE', 'German (Germany)',         50),
  ('communication-locale-code', 'es-ES', 'Spanish (Spain)',          60),
  ('communication-locale-code', 'ar-SA', 'Arabic (Saudi Arabia)',    70),
  ('communication-locale-code', 'zh-CN', 'Chinese (Simplified)',     80),
  ('communication-locale-code', 'hi-IN', 'Hindi (India)',            90),
  ('communication-locale-code', 'pt-BR', 'Portuguese (Brazil)',      100)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

-- Seed time-zone-code value set members
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('time-zone-code', 'Europe/London',    'London (GMT/BST)',             10),
  ('time-zone-code', 'Europe/Dublin',    'Dublin (GMT/IST)',             20),
  ('time-zone-code', 'Europe/Paris',     'Paris (CET/CEST)',             30),
  ('time-zone-code', 'Europe/Berlin',    'Berlin (CET/CEST)',            40),
  ('time-zone-code', 'Europe/Madrid',    'Madrid (CET/CEST)',            50),
  ('time-zone-code', 'America/New_York', 'New York (ET)',                60),
  ('time-zone-code', 'America/Chicago',  'Chicago (CT)',                 70),
  ('time-zone-code', 'America/Denver',   'Denver (MT)',                  80),
  ('time-zone-code', 'America/Los_Angeles', 'Los Angeles (PT)',          90),
  ('time-zone-code', 'Asia/Dubai',       'Dubai (GST)',                  100),
  ('time-zone-code', 'Asia/Riyadh',      'Riyadh (AST)',                 110),
  ('time-zone-code', 'Asia/Kolkata',     'India (IST)',                  120),
  ('time-zone-code', 'Asia/Shanghai',    'China (CST)',                  130),
  ('time-zone-code', 'Asia/Singapore',   'Singapore (SGT)',              140),
  ('time-zone-code', 'Asia/Hong_Kong',   'Hong Kong (HKT)',              150),
  ('time-zone-code', 'Asia/Tokyo',       'Tokyo (JST)',                  160),
  ('time-zone-code', 'Australia/Sydney', 'Sydney (AEST/AEDT)',           170),
  ('time-zone-code', 'Pacific/Auckland', 'Auckland (NZST/NZDT)',         180),
  ('time-zone-code', 'Africa/Lagos',     'Lagos (WAT)',                  190),
  ('time-zone-code', 'UTC',              'UTC',                          200)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

-- ── ISO 4217 Currency Seed Data ──────────────────────────────────────────────

INSERT INTO "currency" ("currency_code", "numeric_code", "display_name", "symbol", "minor_units", "active")
VALUES
  ('GBP', '826', 'Pound Sterling',        '£',  2, true),
  ('USD', '840', 'US Dollar',             '$',  2, true),
  ('EUR', '978', 'Euro',                  '€',  2, true),
  ('AUD', '036', 'Australian Dollar',     'A$', 2, true),
  ('CAD', '124', 'Canadian Dollar',       'C$', 2, true),
  ('NZD', '554', 'New Zealand Dollar',    'NZ$',2, true),
  ('SGD', '702', 'Singapore Dollar',      'S$', 2, true),
  ('HKD', '344', 'Hong Kong Dollar',      'HK$',2, true),
  ('CNY', '156', 'Chinese Yuan Renminbi', '¥',  2, true),
  ('INR', '356', 'Indian Rupee',          '₹',  2, true),
  ('NGN', '566', 'Nigerian Naira',        '₦',  2, true),
  ('JPY', '392', 'Japanese Yen',          '¥',  0, true),
  ('AED', '784', 'UAE Dirham',            'د.إ',2, true),
  ('SAR', '682', 'Saudi Riyal',           'ر.س',2, true),
  ('CHF', '756', 'Swiss Franc',           'Fr', 2, true),
  ('DKK', '208', 'Danish Krone',          'kr', 2, true),
  ('NOK', '578', 'Norwegian Krone',       'kr', 2, true),
  ('SEK', '752', 'Swedish Krona',         'kr', 2, true),
  ('MYR', '458', 'Malaysian Ringgit',     'RM', 2, true),
  ('THB', '764', 'Thai Baht',             '฿',  2, true)
ON CONFLICT ("currency_code") DO NOTHING;


-- ============================================================
-- Originally: 0013_workflow_coverage_matrix.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0013 — Stage 2: Workflow Coverage Matrix
--
-- Adds workflow definitions, versions, steps, decision gateways, and assignment
-- rules for every process-bearing domain not already covered by migration 0009.
-- Also seeds feature flags that govern workflow variant selection per domain.
--
-- Domains covered here (admissions workflows already seeded in 0009):
--   enrolment-change-approval       module-registration-change
--   assessment-mark-review          progression-review
--   award-classification            exam-board-governance
--   correction-case                 appeal-case
--   regulatory-submission-approval  finance-fee-handoff
--   identity-provisioning           communication-dispatch
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Workflow Control Feature Flags ─────────────────────────────────

WITH coverage_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('enrolment.change-approval.required',
     'Enrolment change requires approval',
     'When on, enrolment status changes must be approved through the enrolment-change-approval workflow before taking effect.',
     'enrolment', 'active', 'boolean', 'off', 'system'),

    ('module-registration.approval.required',
     'Module registration change requires approval',
     'When on, add/drop/complete registration requests are routed through the module-registration-change approval workflow.',
     'module-registration', 'active', 'boolean', 'off', 'system'),

    ('assessment.moderation.workflow.enabled',
     'Assessment mark moderation uses workflow',
     'When on, marks ingested during a controlled period are routed through the assessment-mark-review workflow for moderation and review.',
     'assessment', 'active', 'boolean', 'off', 'system'),

    ('progression.board-review.enabled',
     'Progression review uses board workflow',
     'When on, discretionary progression decisions are routed through the progression-review board workflow.',
     'progression', 'active', 'boolean', 'off', 'system'),

    ('award.discretionary-review.enabled',
     'Award classification allows discretionary review',
     'When on, classification results in the borderline or exceptional range are routed through the award-classification discretionary review step.',
     'progression', 'active', 'boolean', 'off', 'system'),

    ('exam-board.external-examiner.required',
     'Exam board requires external examiner sign-off',
     'When on, the exam-board-governance workflow requires the external-examiner-review step before chair ratification.',
     'governance', 'active', 'boolean', 'on', 'system'),

    ('correction.panel-review.enabled',
     'Correction cases may require panel review',
     'When on, the correction-case workflow may route eligible cases to a review panel before outcome is decided.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('appeal.panel-hearing.enabled',
     'Appeals may require a panel hearing',
     'When on, the appeal-case workflow may route admissible appeals to a panel hearing before outcome is decided.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('regulatory.submission.manual-approval.required',
     'Regulatory submissions require manual approval',
     'When on, regulatory data submissions require an explicit approval step in the regulatory-submission-approval workflow before dispatch.',
     'regulatory', 'active', 'boolean', 'off', 'system'),

    ('finance.fee-handoff.enabled',
     'Finance fee handoff workflow enabled',
     'When on, fee liability events are routed through the finance-fee-handoff workflow for invoicing and external system notification.',
     'finance', 'active', 'boolean', 'off', 'system'),

    ('identity.deduplication.enabled',
     'Identity provisioning uses deduplication check',
     'When on, new person records are subject to a deduplication check and optional merge-review step in the identity-provisioning workflow.',
     'identity', 'active', 'boolean', 'off', 'system'),

    ('communications.locale-aware.enabled',
     'Communications use locale-aware dispatch',
     'When on, communication dispatch resolves locale and selects templates through the communication-dispatch workflow.',
     'communications', 'active', 'boolean', 'on', 'system')
  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"       = EXCLUDED."display_name",
    "description"        = EXCLUDED."description",
    "owner_module_code"  = EXCLUDED."owner_module_code",
    "status_code"        = EXCLUDED."status_code",
    "value_type_code"    = EXCLUDED."value_type_code",
    "default_variant_key"= EXCLUDED."default_variant_key",
    "updated_at"         = now()
  RETURNING "id"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM coverage_flags f
JOIN (VALUES
  ('off', 'Off', 'false', 10),
  ('on',  'On',  'true',  20)
) AS v("variant_key", "display_name", "value", "sort_order") ON true
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: Workflow Definitions ──────────────────────────────────────────

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('enrolment-change-approval',
   'Enrolment Change Approval',
   'enrolment', 'active', 1,
   'Registry or school-led approval for enrolment status changes such as withdrawal, intermission, and reinstatement.',
   'system'),

  ('module-registration-change',
   'Module Registration Change',
   'module-registration', 'active', 1,
   'Add/drop/complete workflow covering registration window checks, prerequisite checks, capacity, and optional approval.',
   'system'),

  ('assessment-mark-review',
   'Assessment Mark Review',
   'assessment', 'active', 1,
   'Structured review of marks ingested during a controlled period: moderation, late-penalty decisions, result review, and approval before board.',
   'system'),

  ('progression-review',
   'Progression Review',
   'progression', 'active', 1,
   'Algorithm-driven progression decision with optional board review and discretionary decision gateway for boundary and exceptional cases.',
   'system'),

  ('award-classification',
   'Award Classification',
   'progression', 'active', 1,
   'Classification calculation, optional discretionary review, award approval, and graduation trigger for eligible students.',
   'system'),

  ('exam-board-governance',
   'Exam Board Governance',
   'governance', 'active', 1,
   'Board constitution, data-pack preparation, external examiner review, chair ratification, and non-bypassable record lock.',
   'system'),

  ('correction-case',
   'Correction Case',
   'governance', 'active', 1,
   'Academic correction case: eligibility assessment, evidence gathering, optional panel review, outcome decision, and locked-record amendment.',
   'system'),

  ('appeal-case',
   'Academic Appeal Case',
   'governance', 'active', 1,
   'Academic appeal processing: grounds assessment, evidence gathering, optional panel hearing, outcome decision, and optional amendment.',
   'system'),

  ('regulatory-submission-approval',
   'Regulatory Submission Approval',
   'regulatory', 'active', 1,
   'Environment-safe regulatory data submission: validation, optional manual approval, dispatch, and response processing.',
   'system'),

  ('finance-fee-handoff',
   'Finance Fee Handoff',
   'finance', 'active', 1,
   'Fee liability event processing: fee calculation, invoice generation, payment confirmation, and optional external finance system notification.',
   'system'),

  ('identity-provisioning',
   'Identity Provisioning',
   'identity', 'active', 1,
   'New person identity creation with deduplication check and optional merge-review step before confirmation.',
   'system'),

  ('communication-dispatch',
   'Communication Dispatch',
   'communications', 'active', 1,
   'Locale-aware communication dispatch: template selection, locale resolution, channel selection, message dispatch, and optional delivery confirmation.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"            = EXCLUDED."display_name",
  "status_code"             = EXCLUDED."status_code",
  "current_version_number"  = EXCLUDED."current_version_number",
  "description"             = EXCLUDED."description",
  "updated_at"              = now();

-- ── Section 3: Workflow Definition Versions ───────────────────────────────────

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'startEvent',          v."start_event",
    'flagSnapshot',        v."flag_snapshot"::jsonb,
    'serviceInvariants',   v."service_invariants"::jsonb,
    'escalationPolicy',    v."escalation_policy"::jsonb,
    'terminalDataWrites',  v."terminal_data_writes"::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
JOIN (VALUES
  ('enrolment-change-approval',
   'enrolment.status-change-requested',
   '["enrolment.change-approval.required"]',
   '["EnrolmentService.transitionStatus: bitemporal write, valid status, record-lock check"]',
   '{"defaultDeadlineDays": 5, "escalateToRole": "registry-administrator"}',
   '["enrolment.status_code updated bitemporally, audit record written"]'),

  ('module-registration-change',
   'module-registration.add-drop-requested',
   '["module-registration.approval.required"]',
   '["RegistrationService: duplicate check, capacity guard, prerequisite check, credit limit, bitemporal write"]',
   '{"defaultDeadlineDays": 3, "escalateToRole": "registry-administrator"}',
   '["module_registration row updated bitemporally, downstream triggers evaluated"]'),

  ('assessment-mark-review',
   'mark.ingested-on-controlled-period',
   '["assessment.moderation.workflow.enabled"]',
   '["MarkService: record-lock guard, valid-mark range, bitemporal write", "ModuleResultService: recalculation deterministic"]',
   '{"defaultDeadlineDays": 10, "escalateToRole": "exam-board-chair"}',
   '["mark bitemporally confirmed, module_result updated, moderation decision audit written"]'),

  ('progression-review',
   'progression.criteria-met',
   '["progression.board-review.enabled"]',
   '["ProgressionService.decide: valid algorithm, credit/mark thresholds, bitemporal persistence"]',
   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}',
   '["progression_decision written, algorithm key and rule ids recorded, workflow decision audit"]'),

  ('award-classification',
   'award.eligible-signal',
   '["award.discretionary-review.enabled"]',
   '["AwardService: locked results required, valid classification, EnrolmentService.transitionStatus graduation"]',
   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}',
   '["award row created, classification and algorithm evidence recorded, enrolment transitioned to graduated"]'),

  ('exam-board-governance',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 21, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]'),

  ('correction-case',
   'correction.eligibility-event',
   '["correction.panel-review.enabled"]',
   '["CorrectionService: locked-record amendment authority, valid correction status transitions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "registry-administrator"}',
   '["correction_case status updated, locked-record amended if upheld, amendment audit written"]'),

  ('appeal-case',
   'appeal.submission-command',
   '["appeal.panel-hearing.enabled"]',
   '["CorrectionService: locked-record amendment authority, valid correction status transitions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "registry-administrator"}',
   '["appeal_case status updated, locked-record amended if upheld, amendment audit written"]'),

  ('regulatory-submission-approval',
   'regulatory.submission-prepared',
   '["regulatory.submission.manual-approval.required", "regulatory.environment-safety.active"]',
   '["RegulatoryExchangeService: endpoint safety class, environment live-traffic approval"]',
   '{"defaultDeadlineDays": 2, "escalateToRole": "regulatory-officer"}',
   '["regulatory_exchange record status updated, outbound exchange dispatched and logged"]'),

  ('finance-fee-handoff',
   'enrolment.fee-event',
   '["finance.fee-handoff.enabled", "finance.external-system-integration.enabled"]',
   '["EnrolmentService: valid fee liability, currency-aware monetary amount"]',
   '{"defaultDeadlineDays": 5, "escalateToRole": "finance-administrator"}',
   '["fee_liability status updated, invoice reference recorded, finance system notified"]'),

  ('identity-provisioning',
   'person.creation-command',
   '["identity.deduplication.enabled"]',
   '["PersonService: valid identity fields, unique person guard"]',
   '{"defaultDeadlineDays": 1, "escalateToRole": "registry-administrator"}',
   '["person_identity created or merged, deduplication evidence recorded"]'),

  ('communication-dispatch',
   'communication.dispatch-trigger',
   '["communications.locale-aware.enabled"]',
   '[]',
   '{"defaultDeadlineDays": 1, "escalateToRole": "registry-administrator"}',
   '["communication dispatch event published, delivery audit written"]')
) AS v(
  "definition_code", "start_event", "flag_snapshot",
  "service_invariants", "escalation_policy", "terminal_data_writes"
) ON wd."definition_code" = v."definition_code"
WHERE wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- ── Section 4: Workflow Steps ──────────────────────────────────────────────────

-- enrolment-change-approval steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('change-requested',   'start',         'Enrolment change requested',          NULL,                    10, '{}'),
  ('registrar-review',   'human-task',    'Registrar review',                    'registry-administrator', 20, '{"flagGuard": "enrolment.change-approval.required"}'),
  ('gateway-approval',   'decision',      'Change approval decision',            NULL,                    30, '{"gatewayKey": "G01"}'),
  ('enrolment-updated',  'integration',   'Enrolment status updated',            NULL,                    40, '{"targetService": "EnrolmentService.transitionStatus"}'),
  ('end',                'end',           'Enrolment change workflow complete',   NULL,                    50, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'enrolment-change-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- module-registration-change steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('registration-requested',        'start',       'Registration change requested',          NULL,                    10, '{}'),
  ('window-and-prerequisite-check', 'system-task', 'Window and prerequisite check',          NULL,                    20, '{"serviceCall": "RegistrationService.checkWindowAndPrerequisites"}'),
  ('approval-review',               'human-task',  'Registration approval review',           'registry-administrator', 30, '{"flagGuard": "module-registration.approval.required"}'),
  ('gateway-approval',              'decision',    'Registration approval decision',          NULL,                    40, '{"gatewayKey": "G01"}'),
  ('registration-updated',          'integration', 'Registration updated',                   NULL,                    50, '{"targetService": "RegistrationService.updateRegistration"}'),
  ('end',                           'end',         'Registration change workflow complete',   NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- assessment-mark-review steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('mark-ingested',      'start',       'Mark ingested on controlled period',  NULL,                    10, '{}'),
  ('moderation-review',  'human-task',  'Moderation review',                   'module-tutor',          20, '{"flagGuard": "assessment.moderation.workflow.enabled"}'),
  ('late-penalty-review','human-task',  'Late penalty review',                 'registry-administrator', 30, '{}'),
  ('result-review',      'human-task',  'Result review',                       'exam-board-chair',      40, '{}'),
  ('outcome-approved',   'system-task', 'Mark review outcome approved',        NULL,                    50, '{"serviceCall": "MarkService.confirmMark"}'),
  ('end',                'end',         'Mark review workflow complete',        NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'assessment-mark-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- progression-review steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('progression-data-gathered',  'start',       'Progression data gathered',           NULL,                10, '{}'),
  ('algorithm-applied',          'system-task', 'Progression algorithm applied',        NULL,                20, '{"serviceCall": "ProgressionService.decide"}'),
  ('gateway-complexity',         'decision',    'Complexity and discretion gateway',    NULL,                30, '{"gatewayKey": "G01"}'),
  ('board-review',               'human-task',  'Board review',                         'exam-board-chair',  40, '{"flagGuard": "progression.board-review.enabled"}'),
  ('outcome-decided',            'human-task',  'Progression outcome decided',          'exam-board-chair',  50, '{}'),
  ('outcome-notified',           'system-task', 'Progression outcome notified',         NULL,                60, '{"eventType": "srs.progression.outcome-decided"}'),
  ('end',                        'end',         'Progression review workflow complete',  NULL,               70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'progression-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- award-classification steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('results-verified',       'start',       'Award results verified',                 NULL,                10, '{}'),
  ('classification-calculated','system-task','Classification calculated',              NULL,                20, '{"serviceCall": "AwardService.calculateClassification"}'),
  ('gateway-discretionary',  'decision',    'Discretionary review gateway',           NULL,                30, '{"gatewayKey": "G01"}'),
  ('discretionary-review',   'human-task',  'Discretionary classification review',    'exam-board-chair',  40, '{"flagGuard": "award.discretionary-review.enabled"}'),
  ('award-approved',         'human-task',  'Award approved',                         'exam-board-chair',  50, '{}'),
  ('graduation-triggered',   'integration', 'Graduation triggered',                   NULL,                60, '{"targetService": "EnrolmentService.transitionStatus", "targetStatus": "graduated"}'),
  ('end',                    'end',         'Award classification workflow complete',  NULL,                70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'award-classification' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- exam-board-governance steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',       'start',       'Board constituted',                      NULL,                    10, '{}'),
  ('data-pack-prepared',      'human-task',  'Data pack prepared',                     'registry-administrator', 20, '{}'),
  ('external-examiner-review','human-task',  'External examiner review',               'external-examiner',      30, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',        'decision',    'External examiner concerns gateway',      NULL,                    40, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',       'human-task',  'External examiner concerns resolved',    'exam-board-chair',       50, '{}'),
  ('chair-ratification',      'human-task',  'Chair ratification',                     'exam-board-chair',       60, '{}'),
  ('record-locked',           'integration', 'Records locked after ratification',       NULL,                    70, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                     'end',         'Exam board governance workflow complete', NULL,                    80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-governance' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- correction-case steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('case-received',       'start',       'Correction case received',           NULL,                    10, '{}'),
  ('eligibility-assessed','human-task',  'Eligibility assessed',               'registry-administrator', 20, '{}'),
  ('gateway-admissible',  'decision',    'Case admissibility gateway',          NULL,                    30, '{"gatewayKey": "G01"}'),
  ('evidence-gathered',   'human-task',  'Evidence gathered',                  'registry-administrator', 40, '{}'),
  ('gateway-panel',       'decision',    'Panel review required gateway',       NULL,                    50, '{"gatewayKey": "G02", "flagGuard": "correction.panel-review.enabled"}'),
  ('panel-review',        'human-task',  'Panel review',                       'exam-board-chair',       60, '{}'),
  ('outcome-decided',     'human-task',  'Outcome decided',                    'registry-administrator', 70, '{}'),
  ('gateway-upheld',      'decision',    'Case upheld gateway',                 NULL,                    80, '{"gatewayKey": "G03"}'),
  ('amendment-applied',   'integration', 'Locked-record amendment applied',     NULL,                    90, '{"targetService": "CorrectionService.applyAmendment"}'),
  ('case-closed',         'end',         'Correction case closed',              NULL,                   100, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'correction-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- appeal-case steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('appeal-received',       'start',       'Appeal received',                    NULL,                    10, '{}'),
  ('grounds-assessed',      'human-task',  'Grounds assessed',                   'registry-administrator', 20, '{}'),
  ('gateway-admissible',    'decision',    'Appeal admissibility gateway',        NULL,                    30, '{"gatewayKey": "G01"}'),
  ('evidence-gathered',     'human-task',  'Evidence gathered',                  'registry-administrator', 40, '{}'),
  ('gateway-hearing',       'decision',    'Panel hearing required gateway',      NULL,                    50, '{"gatewayKey": "G02", "flagGuard": "appeal.panel-hearing.enabled"}'),
  ('panel-hearing',         'human-task',  'Panel hearing',                      'exam-board-chair',       60, '{}'),
  ('outcome-decided',       'human-task',  'Outcome decided',                    'registry-administrator', 70, '{}'),
  ('gateway-upheld',        'decision',    'Appeal upheld gateway',               NULL,                    80, '{"gatewayKey": "G03"}'),
  ('amendment-applied',     'integration', 'Locked-record amendment applied',    NULL,                     90, '{"targetService": "CorrectionService.applyAmendment"}'),
  ('case-closed',           'end',         'Appeal case closed',                  NULL,                   100, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'appeal-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- regulatory-submission-approval steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('submission-prepared',    'start',       'Regulatory submission prepared',          NULL,                 10, '{}'),
  ('validation-complete',    'system-task', 'Submission validation complete',          NULL,                 20, '{"serviceCall": "RegulatoryExchangeService.validate"}'),
  ('gateway-approval',       'decision',    'Manual approval required gateway',        NULL,                 30, '{"gatewayKey": "G01", "flagGuard": "regulatory.submission.manual-approval.required"}'),
  ('submission-approved',    'human-task',  'Submission approved',                     'regulatory-officer', 40, '{}'),
  ('submission-dispatched',  'integration', 'Submission dispatched',                   NULL,                 50, '{"targetService": "RegulatoryExchangeService.dispatch", "safetyClassRequired": true}'),
  ('gateway-response',       'decision',    'Response awaited gateway',                NULL,                 60, '{"gatewayKey": "G02"}'),
  ('response-processed',     'system-task', 'Response processed',                      NULL,                 70, '{}'),
  ('end',                    'end',         'Regulatory submission workflow complete',  NULL,                 80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'regulatory-submission-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- finance-fee-handoff steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('fee-liability-created',   'start',       'Fee liability created',              NULL,                     10, '{}'),
  ('fee-calculated',          'system-task', 'Fee calculated',                     NULL,                     20, '{"serviceCall": "FeeService.calculateFee"}'),
  ('gateway-external-system', 'decision',    'External finance system gateway',    NULL,                     30, '{"gatewayKey": "G01", "flagGuard": "finance.fee-handoff.enabled"}'),
  ('invoice-generated',       'integration', 'Invoice generated',                  NULL,                     40, '{"targetService": "InvoiceService.generate"}'),
  ('payment-confirmed',       'human-task',  'Payment confirmed',                  'finance-administrator',  50, '{}'),
  ('finance-system-notified', 'integration', 'External finance system notified',   NULL,                     60, '{"flagGuard": "finance.external-system-integration.enabled"}'),
  ('end',                     'end',         'Finance fee handoff complete',        NULL,                     70, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'finance-fee-handoff' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- identity-provisioning steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('identity-submitted',    'start',       'Identity submitted',                  NULL,                    10, '{}'),
  ('deduplication-check',   'system-task', 'Deduplication check',                 NULL,                    20, '{"flagGuard": "identity.deduplication.enabled", "serviceCall": "PersonService.checkDuplicates"}'),
  ('gateway-match-found',   'decision',    'Duplicate match gateway',             NULL,                    30, '{"gatewayKey": "G01"}'),
  ('merge-review',          'human-task',  'Merge review',                        'registry-administrator', 40, '{}'),
  ('identity-confirmed',    'system-task', 'Identity confirmed',                  NULL,                    50, '{"serviceCall": "PersonService.confirmIdentity"}'),
  ('end',                   'end',         'Identity provisioning complete',       NULL,                    60, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'identity-provisioning' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- communication-dispatch steps
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('trigger-received',           'start',       'Communication trigger received',         NULL, 10, '{}'),
  ('template-selected',          'system-task', 'Template selected',                      NULL, 20, '{"serviceCall": "CommunicationService.selectTemplate"}'),
  ('locale-resolved',            'system-task', 'Locale resolved',                        NULL, 30, '{"flagGuard": "communications.locale-aware.enabled", "serviceCall": "LocaleService.resolveLocale"}'),
  ('channel-selected',           'system-task', 'Channel selected',                       NULL, 40, '{"serviceCall": "CommunicationService.selectChannel"}'),
  ('message-dispatched',         'integration', 'Message dispatched',                     NULL, 50, '{}'),
  ('gateway-delivery-confirm',   'decision',    'Delivery confirmation required gateway', NULL, 60, '{"gatewayKey": "G01"}'),
  ('delivery-confirmed',         'system-task', 'Delivery confirmed',                     NULL, 70, '{}'),
  ('end',                        'end',         'Communication dispatch complete',         NULL, 80, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'communication-dispatch' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- ── Section 5: Workflow Decision Gateways ─────────────────────────────────────

-- enrolment-change-approval gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Change request approved or rejected?', '{"policySource": "Enrolment Policy, status transition rules", "approvedOutcome": "enrolment-updated", "rejectedOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'enrolment-change-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- module-registration-change gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Registration change approved or rejected?', '{"policySource": "Registration Window Policy, prerequisite rules", "approvedOutcome": "registration-updated", "rejectedOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- progression-review gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Straightforward or discretionary case?', '{"policySource": "Academic progression rules and cohort thresholds", "straightforwardOutcome": "outcome-decided", "discretionaryOutcome": "board-review"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'progression-review' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- award-classification gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Straightforward or discretionary classification?', '{"policySource": "Classification algorithm and boundary rules", "straightforwardOutcome": "award-approved", "discretionaryOutcome": "discretionary-review"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'award-classification' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- exam-board-governance gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'External examiner concerns raised?', '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "chair-ratification", "concernsOutcome": "concerns-resolved"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-governance' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- correction-case gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Correction case admissible?',    '{"policySource": "Correction eligibility policy", "admissibleOutcome": "evidence-gathered", "inadmissibleOutcome": "case-closed"}'),
  ('G02', 'Panel review required?',         '{"policySource": "Correction panel review policy", "panelRequiredOutcome": "panel-review", "noPanelOutcome": "outcome-decided"}'),
  ('G03', 'Correction case upheld?',        '{"policySource": "Correction outcome decision", "upheldOutcome": "amendment-applied", "notUpheldOutcome": "case-closed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'correction-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- appeal-case gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Appeal admissible?',         '{"policySource": "Academic appeals policy and grounds criteria", "admissibleOutcome": "evidence-gathered", "inadmissibleOutcome": "case-closed"}'),
  ('G02', 'Panel hearing required?',    '{"policySource": "Academic appeals panel policy", "hearingRequiredOutcome": "panel-hearing", "noHearingOutcome": "outcome-decided"}'),
  ('G03', 'Appeal upheld?',             '{"policySource": "Academic appeals outcome decision", "upheldOutcome": "amendment-applied", "notUpheldOutcome": "case-closed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'appeal-case' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- regulatory-submission-approval gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Manual approval required?',    '{"policySource": "Environment safety class and regulatory submission policy", "approvalRequiredOutcome": "submission-approved", "autoApproveOutcome": "submission-dispatched"}'),
  ('G02', 'Response awaited?',            '{"policySource": "Regulatory exchange protocol", "awaitedOutcome": "response-processed", "noResponseOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'regulatory-submission-approval' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- finance-fee-handoff gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'External finance system integration enabled?', '{"policySource": "Finance integration configuration", "enabledOutcome": "invoice-generated", "disabledOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'finance-fee-handoff' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- identity-provisioning gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Potential duplicate match found?', '{"policySource": "Identity deduplication policy", "matchFoundOutcome": "merge-review", "noMatchOutcome": "identity-confirmed"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'identity-provisioning' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- communication-dispatch gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", g."gateway_key", g."display_name", 'exclusive', NULL, g."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('G01', 'Delivery confirmation required?', '{"policySource": "Communication channel configuration", "confirmationRequiredOutcome": "delivery-confirmed", "noConfirmationOutcome": "end"}')
) AS g("gateway_key", "display_name", "configuration") ON true
WHERE wd."definition_code" = 'communication-dispatch' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- ── Section 6: Workflow Assignment Rules ──────────────────────────────────────

-- Default role assignment rules for all Stage 2 workflows.
-- rule_key must be unique within (workflow_definition_version_id, tenant_id),
-- so each rule key embeds both the workflow short-name and the step key.
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, r."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  -- enrolment-change-approval
  ('enrolment-change-approval', 'registrar-review',         'enrolment-change.registrar-review.registry-default',          100, 'registry-administrator', '{}'),

  -- module-registration-change
  ('module-registration-change', 'approval-review',         'module-reg-change.approval-review.registry-default',          100, 'registry-administrator', '{}'),

  -- assessment-mark-review
  ('assessment-mark-review', 'moderation-review',           'mark-review.moderation-review.module-tutor-default',          100, 'module-tutor',           '{}'),
  ('assessment-mark-review', 'late-penalty-review',         'mark-review.late-penalty-review.registry-default',            100, 'registry-administrator', '{}'),
  ('assessment-mark-review', 'result-review',               'mark-review.result-review.board-chair-default',               100, 'exam-board-chair',       '{}'),

  -- progression-review
  ('progression-review', 'board-review',                    'progression.board-review.board-chair-default',                100, 'exam-board-chair',       '{}'),
  ('progression-review', 'outcome-decided',                 'progression.outcome-decided.board-chair-default',             100, 'exam-board-chair',       '{}'),

  -- award-classification
  ('award-classification', 'discretionary-review',          'award.discretionary-review.board-chair-default',              100, 'exam-board-chair',       '{}'),
  ('award-classification', 'award-approved',                'award.award-approved.board-chair-default',                    100, 'exam-board-chair',       '{}'),

  -- exam-board-governance
  ('exam-board-governance', 'data-pack-prepared',           'board.data-pack-prepared.registry-default',                   100, 'registry-administrator', '{}'),
  ('exam-board-governance', 'external-examiner-review',     'board.external-examiner-review.external-examiner-default',    100, 'external-examiner',      '{}'),
  ('exam-board-governance', 'concerns-resolved',            'board.concerns-resolved.chair-default',                       100, 'exam-board-chair',       '{}'),
  ('exam-board-governance', 'chair-ratification',           'board.chair-ratification.chair-default',                      100, 'exam-board-chair',       '{}'),

  -- correction-case
  ('correction-case', 'eligibility-assessed',               'correction.eligibility-assessed.registry-default',            100, 'registry-administrator', '{}'),
  ('correction-case', 'evidence-gathered',                  'correction.evidence-gathered.registry-default',               100, 'registry-administrator', '{}'),
  ('correction-case', 'panel-review',                       'correction.panel-review.panel-chair-default',                 100, 'exam-board-chair',       '{}'),
  ('correction-case', 'outcome-decided',                    'correction.outcome-decided.registry-default',                 100, 'registry-administrator', '{}'),

  -- appeal-case
  ('appeal-case', 'grounds-assessed',                       'appeal.grounds-assessed.registry-default',                    100, 'registry-administrator', '{}'),
  ('appeal-case', 'evidence-gathered',                      'appeal.evidence-gathered.registry-default',                   100, 'registry-administrator', '{}'),
  ('appeal-case', 'panel-hearing',                          'appeal.panel-hearing.panel-chair-default',                    100, 'exam-board-chair',       '{}'),
  ('appeal-case', 'outcome-decided',                        'appeal.outcome-decided.registry-default',                     100, 'registry-administrator', '{}'),

  -- regulatory-submission-approval
  ('regulatory-submission-approval', 'submission-approved', 'regulatory.submission-approved.officer-default',              100, 'regulatory-officer',     '{}'),

  -- finance-fee-handoff
  ('finance-fee-handoff', 'payment-confirmed',              'finance.payment-confirmed.administrator-default',             100, 'finance-administrator',  '{}'),

  -- identity-provisioning
  ('identity-provisioning', 'merge-review',                 'identity.merge-review.registry-default',                      100, 'registry-administrator', '{}')
  -- communication-dispatch: fully automated, no human-task assignment rules required
) AS r(
  "definition_code", "step_key", "rule_key", "priority",
  "assignee_role_code", "configuration"
) ON wd."definition_code" = r."definition_code"
WHERE wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0014_stage3_assessment_grade_progression.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0014 — Stage 3: Assessment, Grade, and Progression Refactor
--
-- Adds:
--   1. Feature flags for assessment policy variants (late-penalty, resit-cap)
--      and board operating-model selection.
--   2. Two additional exam-board workflow definitions for school-led and
--      departmental-staged board governance models (large-institution variants).
--   3. Three append-only calculation evidence tables that satisfy the Stage 3
--      exit criterion: grade and progression calculations are reproducible from
--      rules, workflow decision evidence, and source marks.
--
-- What does NOT change in this migration:
--   - No existing service behaviour is altered by the migration alone; the new
--     flags default to backward-compatible values (late-penalty on, resit-cap
--     off) so existing tenants are unaffected until they opt in.
--   - Hard service guards (locked-record, valid-mark-range, ratification
--     authority) remain enforced in code and are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Assessment policy and board operating-model feature flags ──────

WITH stage3_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('assessment.late-penalty.enabled',
     'Late submission penalty enabled',
     'When off, late penalty calculation is suppressed for all mark ingestion in the tenant, '
     'regardless of due-date information submitted with the mark. '
     'Useful for institutions using external penalty management or mitigating-circumstances-first policies.',
     'assessment', 'active', 'boolean', 'on', 'system'),

    ('assessment.resit-cap.enabled',
     'Resit mark cap enabled',
     'When on, marks for attempt number 2 or higher are capped at the value configured in the '
     'resit-mark-cap academic rule (default 40 — the standard UK HE resit pass mark cap). '
     'The cap is applied after late penalty calculation.',
     'assessment', 'active', 'boolean', 'off', 'system'),

    ('exam-board.operating-model',
     'Exam board operating model',
     'Selects the workflow definition used for exam board governance. '
     'registry-led uses the standard exam-board-governance workflow seeded in Stage 2. '
     'school-led uses a school-initiated model where departmental chair prepares and school '
     'director ratifies before registry finalises. '
     'departmental-staged uses a three-stage model: department → school → registry for '
     'large multi-faculty institutions.',
     'governance', 'active', 'selection', 'registry-led', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "owner_module_code"   = EXCLUDED."owner_module_code",
    "status_code"         = EXCLUDED."status_code",
    "value_type_code"     = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage3_flags f
JOIN (VALUES
  -- assessment.late-penalty.enabled (boolean)
  ('assessment.late-penalty.enabled', 'off', 'Off', 'false', 10),
  ('assessment.late-penalty.enabled', 'on',  'On',  'true',  20),
  -- assessment.resit-cap.enabled (boolean)
  ('assessment.resit-cap.enabled',    'off', 'Off', 'false', 10),
  ('assessment.resit-cap.enabled',    'on',  'On',  'true',  20),
  -- exam-board.operating-model (selection)
  ('exam-board.operating-model', 'registry-led',        'Registry-Led',        '"registry-led"',        10),
  ('exam-board.operating-model', 'school-led',          'School-Led',          '"school-led"',          20),
  ('exam-board.operating-model', 'departmental-staged', 'Departmental-Staged', '"departmental-staged"', 30)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: Board operating-model workflow definitions ─────────────────────

-- exam-board-school-led: School-initiated model
--   Department chair prepares data pack → School director reviews and approves
--   → External examiner reviews → Registry finalises and locks.
--   Appropriate for faculty-led universities where the school owns the board.

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('exam-board-school-led',
   'Exam Board — School-Led Governance',
   'governance', 'active', 1,
   'School-initiated exam board workflow. Department chair prepares the data pack; '
   'school director approves before external examiner review and registry finalisation.',
   'system'),

  ('exam-board-departmental-staged',
   'Exam Board — Departmental Staged Governance',
   'governance', 'active', 1,
   'Large-institution three-stage board workflow: departmental committee sign-off, '
   'school executive approval, external examiner review, and central registry lock.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"           = EXCLUDED."display_name",
  "status_code"            = EXCLUDED."status_code",
  "current_version_number" = EXCLUDED."current_version_number",
  "description"            = EXCLUDED."description",
  "updated_at"             = now();

-- Definition versions
INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT wd."id", 1, 'active',
  jsonb_build_object(
    'startEvent',         v."start_event",
    'flagSnapshot',       v."flag_snapshot"::jsonb,
    'serviceInvariants',  v."service_invariants"::jsonb,
    'escalationPolicy',   v."escalation_policy"::jsonb,
    'terminalDataWrites', v."terminal_data_writes"::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
JOIN (VALUES
  ('exam-board-school-led',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required", "exam-board.operating-model"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 21, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]'),

  ('exam-board-departmental-staged',
   'exam-board.constitution-command',
   '["exam-board.external-examiner.required", "exam-board.operating-model"]',
   '["BoardService.ratifyBoard: external-examiner signoff guard, record-lock writes for marks/results/progressions"]',
   '{"defaultDeadlineDays": 28, "escalateToRole": "exam-board-chair"}',
   '["board ratified, module results and marks locked, progression decisions locked"]')
) AS v("definition_code", "start_event", "flag_snapshot", "service_invariants", "escalation_policy", "terminal_data_writes")
  ON wd."definition_code" = v."definition_code"
WHERE wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- Steps: exam-board-school-led
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',          'start',       'Board constituted',                               NULL,                     10, '{}'),
  ('data-pack-prepared',         'human-task',  'Department chair prepares data pack',             'department-chair',        20, '{}'),
  ('school-director-review',     'human-task',  'School director approves board pack',             'school-director',         30, '{}'),
  ('external-examiner-review',   'human-task',  'External examiner review',                        'external-examiner',       40, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',           'decision',    'External examiner concerns gateway',              NULL,                     50, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',          'human-task',  'External examiner concerns resolved',             'school-director',         60, '{}'),
  ('registry-finalisation',      'human-task',  'Registry finalisation and lock',                  'registry-administrator',  70, '{}'),
  ('record-locked',              'integration', 'Records locked after finalisation',               NULL,                     80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                        'end',         'School-led board governance complete',            NULL,                     90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-school-led' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Steps: exam-board-departmental-staged
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',            'start',       'Board constituted',                               NULL,                     10, '{}'),
  ('departmental-committee-review','human-task',  'Departmental committee sign-off',                 'department-chair',        20, '{}'),
  ('school-executive-approval',    'human-task',  'School executive approval',                       'school-director',         30, '{}'),
  ('external-examiner-review',     'human-task',  'External examiner review',                        'external-examiner',       40, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',             'decision',    'External examiner concerns gateway',              NULL,                     50, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',            'human-task',  'External examiner concerns resolved',             'exam-board-chair',        60, '{}'),
  ('central-registry-lock',        'human-task',  'Central registry lock and confirmation',          'registry-administrator',  70, '{}'),
  ('record-locked',                'integration', 'Records locked after central registry sign-off',  NULL,                     80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                          'end',         'Departmental-staged board governance complete',   NULL,                     90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-departmental-staged' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Decision gateways
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "registry-finalisation", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-school-led' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "central-registry-lock", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-departmental-staged' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Assignment rules
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, '{}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  -- exam-board-school-led
  ('exam-board-school-led', 'data-pack-prepared',       'school-led.data-pack-prepared.dept-chair-default',   100, 'department-chair'),
  ('exam-board-school-led', 'school-director-review',   'school-led.school-director-review.director-default',  100, 'school-director'),
  ('exam-board-school-led', 'external-examiner-review', 'school-led.external-examiner-review.examiner-default',100, 'external-examiner'),
  ('exam-board-school-led', 'concerns-resolved',        'school-led.concerns-resolved.director-default',       100, 'school-director'),
  ('exam-board-school-led', 'registry-finalisation',    'school-led.registry-finalisation.registry-default',   100, 'registry-administrator'),
  -- exam-board-departmental-staged
  ('exam-board-departmental-staged', 'departmental-committee-review','dept-staged.dept-committee.chair-default',        100, 'department-chair'),
  ('exam-board-departmental-staged', 'school-executive-approval',    'dept-staged.school-exec.director-default',        100, 'school-director'),
  ('exam-board-departmental-staged', 'external-examiner-review',     'dept-staged.external-examiner.examiner-default',  100, 'external-examiner'),
  ('exam-board-departmental-staged', 'concerns-resolved',            'dept-staged.concerns-resolved.chair-default',     100, 'exam-board-chair'),
  ('exam-board-departmental-staged', 'central-registry-lock',        'dept-staged.registry-lock.registry-default',      100, 'registry-administrator')
) AS r("definition_code", "step_key", "rule_key", "priority", "assignee_role_code")
  ON wd."definition_code" = r."definition_code"
WHERE wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;

-- ── Section 3: Calculation evidence tables ────────────────────────────────────
--
-- These tables are append-only audit records.  No bitemporal columns — each row
-- is a snapshot of what was calculated, when, and with which rule values.
-- They satisfy the Stage 3 exit criterion:
--   "Grade and progression calculations are reproducible from rules,
--    workflow decision evidence, and source marks."

CREATE TABLE IF NOT EXISTS "mark_calculation_evidence" (
  "id"                       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid         NOT NULL,
  "mark_id"                  uuid         NOT NULL,
  "attempt_number"           integer      NOT NULL,
  "raw_mark"                 numeric(6,2) NOT NULL,
  "late_penalty_enabled"     boolean      NOT NULL DEFAULT false,
  "late_penalty_percent"     numeric(6,2),
  "late_penalty_cap_applied" boolean      NOT NULL DEFAULT false,
  "late_penalty_cap_percent" numeric(6,2),
  "resit_cap_applied"        boolean      NOT NULL DEFAULT false,
  "resit_cap_mark"           numeric(6,2),
  "adjusted_mark"            numeric(6,2) NOT NULL,
  "rule_snapshot"            jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mark_calc_evidence_mark_idx"
  ON "mark_calculation_evidence" ("mark_id");

CREATE INDEX IF NOT EXISTS "mark_calc_evidence_tenant_idx"
  ON "mark_calculation_evidence" ("tenant_id", "calculated_at" DESC);

CREATE TABLE IF NOT EXISTS "progression_calculation_evidence" (
  "id"                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid         NOT NULL,
  "progression_decision_id"      uuid         NOT NULL,
  "academic_year"                text         NOT NULL,
  "required_credits"             numeric      NOT NULL,
  "compensation_threshold"       numeric,
  "compensation_credit_limit"    numeric      NOT NULL,
  "condonement_threshold"        numeric,
  "earned_credits"               numeric      NOT NULL,
  "compensation_credits"         numeric      NOT NULL,
  "unresolved_credits"           numeric      NOT NULL,
  "decision_code"                text         NOT NULL,
  "rule_snapshot"                jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"                timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "prog_calc_evidence_decision_idx"
  ON "progression_calculation_evidence" ("progression_decision_id");

CREATE INDEX IF NOT EXISTS "prog_calc_evidence_tenant_idx"
  ON "progression_calculation_evidence" ("tenant_id", "calculated_at" DESC);

CREATE TABLE IF NOT EXISTS "award_calculation_evidence" (
  "id"                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid         NOT NULL,
  "award_id"              uuid         NOT NULL,
  "algorithm"             text         NOT NULL,
  "aggregate_mark"        numeric(6,2) NOT NULL,
  "classification_code"   text         NOT NULL,
  "boundaries_applied"    jsonb        NOT NULL DEFAULT '[]',
  "outcome_count"         integer      NOT NULL,
  "total_credit_value"    numeric      NOT NULL,
  "rule_snapshot"         jsonb        NOT NULL DEFAULT '{}',
  "calculated_at"         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "award_calc_evidence_award_idx"
  ON "award_calculation_evidence" ("award_id");

CREATE INDEX IF NOT EXISTS "award_calc_evidence_tenant_idx"
  ON "award_calculation_evidence" ("tenant_id", "calculated_at" DESC);


-- ============================================================
-- Originally: 0015_stage4_exam_board_governance.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0015 — Stage 4: Exam Board and Record Governance Refactor
--
-- Adds:
--   1. Three feature flags for board operating-model variants:
--        exam-board.virtual-board.enabled   — async/virtual board operation
--        exam-board.deferral.enabled        — board may be deferred to next cycle
--        exam-board.quorum.required         — minimum quorum must be recorded
--      Plus: the existing exam-board.external-examiner.required flag is now
--      actually checked in BoardService.ratifyBoard() (it was seeded in Stage 2
--      but not yet wired to the service guard).
--
--   2. exam-board-virtual workflow definition — asynchronous board workflow
--      suitable for institutions that conduct board business by correspondence
--      or distributed async review rather than a fixed physical meeting.
--
--   3. Four new nullable columns on exam_board to capture deferral state and
--      quorum evidence without a full bitemporal table:
--        deferred_at         — when the board was deferred
--        deferral_reason     — free-text or coded reason for deferral
--        quorum_count        — number of members recorded as attending / reviewing
--        quorum_recorded_at  — when the quorum count was recorded
--
-- What does NOT change:
--   - Service-level record-lock guards (ratifyBoard: marks, module results, and
--     progression decisions are locked in the same transaction) are unchanged.
--   - Ratification authority (exam-board:ratify → exam-board-chair role) is
--     unchanged in the permission model.
--   - Correction-case authority (separate correction role guards) is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Board governance feature flags ─────────────────────────────────

WITH stage4_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('exam-board.virtual-board.enabled',
     'Virtual exam board enabled',
     'When on, the exam board does not require a physical meeting date. '
     'Members and the chair review and approve asynchronously. '
     'The exam-board-virtual workflow definition is used instead of the standard one.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('exam-board.deferral.enabled',
     'Board deferral enabled',
     'When on, an exam board that has not yet been ratified may be deferred to the '
     'next governance cycle by a registry administrator. A deferred board cannot be '
     'ratified until it is explicitly re-opened.',
     'governance', 'active', 'boolean', 'off', 'system'),

    ('exam-board.quorum.required',
     'Board quorum required',
     'When on, a quorum count must be recorded on the exam board before ratification '
     'is permitted. The quorum threshold is defined in the exam-board-quorum-threshold '
     'academic rule (default 3). Enables institutions that have formal quorum '
     'requirements under their academic regulations.',
     'governance', 'active', 'boolean', 'off', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "owner_module_code"   = EXCLUDED."owner_module_code",
    "status_code"         = EXCLUDED."status_code",
    "value_type_code"     = EXCLUDED."value_type_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage4_flags f
JOIN (VALUES
  ('exam-board.virtual-board.enabled', 'off', 'Off', 'false', 10),
  ('exam-board.virtual-board.enabled', 'on',  'On',  'true',  20),
  ('exam-board.deferral.enabled',      'off', 'Off', 'false', 10),
  ('exam-board.deferral.enabled',      'on',  'On',  'true',  20),
  ('exam-board.quorum.required',       'off', 'Off', 'false', 10),
  ('exam-board.quorum.required',       'on',  'On',  'true',  20)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: exam-board-virtual workflow definition ─────────────────────────
--
-- Asynchronous board workflow. No fixed meeting date is required. Members review
-- the data pack independently; the chair makes a ratification decision after all
-- required async sign-offs are received.
--
-- Step design:
--   board-constituted        → data-pack-distributed   → async-member-review
--   → async-chair-review     → external-examiner-async (optional via flagGuard)
--   → gateway-concerns       → [concerns-resolved] → record-locked → end

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code",
  "status_code", "current_version_number", "description", "created_by"
)
VALUES
  ('exam-board-virtual',
   'Exam Board — Virtual / Async Governance',
   'governance', 'active', 1,
   'Async board workflow for institutions where members review and approve '
   'independently without a fixed physical meeting. '
   'Suitable for distributed governance, small institutions, or correspondence boards.',
   'system')
ON CONFLICT (COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), "definition_code")
DO UPDATE SET
  "display_name"           = EXCLUDED."display_name",
  "status_code"            = EXCLUDED."status_code",
  "current_version_number" = EXCLUDED."current_version_number",
  "description"            = EXCLUDED."description",
  "updated_at"             = now();

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code",
  "definition_json", "bpmn_source_id", "effective_from", "created_by"
)
SELECT wd."id", 1, 'active',
  jsonb_build_object(
    'startEvent',         'exam-board.constitution-command',
    'flagSnapshot',       '["exam-board.virtual-board.enabled", "exam-board.external-examiner.required", "exam-board.quorum.required"]'::jsonb,
    'serviceInvariants',  '["BoardService.ratifyBoard: external-examiner signoff guard (flag controlled), quorum guard (flag controlled), record-lock writes"]'::jsonb,
    'escalationPolicy',   '{"defaultDeadlineDays": 14, "escalateToRole": "exam-board-chair"}'::jsonb,
    'terminalDataWrites', '["board ratified, module results and marks locked, progression decisions locked"]'::jsonb
  ),
  NULL,
  '2026-06-14T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

-- Steps: exam-board-virtual
INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code",
  "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('board-constituted',        'start',       'Board constituted',                                   NULL,                    10, '{}'),
  ('data-pack-distributed',    'human-task',  'Registry distributes data pack asynchronously',       'registry-administrator', 20, '{}'),
  ('async-member-review',      'human-task',  'Board members review data pack (async)',              'exam-board-member',      30, '{}'),
  ('async-chair-review',       'human-task',  'Chair reviews outcomes and draft decisions (async)',  'exam-board-chair',       40, '{}'),
  ('external-examiner-async',  'human-task',  'External examiner async sign-off',                   'external-examiner',      50, '{"flagGuard": "exam-board.external-examiner.required"}'),
  ('gateway-concerns',         'decision',    'External examiner concerns gateway',                  NULL,                    60, '{"gatewayKey": "G01"}'),
  ('concerns-resolved',        'human-task',  'Concerns resolved by chair (async)',                  'exam-board-chair',       70, '{}'),
  ('record-locked',            'integration', 'Records locked after async ratification',             NULL,                    80, '{"targetService": "BoardService.ratifyBoard"}'),
  ('end',                      'end',         'Virtual board governance complete',                   NULL,                    90, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

-- Decision gateway for virtual board
INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name",
  "decision_type_code", "source_reference", "configuration"
)
SELECT wdv."id", 'G01', 'External examiner concerns raised?', 'exclusive', NULL,
  '{"policySource": "External examiner reporting requirements", "noConcernsOutcome": "record-locked", "concernsOutcome": "concerns-resolved"}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Assignment rules for virtual board
INSERT INTO "workflow_assignment_rule" (
  "workflow_definition_version_id", "step_key", "rule_key",
  "priority", "assignee_role_code", "active", "configuration"
)
SELECT wdv."id", r."step_key", r."rule_key", r."priority"::integer, r."assignee_role_code", true, '{}'::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('data-pack-distributed',   'virtual.data-pack.registry-default',         100, 'registry-administrator'),
  ('async-member-review',     'virtual.member-review.member-default',        100, 'exam-board-member'),
  ('async-chair-review',      'virtual.chair-review.chair-default',          100, 'exam-board-chair'),
  ('external-examiner-async', 'virtual.external-examiner.examiner-default',  100, 'external-examiner'),
  ('concerns-resolved',       'virtual.concerns-resolved.chair-default',     100, 'exam-board-chair')
) AS r("step_key", "rule_key", "priority", "assignee_role_code") ON true
WHERE wd."definition_code" = 'exam-board-virtual' AND wd."tenant_id" IS NULL AND wdv."version_number" = 1
ON CONFLICT DO NOTHING;

-- ── Section 3: exam_board schema additions ────────────────────────────────────
--
-- All four columns are nullable. A NULL value for deferred_at means the board
-- is not deferred. A NULL value for quorum_count means quorum has not been
-- recorded (or is not required for this board).

ALTER TABLE "exam_board"
  ADD COLUMN IF NOT EXISTS "deferred_at"        timestamptz,
  ADD COLUMN IF NOT EXISTS "deferral_reason"     text,
  ADD COLUMN IF NOT EXISTS "quorum_count"        integer,
  ADD COLUMN IF NOT EXISTS "quorum_recorded_at"  timestamptz;

CREATE INDEX IF NOT EXISTS "exam_board_deferred_idx"
  ON "exam_board" ("tenant_id", "deferred_at")
  WHERE "deferred_at" IS NOT NULL;


-- ============================================================
-- Originally: 0016_stage5_admissions_communications.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0016 — Stage 5: Admissions and Communications Clean Cut
--
-- Adds:
--   1. Three feature flags for communication channel strategy:
--        communications.channel.email.enabled         — email dispatch
--        communications.channel.crm-handoff.enabled   — CRM integration handoff
--        communications.channel.integration-event.enabled — integration event publish
--
--   2. communication_template — locale-aware message templates, one row per
--      (template_key, channel_code, locale_code, tenant_id/system).
--      System-level templates are seeded here; tenants may override.
--
--   3. communication_dispatch_log — append-only audit record for every
--      communication dispatch attempt, whether sent, suppressed, or failed.
--
--   4. Two seed system templates (en-GB defaults):
--        admissions.application-received / integration-event
--        enrolment.welcome              / integration-event
--
--   5. Two active workflow trigger rules replacing the Stage 2 placeholder:
--        admissions.handoff-started      → communication-dispatch
--        enrolment.created.welcome       → communication-dispatch
--
-- What does NOT change:
--   - Admissions workflow definitions (all 5 routes seeded in 0009).
--   - UCAS is already an adapter: admissions.legacy-ucas-auto-enrolment.enabled
--     is retired (seeded as status='retired' in 0009). No change needed here.
--   - communications.locale-aware.enabled already exists from 0013; not re-seeded.
--   - enrolment downstream triggers (ucas-confirmation, slc-confirmation,
--     ukvi-cas) are unchanged — they are regulatory, not communication.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Communication channel strategy flags ───────────────────────────

WITH stage5_flags AS (
  INSERT INTO "feature_flag" (
    "flag_key", "display_name", "description",
    "owner_module_code", "status_code", "value_type_code", "default_variant_key", "created_by"
  )
  VALUES
    ('communications.channel.email.enabled',
     'Email channel enabled',
     'When on, the communication dispatch service delivers messages via email. '
     'When off, email dispatch is suppressed and recorded with status suppressed.',
     'communications', 'active', 'boolean', 'off', 'system'),

    ('communications.channel.crm-handoff.enabled',
     'CRM handoff channel enabled',
     'When on, the communication dispatch service forwards communication context '
     'to the configured CRM integration endpoint for external delivery. '
     'When off, CRM handoff is suppressed.',
     'communications', 'active', 'boolean', 'off', 'system'),

    ('communications.channel.integration-event.enabled',
     'Integration event channel enabled',
     'When on, the communication dispatch service publishes a structured '
     'integration event that external consumers can act on. '
     'When off, event publication is suppressed.',
     'communications', 'active', 'boolean', 'off', 'system')

  ON CONFLICT ("flag_key") DO UPDATE SET
    "display_name"        = EXCLUDED."display_name",
    "description"         = EXCLUDED."description",
    "status_code"         = EXCLUDED."status_code",
    "default_variant_key" = EXCLUDED."default_variant_key",
    "updated_at"          = now()
  RETURNING "id", "flag_key"
)
INSERT INTO "feature_flag_variant" ("flag_id", "variant_key", "display_name", "value", "sort_order")
SELECT f."id", v."variant_key", v."display_name", v."value"::jsonb, v."sort_order"
FROM stage5_flags f
JOIN (VALUES
  ('communications.channel.email.enabled',              'off', 'Off', 'false', 10),
  ('communications.channel.email.enabled',              'on',  'On',  'true',  20),
  ('communications.channel.crm-handoff.enabled',        'off', 'Off', 'false', 10),
  ('communications.channel.crm-handoff.enabled',        'on',  'On',  'true',  20),
  ('communications.channel.integration-event.enabled',  'off', 'Off', 'false', 10),
  ('communications.channel.integration-event.enabled',  'on',  'On',  'true',  20)
) AS v("flag_key", "variant_key", "display_name", "value", "sort_order")
  ON f."flag_key" = v."flag_key"
ON CONFLICT ("flag_id", "variant_key") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "value"        = EXCLUDED."value",
  "sort_order"   = EXCLUDED."sort_order";

-- ── Section 2: communication_template table ───────────────────────────────────
--
-- Locale resolution order for dispatch:
--   1. Exact match: (template_key, channel_code, preferredLocale, tenant_id)
--   2. Tenant fallback locale: (template_key, channel_code, fallbackLocale, tenant_id)
--   3. System preferred: (template_key, channel_code, preferredLocale, NULL)
--   4. System fallback: (template_key, channel_code, fallbackLocale, NULL)
--   5. System en-GB: (template_key, channel_code, 'en-GB', NULL)
--
-- body_template and subject_template support simple {key} placeholder
-- substitution resolved in CommunicationService.dispatch().

CREATE TABLE IF NOT EXISTS "communication_template" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        REFERENCES "tenant"("id"),
  "template_key"     text        NOT NULL,
  "channel_code"     text        NOT NULL,
  "locale_code"      text        NOT NULL DEFAULT 'en-GB',
  "subject_template" text,
  "body_template"    text        NOT NULL,
  "version"          integer     NOT NULL DEFAULT 1,
  "active"           boolean     NOT NULL DEFAULT true,
  "created_by"       text        NOT NULL DEFAULT 'system',
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

-- System-level templates (tenant_id IS NULL): one per (key, channel, locale)
CREATE UNIQUE INDEX IF NOT EXISTS "comm_template_system_unique_idx"
  ON "communication_template" ("template_key", "channel_code", "locale_code")
  WHERE "tenant_id" IS NULL;

-- Tenant-specific templates: one per (key, channel, locale, tenant)
CREATE UNIQUE INDEX IF NOT EXISTS "comm_template_tenant_unique_idx"
  ON "communication_template" ("template_key", "channel_code", "locale_code", "tenant_id")
  WHERE "tenant_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "comm_template_lookup_idx"
  ON "communication_template" ("template_key", "channel_code", "locale_code")
  WHERE "active" = true;

-- ── Section 3: communication_dispatch_log table ───────────────────────────────
--
-- Append-only. Every dispatch attempt — including suppressed and failed — is
-- recorded. This is the audit evidence for the exit criterion
-- "communications are workflow-triggered and auditable".

CREATE TABLE IF NOT EXISTS "communication_dispatch_log" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "template_key"         text        NOT NULL,
  "channel_code"         text        NOT NULL,
  "locale_code"          text        NOT NULL,
  "subject_entity_type"  text        NOT NULL,
  "subject_entity_id"    uuid        NOT NULL,
  "recipient_ref"        text,
  "payload"              jsonb       NOT NULL DEFAULT '{}',
  "workflow_instance_id" uuid,
  "status_code"          text        NOT NULL DEFAULT 'dispatched',
  "suppression_reason"   text,
  "dispatched_at"        timestamptz NOT NULL DEFAULT now(),
  "dispatched_by"        text        NOT NULL
);

CREATE INDEX IF NOT EXISTS "comm_dispatch_log_tenant_idx"
  ON "communication_dispatch_log" ("tenant_id", "dispatched_at" DESC);

CREATE INDEX IF NOT EXISTS "comm_dispatch_log_subject_idx"
  ON "communication_dispatch_log" ("tenant_id", "subject_entity_type", "subject_entity_id");

-- ── Section 4: Seed system-level communication templates (en-GB) ─────────────
--
-- These are the minimum templates needed to prove locale-aware dispatch
-- works end-to-end. They use the integration-event channel — the SRS
-- publishes a structured event; external systems consume and render.

INSERT INTO "communication_template" (
  "id", "tenant_id", "template_key", "channel_code", "locale_code",
  "subject_template", "body_template", "version", "active", "created_by"
)
VALUES
  (gen_random_uuid(), NULL,
   'admissions.application-received', 'integration-event', 'en-GB',
   NULL,
   '{"eventType": "admissions.application-received", "message": "Your application has been received and is being reviewed. Reference: {sourceApplicationReference}.", "locale": "en-GB"}',
   1, true, 'system'),

  (gen_random_uuid(), NULL,
   'enrolment.welcome', 'integration-event', 'en-GB',
   NULL,
   '{"eventType": "enrolment.welcome", "message": "Welcome to {institutionName}. Your enrolment for {academicYear} has been confirmed.", "locale": "en-GB"}',
   1, true, 'system'),

  (gen_random_uuid(), NULL,
   'enrolment.welcome', 'email', 'en-GB',
   'Welcome to your studies at {institutionName}',
   'Dear {studentName},\n\nWelcome to {institutionName}! Your enrolment for {academicYear} has been confirmed.\n\nIf you have any questions, please contact the registry.\n\nBest regards,\nRegistry Team',
   1, true, 'system')

ON CONFLICT DO NOTHING;

-- ── Section 5: Activate communication workflow trigger rules ──────────────────
--
-- Replace the Stage 2 placeholder (enrolment-created-future-communication,
-- target_workflow_code='future-communication-endpoint', active=false) with
-- real trigger rules that route to the communication-dispatch workflow.
--
-- Note: these rules are seeded globally (tenant_id IS NULL) so they apply
-- to all tenants by default. Tenants can override via tenant-scoped rules.

UPDATE "workflow_trigger_rule"
SET "active" = false
WHERE "trigger_key" = 'enrolment-created-future-communication';

INSERT INTO "workflow_trigger_rule" (
  "trigger_key", "event_type", "target_workflow_code",
  "condition_expression", "active", "configuration"
)
VALUES
  ('admissions.handoff-started.application-received-comms',
   'admissions.handoff-started',
   'communication-dispatch',
   'always',
   true,
   '{"templateKey": "admissions.application-received", "channelCode": "integration-event", "subjectEntityType": "ucas_application", "note": "Triggered when any admissions source starts a workflow handoff. CommunicationService resolves the channel via flag."}'),

  ('enrolment.created.welcome-comms',
   'enrolment.created',
   'communication-dispatch',
   'always',
   true,
   '{"templateKey": "enrolment.welcome", "channelCode": "integration-event", "subjectEntityType": "enrolment", "note": "Welcome communication dispatched on enrolment creation for all new students."}')

ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0017_stage6_flag_governance.sql
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0017 — Stage 6: Flag Governance and Admin UX
--
-- Adds governance metadata to every feature flag so that flags are governed
-- configuration rather than hidden conditionals.
--
-- New columns on feature_flag:
--   flag_class_code      — category from the governance taxonomy
--   risk_class_code      — change-risk rating
--   owner_contact        — team or email responsible for the flag
--   review_date          — next mandatory review date (ISO date string)
--   retirement_condition — prose condition that triggers flag removal
--   allowed_scope_codes  — array of scopes at which this flag may be assigned
--   non_bypassable       — when true, the 'off' variant may never be assigned
--
-- Flag class taxonomy:
--   migration            — temporary compatibility path during a migration
--   release              — release gate; feature not yet available to all tenants
--   tenant-variant       — institutional operating-model choice
--   environment-safety   — safety or compliance control; restricted assignment
--   module-enablement    — turns a product module on/off for a tenant
--   integration-route    — selects an external integration path
--   kill-switch          — emergency disable for a component; restricted assignment
--
-- Scope codes:
--   global               — applies to all tenants by default
--   tenant               — assigned at tenant level
--   environment          — assigned at deployment environment level
--
-- Existing flag classifications are applied in Section 2.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: Add governance columns ─────────────────────────────────────────

ALTER TABLE "feature_flag"
  ADD COLUMN IF NOT EXISTS "flag_class_code"       text        NOT NULL DEFAULT 'release',
  ADD COLUMN IF NOT EXISTS "risk_class_code"        text        NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS "owner_contact"          text,
  ADD COLUMN IF NOT EXISTS "review_date"            text,
  ADD COLUMN IF NOT EXISTS "retirement_condition"   text,
  ADD COLUMN IF NOT EXISTS "allowed_scope_codes"    text[]      NOT NULL DEFAULT ARRAY['global','tenant','environment'],
  ADD COLUMN IF NOT EXISTS "non_bypassable"         boolean     NOT NULL DEFAULT false;

-- ── Section 2: Classify all existing flags ────────────────────────────────────
--
-- Every flag is assigned a class, risk level, owner, and (where appropriate)
-- a non_bypassable guard and retirement condition.
--
-- environment-safety flags are restricted to global/environment scope only —
-- they must not be overridden per-tenant because they guard statutory controls.

-- Admissions flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'migration',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "review_date"         = '2026-12-31',
  "retirement_condition" = 'Remove once all tenants have migrated to AdmissionsService.startHandoff() and no UCAS-to-enrolment auto-creation paths remain in production use.',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.legacy-ucas-auto-enrolment.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'module-enablement',
  "risk_class_code"     = 'medium',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.ucas-adapter.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.direct-applications.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.agent-applications.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'admissions-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'admissions.international-route.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'environment-safety',
  "risk_class_code"     = 'critical',
  "owner_contact"       = 'compliance-team',
  "retirement_condition" = 'Must not be retired. UKVI CAS pre-check is a statutory requirement for student visa sponsors under the UK Home Office Points-Based System.',
  "allowed_scope_codes" = ARRAY['global','environment'],
  "non_bypassable"      = true
WHERE "flag_key" = 'admissions.cas-precheck.required';

-- Enrolment flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'registry-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'enrolment.change-approval.required';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'medium',
  "owner_contact"       = 'registry-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'enrolment.downstream-triggers.configured-mode';

-- Assessment flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'assessment-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'assessment.late-penalty.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'assessment-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'assessment.resit-cap.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'module-enablement',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'assessment-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'assessment.moderation.workflow.enabled';

-- Progression flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'medium',
  "owner_contact"       = 'registry-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'progression.board-review.enabled';

-- Exam board flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'governance-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'exam-board.operating-model';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'governance-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'exam-board.virtual-board.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'tenant-variant',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'governance-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'exam-board.deferral.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'environment-safety',
  "risk_class_code"     = 'high',
  "owner_contact"       = 'governance-team',
  "retirement_condition" = 'Must not be retired. Board quorum verification is a governance requirement for degree-awarding institutions under PSRB and QAA expectations.',
  "allowed_scope_codes" = ARRAY['global','environment'],
  "non_bypassable"      = true
WHERE "flag_key" = 'exam-board.quorum.required';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'environment-safety',
  "risk_class_code"     = 'high',
  "owner_contact"       = 'governance-team',
  "retirement_condition" = 'Must not be retired. External examiner oversight is required under QAA Quality Code Chapter B7 and OfS conditions for degree-awarding powers.',
  "allowed_scope_codes" = ARRAY['global','environment'],
  "non_bypassable"      = true
WHERE "flag_key" = 'exam-board.external-examiner.required';

-- Communications flags
UPDATE "feature_flag" SET
  "flag_class_code"     = 'module-enablement',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.locale-aware.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.channel.email.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.channel.crm-handoff.enabled';

UPDATE "feature_flag" SET
  "flag_class_code"     = 'integration-route',
  "risk_class_code"     = 'low',
  "owner_contact"       = 'platform-team',
  "allowed_scope_codes" = ARRAY['global','tenant','environment'],
  "non_bypassable"      = false
WHERE "flag_key" = 'communications.channel.integration-event.enabled';

-- ── Section 3: Seed flag class and risk class value sets ──────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('feature-flag-class',      'Feature Flag Class',      'srs-internal', '1.0', 'Governance taxonomy for feature flags (migration, release, tenant-variant, etc.)', false),
  ('feature-flag-risk-class', 'Feature Flag Risk Class', 'srs-internal', '1.0', 'Change-risk rating for a feature flag',                                           false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('migration',          'Migration',          10),
  ('release',            'Release gate',       20),
  ('tenant-variant',     'Tenant variant',     30),
  ('environment-safety', 'Environment safety', 40),
  ('module-enablement',  'Module enablement',  50),
  ('integration-route',  'Integration route',  60),
  ('kill-switch',        'Kill switch',        70)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'feature-flag-class'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('low',      'Low',      10),
  ('medium',   'Medium',   20),
  ('high',     'High',     30),
  ('critical', 'Critical', 40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'feature-flag-risk-class'
ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0018_stage7_legacy_removal.sql
-- ============================================================

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


-- ============================================================
-- Originally: 0019_phase7_integration_registry.sql
-- ============================================================

-- Phase 7 Stage 4 — Plugin Registry Runtime APIs
-- Adds the OfS regulatory extracts contract to the integration contract catalogue.
-- All other integration_contract, integration_registration, and integration_exchange
-- tables were created in 0006_phase6_regulatory_schema.sql.

INSERT INTO "integration_contract" (
  "contract_id",
  "display_name",
  "owner_module_code",
  "direction_code",
  "pattern_type",
  "current_contract_version",
  "data_classification_code"
) VALUES (
  'ofs-regulatory-extracts.v1',
  'OfS Regulatory Extracts',
  'regulatory',
  'outbound',
  'api-and-file',
  '1.0.0',
  'regulatory'
) ON CONFLICT ("contract_id") DO NOTHING;


-- ============================================================
-- Originally: 0020_phase7_contract_deprecation.sql
-- ============================================================

-- Phase 7 Stage 4 completions — contract deprecation fields and constraint correction

-- 1. Deprecation and minimum version support on integration_contract.
--    deprecated_at: when the contract was deprecated (NULL = still active).
--    minimum_supported_version: oldest registration contractVersion still accepted.
ALTER TABLE "integration_contract"
  ADD COLUMN "deprecated_at"             TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "minimum_supported_version" TEXT;

-- 2. Drop the overly restrictive unique constraint on (tenant_id, integration_code).
--    Tenants legitimately need multiple registrations for the same contract type
--    (e.g. multiple VLE instances, staging vs live endpoints, different transports).
ALTER TABLE "integration_registration"
  DROP CONSTRAINT IF EXISTS "integration_registration_tenant_code_unique";


-- ============================================================
-- Originally: 0021_phase9_vle_contracts.sql
-- ============================================================

-- Phase 9 — VLE Connector integration contracts
-- Registers the three contracts consumed and produced by the VLE Connector adapter.
-- F015: VLE Course Provisioning (outbound event-driven)
-- F016: VLE Assessment Results  (inbound API)
-- F059: VLE Adjustment Distribution (outbound event-driven)

INSERT INTO "integration_contract" (
  "contract_id",
  "display_name",
  "owner_module_code",
  "direction_code",
  "pattern_type",
  "current_contract_version",
  "data_classification_code"
) VALUES
  (
    'vle-course-provisioning.v1',
    'VLE Course Provisioning',
    'vle',
    'outbound',
    'event-driven',
    '1.0.0',
    'internal'
  ),
  (
    'vle-assessment-results.v1',
    'VLE Assessment Results',
    'vle',
    'inbound',
    'api',
    '1.0.0',
    'confidential'
  ),
  (
    'vle-adjustments.v1',
    'VLE Adjustment Distribution',
    'vle',
    'outbound',
    'event-driven',
    '1.0.0',
    'special-category'
  )
ON CONFLICT ("contract_id") DO NOTHING;


-- Originally 0002_demo_performance_and_seed_data.sql

-- ============================================================
-- Originally: 0022_demo_tenant_mode.sql
-- ============================================================

-- Revelation SRS — Phase 10.5 Stage 0: Demo Tenant Mode
-- Migration: 0022_demo_tenant_mode
-- Applied by: packages/db/src/migrate.ts
--
-- Adds demo_mode to the tenant table.
-- A tenant with demo_mode = TRUE is the only valid target for the demo data
-- reset commands (pnpm demo:reset). This is the primary safety gate:
-- no reset command may execute against a tenant where demo_mode = FALSE,
-- regardless of any other environment flag.
--
-- All existing tenants default to demo_mode = FALSE (no behavioural change).
-- Demo tenants must be explicitly opted in via a system-administrator operation.

ALTER TABLE "tenant" ADD COLUMN "demo_mode" boolean NOT NULL DEFAULT false;


-- ============================================================
-- Originally: 0023_demo_status_checkpoint.sql
-- ============================================================

-- Revelation SRS — Phase 10.5 Stage 1: Demo Status and Checkpoint Tables
-- Migration: 0023_demo_status_checkpoint
-- Applied by: packages/db/src/migrate.ts
--
-- demo_status: one row per demo tenant recording the currently-loaded scenario,
--   the clock offset (referenceDate - wall-clock time at load), and rotation
--   metadata consumed by GET /api/v1/demo/status and the demo site banner.
--
-- demo_load_checkpoint: one row per demo tenant recording the last committed
--   load phase, enabling interrupted scenario loads to resume rather than
--   restart from scratch.

CREATE TABLE "demo_status" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid        NOT NULL REFERENCES "tenant"("id"),
  "scenario_slug"   text        NOT NULL,
  "scenario_name"   text        NOT NULL,
  "schema_version"  text        NOT NULL,
  "reference_date"  date        NOT NULL,
  "clock_offset_ms" bigint      NOT NULL,
  "loaded_at"       timestamptz NOT NULL DEFAULT now(),
  "next_reset_at"   timestamptz,
  CONSTRAINT "demo_status_tenant_unique" UNIQUE ("tenant_id")
);

CREATE TABLE "demo_load_checkpoint" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "scenario_slug" text        NOT NULL,
  "phase_name"    text        NOT NULL,
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "demo_load_checkpoint_tenant_unique" UNIQUE ("tenant_id")
);


-- ============================================================
-- Originally: 0024_phase11_performance_indexes.sql
-- ============================================================

-- Phase 11 Stage 2 — Performance Indexes
-- Adds composite indexes for high-query paths identified during the S6 load profile.
--
-- Targets:
--   1. Enrolment aggregate queries (reporting endpoint) — year of entry + mode group-bys
--   2. Student search — family-name text prefix scan
--   3. Module registration lookups — by offering for exam board data-pack queries
--   4. Mark lookups — by registration for result assembly
--   5. Exam board candidate profile listing — by board for ratification screens
--   6. Audit log — by entity type + id (Stage 3 entity audit API)
--   7. Fee liability — by academic year (SLC/fee reporting)
--   8. Exceptional circumstances — by enrolment + status (EC workload dashboard)

-- 1. Enrolment aggregate — academic year of entry (GROUP BY year)
CREATE INDEX IF NOT EXISTS "enrolment_year_of_entry_idx"
  ON "enrolment" ("tenant_id", "academic_year_of_entry")
  WHERE recorded_until IS NULL;

-- 2. Enrolment aggregate — programme id (top-N programme report)
CREATE INDEX IF NOT EXISTS "enrolment_programme_report_idx"
  ON "enrolment" ("tenant_id", "programme_id")
  WHERE recorded_until IS NULL AND programme_id IS NOT NULL;

-- 3. Person search by family name (LIKE 'Smith%' prefix scans on student search)
CREATE INDEX IF NOT EXISTS "person_identity_family_name_idx"
  ON "person_identity" ("tenant_id", "legal_family_name" text_pattern_ops)
  WHERE recorded_until IS NULL;

-- 4. Module registration by offering (exam board data-pack assembly)
CREATE INDEX IF NOT EXISTS "module_registration_offering_idx"
  ON "module_registration" ("tenant_id", "module_offering_id")
  WHERE recorded_until IS NULL;

-- 5. Mark by registration (result-lookup and mark submission reads)
CREATE INDEX IF NOT EXISTS "mark_registration_current_idx"
  ON "mark" ("tenant_id", "module_registration_id")
  WHERE recorded_until IS NULL;

-- 6. Exam board candidate profile by data pack (ratification screen paging)
CREATE INDEX IF NOT EXISTS "exam_board_candidate_profile_pack_idx"
  ON "exam_board_candidate_profile" ("tenant_id", "data_pack_id");

-- 7. Audit log by entity type + entity id (entity audit API)
CREATE INDEX IF NOT EXISTS "audit_record_entity_type_id_idx"
  ON "audit_record" ("tenant_id", "entity_type", "entity_id");

-- 8. Fee liability by academic year (SLC / fee reporting queries)
CREATE INDEX IF NOT EXISTS "fee_liability_year_idx"
  ON "fee_liability" ("tenant_id", "academic_year");

-- 9. Exceptional circumstances by enrolment (EC workload dashboard)
CREATE INDEX IF NOT EXISTS "ec_enrolment_idx"
  ON "exceptional_circumstances" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;


-- ============================================================
-- Originally: 0025_phase11_retention_anonymisation.sql
-- ============================================================

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


-- ============================================================
-- Originally: 0026_phase11_notifications.sql
-- ============================================================

-- Phase 11 Stage 5 — In-app notification table
-- Stores persistent notifications delivered to students via SSE and displayed
-- in the NotificationsPage.  Each row is tenant-scoped and person-scoped.

CREATE TABLE IF NOT EXISTS "notification" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID        NOT NULL REFERENCES "tenant"("id"),
  "person_id"   UUID        NOT NULL,
  "category"    TEXT        NOT NULL,   -- e.g. 'adjustment', 'ec', 'enrolment', 'general'
  "title"       TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "link_url"    TEXT,                   -- optional deep link
  "read_at"     TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_person_idx"
  ON "notification"("tenant_id", "person_id", "created_at" DESC);

CREATE INDEX "notification_unread_idx"
  ON "notification"("tenant_id", "person_id")
  WHERE "read_at" IS NULL;


-- ============================================================
-- Originally: 0027_valueset_picklists.sql
-- ============================================================

-- Revelation SRS — Value-Set Picklist Normalisation
-- Migration: 0027_valueset_picklists
--
-- Principle: every code column surfaced to a UI picklist must be backed by a
-- value_set + field_value_set mapping so that the list of valid values is
-- authoritative in the database and can be extended per-tenant without a
-- code deployment.
--
-- This migration:
--   1. Corrects student-address-type members (term-time, next-of-kin).
--   2. Adds exam-board-type-code value set + members + field mapping.
--   3. Adds correction-case-type-code value set + members + field mapping.
--   4. Adds academic-rule-type-code value set + members + field mapping.
--   5. Adds foi-status-code value set + members (no domain field mapping —
--      used by admin workflow only).

-- ── 1. Fix student-address-type ──────────────────────────────────────────────
-- The original seed used 'term' but the application code expects 'term-time'.
-- Rename the code in place and add next-of-kin.

UPDATE "value_set_member"
SET    "code" = 'term-time', "display_label" = 'Term-time address'
WHERE  "value_set_id" = (SELECT "id" FROM "value_set" WHERE "set_code" = 'student-address-type')
  AND  "code" = 'term';

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('next-of-kin', 'Next-of-kin address', 40)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'student-address-type'
ON CONFLICT DO NOTHING;

-- ── 2. Exam Board Type ───────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('exam-board-type-code', 'Exam Board Type', 'srs-internal', NULL,
        'Category of examination board (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('undergraduate',        'Undergraduate',         10),
  ('postgraduate-taught',  'Postgraduate Taught',   20),
  ('postgraduate-research','Postgraduate Research',  30),
  ('progression',          'Progression',           40),
  ('resit',                'Resit',                 50)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'exam-board-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('exam_board', 'board_type_code', 'exam-board-type-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ── 3. Correction Case Type ──────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('correction-case-type-code', 'Correction Case Type', 'srs-internal', NULL,
        'Type of academic correction or appeal case (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('appeal',                    'Academic Appeal',            10),
  ('administrative-correction', 'Administrative Correction',  20),
  ('misconduct',                'Academic Misconduct',        30)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'correction-case-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('correction_case', 'case_type_code', 'correction-case-type-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ── 4. Academic Rule Type ────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('academic-rule-type-code', 'Academic Rule Type', 'srs-internal', NULL,
        'Category of academic regulation rule (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('progression',       'Progression',        10),
  ('classification',    'Classification',     20),
  ('assessment',        'Assessment',         30),
  ('credit-transfer',   'Credit Transfer',    40),
  ('resit-eligibility', 'Resit Eligibility',  50),
  ('award-eligibility', 'Award Eligibility',  60)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'academic-rule-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('academic_rule', 'rule_type_code', 'academic-rule-type-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ── 5. FOI Status ────────────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('foi-status-code', 'FOI Request Status', 'srs-internal', NULL,
        'Lifecycle status of a Freedom of Information request', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('open',        'Open',        10),
  ('in-progress', 'In Progress', 20),
  ('completed',   'Completed',   30),
  ('rejected',    'Rejected',    40),
  ('withdrawn',   'Withdrawn',   50)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'foi-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('foi_request', 'status_code', 'foi-status-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0028_valueset_correction_status.sql
-- ============================================================

-- Revelation SRS — Correction Case Status Value Set
-- Migration: 0028_valueset_correction_status
--
-- Adds the correction-case-status-code value set and field mapping so the
-- status picklist in the corrections/appeals UI is database-driven rather
-- than hardcoded.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('correction-case-status-code', 'Correction Case Status', 'srs-internal', NULL,
        'Lifecycle status of a correction or appeal case (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('open',          'Open',          10),
  ('under-review',  'Under Review',  20),
  ('upheld',        'Upheld',        30),
  ('not-upheld',    'Not Upheld',    40),
  ('withdrawn',     'Withdrawn',     50)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'correction-case-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('correction_case', 'case_status_code', 'correction-case-status-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0029_valueset_activefrom_nullable.sql
-- ============================================================

-- Revelation SRS — Make value_set_member.active_from nullable
-- Migration: 0029_valueset_activefrom_nullable
--
-- Bitemporal alignment: NULL active_from means "valid from the beginning of
-- time" (open-ended start), consistent with NULL active_to meaning "valid
-- forever" (open-ended end).  Previously active_from was NOT NULL defaultNow(),
-- which forced every member to record the insert timestamp as a lower bound —
-- semantically incorrect for platform-seeded codes that have always been valid.
--
-- Changes:
--   1. Drop the NOT NULL constraint and default from active_from.
--   2. Set active_from = NULL for all platform-managed members (tenant_id IS NULL)
--      because these codes are definitionally valid from the beginning.
--   3. Tenant-owned members retain their existing timestamp (they were explicitly
--      created at a known point in time; NULL would misrepresent their provenance).

ALTER TABLE "value_set_member"
  ALTER COLUMN "active_from" DROP NOT NULL,
  ALTER COLUMN "active_from" DROP DEFAULT;

UPDATE "value_set_member"
SET    "active_from" = NULL
WHERE  "tenant_id" IS NULL;


-- ============================================================
-- Originally: 0030_seed_nationality_domicile.sql
-- ============================================================

-- ── Nationality & Domicile value-set members (ISO 3166-1 alpha-3) ────────────
-- Seeds the subset of ISO 3166-1 alpha-3 country codes used by demo data.
-- The hesa-nationality-code and hesa-domicile-code sets were defined in
-- 0001_seed_value_sets.sql but left empty; validation requires members to exist.

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'ISO 3166-1 alpha-3')
FROM "value_set" vs,
(VALUES
  ('AUS', 'Australia',            50),
  ('CAN', 'Canada',               70),
  ('CHN', 'China',                80),
  ('DEU', 'Germany',             100),
  ('ESP', 'Spain',               110),
  ('FRA', 'France',              120),
  ('GBR', 'United Kingdom',      130),
  ('IND', 'India',               140),
  ('IRL', 'Ireland',             145),
  ('ITA', 'Italy',               150),
  ('JPN', 'Japan',               160),
  ('NGA', 'Nigeria',             200),
  ('NLD', 'Netherlands',         210),
  ('NZL', 'New Zealand',         220),
  ('PAK', 'Pakistan',            230),
  ('POL', 'Poland',              240),
  ('PRT', 'Portugal',            250),
  ('USA', 'United States',       310),
  ('ZZZ', 'Not known',           999)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-nationality-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'ISO 3166-1 alpha-3')
FROM "value_set" vs,
(VALUES
  ('AUS', 'Australia',            50),
  ('CAN', 'Canada',               70),
  ('CHN', 'China',                80),
  ('DEU', 'Germany',             100),
  ('ESP', 'Spain',               110),
  ('FRA', 'France',              120),
  ('GBR', 'United Kingdom',      130),
  ('IND', 'India',               140),
  ('IRL', 'Ireland',             145),
  ('ITA', 'Italy',               150),
  ('JPN', 'Japan',               160),
  ('NGA', 'Nigeria',             200),
  ('NLD', 'Netherlands',         210),
  ('NZL', 'New Zealand',         220),
  ('PAK', 'Pakistan',            230),
  ('POL', 'Poland',              240),
  ('PRT', 'Portugal',            250),
  ('USA', 'United States',       310),
  ('ZZZ', 'Not known',           999)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-domicile-code'
ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0031_person_identity_pronouns.sql
-- ============================================================

ALTER TABLE "person_identity" ADD COLUMN "preferred_pronouns" text;


-- ============================================================
-- Originally: 0032_seed_fee_band_code.sql
-- ============================================================

-- ── Fee Band Code value set ───────────────────────────────────────────────────
-- Categorises the fee-paying status of an enrolment for funding purposes.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('fee-band-code', 'Fee Band', 'srs-internal', NULL,
        'Fee-paying status of the enrolment (home, international, etc.)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('home',          'Home (UK)',        10),
  ('international', 'International',    20),
  ('overseas',      'Overseas',         30),
  ('eu',            'EU',               40),
  ('channel-islands','Channel Islands', 50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'fee-band-code'
ON CONFLICT DO NOTHING;

-- Field mapping
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('enrolment', 'fee_band_code', 'fee-band-code', NULL)
ON CONFLICT DO NOTHING;


-- ============================================================
-- Originally: 0033_disability_declaration_notes.sql
-- ============================================================

-- Add optional supporting notes to disability declarations.
ALTER TABLE "disability_declaration" ADD COLUMN "notes" text;


-- Originally 0003_engagement_and_attendance.sql

-- ============================================================
-- Originally: 0037_engagement_intervention.sql
-- ============================================================

-- Revelation SRS — Attendance and Academic Engagement Aggregate
-- Migration: 0037_engagement_intervention
-- Implements the generic Increment B storage baseline for BP-027/BP-028.

CREATE TABLE "engagement_policy_version" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "policy_code" text NOT NULL,
  "version_number" integer NOT NULL,
  "display_name" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'draft',
  "applicability" jsonb NOT NULL DEFAULT '{}',
  "evidence_window" jsonb NOT NULL DEFAULT '{}',
  "alert_rules" jsonb NOT NULL DEFAULT '{}',
  "review_deadline" jsonb NOT NULL DEFAULT '{}',
  "approved_by" text,
  "approved_at" timestamptz,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_policy_version_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_policy_version_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_policy_version_number_positive" CHECK (version_number > 0),
  CONSTRAINT "engagement_policy_version_approval_consistent" CHECK (
    (status_code = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status_code <> 'approved'
  )
);

CREATE TABLE "expected_engagement_event" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "activity_type_code" text NOT NULL,
  "activity_reference" text,
  "event_mode_code" text NOT NULL,
  "scheduled_from" timestamptz NOT NULL,
  "scheduled_to" timestamptz,
  "location_reference" text,
  "source_system_code" text NOT NULL,
  "source_event_id" text NOT NULL,
  "source_version" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'expected',
  "actor_id" text NOT NULL DEFAULT 'system',
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "expected_engagement_event_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "expected_engagement_event_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "expected_engagement_event_schedule_check" CHECK (scheduled_to IS NULL OR scheduled_to > scheduled_from)
);

CREATE TABLE "engagement_observation" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "expected_event_id" uuid,
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "source_system_code" text NOT NULL,
  "source_event_id" text NOT NULL,
  "source_version" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "capture_method_code" text NOT NULL,
  "outcome_code" text NOT NULL,
  "data_quality_code" text NOT NULL DEFAULT 'valid',
  "event_time" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "device_reference" text,
  "operational_reference" text,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_observation_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_observation_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE TABLE "engagement_observation_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "observation_id" uuid NOT NULL,
  "superseded_version_id" uuid NOT NULL REFERENCES "engagement_observation"("version_id"),
  "replacement_version_id" uuid NOT NULL REFERENCES "engagement_observation"("version_id"),
  "correction_reason_code" text NOT NULL,
  "correction_reason" text,
  "disputed" boolean NOT NULL DEFAULT false,
  "authorised_by" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "correlation_id" uuid,
  CONSTRAINT "engagement_observation_revision_distinct_versions" CHECK (superseded_version_id <> replacement_version_id)
);

CREATE TABLE "engagement_alert" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL REFERENCES "engagement_policy_version"("version_id"),
  "evidence_window_from" timestamptz NOT NULL,
  "evidence_window_to" timestamptz NOT NULL,
  "evidence_snapshot" jsonb NOT NULL DEFAULT '{}',
  "evidence_hash" text NOT NULL,
  "explanation" jsonb NOT NULL DEFAULT '{}',
  "severity_code" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'open',
  "reevaluation_required" boolean NOT NULL DEFAULT false,
  "actor_id" text NOT NULL DEFAULT 'system',
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_alert_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_alert_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_alert_window_check" CHECK (evidence_window_to > evidence_window_from)
);

CREATE TABLE "engagement_intervention_case" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "alert_id" uuid NOT NULL,
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "status_code" text NOT NULL DEFAULT 'open',
  "outcome_code" text,
  "assigned_role_code" text,
  "assigned_actor_id" text,
  "workflow_instance_id" uuid,
  "correlation_id" uuid NOT NULL,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "review_at" timestamptz,
  "due_at" timestamptz,
  "closed_at" timestamptz,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_intervention_case_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_intervention_case_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "engagement_intervention_case_closure_check" CHECK (
    (status_code = 'closed' AND outcome_code IS NOT NULL AND closed_at IS NOT NULL)
    OR status_code <> 'closed'
  )
);

CREATE TABLE "engagement_contact_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "intervention_case_id" uuid NOT NULL,
  "channel_code" text NOT NULL,
  "attempted_at" timestamptz NOT NULL,
  "outcome_code" text NOT NULL,
  "communication_locale" text,
  "operational_note" text,
  "data_classification" text NOT NULL DEFAULT 'sensitive-personal',
  "actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "engagement_action" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "intervention_case_id" uuid NOT NULL,
  "action_type_code" text NOT NULL,
  "operational_instruction" text,
  "owner_role_code" text,
  "owner_actor_id" text,
  "due_at" timestamptz,
  "completed_at" timestamptz,
  "completed_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "engagement_action_completion_check" CHECK (
    (completed_at IS NULL AND completed_by IS NULL)
    OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)
  )
);

CREATE TABLE "engagement_referral" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "intervention_case_id" uuid NOT NULL,
  "target_service_code" text NOT NULL,
  "referral_type_code" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'pending',
  "external_reference" text,
  "integration_exchange_id" uuid,
  "correlation_id" uuid NOT NULL,
  "referred_by" text NOT NULL,
  "referred_at" timestamptz NOT NULL DEFAULT now(),
  "acknowledged_at" timestamptz
);

-- Bitemporal uniqueness and source/idempotency invariants.
CREATE UNIQUE INDEX "engagement_policy_version_unique_logical_transaction"
  ON "engagement_policy_version" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_policy_version_current_version_unique"
  ON "engagement_policy_version" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_policy_version_code_number_unique"
  ON "engagement_policy_version" ("tenant_id", "policy_code", "version_number");

CREATE UNIQUE INDEX "expected_engagement_event_unique_logical_transaction"
  ON "expected_engagement_event" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "expected_engagement_event_current_version_unique"
  ON "expected_engagement_event" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "expected_engagement_event_source_version_unique"
  ON "expected_engagement_event" ("tenant_id", "source_system_code", "source_event_id", "source_version");
CREATE INDEX "expected_engagement_event_worklist_idx"
  ON "expected_engagement_event" ("tenant_id", "scheduled_from", "status_code");

CREATE UNIQUE INDEX "engagement_observation_unique_logical_transaction"
  ON "engagement_observation" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_observation_current_version_unique"
  ON "engagement_observation" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_observation_idempotency_unique"
  ON "engagement_observation" ("tenant_id", "source_system_code", "idempotency_key");
CREATE UNIQUE INDEX "engagement_observation_source_version_unique"
  ON "engagement_observation" ("tenant_id", "source_system_code", "source_event_id", "source_version");
CREATE INDEX "engagement_observation_timeline_idx"
  ON "engagement_observation" ("tenant_id", "person_id", "event_time");

CREATE UNIQUE INDEX "engagement_observation_revision_replacement_unique"
  ON "engagement_observation_revision" ("tenant_id", "replacement_version_id");

CREATE UNIQUE INDEX "engagement_alert_unique_logical_transaction"
  ON "engagement_alert" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_alert_current_version_unique"
  ON "engagement_alert" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_alert_evaluation_unique"
  ON "engagement_alert" ("tenant_id", "person_id", "policy_version_id", "evidence_window_from", "evidence_window_to", "evidence_hash")
  WHERE "recorded_until" IS NULL;
CREATE INDEX "engagement_alert_queue_idx"
  ON "engagement_alert" ("tenant_id", "status_code", "severity_code", "evidence_window_to");

CREATE UNIQUE INDEX "engagement_intervention_case_unique_logical_transaction"
  ON "engagement_intervention_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_intervention_case_current_version_unique"
  ON "engagement_intervention_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE UNIQUE INDEX "engagement_intervention_case_open_alert_unique"
  ON "engagement_intervention_case" ("tenant_id", "alert_id")
  WHERE "recorded_until" IS NULL AND "status_code" <> 'closed';
CREATE INDEX "engagement_intervention_case_worklist_idx"
  ON "engagement_intervention_case" ("tenant_id", "status_code", "assigned_actor_id", "due_at");

CREATE INDEX "engagement_contact_attempt_case_idx"
  ON "engagement_contact_attempt" ("tenant_id", "intervention_case_id", "attempted_at");
CREATE INDEX "engagement_action_case_idx"
  ON "engagement_action" ("tenant_id", "intervention_case_id", "due_at");
CREATE INDEX "engagement_referral_case_idx"
  ON "engagement_referral" ("tenant_id", "intervention_case_id", "status_code");

-- Observation history is correction-only: a current version may be closed by
-- the bitemporal update transaction, but closed versions cannot be changed and
-- neither observations nor their revision ledger can be deleted.
CREATE FUNCTION engagement_protect_observation_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'engagement observation history is append-only';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'closed engagement observation versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_observation_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_observation"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_observation_history();

CREATE FUNCTION engagement_protect_revision_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement observation revisions are append-only';
END;
$$;

CREATE TRIGGER engagement_observation_revision_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_observation_revision"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_revision_history();

-- Every engagement table is tenant-owned and protected at the database boundary.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'engagement_policy_version',
    'expected_engagement_event',
    'engagement_observation',
    'engagement_observation_revision',
    'engagement_alert',
    'engagement_intervention_case',
    'engagement_contact_attempt',
    'engagement_action',
    'engagement_referral'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', table_name);
  END LOOP;
END $$;

-- Generic product value sets. Tenant extensibility is deliberately limited to
-- activity, mode and capture method; lifecycle/control semantics are stable.
INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('engagement-activity-type-code', 'Engagement Activity Type', 'srs-internal', 'Expected or recognised academic activity', true),
  ('engagement-event-mode-code', 'Engagement Event Mode', 'srs-internal', 'Mode in which an engagement event occurs', true),
  ('engagement-observation-outcome-code', 'Engagement Observation Outcome', 'srs-internal', 'Normalised source observation outcome', false),
  ('engagement-capture-method-code', 'Engagement Capture Method', 'srs-internal', 'Method used to capture an observation', true),
  ('engagement-data-quality-code', 'Engagement Data Quality', 'srs-internal', 'Quality and reconciliation state of an observation', false),
  ('engagement-alert-status-code', 'Engagement Alert Status', 'srs-internal', 'Lifecycle of an explainable non-engagement alert', false),
  ('engagement-case-status-code', 'Engagement Case Status', 'srs-internal', 'Lifecycle of an intervention case', false),
  ('engagement-case-outcome-code', 'Engagement Case Outcome', 'srs-internal', 'Authorised intervention case outcome', false),
  ('engagement-referral-status-code', 'Engagement Referral Status', 'srs-internal', 'Delivery and reconciliation state of a referral', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('engagement-activity-type-code', 'lecture', 'Lecture', 10),
  ('engagement-activity-type-code', 'seminar-tutorial', 'Seminar or tutorial', 20),
  ('engagement-activity-type-code', 'laboratory-practical', 'Laboratory or practical', 30),
  ('engagement-activity-type-code', 'assessment', 'Assessment', 40),
  ('engagement-activity-type-code', 'research-supervision', 'Research supervision', 50),
  ('engagement-activity-type-code', 'research-fieldwork', 'Research fieldwork', 60),
  ('engagement-activity-type-code', 'placement', 'Placement', 70),
  ('engagement-activity-type-code', 'online-activity', 'Online activity', 80),
  ('engagement-activity-type-code', 'other-recognised', 'Other recognised activity', 90),
  ('engagement-event-mode-code', 'in-person', 'In person', 10),
  ('engagement-event-mode-code', 'remote-live', 'Remote live', 20),
  ('engagement-event-mode-code', 'asynchronous', 'Asynchronous', 30),
  ('engagement-event-mode-code', 'hybrid', 'Hybrid', 40),
  ('engagement-event-mode-code', 'off-campus', 'Off campus', 50),
  ('engagement-observation-outcome-code', 'attended', 'Attended', 10),
  ('engagement-observation-outcome-code', 'absent', 'Absent', 20),
  ('engagement-observation-outcome-code', 'authorised-absence', 'Authorised absence', 30),
  ('engagement-observation-outcome-code', 'partial', 'Partial engagement', 40),
  ('engagement-observation-outcome-code', 'alternative-engagement', 'Alternative engagement', 50),
  ('engagement-observation-outcome-code', 'cancelled', 'Cancelled', 60),
  ('engagement-observation-outcome-code', 'not-captured', 'Not captured', 70),
  ('engagement-capture-method-code', 'staff-entry', 'Staff entry', 10),
  ('engagement-capture-method-code', 'student-check-in', 'Student check-in', 20),
  ('engagement-capture-method-code', 'device-scan', 'Device scan', 30),
  ('engagement-capture-method-code', 'vle-activity', 'VLE activity', 40),
  ('engagement-capture-method-code', 'assessment-submission', 'Assessment submission', 50),
  ('engagement-capture-method-code', 'source-import', 'Source import', 60),
  ('engagement-capture-method-code', 'specialist-confirmation', 'Specialist confirmation', 70),
  ('engagement-data-quality-code', 'valid', 'Valid', 10),
  ('engagement-data-quality-code', 'missing', 'Missing', 20),
  ('engagement-data-quality-code', 'duplicate', 'Duplicate', 30),
  ('engagement-data-quality-code', 'disputed', 'Disputed', 40),
  ('engagement-data-quality-code', 'conflicting', 'Conflicting', 50),
  ('engagement-data-quality-code', 'quarantined', 'Quarantined', 60),
  ('engagement-data-quality-code', 'corrected', 'Corrected', 70),
  ('engagement-alert-status-code', 'open', 'Open', 10),
  ('engagement-alert-status-code', 'suspended-reconciliation', 'Suspended for reconciliation', 20),
  ('engagement-alert-status-code', 'triaged-no-action', 'Triaged — no action', 30),
  ('engagement-alert-status-code', 'intervention-opened', 'Intervention opened', 40),
  ('engagement-alert-status-code', 'superseded', 'Superseded', 50),
  ('engagement-alert-status-code', 'closed', 'Closed', 60),
  ('engagement-case-status-code', 'open', 'Open', 10),
  ('engagement-case-status-code', 'contact-in-progress', 'Contact in progress', 20),
  ('engagement-case-status-code', 'review-due', 'Review due', 30),
  ('engagement-case-status-code', 'referred', 'Referred', 40),
  ('engagement-case-status-code', 'closed', 'Closed', 50),
  ('engagement-case-outcome-code', 'data-corrected', 'Data corrected', 10),
  ('engagement-case-outcome-code', 'no-concern', 'No concern', 20),
  ('engagement-case-outcome-code', 'engagement-restored', 'Engagement restored', 30),
  ('engagement-case-outcome-code', 'support-continuing', 'Support continuing', 40),
  ('engagement-case-outcome-code', 'no-response', 'No response', 50),
  ('engagement-case-outcome-code', 'referred-wellbeing', 'Referred to wellbeing', 60),
  ('engagement-case-outcome-code', 'referred-safeguarding', 'Referred to safeguarding', 70),
  ('engagement-case-outcome-code', 'referred-academic-status', 'Referred for academic-status review', 80),
  ('engagement-case-outcome-code', 'referred-sponsor-compliance', 'Referred for sponsor-compliance review', 90),
  ('engagement-referral-status-code', 'pending', 'Pending', 10),
  ('engagement-referral-status-code', 'acknowledged', 'Acknowledged', 20),
  ('engagement-referral-status-code', 'rejected', 'Rejected', 30),
  ('engagement-referral-status-code', 'reconciled', 'Reconciled', 40),
  ('engagement-referral-status-code', 'cancelled', 'Cancelled', 50)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('expected_engagement_event', 'activity_type_code', 'engagement-activity-type-code'),
  ('expected_engagement_event', 'event_mode_code', 'engagement-event-mode-code'),
  ('engagement_observation', 'capture_method_code', 'engagement-capture-method-code'),
  ('engagement_observation', 'outcome_code', 'engagement-observation-outcome-code'),
  ('engagement_observation', 'data_quality_code', 'engagement-data-quality-code'),
  ('engagement_alert', 'status_code', 'engagement-alert-status-code'),
  ('engagement_intervention_case', 'status_code', 'engagement-case-status-code'),
  ('engagement_intervention_case', 'outcome_code', 'engagement-case-outcome-code'),
  ('engagement_referral', 'status_code', 'engagement-referral-status-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0038_engagement_policy_alert_immutability.sql
-- ============================================================

-- Increment D: policy definitions and alert evidence are immutable authorities.
-- Lifecycle changes close the current alert version and append a replacement.

CREATE FUNCTION engagement_protect_policy_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement policy versions are immutable; create a new version';
END;
$$;

CREATE TRIGGER engagement_policy_version_immutability_guard
  BEFORE UPDATE OR DELETE ON "engagement_policy_version"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_policy_version();

CREATE FUNCTION engagement_protect_alert_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'engagement alert history is append-only';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'closed engagement alert versions are immutable';
  END IF;
  IF NEW.policy_version_id <> OLD.policy_version_id
    OR NEW.evidence_window_from <> OLD.evidence_window_from
    OR NEW.evidence_window_to <> OLD.evidence_window_to
    OR NEW.evidence_snapshot <> OLD.evidence_snapshot
    OR NEW.evidence_hash <> OLD.evidence_hash
    OR NEW.explanation <> OLD.explanation
  THEN
    RAISE EXCEPTION 'engagement alert evidence and explanation are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_alert_evidence_immutability_guard
  BEFORE UPDATE OR DELETE ON "engagement_alert"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_alert_evidence();


-- ============================================================
-- Originally: 0039_engagement_intervention_idempotency.sql
-- ============================================================

-- Increment E: durable idempotency and append-only intervention evidence.

ALTER TABLE "engagement_intervention_case" ADD COLUMN "idempotency_key" text;
ALTER TABLE "engagement_contact_attempt" ADD COLUMN "idempotency_key" text;
ALTER TABLE "engagement_action" ADD COLUMN "idempotency_key" text;
ALTER TABLE "engagement_referral" ADD COLUMN "idempotency_key" text;

ALTER TABLE "engagement_contact_attempt" ALTER COLUMN "idempotency_key" SET NOT NULL;
ALTER TABLE "engagement_action" ALTER COLUMN "idempotency_key" SET NOT NULL;
ALTER TABLE "engagement_referral" ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE UNIQUE INDEX "engagement_case_idempotency_unique"
  ON "engagement_intervention_case" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "engagement_contact_idempotency_unique"
  ON "engagement_contact_attempt" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "engagement_action_idempotency_unique"
  ON "engagement_action" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "engagement_referral_idempotency_unique"
  ON "engagement_referral" ("tenant_id", "idempotency_key");

CREATE FUNCTION engagement_protect_case_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'engagement intervention history is append-only';
  END IF;
  IF OLD.recorded_until IS NOT NULL THEN
    RAISE EXCEPTION 'closed engagement intervention versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER engagement_case_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_intervention_case"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_case_history();

CREATE FUNCTION engagement_protect_case_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'engagement case evidence is append-only';
END;
$$;
CREATE TRIGGER engagement_contact_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_contact_attempt"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_case_evidence();
CREATE TRIGGER engagement_referral_history_guard
  BEFORE UPDATE OR DELETE ON "engagement_referral"
  FOR EACH ROW EXECUTE FUNCTION engagement_protect_case_evidence();


-- ============================================================
-- Originally: 0040_ukvi_engagement_decision_boundary.sql
-- ============================================================

-- Increment G: governed engagement evidence and Student sponsor decision boundary.

CREATE TABLE "ukvi_engagement_evidence_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "engagement_alert_id" uuid NOT NULL,
  "policy_version_id" uuid NOT NULL,
  "evidence_window_from" timestamptz NOT NULL,
  "evidence_window_to" timestamptz NOT NULL,
  "evidence_summary" jsonb NOT NULL,
  "evidence_hash" text NOT NULL,
  "evidence_quality_code" text NOT NULL,
  "source_recorded_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL,
  CONSTRAINT "ukvi_engagement_snapshot_window_check" CHECK ("evidence_window_to" > "evidence_window_from"),
  CONSTRAINT "ukvi_engagement_snapshot_quality_check" CHECK (
    "evidence_quality_code" IN ('verified', 'reconciliation-required')
  ),
  UNIQUE ("tenant_id", "engagement_alert_id", "evidence_hash")
);

CREATE TABLE "ukvi_sponsor_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "evidence_snapshot_id" uuid NOT NULL REFERENCES "ukvi_engagement_evidence_snapshot"("id"),
  "outcome_code" text NOT NULL,
  "rationale_code" text NOT NULL,
  "guidance_version" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'pending-authorisation',
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "decided_by" text NOT NULL,
  "authorised_at" timestamptz,
  "authorised_by" text,
  "external_report_id" uuid REFERENCES "ukvi_attendance_report"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ukvi_sponsor_decision_outcome_check" CHECK (
    "outcome_code" IN ('report', 'no-report', 'further-review')
  ),
  CONSTRAINT "ukvi_sponsor_decision_status_check" CHECK (
    "status_code" IN ('pending-authorisation', 'authorised')
  ),
  CONSTRAINT "ukvi_sponsor_decision_authorisation_check" CHECK (
    ("status_code" = 'pending-authorisation' AND "authorised_at" IS NULL AND "authorised_by" IS NULL)
    OR
    ("status_code" = 'authorised' AND "authorised_at" IS NOT NULL AND "authorised_by" IS NOT NULL
      AND "authorised_by" <> "decided_by")
  ),
  UNIQUE ("tenant_id", "evidence_snapshot_id")
);

ALTER TABLE "ukvi_engagement_evidence_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ukvi_sponsor_decision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ukvi_engagement_snapshot_tenant_isolation" ON "ukvi_engagement_evidence_snapshot"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY "ukvi_sponsor_decision_tenant_isolation" ON "ukvi_sponsor_decision"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

CREATE FUNCTION ukvi_protect_governed_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'UKVI governed evidence and decisions are append-only';
END;
$$;
CREATE TRIGGER ukvi_engagement_snapshot_history_guard
  BEFORE UPDATE OR DELETE ON "ukvi_engagement_evidence_snapshot"
  FOR EACH ROW EXECUTE FUNCTION ukvi_protect_governed_evidence();
CREATE TRIGGER ukvi_sponsor_decision_delete_guard
  BEFORE DELETE ON "ukvi_sponsor_decision"
  FOR EACH ROW EXECUTE FUNCTION ukvi_protect_governed_evidence();

CREATE FUNCTION ukvi_protect_sponsor_decision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status_code <> 'pending-authorisation'
     OR NEW.status_code <> 'authorised'
     OR NEW.outcome_code <> OLD.outcome_code
     OR NEW.rationale_code <> OLD.rationale_code
     OR NEW.guidance_version <> OLD.guidance_version
     OR NEW.evidence_snapshot_id <> OLD.evidence_snapshot_id
     OR NEW.decided_by <> OLD.decided_by
     OR NEW.decided_at <> OLD.decided_at THEN
    RAISE EXCEPTION 'UKVI sponsor decision content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ukvi_sponsor_decision_update_guard
  BEFORE UPDATE ON "ukvi_sponsor_decision"
  FOR EACH ROW EXECUTE FUNCTION ukvi_protect_sponsor_decision();


-- ============================================================
-- Originally: 0041_engagement_outcome.sql
-- ============================================================

-- Revelation SRS — Engagement Outcome (Stage 1 attendance-module extraction)
-- Migration: 0041_engagement_outcome
--
-- Core-owned, bitemporal record of the operational outcome produced by the
-- attendance module's evidence, policy evaluation, and intervention casework.
-- The attendance module never writes to SRS tables directly; it calls
-- POST /api/v1/students/:personId/engagement-outcomes, and this table is the
-- authoritative record of that handoff, mirroring the existing
-- reasonable_adjustment / F063 pattern.

CREATE TABLE "engagement_outcome" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "module_registration_id" uuid,
  "outcome_code" text NOT NULL,
  "severity_code" text,
  "source_alert_id" text,
  "source_module" text NOT NULL DEFAULT 'attendance',
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz,
  CONSTRAINT "engagement_outcome_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "engagement_outcome_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX "engagement_outcome_unique_logical_transaction"
  ON "engagement_outcome" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "engagement_outcome_current_version_unique"
  ON "engagement_outcome" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "engagement_outcome_person_idx"
  ON "engagement_outcome" ("tenant_id", "person_id");
CREATE INDEX "engagement_outcome_module_registration_idx"
  ON "engagement_outcome" ("tenant_id", "module_registration_id");

-- Idempotency for the F063-style handoff: sourceAlertId + outcomeCode
-- identifies a single logical submission from the attendance module so the
-- X-Idempotency-Key check can detect a repeat delivery cheaply.
CREATE UNIQUE INDEX "engagement_outcome_source_alert_unique"
  ON "engagement_outcome" ("tenant_id", "source_alert_id", "outcome_code")
  WHERE "source_alert_id" IS NOT NULL AND "recorded_until" IS NULL;

ALTER TABLE "engagement_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "engagement_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('engagement-outcome-code', 'Engagement Outcome', 'srs-internal', 'Recorded operational outcome of attendance-module casework', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('engagement-outcome-code', 'at-risk', 'At risk', 10),
  ('engagement-outcome-code', 'non-engagement', 'Non-engagement', 20),
  ('engagement-outcome-code', 'engagement-restored', 'Engagement restored', 30),
  ('engagement-outcome-code', 'no-concern', 'No concern', 40),
  ('engagement-outcome-code', 'support-continuing', 'Support continuing', 50),
  ('engagement-outcome-code', 'referred-wellbeing', 'Referred to wellbeing', 60),
  ('engagement-outcome-code', 'referred-safeguarding', 'Referred to safeguarding', 70),
  ('engagement-outcome-code', 'referred-academic-status', 'Referred for academic-status review', 80),
  ('engagement-outcome-code', 'referred-sponsor-compliance', 'Referred for sponsor-compliance review', 90),
  ('engagement-outcome-code', 'data-corrected', 'Data corrected', 100),
  ('engagement-outcome-code', 'no-response', 'No response', 110)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('engagement_outcome', 'outcome_code', 'engagement-outcome-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0042_engagement_extraction_cutover.sql
-- ============================================================

-- Revelation SRS — Attendance/Engagement extraction cutover
-- Migration: 0042_engagement_extraction_cutover
--
-- Completes the Stage 1 extraction of attendance/engagement capture into the
-- standalone `modules/attendance` module, which recreates these 9 tables in
-- a separate "attendance" Postgres schema on the same physical database
-- instance (see modules/attendance/migrations/0001_attendance_initial.sql).
--
-- Every copy below uses an explicit, named column list on both sides —
-- required because idempotency_key was appended to four tables via
-- ALTER TABLE ADD COLUMN in migration 0039 (so it sits at the physical end
-- of the old public tables) while the module's schema places it in logical
-- column order instead; positional `SELECT *` would silently misalign
-- columns for those tables.
--
-- DEPLOYMENT PRECONDITION: the attendance module's own migration (creating
-- the "attendance" schema and its tables) MUST be applied to this database
-- before this migration runs, or any existing engagement rows in `public`
-- will be dropped without being copied. The copy step below is defensive —
-- it no-ops (with a NOTICE) if the "attendance" schema is not yet present,
-- but it does NOT block the subsequent DROP. Operators upgrading a
-- deployment that already captured real engagement data must run the
-- module's migration first.

DO $$
BEGIN
  IF to_regclass('attendance.expected_engagement_event') IS NOT NULL THEN

    INSERT INTO attendance.engagement_policy_version (
      version_id, id, tenant_id, policy_code, version_number, display_name, status_code,
      applicability, evidence_window, alert_rules, review_deadline, approved_by, approved_at,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, policy_code, version_number, display_name, status_code,
      applicability, evidence_window, alert_rules, review_deadline, approved_by, approved_at,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_policy_version
    ON CONFLICT DO NOTHING;

    -- module_registration_id is new in the attendance schema; NULL for all
    -- copied rows (real linkage only exists for newly created events).
    INSERT INTO attendance.expected_engagement_event (
      version_id, id, tenant_id, person_id, enrolment_id, module_registration_id,
      activity_type_code, activity_reference, event_mode_code, scheduled_from, scheduled_to,
      location_reference, source_system_code, source_event_id, source_version, status_code,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, person_id, enrolment_id, NULL,
      activity_type_code, activity_reference, event_mode_code, scheduled_from, scheduled_to,
      location_reference, source_system_code, source_event_id, source_version, status_code,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.expected_engagement_event
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_observation (
      version_id, id, tenant_id, expected_event_id, person_id, enrolment_id, source_system_code,
      source_event_id, source_version, idempotency_key, capture_method_code, outcome_code,
      data_quality_code, event_time, received_at, device_reference, operational_reference,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, expected_event_id, person_id, enrolment_id, source_system_code,
      source_event_id, source_version, idempotency_key, capture_method_code, outcome_code,
      data_quality_code, event_time, received_at, device_reference, operational_reference,
      actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_observation
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_observation_revision (
      id, tenant_id, observation_id, superseded_version_id, replacement_version_id,
      correction_reason_code, correction_reason, disputed, authorised_by, recorded_at, correlation_id
    )
    SELECT
      id, tenant_id, observation_id, superseded_version_id, replacement_version_id,
      correction_reason_code, correction_reason, disputed, authorised_by, recorded_at, correlation_id
    FROM public.engagement_observation_revision
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_alert (
      version_id, id, tenant_id, person_id, enrolment_id, policy_version_id, evidence_window_from,
      evidence_window_to, evidence_snapshot, evidence_hash, explanation, severity_code, status_code,
      reevaluation_required, actor_id, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, person_id, enrolment_id, policy_version_id, evidence_window_from,
      evidence_window_to, evidence_snapshot, evidence_hash, explanation, severity_code, status_code,
      reevaluation_required, actor_id, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_alert
    ON CONFLICT DO NOTHING;

    -- idempotency_key was appended via ALTER TABLE (migration 0039) on the
    -- following four tables — named columns on both sides, not SELECT *.
    INSERT INTO attendance.engagement_intervention_case (
      version_id, id, tenant_id, alert_id, person_id, enrolment_id, status_code, outcome_code,
      assigned_role_code, assigned_actor_id, workflow_instance_id, correlation_id, opened_at,
      review_at, due_at, closed_at, actor_id, idempotency_key, valid_from, valid_to, recorded_at, recorded_until
    )
    SELECT
      version_id, id, tenant_id, alert_id, person_id, enrolment_id, status_code, outcome_code,
      assigned_role_code, assigned_actor_id, workflow_instance_id, correlation_id, opened_at,
      review_at, due_at, closed_at, actor_id, idempotency_key, valid_from, valid_to, recorded_at, recorded_until
    FROM public.engagement_intervention_case
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_contact_attempt (
      id, tenant_id, intervention_case_id, channel_code, attempted_at, outcome_code,
      communication_locale, operational_note, data_classification, actor_id, idempotency_key, created_at
    )
    SELECT
      id, tenant_id, intervention_case_id, channel_code, attempted_at, outcome_code,
      communication_locale, operational_note, data_classification, actor_id, idempotency_key, created_at
    FROM public.engagement_contact_attempt
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_action (
      id, tenant_id, intervention_case_id, action_type_code, operational_instruction, owner_role_code,
      owner_actor_id, due_at, completed_at, completed_by, created_by, idempotency_key, created_at
    )
    SELECT
      id, tenant_id, intervention_case_id, action_type_code, operational_instruction, owner_role_code,
      owner_actor_id, due_at, completed_at, completed_by, created_by, idempotency_key, created_at
    FROM public.engagement_action
    ON CONFLICT DO NOTHING;

    INSERT INTO attendance.engagement_referral (
      id, tenant_id, intervention_case_id, target_service_code, referral_type_code, status_code,
      external_reference, integration_exchange_id, correlation_id, referred_by, referred_at,
      acknowledged_at, idempotency_key
    )
    SELECT
      id, tenant_id, intervention_case_id, target_service_code, referral_type_code, status_code,
      external_reference, integration_exchange_id, correlation_id, referred_by, referred_at,
      acknowledged_at, idempotency_key
    FROM public.engagement_referral
    ON CONFLICT DO NOTHING;

  ELSE
    RAISE NOTICE 'attendance schema not found — skipping engagement data copy; run modules/attendance migrate first if this database holds real engagement data';
  END IF;
END $$;

-- Retire the core copies. Core no longer owns attendance/engagement capture;
-- apps/api/src/platform/engagement/* and apps/api/src/routes/engagement*.ts
-- have been removed, and core only retains the `engagement_outcome` table
-- (migration 0041) as the authoritative record of the operational outcome
-- handed off by the attendance module.
DROP TABLE IF EXISTS "engagement_observation_revision";
DROP TABLE IF EXISTS "engagement_contact_attempt";
DROP TABLE IF EXISTS "engagement_action";
DROP TABLE IF EXISTS "engagement_referral";
DROP TABLE IF EXISTS "engagement_intervention_case";
DROP TABLE IF EXISTS "engagement_alert";
DROP TABLE IF EXISTS "engagement_observation";
DROP TABLE IF EXISTS "expected_engagement_event";
DROP TABLE IF EXISTS "engagement_policy_version";

DROP FUNCTION IF EXISTS engagement_protect_observation_history() CASCADE;
DROP FUNCTION IF EXISTS engagement_protect_revision_history() CASCADE;

-- These value sets now belong to the attendance module's own configuration
-- surface, not core's. Field-value-set bindings referenced the dropped
-- tables and must go with them; the value sets themselves are left in place
-- (harmless, and any institution-added extensions are preserved) but no
-- longer bound to any core entity.
DELETE FROM "field_value_set" WHERE "entity_name" IN (
  'expected_engagement_event', 'engagement_observation', 'engagement_alert', 'engagement_intervention_case'
);


-- ============================================================
-- Originally: 0043_engagement_outcome_sponsor_evidence.sql
-- ============================================================

-- Revelation SRS — Engagement outcome sponsor-compliance evidence fields
-- Migration: 0043_engagement_outcome_sponsor_evidence
--
-- The UKVI sponsor-compliance evidence-snapshot flow
-- (apps/api/src/platform/regulatory/ukvi-service.ts:createEngagementEvidenceSnapshot)
-- used to join core's own engagement_alert/engagement_intervention_case/
-- engagement_referral tables directly. Those tables moved to the attendance
-- module in migration 0042. This adds the fields the attendance module now
-- hands off via POST /students/:personId/engagement-outcomes (outcomeCode
-- 'referred-sponsor-compliance') so core can create the evidence snapshot
-- from its own authoritative record instead of a cross-schema join.

ALTER TABLE "engagement_outcome"
  ADD COLUMN "policy_version_id"      uuid,
  ADD COLUMN "evidence_window_from"   timestamptz,
  ADD COLUMN "evidence_window_to"     timestamptz,
  ADD COLUMN "evidence_snapshot"      jsonb,
  ADD COLUMN "evidence_hash"          text,
  ADD COLUMN "reevaluation_required"  boolean;


-- Originally 0004_business_process_foundations.sql

-- ============================================================
-- Originally: 0044_business_case_foundations.sql
-- ============================================================

-- Revelation SRS — Shared business-case/evidence/decision/distribution primitives
-- Migration: 0044_business_case_foundations
--
-- Stage 0 of the business-process P0 backlog (docs/business-processes/
-- revelation-change-backlog.md, docs/architecture/business-process-target-data-model.md
-- "Shared primitives"). Every later P0 domain migration (CAS, support outcome,
-- assessment moderation, board authority, correction, regulatory, identity,
-- rights, audit) builds on these seven tables. Purely additive: no existing
-- table is altered or dropped.

CREATE TABLE "business_case" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "process_id" text NOT NULL,
  "status_code" text NOT NULL,
  "owner_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "business_case_unique_logical_transaction"
  ON "business_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "business_case_current_version_unique"
  ON "business_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "business_case_subject_idx"
  ON "business_case" ("tenant_id", "subject_type", "subject_id");
CREATE INDEX "business_case_process_idx"
  ON "business_case" ("tenant_id", "process_id");

ALTER TABLE "business_case"
  ADD CONSTRAINT "business_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "business_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "business_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "case_evidence_reference" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "evidence_ref" text NOT NULL,
  "classification_code" text NOT NULL,
  "source_system" text NOT NULL,
  "source_reference" text,
  "content_hash" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "received_by" text NOT NULL
);

CREATE INDEX "case_evidence_reference_case_idx"
  ON "case_evidence_reference" ("tenant_id", "business_case_id");

ALTER TABLE "case_evidence_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_evidence_reference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_evidence_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "case_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "decision_type_code" text NOT NULL,
  "authority_actor_id" text NOT NULL,
  "policy_version" text,
  "reason_code" text,
  "reason_text" text,
  "effective_at" timestamptz NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "case_decision_case_idx"
  ON "case_decision" ("tenant_id", "business_case_id");

ALTER TABLE "case_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "source_version_reference" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_decision_id" uuid,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "version_id" uuid NOT NULL,
  "purpose_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "source_version_reference_decision_idx"
  ON "source_version_reference" ("tenant_id", "case_decision_id");
CREATE INDEX "source_version_reference_entity_idx"
  ON "source_version_reference" ("tenant_id", "entity_type", "entity_id");

ALTER TABLE "source_version_reference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_version_reference" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "source_version_reference"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "distribution_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "source_decision_id" uuid,
  "target_system_code" text NOT NULL,
  "content_ref" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "distribution_item_decision_idx"
  ON "distribution_item" ("tenant_id", "source_decision_id");
CREATE INDEX "distribution_item_status_idx"
  ON "distribution_item" ("tenant_id", "status_code");

ALTER TABLE "distribution_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distribution_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distribution_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "distribution_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "distribution_item_id" uuid NOT NULL,
  "attempted_at" timestamptz NOT NULL DEFAULT now(),
  "transport_code" text NOT NULL,
  "payload_hash" text,
  "response_code" text,
  "error_detail" text
);

CREATE INDEX "distribution_attempt_item_idx"
  ON "distribution_attempt" ("tenant_id", "distribution_item_id");

ALTER TABLE "distribution_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distribution_attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distribution_attempt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "distribution_acknowledgement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "distribution_item_id" uuid NOT NULL,
  "acknowledged_at" timestamptz NOT NULL DEFAULT now(),
  "result_code" text NOT NULL,
  "reconciliation_ref" text,
  "detail" jsonb
);

CREATE INDEX "distribution_acknowledgement_item_idx"
  ON "distribution_acknowledgement" ("tenant_id", "distribution_item_id");

ALTER TABLE "distribution_acknowledgement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distribution_acknowledgement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distribution_acknowledgement"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('business-case-status-code', 'Business Case Status', 'srs-internal', 'Lifecycle status of a governed business-case instance', true),
  ('case-evidence-classification-code', 'Case Evidence Classification', 'srs-internal', 'Sensitivity classification of an opaque evidence reference', false),
  ('distribution-item-status-code', 'Distribution Item Status', 'srs-internal', 'Delivery status of a durable distribution target item', false),
  ('distribution-acknowledgement-result-code', 'Distribution Acknowledgement Result', 'srs-internal', 'Outcome of a target system acknowledging a distribution item', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('business-case-status-code', 'open', 'Open', 10),
  ('business-case-status-code', 'under-review', 'Under review', 20),
  ('business-case-status-code', 'decided', 'Decided', 30),
  ('business-case-status-code', 'closed', 'Closed', 40),
  ('business-case-status-code', 'withdrawn', 'Withdrawn', 50),

  ('case-evidence-classification-code', 'restricted-case', 'Restricted case evidence', 10),
  ('case-evidence-classification-code', 'sensitive-academic', 'Sensitive academic evidence', 20),
  ('case-evidence-classification-code', 'regulatory', 'Regulatory evidence', 30),
  ('case-evidence-classification-code', 'personal', 'Personal evidence', 40),
  ('case-evidence-classification-code', 'operational', 'Operational evidence', 50),

  ('distribution-item-status-code', 'pending', 'Pending', 10),
  ('distribution-item-status-code', 'sent', 'Sent', 20),
  ('distribution-item-status-code', 'acknowledged', 'Acknowledged', 30),
  ('distribution-item-status-code', 'failed', 'Failed', 40),
  ('distribution-item-status-code', 'superseded', 'Superseded', 50),

  ('distribution-acknowledgement-result-code', 'applied', 'Applied', 10),
  ('distribution-acknowledgement-result-code', 'rejected', 'Rejected', 20),
  ('distribution-acknowledgement-result-code', 'reconciled', 'Reconciled', 30),
  ('distribution-acknowledgement-result-code', 'mismatch', 'Mismatch', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('business_case', 'status_code', 'business-case-status-code'),
  ('case_evidence_reference', 'classification_code', 'case-evidence-classification-code'),
  ('distribution_item', 'status_code', 'distribution-item-status-code'),
  ('distribution_acknowledgement', 'result_code', 'distribution-acknowledgement-result-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0045_cas_governance.sql
-- ============================================================

-- Revelation SRS — CAS governance (BPR-D03)
-- Migration: 0045_cas_governance
--
-- Stage 1 of the business-process P0 backlog. ukvi_cas_request is a
-- separate table; cas_case is a separate governed aggregate. Adds the eligibility-check,
-- assignment-version and sponsor-report-version evidence trail the legacy
-- table never captured.

CREATE TABLE "cas_case" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "cas_reference" text,
  "status_code" text NOT NULL DEFAULT 'opened',
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "cas_case_unique_logical_transaction"
  ON "cas_case" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "cas_case_current_version_unique"
  ON "cas_case" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "cas_case_enrolment_idx"
  ON "cas_case" ("tenant_id", "enrolment_id");

ALTER TABLE "cas_case"
  ADD CONSTRAINT "cas_case_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "cas_case_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "cas_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cas_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cas_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "cas_eligibility_check" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "cas_case_id" uuid NOT NULL,
  "guidance_version" text NOT NULL,
  "check_type_code" text NOT NULL,
  "result_code" text NOT NULL,
  "evidence_ref" uuid,
  "checked_by" text NOT NULL,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "cas_eligibility_check_case_idx"
  ON "cas_eligibility_check" ("tenant_id", "cas_case_id");

ALTER TABLE "cas_eligibility_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cas_eligibility_check" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cas_eligibility_check"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "cas_assignment_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "cas_case_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "assigned_payload_hash" text NOT NULL,
  "cas_number" text,
  "approved_by" text NOT NULL,
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "sms_request_sent_at" timestamptz,
  "sms_receipt_ref" text
);

CREATE UNIQUE INDEX "cas_assignment_version_case_version_unique"
  ON "cas_assignment_version" ("tenant_id", "cas_case_id", "version_number");

ALTER TABLE "cas_assignment_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cas_assignment_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cas_assignment_version"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "sponsor_report_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "cas_case_id" uuid NOT NULL,
  "report_payload_ref" text NOT NULL,
  "distribution_item_id" uuid,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" text NOT NULL
);

CREATE INDEX "sponsor_report_version_case_idx"
  ON "sponsor_report_version" ("tenant_id", "cas_case_id");

ALTER TABLE "sponsor_report_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sponsor_report_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sponsor_report_version"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('cas-case-status-code', 'CAS Case Status', 'srs-internal', 'Lifecycle status of a governed CAS case', false),
  ('cas-eligibility-check-type-code', 'CAS Eligibility Check Type', 'srs-internal', 'Type of eligibility check performed on a CAS case', true),
  ('cas-eligibility-result-code', 'CAS Eligibility Result', 'srs-internal', 'Outcome of a CAS eligibility check', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('cas-case-status-code', 'opened', 'Opened', 10),
  ('cas-case-status-code', 'eligibility-checked', 'Eligibility checked', 20),
  ('cas-case-status-code', 'assigned', 'Assigned', 30),
  ('cas-case-status-code', 'withdrawn', 'Withdrawn', 40),
  ('cas-case-status-code', 'closed', 'Closed', 50),

  ('cas-eligibility-check-type-code', 'genuine-student', 'Genuine student requirement', 10),
  ('cas-eligibility-check-type-code', 'academic-progress', 'Academic progress', 20),
  ('cas-eligibility-check-type-code', 'financial-requirement', 'Financial requirement', 30),
  ('cas-eligibility-check-type-code', 'immigration-history', 'Immigration history', 40),

  ('cas-eligibility-result-code', 'pass', 'Pass', 10),
  ('cas-eligibility-result-code', 'fail', 'Fail', 20),
  ('cas-eligibility-result-code', 'referred', 'Referred for review', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('cas_case', 'status_code', 'cas-case-status-code'),
  ('cas_eligibility_check', 'check_type_code', 'cas-eligibility-check-type-code'),
  ('cas_eligibility_check', 'result_code', 'cas-eligibility-result-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0046_support_outcome_distribution.sql
-- ============================================================

-- Revelation SRS — Support-outcome distribution (BPR-D09)
-- Migration: 0046_support_outcome_distribution
--
-- Stage 2 of the business-process P0 backlog. adjustment_distribution stays
-- as the legacy compat path. support_outcome is the new minimum-necessary
-- outcome record, optionally sourced from a business_case/case_decision
-- (migration 0044) and optionally bridged from a legacy reasonable_adjustment.
-- Per-target delivery uses the shared distribution_item primitives rather
-- than a flat status column.

CREATE TABLE "support_outcome" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "source_case_id" uuid,
  "source_decision_id" uuid,
  "outcome_type_code" text NOT NULL,
  "minimum_necessary_text" text NOT NULL,
  "visibility_scope_code" text NOT NULL,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "support_outcome_unique_logical_transaction"
  ON "support_outcome" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "support_outcome_current_version_unique"
  ON "support_outcome" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "support_outcome_enrolment_idx"
  ON "support_outcome" ("tenant_id", "enrolment_id");

ALTER TABLE "support_outcome"
  ADD CONSTRAINT "support_outcome_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "support_outcome_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "support_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('support-outcome-type-code', 'Support Outcome Type', 'srs-internal', 'Type of minimum-necessary support outcome recorded for a student', true),
  ('support-outcome-visibility-scope-code', 'Support Outcome Visibility Scope', 'srs-internal', 'Who a support outcome is visible to downstream', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('support-outcome-type-code', 'extra-time', 'Extra time', 10),
  ('support-outcome-type-code', 'separate-room', 'Separate room', 20),
  ('support-outcome-type-code', 'deadline-extension', 'Deadline extension', 30),
  ('support-outcome-type-code', 'reader', 'Reader', 40),
  ('support-outcome-type-code', 'scribe', 'Scribe', 50),
  ('support-outcome-type-code', 'rest-breaks', 'Rest breaks', 60),

  ('support-outcome-visibility-scope-code', 'module-tutor', 'Module tutor', 10),
  ('support-outcome-visibility-scope-code', 'exam-officer', 'Exam officer', 20),
  ('support-outcome-visibility-scope-code', 'programme-team', 'Programme team', 30),
  ('support-outcome-visibility-scope-code', 'all-authorised-staff', 'All authorised staff', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('support_outcome', 'outcome_type_code', 'support-outcome-type-code'),
  ('support_outcome', 'visibility_scope_code', 'support-outcome-visibility-scope-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0047_assessment_moderation.sql
-- ============================================================

-- Revelation SRS — Assessment candidate attempt & moderation (BPR-D10)
-- Migration: 0047_assessment_moderation
--
-- Stage 3 of the business-process P0 backlog. mark.attempt_number stays as
-- the legacy source column; assessment_candidate_attempt gives moderation a
-- stable attempt identity that survives a mark being superseded.

CREATE TABLE "assessment_candidate_attempt" (
  "version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "module_registration_id" uuid NOT NULL,
  "assessment_component_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "attempt_type_code" text NOT NULL,
  "created_from_mark_id" uuid,
  "actor_id" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_until" timestamptz
);

CREATE UNIQUE INDEX "assessment_candidate_attempt_unique_logical_transaction"
  ON "assessment_candidate_attempt" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX "assessment_candidate_attempt_current_version_unique"
  ON "assessment_candidate_attempt" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX "assessment_candidate_attempt_registration_idx"
  ON "assessment_candidate_attempt" ("tenant_id", "module_registration_id", "assessment_component_id");

ALTER TABLE "assessment_candidate_attempt"
  ADD CONSTRAINT "assessment_candidate_attempt_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  ADD CONSTRAINT "assessment_candidate_attempt_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

ALTER TABLE "assessment_candidate_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_candidate_attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assessment_candidate_attempt"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "mark_set" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "assessment_component_id" uuid NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" text NOT NULL,
  "source_query_hash" text NOT NULL
);

CREATE INDEX "mark_set_component_idx"
  ON "mark_set" ("tenant_id", "assessment_component_id");

ALTER TABLE "mark_set" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark_set" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mark_set"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "mark_set_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "mark_set_id" uuid NOT NULL,
  "mark_id" uuid NOT NULL,
  "candidate_attempt_id" uuid NOT NULL
);

CREATE INDEX "mark_set_member_set_idx"
  ON "mark_set_member" ("tenant_id", "mark_set_id");
CREATE UNIQUE INDEX "mark_set_member_unique"
  ON "mark_set_member" ("tenant_id", "mark_set_id", "mark_id");

ALTER TABLE "mark_set_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mark_set_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mark_set_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "moderation_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "mark_set_id" uuid NOT NULL,
  "moderator_actor_id" text NOT NULL,
  "rule_version" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "outcome_code" text
);

CREATE INDEX "moderation_review_mark_set_idx"
  ON "moderation_review" ("tenant_id", "mark_set_id");

ALTER TABLE "moderation_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moderation_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "moderation_review"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "moderation_sample" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "moderation_review_id" uuid NOT NULL,
  "mark_id" uuid NOT NULL,
  "sample_reason_code" text NOT NULL,
  "original_mark" numeric(5,2) NOT NULL,
  "moderated_mark" numeric(5,2),
  "change_reason_code" text
);

CREATE INDEX "moderation_sample_review_idx"
  ON "moderation_sample" ("tenant_id", "moderation_review_id");

ALTER TABLE "moderation_sample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "moderation_sample" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "moderation_sample"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('candidate-attempt-type-code', 'Candidate Attempt Type', 'srs-internal', 'Nature of an assessment attempt', false),
  ('moderation-outcome-code', 'Moderation Outcome', 'srs-internal', 'Outcome of a moderation review', false),
  ('moderation-sample-reason-code', 'Moderation Sample Reason', 'srs-internal', 'Reason a mark was sampled for moderation', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('candidate-attempt-type-code', 'first-sit', 'First sit', 10),
  ('candidate-attempt-type-code', 'resit', 'Resit', 20),
  ('candidate-attempt-type-code', 'repeat', 'Repeat', 30),

  ('moderation-outcome-code', 'no-change', 'No change', 10),
  ('moderation-outcome-code', 'adjusted', 'Adjusted', 20),
  ('moderation-outcome-code', 'escalated', 'Escalated', 30),

  ('moderation-sample-reason-code', 'random', 'Random sample', 10),
  ('moderation-sample-reason-code', 'boundary', 'Boundary mark', 20),
  ('moderation-sample-reason-code', 'first-marker-flag', 'First-marker flagged', 30),
  ('moderation-sample-reason-code', 'outlier', 'Statistical outlier', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('assessment_candidate_attempt', 'attempt_type_code', 'candidate-attempt-type-code'),
  ('moderation_review', 'outcome_code', 'moderation-outcome-code'),
  ('moderation_sample', 'sample_reason_code', 'moderation-sample-reason-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0048_board_authority_ratification.sql
-- ============================================================

-- Revelation SRS — Board authority & ratification (BPR-D11)
-- Migration: 0048_board_authority_ratification
--
-- Stage 4 of the business-process P0 backlog. exam_board.ratified_at and
-- quorum_count/quorum_recorded_at stay for compat. This migration adds the
-- structured decision/quorum/conflict/ratification/publication chain that
-- proves exactly which pack, rule set and quorum a ratification relied on.

ALTER TABLE "exam_board_data_pack"
  ADD COLUMN "pack_hash" text,
  ADD COLUMN "rule_manifest_ref" text;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "board_member_conflict" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "actor_id" text NOT NULL,
  "enrolment_id" uuid,
  "conflict_type_code" text NOT NULL,
  "declared_at" timestamptz NOT NULL DEFAULT now(),
  "recused_at" timestamptz
);

CREATE INDEX "board_member_conflict_board_idx"
  ON "board_member_conflict" ("tenant_id", "exam_board_id");

ALTER TABLE "board_member_conflict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_member_conflict" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_member_conflict"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "board_quorum_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "required_count" integer NOT NULL,
  "attending_count" integer NOT NULL,
  "quorum_met" boolean NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "board_quorum_decision_board_idx"
  ON "board_quorum_decision" ("tenant_id", "exam_board_id");

ALTER TABLE "board_quorum_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_quorum_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_quorum_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "exam_board_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "data_pack_id" uuid NOT NULL REFERENCES "exam_board_data_pack"("id"),
  "decision_type_code" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "rationale" text
);

CREATE INDEX "exam_board_decision_board_idx"
  ON "exam_board_decision" ("tenant_id", "exam_board_id");

ALTER TABLE "exam_board_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exam_board_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "exam_board_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ratification_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "exam_board_decision_id" uuid NOT NULL REFERENCES "exam_board_decision"("id"),
  "exam_board_id" uuid NOT NULL REFERENCES "exam_board"("id"),
  "ratified_at" timestamptz NOT NULL DEFAULT now(),
  "ratified_by" text NOT NULL
);

CREATE UNIQUE INDEX "ratification_record_decision_unique"
  ON "ratification_record" ("tenant_id", "exam_board_decision_id");

ALTER TABLE "ratification_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ratification_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ratification_record"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "result_publication" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "ratification_record_id" uuid NOT NULL REFERENCES "ratification_record"("id"),
  "status_code" text NOT NULL DEFAULT 'locked',
  "published_at" timestamptz,
  "published_by" text
);

CREATE UNIQUE INDEX "result_publication_ratification_unique"
  ON "result_publication" ("tenant_id", "ratification_record_id");

ALTER TABLE "result_publication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_publication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "result_publication"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets
--
-- Note (found during this migration): migration 0027 added an
-- 'exam-board-type-code' value set (undergraduate/postgraduate-taught/...)
-- intending to replace 'board-type-code' (module/award) as the mapping for
-- exam_board.board_type_code, but its field_value_set INSERT used
-- ON CONFLICT DO NOTHING against a mapping 0005 had already created, so it
-- silently never took effect — 'board-type-code' (module/award) remains the
-- live mapping and matches what application code actually writes.
-- 'exam-board-type-code' is orphaned data, not touched here: changing which
-- value set governs a live field is a product decision outside this
-- migration's additive scope.

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('board-conflict-type-code', 'Board Member Conflict Type', 'srs-internal', 'Type of conflict of interest declared by a board member', true),
  ('board-decision-type-code', 'Exam Board Decision Type', 'srs-internal', 'Type of decision an exam board reached', false),
  ('result-publication-status-code', 'Result Publication Status', 'srs-internal', 'Publication lifecycle status of a ratified result set', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('board-conflict-type-code', 'family', 'Family relationship', 10),
  ('board-conflict-type-code', 'supervisory', 'Supervisory relationship', 20),
  ('board-conflict-type-code', 'financial', 'Financial interest', 30),
  ('board-conflict-type-code', 'other', 'Other', 40),

  ('board-decision-type-code', 'ratify', 'Ratify', 10),
  ('board-decision-type-code', 'defer', 'Defer', 20),
  ('board-decision-type-code', 'refer-back', 'Refer back', 30),

  ('result-publication-status-code', 'locked', 'Locked', 10),
  ('result-publication-status-code', 'published', 'Published', 20),
  ('result-publication-status-code', 'withdrawn', 'Withdrawn', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('board_member_conflict', 'conflict_type_code', 'board-conflict-type-code'),
  ('exam_board_decision', 'decision_type_code', 'board-decision-type-code'),
  ('result_publication', 'status_code', 'result-publication-status-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0049_post_ratification_correction_distribution.sql
-- ============================================================

-- Revelation SRS — Post-ratification correction distribution (BPR-D13)
-- Migration: 0049_post_ratification_correction_distribution
--
-- Stage 5 of the business-process P0 backlog. Additive columns on
-- post_ratification_case (why/under what authority a correction was
-- raised) and post_ratification_amendment (exact before/after version
-- references plus a distribution_item so downstream consumers of the
-- corrected record are notified, not just the record itself).
--
-- Also fixes a value-set/field mapping bug found while working in this
-- area: migration 0005 wired post_ratification_case.status_code to value
-- set 'post-ratification-case-status-code' (members submitted/under-review/
-- upheld/dismissed/not-eligible), but CorrectionService (apps/api) has only
-- ever written open/under-review/upheld/not-upheld/withdrawn. Migration
-- 0027 added a *correct* value set ('correction-case-status-code', members
-- open/under-review/upheld/not-upheld/withdrawn matching the real code) but
-- mapped it against entity_name 'correction_case' — a table that has never
-- existed — so the fix never attached and the wrong value set stayed live.

ALTER TABLE "post_ratification_case"
  ADD COLUMN "superseded_version_id" uuid,
  ADD COLUMN "error_category_code" text,
  ADD COLUMN "evidence_ref" uuid,
  ADD COLUMN "authorised_by" text;

ALTER TABLE "post_ratification_amendment"
  ADD COLUMN "before_version_ref" uuid,
  ADD COLUMN "after_version_ref" uuid,
  ADD COLUMN "distribution_item_id" uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('correction-error-category-code', 'Correction Error Category', 'srs-internal', 'Category of error a post-ratification correction addresses', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('correction-error-category-code', 'data-entry', 'Data entry error', 10),
  ('correction-error-category-code', 'calculation', 'Calculation error', 20),
  ('correction-error-category-code', 'procedural', 'Procedural error', 30),
  ('correction-error-category-code', 'third-party', 'Third-party error', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('post_ratification_case', 'error_category_code', 'correction-error-category-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- Repoint the live mapping at the value set whose members actually match
-- what CorrectionService writes, and align the column default to match.
-- The orphaned ('correction_case', 'case_status_code') row from 0027/0028
-- is left as historical record — deleting migration-authored rows outside
-- an expand-only migration is avoided even for dead data.
UPDATE "field_value_set"
SET    "value_set_code" = 'correction-case-status-code'
WHERE  "entity_name" = 'post_ratification_case' AND "field_name" = 'status_code';

ALTER TABLE "post_ratification_case" ALTER COLUMN "status_code" SET DEFAULT 'open';


-- ============================================================
-- Originally: 0050_regulatory_collection_lineage.sql
-- ============================================================

-- Revelation SRS — Regulatory collection, lineage & devolved-nation returns (BPR-D16)
-- Migration: 0050_regulatory_collection_lineage
--
-- Stage 6 of the business-process P0 backlog. HESA/OfS keep their bespoke
-- tables and routes unchanged; regulatory_collection is a regulator-neutral
-- parent that HESA/OfS can optionally bridge into, and that SFC (Scotland),
-- Medr (Wales) and DfE-NI collections use directly rather than each getting
-- three more bespoke table sets.

CREATE TABLE "regulatory_collection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulator_code" text NOT NULL,
  "collection_type_code" text NOT NULL,
  "academic_year" text NOT NULL,
  "status_code" text NOT NULL DEFAULT 'draft',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text NOT NULL
);

CREATE INDEX "regulatory_collection_regulator_idx"
  ON "regulatory_collection" ("tenant_id", "regulator_code", "academic_year");

ALTER TABLE "regulatory_collection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_collection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_collection"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "collection_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "snapshot_version" integer NOT NULL DEFAULT 1,
  "source_transaction_time" timestamptz NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" text NOT NULL
);

CREATE INDEX "collection_snapshot_collection_idx"
  ON "collection_snapshot" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "collection_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection_snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "collection_snapshot"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "collection_snapshot_id" uuid NOT NULL REFERENCES "collection_snapshot"("id"),
  "enrolment_id" uuid,
  "record_payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "regulatory_record_snapshot_idx"
  ON "regulatory_record" ("tenant_id", "collection_snapshot_id");

ALTER TABLE "regulatory_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_record"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_field_lineage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_record_id" uuid NOT NULL REFERENCES "regulatory_record"("id"),
  "field_code" text NOT NULL,
  "source_entity_type" text NOT NULL,
  "source_entity_id" uuid NOT NULL,
  "source_version_id" uuid,
  "transform_code" text
);

CREATE INDEX "regulatory_field_lineage_record_idx"
  ON "regulatory_field_lineage" ("tenant_id", "regulatory_record_id");

ALTER TABLE "regulatory_field_lineage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_field_lineage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_field_lineage"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_validation_issue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "regulatory_record_id" uuid REFERENCES "regulatory_record"("id"),
  "severity_code" text NOT NULL,
  "field_code" text,
  "message" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "regulatory_validation_issue_collection_idx"
  ON "regulatory_validation_issue" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "regulatory_validation_issue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_validation_issue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_validation_issue"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_signoff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "signed_off_by" text NOT NULL,
  "signed_off_at" timestamptz NOT NULL DEFAULT now(),
  "commentary" text
);

CREATE INDEX "regulatory_signoff_collection_idx"
  ON "regulatory_signoff" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "regulatory_signoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_signoff" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_signoff"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "regulatory_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "regulatory_collection_id" uuid NOT NULL REFERENCES "regulatory_collection"("id"),
  "collection_snapshot_id" uuid NOT NULL REFERENCES "collection_snapshot"("id"),
  "distribution_item_id" uuid,
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_by" text NOT NULL,
  "submission_reference" text
);

CREATE INDEX "regulatory_submission_collection_idx"
  ON "regulatory_submission" ("tenant_id", "regulatory_collection_id");

ALTER TABLE "regulatory_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "hesa_student_return" ADD COLUMN "regulatory_collection_id" uuid;
ALTER TABLE "ofs_extract" ADD COLUMN "regulatory_collection_id" uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('regulator-code', 'Regulator', 'srs-internal', 'The statutory body a regulatory collection is submitted to', true),
  ('regulatory-collection-type-code', 'Regulatory Collection Type', 'srs-internal', 'Type of regulatory collection within a regulator', true),
  ('regulatory-collection-status-code', 'Regulatory Collection Status', 'srs-internal', 'Lifecycle status of a regulatory collection', false),
  ('regulatory-validation-severity-code', 'Regulatory Validation Severity', 'srs-internal', 'Severity of a regulatory validation issue', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('regulator-code', 'HESA', 'Higher Education Statistics Agency', 10),
  ('regulator-code', 'OFS', 'Office for Students', 20),
  ('regulator-code', 'SFC', 'Scottish Funding Council', 30),
  ('regulator-code', 'MEDR', 'Medr (Wales)', 40),
  ('regulator-code', 'DFE-NI', 'Department for the Economy (Northern Ireland)', 50),

  ('regulatory-collection-status-code', 'draft', 'Draft', 10),
  ('regulatory-collection-status-code', 'validated', 'Validated', 20),
  ('regulatory-collection-status-code', 'signed-off', 'Signed off', 30),
  ('regulatory-collection-status-code', 'submitted', 'Submitted', 40),
  ('regulatory-collection-status-code', 'amended', 'Amended', 50),

  ('regulatory-validation-severity-code', 'blocking', 'Blocking', 10),
  ('regulatory-validation-severity-code', 'warning', 'Warning', 20)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('regulatory_collection', 'regulator_code', 'regulator-code'),
  ('regulatory_collection', 'status_code', 'regulatory-collection-status-code'),
  ('regulatory_validation_issue', 'severity_code', 'regulatory-validation-severity-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0051_identity_resolution.sql
-- ============================================================

-- Revelation SRS — Identity resolution & correction case (BPR-D17)
-- Migration: 0051_identity_resolution
--
-- Stage 7 of the business-process P0 backlog. identity_resolution_case and
-- data_correction_case extend the shared business_case primitive (0044) via
-- business_case_id rather than re-implementing case status/ownership.
-- Candidate generation only: no row here auto-creates a merge decision from
-- a match score, matching the migration plan's "do not auto-create merge
-- decisions from matching scores" rule.

CREATE TABLE "identity_resolution_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "identity_resolution_case_business_case_idx"
  ON "identity_resolution_case" ("tenant_id", "business_case_id");

ALTER TABLE "identity_resolution_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_resolution_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_resolution_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "identity_resolution_candidate" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "identity_resolution_case_id" uuid NOT NULL REFERENCES "identity_resolution_case"("id"),
  "candidate_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "match_score" numeric(5,4) NOT NULL,
  "match_reason_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "identity_resolution_candidate_case_idx"
  ON "identity_resolution_candidate" ("tenant_id", "identity_resolution_case_id");

ALTER TABLE "identity_resolution_candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_resolution_candidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_resolution_candidate"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "identity_resolution_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "identity_resolution_case_id" uuid NOT NULL REFERENCES "identity_resolution_case"("id"),
  "decision_type_code" text NOT NULL,
  "survivor_person_id" uuid REFERENCES "person"("id"),
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "identity_resolution_decision_case_unique"
  ON "identity_resolution_decision" ("tenant_id", "identity_resolution_case_id");

ALTER TABLE "identity_resolution_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_resolution_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_resolution_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "person_identity_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "source_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "target_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "link_type_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "person_identity_link_source_idx"
  ON "person_identity_link" ("tenant_id", "source_person_id");
CREATE INDEX "person_identity_link_target_idx"
  ON "person_identity_link" ("tenant_id", "target_person_id");

ALTER TABLE "person_identity_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_identity_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "person_identity_link"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "identity_redirect" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "old_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "new_person_id" uuid NOT NULL REFERENCES "person"("id"),
  "effective_from" timestamptz NOT NULL DEFAULT now(),
  "propagated_at" timestamptz
);

CREATE UNIQUE INDEX "identity_redirect_old_person_unique"
  ON "identity_redirect" ("tenant_id", "old_person_id");

ALTER TABLE "identity_redirect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_redirect" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_redirect"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "data_correction_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "corrected_entity_type" text NOT NULL,
  "corrected_field_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "data_correction_case_person_idx"
  ON "data_correction_case" ("tenant_id", "person_id");

ALTER TABLE "data_correction_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_correction_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_correction_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('identity-match-reason-code', 'Identity Match Reason', 'srs-internal', 'Basis on which an identity-resolution candidate was matched', true),
  ('identity-resolution-decision-type-code', 'Identity Resolution Decision Type', 'srs-internal', 'Type of decision reached on an identity-resolution case', false),
  ('person-identity-link-type-code', 'Person Identity Link Type', 'srs-internal', 'Nature of the link between two person records', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('identity-match-reason-code', 'name-dob', 'Name and date of birth', 10),
  ('identity-match-reason-code', 'email', 'Email address', 20),
  ('identity-match-reason-code', 'student-number', 'Student number', 30),
  ('identity-match-reason-code', 'manual-flag', 'Manually flagged', 40),

  ('identity-resolution-decision-type-code', 'merge', 'Merge', 10),
  ('identity-resolution-decision-type-code', 'reject', 'Reject', 20),
  ('identity-resolution-decision-type-code', 'link', 'Link (not merged)', 30),

  ('person-identity-link-type-code', 'merged-into', 'Merged into', 10),
  ('person-identity-link-type-code', 'duplicate-of', 'Duplicate of', 20),
  ('person-identity-link-type-code', 'related-record', 'Related record', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('identity_resolution_candidate', 'match_reason_code', 'identity-match-reason-code'),
  ('identity_resolution_decision', 'decision_type_code', 'identity-resolution-decision-type-code'),
  ('person_identity_link', 'link_type_code', 'person-identity-link-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0052_rights_retention_disposal.sql
-- ============================================================

-- Revelation SRS — Individual rights, retention & disposal (BPR-D18)
-- Migration: 0052_rights_retention_disposal
--
-- Stage 8 of the business-process P0 backlog. individual_rights_request
-- extends the shared business_case primitive (0044). foi_request stays a
-- separate model — a DSAR is broader than FOI. This is new capability only:
-- the existing RetentionEnforcementService and person.retention_anonymised_at
-- are left untouched (no historical backfill of undocumented retention
-- decisions, per the migration plan's "do not fabricate evidence" rule);
-- new retention_schedule/assignment/hold/disposition rows apply prospectively.

CREATE TABLE "individual_rights_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "request_type_code" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "statutory_deadline_date" date NOT NULL
);

CREATE INDEX "individual_rights_request_person_idx"
  ON "individual_rights_request" ("tenant_id", "person_id");

ALTER TABLE "individual_rights_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "individual_rights_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "individual_rights_request"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "rights_request_scope" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "individual_rights_request_id" uuid NOT NULL REFERENCES "individual_rights_request"("id"),
  "scope_entity_type" text NOT NULL,
  "scope_description" text
);

CREATE INDEX "rights_request_scope_request_idx"
  ON "rights_request_scope" ("tenant_id", "individual_rights_request_id");

ALTER TABLE "rights_request_scope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rights_request_scope" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rights_request_scope"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "rights_search_manifest" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "individual_rights_request_id" uuid NOT NULL REFERENCES "individual_rights_request"("id"),
  "searched_system" text NOT NULL,
  "searched_at" timestamptz NOT NULL DEFAULT now(),
  "record_count" integer NOT NULL DEFAULT 0
);

CREATE INDEX "rights_search_manifest_request_idx"
  ON "rights_search_manifest" ("tenant_id", "individual_rights_request_id");

ALTER TABLE "rights_search_manifest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rights_search_manifest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rights_search_manifest"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "rights_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "individual_rights_request_id" uuid NOT NULL REFERENCES "individual_rights_request"("id"),
  "decision_type_code" text NOT NULL,
  "legal_basis" text,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "rights_decision_request_idx"
  ON "rights_decision" ("tenant_id", "individual_rights_request_id");

ALTER TABLE "rights_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rights_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rights_decision"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "processing_restriction" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "rights_decision_id" uuid REFERENCES "rights_decision"("id"),
  "restriction_type_code" text NOT NULL,
  "applied_by" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "lifted_at" timestamptz
);

CREATE INDEX "processing_restriction_person_idx"
  ON "processing_restriction" ("tenant_id", "person_id");

ALTER TABLE "processing_restriction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_restriction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "processing_restriction"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "retention_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "entity_type" text NOT NULL,
  "retention_period_months" text NOT NULL,
  "trigger_event_code" text NOT NULL,
  "description" text
);

CREATE INDEX "retention_schedule_entity_idx"
  ON "retention_schedule" ("tenant_id", "entity_type");

ALTER TABLE "retention_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_schedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_schedule"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "retention_assignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "retention_schedule_id" uuid NOT NULL REFERENCES "retention_schedule"("id"),
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "scheduled_disposal_date" date
);

CREATE INDEX "retention_assignment_entity_idx"
  ON "retention_assignment" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX "retention_assignment_disposal_idx"
  ON "retention_assignment" ("tenant_id", "scheduled_disposal_date");

ALTER TABLE "retention_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_assignment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "record_hold" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "retention_assignment_id" uuid NOT NULL REFERENCES "retention_assignment"("id"),
  "hold_reason_code" text NOT NULL,
  "applied_by" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "lifted_at" timestamptz
);

CREATE INDEX "record_hold_assignment_idx"
  ON "record_hold" ("tenant_id", "retention_assignment_id");

ALTER TABLE "record_hold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_hold" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "record_hold"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "record_disposition" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "retention_assignment_id" uuid NOT NULL REFERENCES "retention_assignment"("id"),
  "disposition_type_code" text NOT NULL,
  "executed_at" timestamptz NOT NULL DEFAULT now(),
  "executed_by" text NOT NULL,
  "evidence_ref" text
);

CREATE UNIQUE INDEX "record_disposition_assignment_unique"
  ON "record_disposition" ("tenant_id", "retention_assignment_id");

ALTER TABLE "record_disposition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_disposition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "record_disposition"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('rights-request-type-code', 'Individual Rights Request Type', 'srs-internal', 'Type of GDPR individual-rights request', false),
  ('rights-decision-type-code', 'Rights Decision Type', 'srs-internal', 'Outcome of an individual-rights request', false),
  ('processing-restriction-type-code', 'Processing Restriction Type', 'srs-internal', 'Type of processing restriction applied to a person', true),
  ('retention-trigger-event-code', 'Retention Trigger Event', 'srs-internal', 'Event that starts a retention schedule counting down', true),
  ('record-hold-reason-code', 'Record Hold Reason', 'srs-internal', 'Reason a scheduled disposal is being held', true),
  ('record-disposition-type-code', 'Record Disposition Type', 'srs-internal', 'How a record was ultimately disposed of', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('rights-request-type-code', 'access', 'Right of access', 10),
  ('rights-request-type-code', 'rectification', 'Right to rectification', 20),
  ('rights-request-type-code', 'erasure', 'Right to erasure', 30),
  ('rights-request-type-code', 'restriction', 'Right to restriction of processing', 40),
  ('rights-request-type-code', 'portability', 'Right to data portability', 50),
  ('rights-request-type-code', 'objection', 'Right to object', 60),

  ('rights-decision-type-code', 'granted', 'Granted', 10),
  ('rights-decision-type-code', 'partially-granted', 'Partially granted', 20),
  ('rights-decision-type-code', 'refused', 'Refused', 30),

  ('processing-restriction-type-code', 'no-marketing', 'No marketing communications', 10),
  ('processing-restriction-type-code', 'no-automated-decision', 'No automated decision-making', 20),
  ('processing-restriction-type-code', 'processing-paused', 'Processing paused', 30),

  ('retention-trigger-event-code', 'end-of-study', 'End of study', 10),
  ('retention-trigger-event-code', 'award-conferred', 'Award conferred', 20),
  ('retention-trigger-event-code', 'request-closed', 'Request closed', 30),

  ('record-hold-reason-code', 'litigation', 'Litigation', 10),
  ('record-hold-reason-code', 'foi-request', 'FOI request', 20),
  ('record-hold-reason-code', 'dsar-in-progress', 'DSAR in progress', 30),
  ('record-hold-reason-code', 'audit', 'Audit', 40),

  ('record-disposition-type-code', 'anonymised', 'Anonymised', 10),
  ('record-disposition-type-code', 'deleted', 'Deleted', 20),
  ('record-disposition-type-code', 'transferred', 'Transferred', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('individual_rights_request', 'request_type_code', 'rights-request-type-code'),
  ('rights_decision', 'decision_type_code', 'rights-decision-type-code'),
  ('processing_restriction', 'restriction_type_code', 'processing-restriction-type-code'),
  ('retention_schedule', 'trigger_event_code', 'retention-trigger-event-code'),
  ('record_hold', 'hold_reason_code', 'record-hold-reason-code'),
  ('record_disposition', 'disposition_type_code', 'record-disposition-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- ============================================================
-- Originally: 0053_audit_hardening_review.sql
-- ============================================================

-- Revelation SRS — Audit hash-chaining & review (BPR-D19)
-- Migration: 0053_audit_hardening_review
--
-- Stage 9 (final stage this pass) of the business-process P0 backlog.
-- Adds a hash chain to audit_record itself (computed by AuditService.record,
-- the single choke point all 25+ call sites already go through — no call
-- site needs to change) plus partition-seal and review-case/finding tables.
-- Existing rows get previous_record_hash/record_hash = NULL and are treated
-- as a sealed legacy range; no retroactive tamper evidence is claimed for
-- pre-migration history.

ALTER TABLE "audit_record"
  ADD COLUMN "previous_record_hash" text,
  ADD COLUMN "record_hash" text;

CREATE INDEX "audit_record_tenant_occurred_idx"
  ON "audit_record" ("tenant_id", "occurred_at");

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_partition_seal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "range_start" timestamptz NOT NULL,
  "range_end" timestamptz NOT NULL,
  "seal_hash" text NOT NULL,
  "sealed_at" timestamptz NOT NULL DEFAULT now(),
  "sealed_by" text NOT NULL
);

CREATE INDEX "audit_partition_seal_tenant_range_idx"
  ON "audit_partition_seal" ("tenant_id", "range_start", "range_end");

ALTER TABLE "audit_partition_seal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_partition_seal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_partition_seal"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_review_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "audit_review_case_business_case_idx"
  ON "audit_review_case" ("tenant_id", "business_case_id");

ALTER TABLE "audit_review_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_review_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_review_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_review_finding" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "audit_review_case_id" uuid NOT NULL REFERENCES "audit_review_case"("id"),
  "audit_record_id" uuid NOT NULL,
  "finding_type_code" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "audit_review_finding_case_idx"
  ON "audit_review_finding" ("tenant_id", "audit_review_case_id");

ALTER TABLE "audit_review_finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_review_finding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_review_finding"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('audit-review-finding-type-code', 'Audit Review Finding Type', 'srs-internal', 'Outcome type of an individual audit-review finding', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('audit-review-finding-type-code', 'no-concern', 'No concern', 10),
  ('audit-review-finding-type-code', 'policy-breach', 'Policy breach', 20),
  ('audit-review-finding-type-code', 'tamper-suspected', 'Tamper suspected', 30),
  ('audit-review-finding-type-code', 'investigation-required', 'Investigation required', 40)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('audit_review_finding', 'finding_type_code', 'audit-review-finding-type-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;


-- Originally 0005_curriculum_regulatory_and_pgr.sql

-- ============================================================
-- 0005_curriculum_regulatory_and_pgr
--
-- Module selection and registration, the regulatory-submission and legal
-- identity workflows, and the PGR lifecycle.
--
-- Squashed on 2026-11-15 from migrations 0005–0018, which follow as
-- sections in their original order and with their original text. Nothing
-- has been run in production, so the history carries no data obligations.
-- scripts/verify-migration-squash.sh checked that the squashed set yields
-- the same schema and seed data.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- Originally 0005_module_selection_rules.sql
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- Module selection rules: diet groups, curriculum binding, and the
-- selection-proposal workflow.
--
-- See docs/architecture/module-selection-rules.md.
-- Resolves BP-03-002 OQ-1; BP-03-003 OQ-1; BP-03-004 OQ-1, OQ-2.
-- ============================================================

-- ── Module Group (Bitemporal) ─────────────────────────────────────────────────
-- Gives programme_rule_set actual diet content: compulsory/optional/elective
-- pools of modules, with count and/or credit bounds and level composition rules.
CREATE TABLE IF NOT EXISTS "module_group" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "programme_rule_set_id" uuid      NOT NULL,
  "fheq_level"          smallint,
  "group_code"          text        NOT NULL,
  "title"               text        NOT NULL,
  "group_type_code"     text        NOT NULL
                          CHECK ("group_type_code" IN ('compulsory','optional-pool','elective-pool')),
  "min_modules"         smallint,
  "max_modules"         smallint,
  "min_credits"         smallint,
  "max_credits"         smallint,
  "min_fheq_level"      smallint,
  "max_fheq_level"      smallint,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "module_group_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_group_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_unique_logical_transaction"
  ON "module_group" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_current_version_unique"
  ON "module_group" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_group_rule_set_idx"
  ON "module_group" ("tenant_id", "programme_rule_set_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_group" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_group"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Module Group Member (Bitemporal) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_group_member" (
  "version_id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                  uuid        NOT NULL,
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_group_id"     uuid        NOT NULL,
  "module_id"           uuid        NOT NULL,
  "is_default"          boolean     NOT NULL DEFAULT false,
  "is_non_condonable"   boolean     NOT NULL DEFAULT false,
  "valid_from"          timestamptz NOT NULL,
  "valid_to"            timestamptz,
  "recorded_at"         timestamptz NOT NULL DEFAULT now(),
  "recorded_until"      timestamptz,
  CONSTRAINT "module_group_member_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_group_member_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_member_unique_logical_transaction"
  ON "module_group_member" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_group_member_current_version_unique"
  ON "module_group_member" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_group_member_group_idx"
  ON "module_group_member" ("tenant_id", "module_group_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_group_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_group_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_group_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enrolment Curriculum Binding (Bitemporal) ─────────────────────────────────
-- Explicit, fixed binding of an enrolment to the route/rule-set version that
-- governs its module choices, progression and award (BP-03-002 OQ-1).
CREATE TABLE IF NOT EXISTS "enrolment_curriculum_binding" (
  "version_id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                     uuid        NOT NULL,
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"           uuid        NOT NULL,
  "programme_route_id"     uuid,
  "programme_rule_set_id"  uuid        NOT NULL,
  "decision_authority_code" text       NOT NULL
                              CHECK ("decision_authority_code" IN ('automatic','registry-administrator','academic-approver')),
  "decision_reason"        text,
  "valid_from"             timestamptz NOT NULL,
  "valid_to"               timestamptz,
  "recorded_at"            timestamptz NOT NULL DEFAULT now(),
  "recorded_until"         timestamptz,
  CONSTRAINT "enrolment_curriculum_binding_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "enrolment_curriculum_binding_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_curriculum_binding_unique_logical_transaction"
  ON "enrolment_curriculum_binding" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "enrolment_curriculum_binding_current_version_unique"
  ON "enrolment_curriculum_binding" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "enrolment_curriculum_binding_enrolment_idx"
  ON "enrolment_curriculum_binding" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

ALTER TABLE "enrolment_curriculum_binding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrolment_curriculum_binding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "enrolment_curriculum_binding"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Module Selection Proposal (Bitemporal) ────────────────────────────────────
-- The draft/submitted/validated/approved lifecycle described in BP-03-003/004,
-- ahead of confirmation as durable module_registration rows.
CREATE TABLE IF NOT EXISTS "module_selection_proposal" (
  "version_id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                      uuid        NOT NULL,
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id"            uuid        NOT NULL,
  "academic_period_id"      uuid        NOT NULL,
  "programme_rule_set_id"   uuid        NOT NULL,
  "status_code"             text        NOT NULL DEFAULT 'draft'
                              CHECK ("status_code" IN (
                                'draft','submitted','validated','approved',
                                'returned','waitlisted','rejected','confirmed'
                              )),
  "submitted_at"            timestamptz,
  "decided_at"              timestamptz,
  "decision_authority_code" text
                              CHECK ("decision_authority_code" IS NULL OR "decision_authority_code" IN (
                                'automatic','registry-administrator','programme-approver'
                              )),
  "decision_reason"         text,
  "workflow_instance_id"    uuid,
  "valid_from"              timestamptz NOT NULL,
  "valid_to"                timestamptz,
  "recorded_at"             timestamptz NOT NULL DEFAULT now(),
  "recorded_until"          timestamptz,
  CONSTRAINT "module_selection_proposal_temporal_check_valid"
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_selection_proposal_temporal_check_recorded"
    CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_selection_proposal_unique_logical_transaction"
  ON "module_selection_proposal" ("tenant_id", "id", "recorded_at");

CREATE UNIQUE INDEX IF NOT EXISTS "module_selection_proposal_current_version_unique"
  ON "module_selection_proposal" ("tenant_id", "id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_selection_proposal_enrolment_idx"
  ON "module_selection_proposal" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;

CREATE INDEX IF NOT EXISTS "module_selection_proposal_status_idx"
  ON "module_selection_proposal" ("tenant_id", "status_code")
  WHERE recorded_until IS NULL;

ALTER TABLE "module_selection_proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_selection_proposal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_selection_proposal"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

-- ── Module Selection Proposal Item ────────────────────────────────────────────
-- Not bitemporal: line items are freely edited while a proposal is in draft,
-- and re-validated in place. The durable, versioned record is module_registration,
-- created once the parent proposal reaches 'approved'/'confirmed'.
CREATE TABLE IF NOT EXISTS "module_selection_proposal_item" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "proposal_id"            uuid        NOT NULL,
  "module_id"               uuid        NOT NULL,
  "module_offering_id"     uuid,
  "preference_rank"        smallint,
  "source_code"            text        NOT NULL
                              CHECK ("source_code" IN ('compulsory-auto','student-choice','staff-assisted')),
  "validation_state_code"  text        NOT NULL DEFAULT 'pending'
                              CHECK ("validation_state_code" IN ('pending','passed','failed')),
  "validation_messages"    jsonb,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "module_selection_proposal_item_proposal_idx"
  ON "module_selection_proposal_item" ("tenant_id", "proposal_id");

ALTER TABLE "module_selection_proposal_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_selection_proposal_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "module_selection_proposal_item"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('module-group-type-code', 'Module Group Type', 'srs-internal', 'Whether a module diet group is compulsory or a choice pool', false),
  ('curriculum-binding-decision-authority-code', 'Curriculum Binding Decision Authority', 'srs-internal', 'Who authorised an enrolment''s route/rule-set binding', false),
  ('module-selection-proposal-status-code', 'Module Selection Proposal Status', 'srs-internal', 'Lifecycle status of a module selection proposal', false),
  ('module-selection-item-source-code', 'Module Selection Item Source', 'srs-internal', 'How a proposed module choice was added', false),
  ('module-selection-item-validation-state-code', 'Module Selection Item Validation State', 'srs-internal', 'Outcome of rule validation for a proposed module choice', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, member.code, member.label, member.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('module-group-type-code', 'compulsory', 'Compulsory', 10),
  ('module-group-type-code', 'optional-pool', 'Optional pool', 20),
  ('module-group-type-code', 'elective-pool', 'Elective pool', 30),

  ('curriculum-binding-decision-authority-code', 'automatic', 'Automatic', 10),
  ('curriculum-binding-decision-authority-code', 'registry-administrator', 'Registry administrator', 20),
  ('curriculum-binding-decision-authority-code', 'academic-approver', 'Academic approver', 30),

  ('module-selection-proposal-status-code', 'draft', 'Draft', 10),
  ('module-selection-proposal-status-code', 'submitted', 'Submitted', 20),
  ('module-selection-proposal-status-code', 'validated', 'Validated', 30),
  ('module-selection-proposal-status-code', 'approved', 'Approved', 40),
  ('module-selection-proposal-status-code', 'returned', 'Returned', 50),
  ('module-selection-proposal-status-code', 'waitlisted', 'Waitlisted', 60),
  ('module-selection-proposal-status-code', 'rejected', 'Rejected', 70),
  ('module-selection-proposal-status-code', 'confirmed', 'Confirmed', 80),

  ('module-selection-item-source-code', 'compulsory-auto', 'Compulsory (automatic)', 10),
  ('module-selection-item-source-code', 'student-choice', 'Student choice', 20),
  ('module-selection-item-source-code', 'staff-assisted', 'Staff-assisted', 30),

  ('module-selection-item-validation-state-code', 'pending', 'Pending', 10),
  ('module-selection-item-validation-state-code', 'passed', 'Passed', 20),
  ('module-selection-item-validation-state-code', 'failed', 'Failed', 30)
) AS member(set_code, code, label, sort_order)
  ON member.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('module_group', 'group_type_code', 'module-group-type-code'),
  ('enrolment_curriculum_binding', 'decision_authority_code', 'curriculum-binding-decision-authority-code'),
  ('module_selection_proposal', 'status_code', 'module-selection-proposal-status-code'),
  ('module_selection_proposal_item', 'source_code', 'module-selection-item-source-code'),
  ('module_selection_proposal_item', 'validation_state_code', 'module-selection-item-validation-state-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Approval workflow for exception cases (BP-03-004 A5b): oversubscription,
-- non-standard diet, or a rule failure with an authorised override.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'module-selection-approval',
  'Module selection exception approval',
  'registration',
  'active',
  1,
  'Routes a module selection proposal to a programme or teaching-unit approver when automated validation cannot confirm it outright (oversubscription, non-standard diet, or an authorised rule exception).',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'source', 'docs/business-processes/03-curriculum-and-module-registration/bp-03-004-validate-and-approve-module-selection.md',
    'decisionStepKey', 'approve-or-reject-selection',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-02T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'module-selection-approval'
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
  ('proposal-submitted', 'start', 'Proposal submitted', null, 10, '{}'),
  ('automated-validation', 'human-task', 'Automated rule validation', null, 20, '{"assignmentRulesRequired": false}'),
  ('approve-or-reject-selection', 'human-task', 'Programme or teaching-unit approval', 'programme-approver', 30, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Selection decision gateway', 'programme-approver', 40, '{"auditTable": "workflow_decision_audit"}'),
  ('proposal-closed', 'end', 'Proposal workflow closed', null, 50, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-selection-approval'
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
  'G01',
  'Approve, reject, substitute or waitlist?',
  'exclusive',
  'bp-03-004-validate-and-approve-module-selection.md',
  jsonb_build_object(
    'bpmnGatewayId', 'G01',
    'ownerRole', 'Programme or Teaching Unit Approver',
    'policySource', 'Institutional module selection and approval policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'module-selection-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0006_registration_window.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — Registration window enforcement
-- Migration: 0006_registration_window
--
-- Technical debt item: ModuleRegistrationService.createRegistration used to
-- call a #validateRegistrationWindow method that was removed during UAT
-- because the AUTUMN 2025 teaching period had passed. Tenant configuration
-- already carries a registrationWindowMode key (see
-- apps/api/test/tenant-admin.int.test.ts) that was never wired to any real
-- behaviour. This migration adds the missing registration_window table so
-- admins can set an explicit open/close window per academic period; the
-- service only enforces it when a tenant's configuration.registrationWindowMode
-- is 'academic-period', so tenants that leave it unset keep the previous
-- unrestricted behaviour.

CREATE TABLE IF NOT EXISTS "registration_window" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "opens_at"           timestamptz NOT NULL,
  "closes_at"          timestamptz NOT NULL,
  CONSTRAINT "registration_window_tenant_period_unique"
    UNIQUE ("tenant_id", "academic_period_id"),
  CONSTRAINT "registration_window_closes_after_opens"
    CHECK ("closes_at" > "opens_at")
);

CREATE INDEX IF NOT EXISTS "registration_window_tenant_period_idx"
  ON "registration_window" ("tenant_id", "academic_period_id");

ALTER TABLE "registration_window" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registration_window" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "registration_window";
CREATE POLICY tenant_isolation ON "registration_window"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- ════════════════════════════════════════════════════════════
-- Originally 0007_module_registration_change_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — Module registration/withdrawal change-request workflow
-- Migration: 0007_module_registration_change_workflow
--
-- Technical debt item: module registration and withdrawal were immediate,
-- single-step operations with no approval step, despite workflow being a
-- core architectural principle (ADR-016) and despite the module-selection
-- proposal flow already demonstrating the pattern for capacity exceptions
-- (see 0005_module_selection_rules.sql, workflow code
-- 'module-selection-approval'). This migration adds a second, simpler
-- workflow so *every* portal-initiated registration or withdrawal request
-- goes through a personal-tutor (or registry-administrator) approval step,
-- not just capacity-conflict cases. Staff-initiated direct registration via
-- POST /module-registrations is unaffected — only the new portal-facing
-- request endpoints use this workflow.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'module-registration-change-approval',
  'Module registration/withdrawal change request approval',
  'registration',
  'active',
  1,
  'Routes a student-initiated module registration or withdrawal request to a personal tutor or registry administrator for approval before it is applied.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-registration-change',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'module-registration-change-approval'
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
  ('request-submitted', 'start', 'Change request submitted', null, 10, '{}'),
  ('approve-or-reject-registration-change', 'human-task', 'Personal tutor or registry approval', 'personal-tutor', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Registration change decision gateway', 'personal-tutor', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Change request workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-registration-change-approval'
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
  'G01',
  'Approve or reject the registration change?',
  'exclusive',
  'packages/db/migrations/0007_module_registration_change_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Personal Tutor or Registry Administrator',
    'policySource', 'Institutional module registration and withdrawal policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'module-registration-change-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0008_slc_submission_approval_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — SLC confirmation submission approval workflow
-- Migration: 0008_slc_submission_approval_workflow
--
-- Reference implementation for the broader technical debt item: all
-- regulatory submission processes (HESA, SLC, OfS, UCAS, UKVI) are
-- stateless synchronous operations with no task-inbox integration or
-- human-approval gate. SLC is the first converted, following exactly the
-- same seed pattern as 0007_module_registration_change_workflow.sql
-- (itself modeled on 0005_module_selection_rules.sql's
-- 'module-selection-approval'). Remaining processes are tracked as
-- follow-up work, not implemented in this migration.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'slc-confirmation-submission-approval',
  'SLC confirmation submission approval',
  'regulatory',
  'active',
  1,
  'Routes a batch of previewed SLC enrolment confirmations to a regulatory officer for approval before they are transmitted, snapshotting the exact trigger set previewed so a later approval acts on what was actually reviewed.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-submission',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'slc-confirmation-submission-approval'
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
  ('batch-previewed', 'start', 'Confirmation batch previewed', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'slc-confirmation-submission-approval'
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
  'G01',
  'Approve or reject the SLC confirmation batch?',
  'exclusive',
  'packages/db/migrations/0008_slc_submission_approval_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional SLC confirmation submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'slc-confirmation-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0009_legal_identity_change_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — Legal identity change (gender/nationality) approval workflow
-- Migration: 0009_legal_identity_change_workflow
--
-- Technical debt item: gender and nationality were removed from the portal
-- profile edit form because legal identity changes require documentation and
-- administrative approval, not self-service. However PATCH
-- /students/:personId/identity had no field-level restriction at all — a
-- student could self-PATCH genderCode/nationalityCode directly with no
-- approval; only the portal UI omitted the fields. This migration adds the
-- workflow definition for a governed request/approve path; the API-level
-- restriction on the direct PATCH route and the request/decide routes are
-- added in the same change (apps/api/src/routes/students.ts).
--
-- Follows the same seed pattern as 0007_module_registration_change_workflow.sql
-- and 0008_slc_submission_approval_workflow.sql.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'legal-identity-change-approval',
  'Legal identity change (gender/nationality) approval',
  'students',
  'active',
  1,
  'Routes a student-initiated request to change their recorded gender or nationality to a personal tutor or registry administrator for approval before the bitemporal person_identity record is updated.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-identity-change',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'legal-identity-change-approval'
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
  ('request-submitted', 'start', 'Identity change request submitted', null, 10, '{}'),
  ('approve-or-reject-identity-change', 'human-task', 'Personal tutor or registry approval', 'personal-tutor', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Identity change decision gateway', 'personal-tutor', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Identity change request workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'legal-identity-change-approval'
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
  'G01',
  'Approve or reject the legal identity change?',
  'exclusive',
  'packages/db/migrations/0009_legal_identity_change_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Personal Tutor or Registry Administrator',
    'policySource', 'Institutional legal identity change and documentation policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'legal-identity-change-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0010_hesa_submission_approval_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — HESA student return submission approval workflow
-- Migration: 0010_hesa_submission_approval_workflow
--
-- Second regulatory-submission process converted to the workflow-gated
-- pattern established for SLC (0008_slc_submission_approval_workflow.sql).
-- Unlike SLC, HESA already has a persisted, stateful batch entity — the
-- hesa_student_return row and its status_code lifecycle — so the returnId
-- itself is the workflow subject; no trigger-ID snapshot is needed since a
-- return's records are already fixed at generation time.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'hesa-return-submission-approval',
  'HESA student return submission approval',
  'regulatory',
  'active',
  1,
  'Routes a validated HESA student return, with its submission file already generated, to a regulatory officer for approval before it is marked submitted.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-submission',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'hesa-return-submission-approval'
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
  ('return-ready', 'start', 'Return validated and file generated', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'hesa-return-submission-approval'
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
  'G01',
  'Approve or reject the HESA return submission?',
  'exclusive',
  'packages/db/migrations/0010_hesa_submission_approval_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional HESA return submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'hesa-return-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0011_ofs_extract_generation_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — OfS B3/participation extract generation approval workflow
-- Migration: 0011_ofs_extract_generation_workflow
--
-- Third regulatory-submission process converted, following the pattern
-- established for SLC (0008) and HESA (0010). OfS is structurally different
-- from the other three: there is no submit/transmit step anywhere in the
-- codebase (the admin console's only further action is a client-side JSON
-- download), so this gate sits before the one meaningful mutating action
-- that does exist — generating the official extract record — rather than
-- before a submission that doesn't exist. A single workflow covers both the
-- B3 extract and the access/participation report, distinguished by
-- extractTypeCode in the workflow context.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'ofs-extract-generation-approval',
  'OfS extract generation approval',
  'regulatory',
  'active',
  1,
  'Routes a request to generate an official OfS B3 or access/participation extract to a regulatory officer for approval before the extract record is created.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-generation',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'ofs-extract-generation-approval'
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
  ('generation-requested', 'start', 'Extract generation requested', null, 10, '{}'),
  ('approve-or-reject-generation', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Generation decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Generation workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ofs-extract-generation-approval'
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
  'G01',
  'Approve or reject the OfS extract generation?',
  'exclusive',
  'packages/db/migrations/0011_ofs_extract_generation_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional OfS extract generation policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ofs-extract-generation-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0012_ucas_confirmation_submission_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — UCAS confirmation submission approval workflow
-- Migration: 0012_ucas_confirmation_submission_workflow
--
-- Continues the BPR-W12 rollout begun in 0008 (SLC), 0009 (legal identity
-- change), 0010 (HESA) and 0011 (OfS): converts the previously stateless
-- "generate outbound confirmations" call into a workflow-gated request/decide
-- pattern, following the exact same seed shape as
-- 0008_slc_submission_approval_workflow.sql.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'ucas-confirmation-submission-approval',
  'UCAS confirmation submission approval',
  'regulatory',
  'active',
  1,
  'Routes a batch of previewed UCAS enrolment confirmations to a regulatory officer for approval before they are transmitted, snapshotting the exact trigger set previewed so a later approval acts on what was actually reviewed.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-submission',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'ucas-confirmation-submission-approval'
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
  ('batch-previewed', 'start', 'Confirmation batch previewed', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ucas-confirmation-submission-approval'
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
  'G01',
  'Approve or reject the UCAS confirmation batch?',
  'exclusive',
  'packages/db/migrations/0012_ucas_confirmation_submission_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional UCAS confirmation submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ucas-confirmation-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0013_ukvi_cas_submission_workflow.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — UKVI CAS request submission approval workflow
-- Migration: 0013_ukvi_cas_submission_workflow
--
-- Final step of the BPR-W12 rollout begun in 0008 (SLC), 0009 (legal identity
-- change), 0010 (HESA), 0011 (OfS) and 0012 (UCAS): converts the previously
-- stateless "generate CAS requests" call into a workflow-gated request/decide
-- pattern, following the exact same seed shape as
-- 0008_slc_submission_approval_workflow.sql.

INSERT INTO "workflow_definition" (
  "definition_code",
  "display_name",
  "owner_module_code",
  "status_code",
  "current_version_number",
  "description",
  "created_by"
) VALUES (
  'ukvi-cas-request-submission-approval',
  'UKVI CAS request submission approval',
  'regulatory',
  'active',
  1,
  'Routes a batch of previewed UKVI CAS requests to a regulatory officer for approval before they are transmitted, snapshotting the exact trigger set previewed so a later approval acts on what was actually reviewed.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id",
  "version_number",
  "status_code",
  "definition_json",
  "effective_from",
  "created_by"
)
SELECT
  wd."id",
  1,
  'active',
  jsonb_build_object(
    'decisionStepKey', 'approve-or-reject-submission',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-08-03T00:00:00Z'::timestamptz,
  'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'ukvi-cas-request-submission-approval'
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
  ('batch-previewed', 'start', 'CAS request batch previewed', null, 10, '{}'),
  ('approve-or-reject-submission', 'human-task', 'Regulatory officer approval', 'regulatory-officer', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway', 'decision', 'Submission decision gateway', 'regulatory-officer', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('request-closed', 'end', 'Submission workflow closed', null, 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ukvi-cas-request-submission-approval'
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
  'G01',
  'Approve or reject the UKVI CAS request batch?',
  'exclusive',
  'packages/db/migrations/0013_ukvi_cas_submission_workflow.sql',
  jsonb_build_object(
    'ownerRole', 'Regulatory Officer',
    'policySource', 'Institutional UKVI CAS request submission policy'
  )
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ukvi-cas-request-submission-approval'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0014_pgr_foundation.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR lifecycle foundation
-- Migration: 0014_pgr_foundation
--
-- Stage 0 of the PGR lifecycle build (ADR-023): seeds the shared vocabulary
-- and integration-contract registrations needed before any PGR schema lands.
-- PGR is built core-hosted, rooted on the existing business_case/case_decision
-- primitive (packages/db/src/schema/business-case.ts) — no new case/workflow
-- engine is introduced here.

-- ── Value set: PGR examination outcome (verbatim from docs/domain-glossary.md) ─

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible")
VALUES
  ('pgr-examination-outcome-code', 'PGR Examination Outcome', 'srs-internal', 'Outcome of a PGR thesis viva voce examination', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pass',                     'Pass',                              10),
  ('pass-minor-corrections',   'Pass with minor corrections',       20),
  ('pass-major-corrections',   'Pass with major corrections',       30),
  ('resubmission',             'Resubmission',                      40),
  ('fail',                     'Fail',                              50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'pgr-examination-outcome-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('pgr_examination_outcome', 'outcome_code', 'pgr-examination-outcome-code')
ON CONFLICT DO NOTHING;

-- ── Integration contracts: HR and CRIS boundaries (BP-03-007, BP-04-003) ──────
-- Seeded now for completeness/documentation; research-proposal-eligibility.v1
-- is not built against until a concrete research-proposals consumer exists.

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('hr-staff-assignments.v1',        'HR Staff Assignments',              'pgr', 'inbound',       'api', '1.0.0', 'personal'),
  ('cris-pgr-profile.v1',            'CRIS PGR Profile',                  'pgr', 'outbound',      'api', '1.0.0', 'personal'),
  ('cris-pgr-milestones.v1',         'CRIS PGR Milestones',               'pgr', 'bidirectional', 'api', '1.0.0', 'personal'),
  ('research-proposal-eligibility.v1','Research Proposal Eligibility',    'pgr', 'outbound',      'api', '1.0.0', 'personal')
ON CONFLICT ("contract_id") DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0015_pgr_supervision.sql
-- ════════════════════════════════════════════════════════════

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


-- ════════════════════════════════════════════════════════════
-- Originally 0016_pgr_progress_review.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR progress review and milestones
-- Migration: 0016_pgr_progress_review
--
-- Stage 2 of the PGR lifecycle build (BP-04-003, BPR-D07 part 2). Per
-- ADR-023, pgr_progress_review extends the shared business_case primitive —
-- each review (initial, annual, upgrade, return-from-interruption) is its
-- own case instance, not a version of a prior one. pgr_review_member
-- mirrors board_member_conflict's shape (0004_business_process_foundations)
-- for panel composition and conflict/recusal tracking. research_milestone
-- is append-only: an unsatisfactory outcome never alters candidature until
-- the case is decided, and a milestone is only published once a decision
-- exists.

CREATE TABLE "pgr_progress_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "supervision_case_id" uuid REFERENCES "pgr_supervision_case"("id"),
  "review_type_code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_progress_review_business_case_idx"
  ON "pgr_progress_review" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_progress_review_enrolment_idx"
  ON "pgr_progress_review" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_progress_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_progress_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_progress_review"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pgr_review_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "review_id" uuid NOT NULL REFERENCES "pgr_progress_review"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "role_code" text NOT NULL,
  "conflict_type_code" text,
  "declared_at" timestamptz,
  "recused_at" timestamptz,
  "added_by" text NOT NULL,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_review_member_review_idx"
  ON "pgr_review_member" ("tenant_id", "review_id");

ALTER TABLE "pgr_review_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_review_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_review_member"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "research_milestone" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "enrolment_id" uuid NOT NULL,
  "review_id" uuid REFERENCES "pgr_progress_review"("id"),
  "milestone_type_code" text NOT NULL,
  "achieved_date" date NOT NULL,
  "published_at" timestamptz,
  "actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "research_milestone_enrolment_idx"
  ON "research_milestone" ("tenant_id", "enrolment_id");

ALTER TABLE "research_milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_milestone" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "research_milestone"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-review-type-code',        'PGR Review Type',         'srs-internal', 'Type of PGR progress review', false),
  ('pgr-review-member-role-code', 'PGR Review Member Role',   'srs-internal', 'Role of a member on a PGR progress-review panel', false),
  ('pgr-review-outcome-code',     'PGR Review Outcome',       'srs-internal', 'Outcome of a PGR progress review', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('pgr-review-type-code', 'initial',                     'Initial review',                 10),
  ('pgr-review-type-code', 'annual',                      'Annual review',                  20),
  ('pgr-review-type-code', 'upgrade',                      'Upgrade / confirmation review',  30),
  ('pgr-review-type-code', 'return-from-interruption',     'Return-from-interruption review',40),

  ('pgr-review-member-role-code', 'chair',                'Chair',                10),
  ('pgr-review-member-role-code', 'independent-reviewer', 'Independent reviewer', 20),
  ('pgr-review-member-role-code', 'panel-member',         'Panel member',         30),

  ('pgr-review-outcome-code', 'satisfactory', 'Satisfactory progress', 10),
  ('pgr-review-outcome-code', 'conditions',   'Conditions set',        20),
  ('pgr-review-outcome-code', 'referral',     'Referral',              30),
  ('pgr-review-outcome-code', 'transfer',     'Transfer',              40),
  ('pgr-review-outcome-code', 'escalation',   'Escalation',            50)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('pgr_progress_review', 'review_type_code',    'pgr-review-type-code'),
  ('pgr_review_member',   'role_code',            'pgr-review-member-role-code'),
  ('pgr_review_member',   'conflict_type_code',   'board-conflict-type-code'),
  ('research_milestone',  'milestone_type_code',  'research-milestone-type')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0017_pgr_thesis_examination.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR thesis submission and examination
-- Migration: 0017_pgr_thesis_examination
--
-- Stage 3 of the PGR lifecycle build (BP-05-010, BPR-D12). Per ADR-023,
-- pgr_examination_case extends the shared business_case primitive. Follows
-- ADR-020's staged-authority pattern: immutable submitted thesis version
-- (thesis_submission, append-only) -> examiner nomination and chair
-- approval -> examiner reports (append-only) -> viva (viva_event) ->
-- ratified, immutable outcome (pgr_examination_outcome, append-only — the
-- outcome value set was already seeded in 0014_pgr_foundation). Corrections
-- are deadlined follow-up requirements linked to the ratified outcome,
-- never an edit to it.

CREATE TABLE "pgr_examination_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_examination_case_business_case_idx"
  ON "pgr_examination_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_examination_case_enrolment_idx"
  ON "pgr_examination_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_examination_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_examination_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_examination_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "thesis_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "version_number" integer NOT NULL,
  "format_code" text NOT NULL,
  "declaration_confirmed" boolean NOT NULL,
  "restricted" boolean NOT NULL DEFAULT false,
  "restriction_reason_text" text,
  "restriction_review_date" date,
  "storage_ref" text NOT NULL,
  "submitted_by" text NOT NULL,
  "submitted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "thesis_submission_case_version_unique"
  ON "thesis_submission" ("tenant_id", "examination_case_id", "version_number");

ALTER TABLE "thesis_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thesis_submission"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "examiner_appointment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "person_id" uuid NOT NULL REFERENCES "person"("id"),
  "examiner_role_code" text NOT NULL,
  "independence_checked_at" timestamptz,
  "conflict_type_code" text,
  "recused_at" timestamptz,
  "confirmed_at" timestamptz,
  "nominated_by" text NOT NULL,
  "nominated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "examiner_appointment_case_idx"
  ON "examiner_appointment" ("tenant_id", "examination_case_id");

ALTER TABLE "examiner_appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examiner_appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "examiner_appointment"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "examiner_report" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "examiner_appointment_id" uuid NOT NULL REFERENCES "examiner_appointment"("id"),
  "report_ref" text NOT NULL,
  "recommendation_code" text,
  "submitted_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "examiner_report_case_idx"
  ON "examiner_report" ("tenant_id", "examination_case_id");

ALTER TABLE "examiner_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "examiner_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "examiner_report"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "viva_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "held_at" timestamptz NOT NULL,
  "joint_recommendation_text" text NOT NULL,
  "recorded_by" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "viva_event_case_idx"
  ON "viva_event" ("tenant_id", "examination_case_id");

ALTER TABLE "viva_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "viva_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "viva_event"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "pgr_examination_outcome" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "outcome_code" text NOT NULL,
  "decided_by" text NOT NULL,
  "decided_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_examination_outcome_case_idx"
  ON "pgr_examination_outcome" ("tenant_id", "examination_case_id");

ALTER TABLE "pgr_examination_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_examination_outcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_examination_outcome"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "thesis_correction_requirement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "outcome_id" uuid NOT NULL REFERENCES "pgr_examination_outcome"("id"),
  "deadline_date" date NOT NULL,
  "completed_at" timestamptz,
  "completed_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "thesis_correction_requirement_outcome_idx"
  ON "thesis_correction_requirement" ("tenant_id", "outcome_id");

ALTER TABLE "thesis_correction_requirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thesis_correction_requirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thesis_correction_requirement"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Value sets

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('pgr-thesis-format-code', 'PGR Thesis Format',  'srs-internal', 'Format of a submitted PGR thesis', false),
  ('pgr-examiner-role-code', 'PGR Examiner Role',  'srs-internal', 'Role of an examiner on a PGR examination case', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('pgr-thesis-format-code', 'traditional',     'Traditional thesis',        10),
  ('pgr-thesis-format-code', 'practice-based',  'Practice-based submission', 20),
  ('pgr-thesis-format-code', 'published-work',  'Published-work submission', 30),

  ('pgr-examiner-role-code', 'internal', 'Internal examiner', 10),
  ('pgr-examiner-role-code', 'external', 'External examiner', 20)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('thesis_submission',    'format_code',          'pgr-thesis-format-code'),
  ('examiner_appointment', 'examiner_role_code',   'pgr-examiner-role-code'),
  ('examiner_appointment', 'conflict_type_code',   'board-conflict-type-code'),
  ('examiner_report',      'recommendation_code',  'pgr-examination-outcome-code')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0018_pgr_completion_and_research_award.sql
-- ════════════════════════════════════════════════════════════

-- Revelation SRS — PGR completion and research award conferral
-- Migration: 0018_pgr_completion_and_research_award
--
-- Stage 4 of the PGR lifecycle build (BP-06-006, BPR-D14). Per ADR-023,
-- pgr_completion_case extends the shared business_case primitive and links
-- back to the examination case whose ratified, corrections-complete
-- outcome authorises completion. final_thesis_deposit confirms repository
-- deposit and IP declarations — a missing deposit holds completion.
--
-- The award table is additively relaxed so a research award can be
-- conferred without a taught exam board: exam_board_id becomes nullable
-- and a new source_case_id column (the PGR completion case) is added for
-- research awards. Exactly one of the two is populated per award.

CREATE TABLE "pgr_completion_case" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "business_case_id" uuid NOT NULL,
  "enrolment_id" uuid NOT NULL,
  "examination_case_id" uuid NOT NULL REFERENCES "pgr_examination_case"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "pgr_completion_case_business_case_idx"
  ON "pgr_completion_case" ("tenant_id", "business_case_id");
CREATE INDEX "pgr_completion_case_enrolment_idx"
  ON "pgr_completion_case" ("tenant_id", "enrolment_id");

ALTER TABLE "pgr_completion_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pgr_completion_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pgr_completion_case"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "final_thesis_deposit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "completion_case_id" uuid NOT NULL REFERENCES "pgr_completion_case"("id"),
  "deposit_ref" text NOT NULL,
  "ip_declaration_confirmed" boolean NOT NULL,
  "confirmed_by" text NOT NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "final_thesis_deposit_completion_case_idx"
  ON "final_thesis_deposit" ("tenant_id", "completion_case_id");

ALTER TABLE "final_thesis_deposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "final_thesis_deposit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "final_thesis_deposit"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Additive relaxation of "award" for research (PGR) awards

ALTER TABLE "award" ALTER COLUMN "exam_board_id" DROP NOT NULL;
ALTER TABLE "award" ADD COLUMN "source_case_id" uuid;

ALTER TABLE "award"
  ADD CONSTRAINT "award_exactly_one_authority"
    CHECK (num_nonnulls("exam_board_id", "source_case_id") = 1);

-- Originally 0006_adjustments_integration_and_support.sql

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

-- Originally 0007_business_process_completion.sql

-- ============================================================
-- 0007_business_process_completion
--
-- The business-process aggregates that closed the BPR-D data-model gaps:
-- student status cases (D04), curriculum publication, recognised credit and
-- rule exceptions (D05), reassessment plans and award conferment (D14),
-- award documents and graduation (D15), and applications and offers
-- (D01, D02).
--
-- Squashed on 2026-11-16 from migrations 0007–0011, which follow as
-- sections in their original order and with their original text.
-- scripts/verify-migration-squash.sh checked that the squashed set yields
-- the same schema and seed data.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- Originally 0007_student_status_cases.sql
-- ════════════════════════════════════════════════════════════

-- 0007 — Student status cases (BPR-D04; BP-02-006/007/008/009/012)
--
-- A governed case for each change to a student's study status, rooted on
-- business_case (ADR-023): interruption, institution-required suspension,
-- return from interruption, withdrawal, transfer of programme or mode, and
-- leaver-record closure. The case holds the request, reviewers'
-- assessments, conditions and the authorised decision. Approval applies the
-- change to the enrolment (a bitemporal version plus an
-- enrolment_status_transition, which the case then references), so the
-- enrolment never changes status without an authorised case behind it.
--
-- Evidence stays with its owner (BR-4): the case holds reason categories and
-- opaque references, never the sensitive detail.

CREATE TABLE IF NOT EXISTS "student_status_case" (
  "id"                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                  uuid        NOT NULL REFERENCES "tenant" ("id"),
  "business_case_id"           uuid        NOT NULL,
  "enrolment_id"               uuid        NOT NULL,
  "person_id"                  uuid        NOT NULL,
  "case_type_code"             text        NOT NULL,   -- value set student-status-case-type-code
  "initiated_by_code"          text        NOT NULL,   -- value set status-case-initiator-code
  "reason_category_code"       text,                   -- value set student-status-reason-code
  "requested_effective_date"   date        NOT NULL,
  "expected_return_date"       date,                   -- interruption/suspension
  "destination_programme_id"   uuid,                   -- transfer
  "destination_mode_of_study_code" text,               -- transfer
  "related_case_id"            uuid,                   -- return: the interruption/suspension it ends
  "institutional_outcome_ref"  text,                   -- A1: opaque link to the authorising process
  -- requested | approved | rejected | withdrawn
  "status_code"                text        NOT NULL DEFAULT 'requested',
  "decided_by"                 text,
  "decided_at"                 timestamptz,
  "decision_reason"            text,
  "approved_effective_date"    date,
  "approved_return_date"       date,
  "enrolment_status_transition_id" uuid,               -- the change the approval made
  "created_by"                 text        NOT NULL,
  "created_at"                 timestamptz NOT NULL DEFAULT now(),
  "updated_at"                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_status_case_status_check"
    CHECK ("status_code" IN ('requested', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT "student_status_case_return_after_effective"
    CHECK ("expected_return_date" IS NULL OR "expected_return_date" > "requested_effective_date")
);
CREATE INDEX IF NOT EXISTS "student_status_case_enrolment_idx" ON "student_status_case" ("tenant_id", "enrolment_id");
-- At most one open status-changing case per enrolment; leaver closure runs alongside.
CREATE UNIQUE INDEX IF NOT EXISTS "student_status_case_one_open"
  ON "student_status_case" ("tenant_id", "enrolment_id")
  WHERE "status_code" = 'requested' AND "case_type_code" <> 'leaver-closure';

-- Reviewers' advice (BP-02-007 steps 3–4, BP-02-006 steps 3–4): append-only.
CREATE TABLE IF NOT EXISTS "status_case_assessment" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant" ("id"),
  "status_case_id"     uuid        NOT NULL REFERENCES "student_status_case" ("id"),
  "assessor_role_code" text        NOT NULL,   -- value set status-case-assessor-role-code
  "outcome_code"       text        NOT NULL,   -- value set status-case-assessment-outcome-code
  "note"               text,
  "assessed_by"        text        NOT NULL,
  "assessed_at"        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "status_case_assessment_case_idx" ON "status_case_assessment" ("tenant_id", "status_case_id");

-- Conditions imposed by a decision, e.g. return conditions on an interruption.
CREATE TABLE IF NOT EXISTS "status_case_condition" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "status_case_id"      uuid        NOT NULL REFERENCES "student_status_case" ("id"),
  "condition_type_code" text        NOT NULL,   -- value set status-case-condition-type-code
  "description"         text        NOT NULL,
  "due_date"            date,
  -- open | met | waived
  "status_code"         text        NOT NULL DEFAULT 'open',
  "evidence_ref"        text,
  "resolved_by"         text,
  "resolved_at"         timestamptz,
  "resolution_note"     text,
  "created_by"          text        NOT NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "status_case_condition_status_check" CHECK ("status_code" IN ('open', 'met', 'waived'))
);
CREATE INDEX IF NOT EXISTS "status_case_condition_case_idx" ON "status_case_condition" ("tenant_id", "status_case_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_status_case', 'status_case_assessment', 'status_case_condition'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('student-status-case-type-code', 'Student Status Case Type', 'srs-internal', NULL, 'Kind of governed change to a student''s study status', false),
  ('status-case-initiator-code', 'Status Case Initiator', 'srs-internal', NULL, 'Who started a status case', false),
  ('student-status-reason-code', 'Student Status Change Reason', 'srs-internal', NULL, 'Reason category for a status change (no sensitive detail)', true),
  ('status-case-assessor-role-code', 'Status Case Assessor Role', 'srs-internal', NULL, 'Reviewer who advised on a status case', true),
  ('status-case-assessment-outcome-code', 'Status Case Assessment Outcome', 'srs-internal', NULL, 'A reviewer''s advice on a status case', false),
  ('status-case-condition-type-code', 'Status Case Condition Type', 'srs-internal', NULL, 'Condition imposed by a status decision', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('student-status-case-type-code', 'interruption',   'Interruption of studies',     10),
  ('student-status-case-type-code', 'suspension',     'Required suspension',         20),
  ('student-status-case-type-code', 'return',         'Return from interruption',    30),
  ('student-status-case-type-code', 'withdrawal',     'Withdrawal',                  40),
  ('student-status-case-type-code', 'transfer',       'Transfer of programme or mode', 50),
  ('student-status-case-type-code', 'leaver-closure', 'Leaver record closure',       60),
  ('status-case-initiator-code', 'student',     'Student',     10),
  ('status-case-initiator-code', 'institution', 'Institution', 20),
  ('student-status-reason-code', 'health',          'Health',                 10),
  ('student-status-reason-code', 'personal',        'Personal circumstances', 20),
  ('student-status-reason-code', 'financial',       'Financial',              30),
  ('student-status-reason-code', 'caring',          'Caring responsibilities', 40),
  ('student-status-reason-code', 'employment',      'Employment',             50),
  ('student-status-reason-code', 'academic',        'Academic',               60),
  ('student-status-reason-code', 'fitness-to-study','Fitness to study',       70),
  ('student-status-reason-code', 'conduct',         'Conduct outcome',        80),
  ('student-status-reason-code', 'non-engagement',  'Non-engagement',         90),
  ('student-status-reason-code', 'change-of-course','Change of course',      100),
  ('student-status-reason-code', 'completed',       'Completed studies',     110),
  ('student-status-reason-code', 'other',           'Other',                 120),
  ('status-case-assessor-role-code', 'academic',             'Academic approver',             10),
  ('status-case-assessor-role-code', 'destination-academic', 'Destination academic approver', 20),
  ('status-case-assessor-role-code', 'finance',              'Finance',                       30),
  ('status-case-assessor-role-code', 'compliance',           'UKVI compliance',               40),
  ('status-case-assessment-outcome-code', 'supports',       'Supports',        10),
  ('status-case-assessment-outcome-code', 'concerns',       'Raises concerns', 20),
  ('status-case-assessment-outcome-code', 'not-applicable', 'Not applicable',  30),
  ('status-case-condition-type-code', 'return-evidence',      'Return evidence',      10),
  ('status-case-condition-type-code', 'fitness-to-study',     'Fitness to study',     20),
  ('status-case-condition-type-code', 'fee-clearance',        'Fee clearance',        30),
  ('status-case-condition-type-code', 'sponsor-clearance',    'Sponsor clearance',    40),
  ('status-case-condition-type-code', 'academic-requirement', 'Academic requirement', 50),
  ('status-case-condition-type-code', 'other',                'Other',                60)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('student_status_case', 'case_type_code', 'student-status-case-type-code', NULL),
  ('student_status_case', 'initiated_by_code', 'status-case-initiator-code', NULL),
  ('student_status_case', 'reason_category_code', 'student-status-reason-code', NULL),
  ('status_case_assessment', 'assessor_role_code', 'status-case-assessor-role-code', NULL),
  ('status_case_assessment', 'outcome_code', 'status-case-assessment-outcome-code', NULL),
  ('status_case_condition', 'condition_type_code', 'status-case-condition-type-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0008_curriculum_publication.sql
-- ════════════════════════════════════════════════════════════

-- 0008 — Curriculum publication, recognised credit and rule exceptions (BPR-D05; BP-03-001, BP-02-006)
--
-- curriculum_publication / curriculum_publication_item: a versioned release
--   from the curriculum system of record (F-CM-SIS-01), received whole,
--   validated and classified item by item (add, change, close, unchanged)
--   against the current catalogue, then applied in one transaction. An
--   invalid item rejects the whole publication and the catalogue is not
--   changed (BP-03-001 E2). The result counts are the acknowledgement to the
--   source (step 8).
-- recognised_credit: credit a student brings in (prior learning, transfer)
--   or is exempted from, proposed and approved by different people.
-- rule_exception: an authorised waiver or variation of a programme rule
--   for one student, time-bound and revocable.

CREATE TABLE IF NOT EXISTS "curriculum_publication" (
  "id"                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"               uuid        NOT NULL REFERENCES "tenant" ("id"),
  "source_system_code"      text        NOT NULL,
  "source_publication_ref"  text        NOT NULL,
  "publication_version"     text        NOT NULL,
  "approval_ref"            text,
  "effective_from"          date        NOT NULL,
  "correction_rationale"    text,                   -- required for a retrospective publication (E4)
  -- validated | rejected | applied
  "status_code"             text        NOT NULL,
  "added_count"             integer     NOT NULL DEFAULT 0,
  "changed_count"           integer     NOT NULL DEFAULT 0,
  "closed_count"            integer     NOT NULL DEFAULT 0,
  "unchanged_count"         integer     NOT NULL DEFAULT 0,
  "rejected_count"          integer     NOT NULL DEFAULT 0,
  "payload_hash"            text        NOT NULL,
  "received_by"             text        NOT NULL,
  "received_at"             timestamptz NOT NULL DEFAULT now(),
  "applied_by"              text,
  "applied_at"              timestamptz,
  CONSTRAINT "curriculum_publication_status_check" CHECK ("status_code" IN ('validated', 'rejected', 'applied')),
  CONSTRAINT "curriculum_publication_source_unique" UNIQUE ("tenant_id", "source_system_code", "source_publication_ref")
);

CREATE TABLE IF NOT EXISTS "curriculum_publication_item" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "publication_id"    uuid        NOT NULL REFERENCES "curriculum_publication" ("id"),
  "object_type_code"  text        NOT NULL,   -- programme | module
  "object_code"       text        NOT NULL,
  "source_reference"  text,
  -- add | change | close | unchanged | invalid
  "change_type_code"  text        NOT NULL,
  "payload"           jsonb       NOT NULL,
  "issue"             text,
  "applied_entity_id" uuid,
  CONSTRAINT "curriculum_publication_item_type_check" CHECK ("object_type_code" IN ('programme', 'module')),
  CONSTRAINT "curriculum_publication_item_change_check" CHECK ("change_type_code" IN ('add', 'change', 'close', 'unchanged', 'invalid'))
);
CREATE INDEX IF NOT EXISTS "curriculum_publication_item_pub_idx" ON "curriculum_publication_item" ("tenant_id", "publication_id");

CREATE TABLE IF NOT EXISTS "recognised_credit" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"          uuid        NOT NULL,
  "recognition_type_code" text        NOT NULL,   -- value set credit-recognition-type-code
  "source_description"    text        NOT NULL,   -- prior institution, qualification or learning
  "credit_value"          smallint    NOT NULL CHECK ("credit_value" > 0),
  "fheq_level"            smallint    CHECK ("fheq_level" BETWEEN 3 AND 8),
  "module_id"             uuid,                   -- module the credit exempts, if any
  "status_case_id"        uuid,                   -- the transfer that mapped it, if any
  "evidence_ref"          text,
  -- proposed | approved | rejected
  "status_code"           text        NOT NULL DEFAULT 'proposed',
  "created_by"            text        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text,
  CONSTRAINT "recognised_credit_status_check" CHECK ("status_code" IN ('proposed', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS "recognised_credit_enrolment_idx" ON "recognised_credit" ("tenant_id", "enrolment_id");

CREATE TABLE IF NOT EXISTS "rule_exception" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"          uuid        NOT NULL,
  "programme_rule_set_id" uuid,
  "rule_code"             text        NOT NULL,   -- the rule varied, e.g. a diet or credit-load rule
  "exception_type_code"   text        NOT NULL,   -- value set rule-exception-type-code
  "description"           text        NOT NULL,
  "valid_from"            date        NOT NULL,
  "valid_to"              date,
  "authority_ref"         text,                   -- e.g. the committee minute
  -- proposed | approved | rejected | revoked
  "status_code"           text        NOT NULL DEFAULT 'proposed',
  "created_by"            text        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text,
  CONSTRAINT "rule_exception_status_check" CHECK ("status_code" IN ('proposed', 'approved', 'rejected', 'revoked')),
  CONSTRAINT "rule_exception_dates_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
);
CREATE INDEX IF NOT EXISTS "rule_exception_enrolment_idx" ON "rule_exception" ("tenant_id", "enrolment_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['curriculum_publication', 'curriculum_publication_item', 'recognised_credit', 'rule_exception'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('credit-recognition-type-code', 'Credit Recognition Type', 'srs-internal', NULL, 'Basis on which credit is recognised for a student', true),
  ('rule-exception-type-code', 'Rule Exception Type', 'srs-internal', NULL, 'Kind of authorised exception to a programme rule', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('credit-recognition-type-code', 'rpcl',        'Recognition of prior certificated learning',  10),
  ('credit-recognition-type-code', 'rpel',        'Recognition of prior experiential learning', 20),
  ('credit-recognition-type-code', 'transfer-in', 'Credit transferred in',                       30),
  ('credit-recognition-type-code', 'internal-transfer', 'Credit carried across an internal transfer', 40),
  ('credit-recognition-type-code', 'exemption',   'Module exemption',                            50),
  ('rule-exception-type-code', 'waiver',    'Waiver',    10),
  ('rule-exception-type-code', 'variation', 'Variation', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('recognised_credit', 'recognition_type_code', 'credit-recognition-type-code', NULL),
  ('rule_exception', 'exception_type_code', 'rule-exception-type-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0009_reassessment_and_conferment.sql
-- ════════════════════════════════════════════════════════════

-- 0009 — Reassessment plans, award recommendation and conferment (BPR-D14; BP-06-002, BP-06-003)
--
-- reassessment_plan: the next attempt an authorised (ratified) progression
--   decision creates: resit without attendance, referral, repeat module,
--   repeat stage, deferral or an exceptional additional attempt, with its
--   attempt number and any mark cap. Tracked to completion or expiry
--   without overwriting earlier attempts.
-- award_recommendation: the board's recommendation (BP-06-003 step 4),
--   bound to the calculated classification; any difference is recorded as
--   authorised discretion with a reason.
-- award_conferment: the immutable conferment by a delegated authority who is
--   not the recommender (step 5), which creates the award (step 6). Rows
--   cannot be updated or deleted: a correction is a new, separate record
--   (E2).

CREATE TABLE IF NOT EXISTS "reassessment_plan" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"             uuid        NOT NULL,
  "progression_decision_id"  uuid        NOT NULL,   -- the authorised decision it follows
  "plan_type_code"           text        NOT NULL,   -- value set reassessment-plan-type-code
  "module_registration_id"   uuid,                   -- module-level plans
  "assessment_component_id"  uuid,
  "academic_period_id"       uuid,
  "attempt_number"           smallint    NOT NULL CHECK ("attempt_number" >= 2),
  "mark_cap"                 smallint    CHECK ("mark_cap" BETWEEN 0 AND 100),
  "due_date"                 date,
  -- planned | completed | expired | cancelled
  "status_code"              text        NOT NULL DEFAULT 'planned',
  "outcome_note"             text,
  "created_by"               text        NOT NULL,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "closed_by"                text,
  "closed_at"                timestamptz,
  CONSTRAINT "reassessment_plan_status_check" CHECK ("status_code" IN ('planned', 'completed', 'expired', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "reassessment_plan_enrolment_idx" ON "reassessment_plan" ("tenant_id", "enrolment_id");

CREATE TABLE IF NOT EXISTS "award_recommendation" (
  "id"                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"                 uuid        NOT NULL,
  "person_id"                    uuid        NOT NULL,
  "exam_board_id"                uuid,
  "award_type_code"              text        NOT NULL,   -- value set award-type-code
  "qualification_code"           text        NOT NULL,
  "classification_code"          text        NOT NULL,
  "calculated_classification_code" text,
  "aggregate_mark"               numeric(6,2),
  "discretion_reason"            text,                   -- set when classification differs from the calculation
  "authority_ref"                text,                   -- policy authority for aegrotat/posthumous awards
  -- recommended | conferred | withdrawn
  "status_code"                  text        NOT NULL DEFAULT 'recommended',
  "recommended_by"               text        NOT NULL,
  "recommended_at"               timestamptz NOT NULL DEFAULT now(),
  "withdrawn_reason"             text,
  CONSTRAINT "award_recommendation_status_check" CHECK ("status_code" IN ('recommended', 'conferred', 'withdrawn')),
  CONSTRAINT "award_recommendation_discretion_check"
    CHECK ("calculated_classification_code" IS NULL OR "classification_code" = "calculated_classification_code" OR "discretion_reason" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS "award_recommendation_one_open"
  ON "award_recommendation" ("tenant_id", "enrolment_id") WHERE "status_code" = 'recommended';

CREATE TABLE IF NOT EXISTS "award_conferment" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant" ("id"),
  "recommendation_id"  uuid        NOT NULL UNIQUE REFERENCES "award_recommendation" ("id"),
  "award_id"           uuid        NOT NULL,
  "conferment_date"    date        NOT NULL,
  "authority_ref"      text        NOT NULL,   -- the delegated authority, e.g. Senate minute
  "conferred_by"       text        NOT NULL,
  "conferred_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION award_conferment_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'award conferment is append-only; record a correction or revocation instead';
END;
$$;

CREATE TRIGGER award_conferment_immutable_guard
  BEFORE UPDATE OR DELETE ON "award_conferment"
  FOR EACH ROW EXECUTE FUNCTION award_conferment_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reassessment_plan', 'award_recommendation', 'award_conferment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('reassessment-plan-type-code', 'Reassessment Plan Type', 'srs-internal', NULL, 'Kind of further attempt an authorised progression decision creates', true),
  ('award-type-code', 'Award Type', 'srs-internal', NULL, 'Basis of an award recommendation', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('reassessment-plan-type-code', 'resit-without-attendance', 'Resit without attendance',       10),
  ('reassessment-plan-type-code', 'referral',                 'Referral',                       20),
  ('reassessment-plan-type-code', 'repeat-module',            'Repeat module with attendance',  30),
  ('reassessment-plan-type-code', 'repeat-stage',             'Repeat stage',                   40),
  ('reassessment-plan-type-code', 'deferral',                 'Deferral (first attempt treatment)', 50),
  ('reassessment-plan-type-code', 'additional-attempt',       'Exceptional additional attempt', 60),
  ('award-type-code', 'standard',   'Standard award', 10),
  ('award-type-code', 'exit',       'Exit award',     20),
  ('award-type-code', 'aegrotat',   'Aegrotat award', 30),
  ('award-type-code', 'posthumous', 'Posthumous award', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('reassessment_plan', 'plan_type_code', 'reassessment-plan-type-code', NULL),
  ('award_recommendation', 'award_type_code', 'award-type-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0010_documents_and_graduation.sql
-- ════════════════════════════════════════════════════════════

-- 0010 — Award documents and graduation (BPR-D15; BP-06-004, BP-06-005)
--
-- student_document: a document the student is entitled to for a conferred
--   award (certificate, transcript, HEAR, award letter).
-- document_issue: each issue of it, numbered, with the exact content
--   snapshot, its SHA-256 hash and a verification code. Replacement,
--   corrected-name and certified-copy issues are new rows; history is never
--   rewritten (BP-06-004 A1).
-- document_revocation: append-only; a compromised or erroneous issue is
--   revoked, not deleted (E2).
-- document_verification: each verification check and its outcome.
-- graduation_cycle / graduation_ceremony / graduation_invitation /
--   ceremony_allocation: invitations derived from conferred awards,
--   students' choices, allocation within ceremony capacity, a frozen
--   presentation list, and attendance recorded separately from the award
--   (BP-06-005 step 6, E1).

CREATE TABLE IF NOT EXISTS "student_document" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "award_id"            uuid        NOT NULL,
  "enrolment_id"        uuid        NOT NULL,
  "person_id"           uuid        NOT NULL,
  "document_type_code"  text        NOT NULL,   -- value set student-document-type-code
  "created_by"          text        NOT NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_document_one_per_type" UNIQUE ("tenant_id", "award_id", "document_type_code")
);

CREATE TABLE IF NOT EXISTS "document_issue" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "student_document_id" uuid        NOT NULL REFERENCES "student_document" ("id"),
  "issue_number"        smallint    NOT NULL,
  "issue_type_code"     text        NOT NULL,   -- value set document-issue-type-code
  "content_snapshot"    jsonb       NOT NULL,
  "content_hash"        text        NOT NULL,
  "verification_code"   text        NOT NULL,
  "channel_code"        text        NOT NULL,   -- value set document-channel-code
  -- issued | superseded | revoked
  "status_code"         text        NOT NULL DEFAULT 'issued',
  "issued_by"           text        NOT NULL,
  "issued_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_issue_status_check" CHECK ("status_code" IN ('issued', 'superseded', 'revoked')),
  CONSTRAINT "document_issue_number_unique" UNIQUE ("student_document_id", "issue_number"),
  CONSTRAINT "document_issue_verification_unique" UNIQUE ("verification_code")
);

CREATE TABLE IF NOT EXISTS "document_revocation" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "document_issue_id" uuid        NOT NULL UNIQUE REFERENCES "document_issue" ("id"),
  "reason_code"       text        NOT NULL,   -- value set document-revocation-reason-code
  "reason_text"       text        NOT NULL,
  "revoked_by"        text        NOT NULL,
  "revoked_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "document_verification" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "document_issue_id" uuid,                 -- null when the code matched nothing
  "verification_code" text        NOT NULL,
  "requested_by"      text        NOT NULL,
  "requester_note"    text,                 -- e.g. the verifying organisation
  -- valid | revoked | superseded | not-found
  "outcome_code"      text        NOT NULL,
  "checked_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION document_revocation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document revocations are append-only';
END;
$$;
CREATE TRIGGER document_revocation_immutable_guard
  BEFORE UPDATE OR DELETE ON "document_revocation"
  FOR EACH ROW EXECUTE FUNCTION document_revocation_immutable();

CREATE TABLE IF NOT EXISTS "graduation_cycle" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "cycle_code"        text        NOT NULL,
  "title"             text        NOT NULL,
  "awards_from"       date        NOT NULL,   -- awards conferred in [awards_from, awards_to] are eligible
  "awards_to"         date        NOT NULL,
  -- open | frozen | closed
  "status_code"       text        NOT NULL DEFAULT 'open',
  "created_by"        text        NOT NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "frozen_at"         timestamptz,
  CONSTRAINT "graduation_cycle_status_check" CHECK ("status_code" IN ('open', 'frozen', 'closed')),
  CONSTRAINT "graduation_cycle_window_check" CHECK ("awards_to" >= "awards_from"),
  CONSTRAINT "graduation_cycle_code_unique" UNIQUE ("tenant_id", "cycle_code")
);

CREATE TABLE IF NOT EXISTS "graduation_ceremony" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant" ("id"),
  "cycle_id"      uuid        NOT NULL REFERENCES "graduation_cycle" ("id"),
  "ceremony_code" text        NOT NULL,
  "starts_at"     timestamptz NOT NULL,
  "venue"         text        NOT NULL,
  "capacity"      integer     NOT NULL CHECK ("capacity" > 0),
  "guest_limit"   smallint    NOT NULL DEFAULT 2 CHECK ("guest_limit" >= 0),
  CONSTRAINT "graduation_ceremony_code_unique" UNIQUE ("cycle_id", "ceremony_code")
);

CREATE TABLE IF NOT EXISTS "graduation_invitation" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "cycle_id"                 uuid        NOT NULL REFERENCES "graduation_cycle" ("id"),
  "award_id"                 uuid        NOT NULL,
  "person_id"                uuid        NOT NULL,
  -- invited | attending | in-absentia | deferred | declined
  "response_code"            text        NOT NULL DEFAULT 'invited',
  "guest_count"              smallint    NOT NULL DEFAULT 0 CHECK ("guest_count" >= 0),
  "accessibility_required"   boolean     NOT NULL DEFAULT false,  -- detail stays with the support team (E2)
  "responded_at"             timestamptz,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "graduation_invitation_response_check" CHECK ("response_code" IN ('invited', 'attending', 'in-absentia', 'deferred', 'declined')),
  CONSTRAINT "graduation_invitation_award_unique" UNIQUE ("cycle_id", "award_id")
);

CREATE TABLE IF NOT EXISTS "ceremony_allocation" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "invitation_id"       uuid        NOT NULL UNIQUE REFERENCES "graduation_invitation" ("id"),
  "ceremony_id"         uuid        NOT NULL REFERENCES "graduation_ceremony" ("id"),
  "presentation_order"  integer,
  -- allocated | attended | absent
  "attendance_code"     text        NOT NULL DEFAULT 'allocated',
  "allocated_by"        text        NOT NULL,
  "allocated_at"        timestamptz NOT NULL DEFAULT now(),
  "attendance_recorded_at" timestamptz,
  CONSTRAINT "ceremony_allocation_attendance_check" CHECK ("attendance_code" IN ('allocated', 'attended', 'absent'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_document', 'document_issue', 'document_revocation', 'document_verification',
                           'graduation_cycle', 'graduation_ceremony', 'graduation_invitation', 'ceremony_allocation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('student-document-type-code', 'Student Document Type', 'srs-internal', NULL, 'Award document a student is issued', true),
  ('document-issue-type-code', 'Document Issue Type', 'srs-internal', NULL, 'Kind of issue of an award document', false),
  ('document-channel-code', 'Document Delivery Channel', 'srs-internal', NULL, 'How an issued document is delivered', true),
  ('document-revocation-reason-code', 'Document Revocation Reason', 'srs-internal', NULL, 'Why an issued document was revoked', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('student-document-type-code', 'certificate',  'Award certificate', 10),
  ('student-document-type-code', 'transcript',   'Transcript',        20),
  ('student-document-type-code', 'hear',         'Higher Education Achievement Report', 30),
  ('student-document-type-code', 'award-letter', 'Award letter',      40),
  ('document-issue-type-code', 'original',       'Original',           10),
  ('document-issue-type-code', 'replacement',    'Replacement',        20),
  ('document-issue-type-code', 'corrected-name', 'Corrected name',     30),
  ('document-issue-type-code', 'certified-copy', 'Certified copy',     40),
  ('document-channel-code', 'digital',    'Secure digital delivery', 10),
  ('document-channel-code', 'post',       'Post',                    20),
  ('document-channel-code', 'collection', 'Collection in person',    30),
  ('document-revocation-reason-code', 'error',         'Issued in error',     10),
  ('document-revocation-reason-code', 'compromised',   'Compromised',         20),
  ('document-revocation-reason-code', 'award-revoked', 'Award revoked',       30),
  ('document-revocation-reason-code', 'other',         'Other',               40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('student_document', 'document_type_code', 'student-document-type-code', NULL),
  ('document_issue', 'issue_type_code', 'document-issue-type-code', NULL),
  ('document_issue', 'channel_code', 'document-channel-code', NULL),
  ('document_revocation', 'reason_code', 'document-revocation-reason-code', NULL)
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- Originally 0011_applications_and_offers.sql
-- ════════════════════════════════════════════════════════════

-- 0011 — Applications and offers (BPR-D01, BPR-D02; BP-01-001 to BP-01-004)
--
-- application_received_payload: every payload as received, append-only and
--   idempotent per channel, source reference and content hash.
-- student_application: the channel-neutral working application. The
--   applicant is matched to a person only on certain evidence; an
--   uncertain match is routed for review, never merged (BP-01-001 step 3).
--   Bridges to ucas_application for the UCAS channel.
-- application_assessment: each assessment outcome with its assessor and
--   evidence version, append-only (BP-01-002 step 4).
-- admissions_offer: the authorised offer. An authorised change creates a
--   new version that supersedes the old one (BP-01-003 step 6).
-- offer_condition / condition_evidence: individually testable conditions
--   and the evidence mapped to them, with provenance (BP-01-004).
-- offer_confirmation_decision: the overall confirmation decision with the
--   frozen condition versions it tested, append-only.

CREATE TABLE IF NOT EXISTS "application_received_payload" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL REFERENCES "tenant" ("id"),
  "channel_code"      text        NOT NULL,   -- value set application-channel-code
  "source_reference"  text        NOT NULL,
  "cycle"             text        NOT NULL,
  "payload"           jsonb       NOT NULL,
  "payload_hash"      text        NOT NULL,
  "received_by"       text        NOT NULL,
  "received_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "application_received_payload_unique" UNIQUE ("tenant_id", "channel_code", "source_reference", "payload_hash")
);

CREATE TABLE IF NOT EXISTS "student_application" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "channel_code"          text        NOT NULL,
  "source_reference"      text        NOT NULL,
  "cycle"                 text        NOT NULL,
  "person_id"             uuid,                   -- null until the applicant identity is confirmed
  -- matched | created | needs-review
  "identity_match_code"   text        NOT NULL,
  "programme_id"          uuid        NOT NULL,
  "intake_code"           text        NOT NULL,   -- e.g. 2027-09
  "mode_of_study_code"    text        NOT NULL,
  "latest_payload_id"     uuid        NOT NULL REFERENCES "application_received_payload" ("id"),
  "ucas_application_id"   uuid,
  -- received | incomplete | under-assessment | recommended | rejected | offered | withdrawn
  "status_code"           text        NOT NULL DEFAULT 'received',
  "routing_reason_code"   text,                   -- why it is on a worklist: incomplete | duplicate | restricted | identity
  "recommendation_code"   text,                   -- offer | reject
  "recommendation_reason" text,
  "recommended_by"        text,
  "recommended_at"        timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "student_application_status_check" CHECK ("status_code" IN ('received', 'incomplete', 'under-assessment', 'recommended', 'rejected', 'offered', 'withdrawn')),
  CONSTRAINT "student_application_identity_check" CHECK ("identity_match_code" IN ('matched', 'created', 'needs-review')),
  CONSTRAINT "student_application_source_unique" UNIQUE ("tenant_id", "channel_code", "source_reference")
);

CREATE TABLE IF NOT EXISTS "application_assessment" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "application_id"        uuid        NOT NULL REFERENCES "student_application" ("id"),
  "assessment_type_code"  text        NOT NULL,   -- value set application-assessment-type-code
  "outcome_code"          text        NOT NULL,   -- value set application-assessment-outcome-code
  "evidence_ref"          text,
  "evidence_version"      text,
  "note"                  text,
  "assessed_by"           text        NOT NULL,
  "assessed_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "admissions_offer" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "application_id"        uuid        NOT NULL REFERENCES "student_application" ("id"),
  "version"               smallint    NOT NULL,
  "previous_offer_id"     uuid        REFERENCES "admissions_offer" ("id"),
  "programme_id"          uuid        NOT NULL,
  "intake_code"           text        NOT NULL,
  "mode_of_study_code"    text        NOT NULL,
  "fee_status_basis_code" text,
  "offer_type_code"       text        NOT NULL,   -- conditional | unconditional
  -- made | accepted | declined | withdrawn | expired | superseded | confirmed | unsuccessful
  "status_code"           text        NOT NULL DEFAULT 'made',
  "expires_on"            date,
  "decided_by"            text        NOT NULL,
  "decided_at"            timestamptz NOT NULL DEFAULT now(),
  "change_reason"         text,
  "response_code"         text,                   -- accept | decline
  "response_source_at"    timestamptz,            -- the applicant channel's timestamp
  "responded_at"          timestamptz,
  CONSTRAINT "admissions_offer_type_check" CHECK ("offer_type_code" IN ('conditional', 'unconditional')),
  CONSTRAINT "admissions_offer_status_check" CHECK ("status_code" IN ('made', 'accepted', 'declined', 'withdrawn', 'expired', 'superseded', 'confirmed', 'unsuccessful')),
  CONSTRAINT "admissions_offer_version_unique" UNIQUE ("application_id", "version")
);

CREATE TABLE IF NOT EXISTS "offer_condition" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "offer_id"            uuid        NOT NULL REFERENCES "admissions_offer" ("id"),
  "condition_type_code" text        NOT NULL,   -- value set offer-condition-type-code
  "description"         text        NOT NULL,
  "required_value"      text,                   -- e.g. AAB, IELTS 6.5
  -- pending | met | waived | unmet
  "status_code"         text        NOT NULL DEFAULT 'pending',
  "decided_by"          text,
  "decided_at"          timestamptz,
  "decision_note"       text,
  CONSTRAINT "offer_condition_status_check" CHECK ("status_code" IN ('pending', 'met', 'waived', 'unmet'))
);

CREATE TABLE IF NOT EXISTS "condition_evidence" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant" ("id"),
  "condition_id"        uuid        NOT NULL REFERENCES "offer_condition" ("id"),
  "provenance_code"     text        NOT NULL,   -- value set evidence-provenance-code
  "evidence_ref"        text        NOT NULL,
  "reported_value"      text,
  "verified"            boolean     NOT NULL DEFAULT false,
  "received_by"         text        NOT NULL,
  "received_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "offer_confirmation_decision" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL REFERENCES "tenant" ("id"),
  "offer_id"                 uuid        NOT NULL UNIQUE REFERENCES "admissions_offer" ("id"),
  -- confirmed | confirmed-alternative | unsuccessful
  "decision_code"            text        NOT NULL,
  "alternative_programme_id" uuid,
  "condition_snapshot"       jsonb       NOT NULL,   -- the frozen condition versions tested
  "reason"                   text,
  "handoff_workflow_instance_id" uuid,
  "decided_by"               text        NOT NULL,
  "decided_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "offer_confirmation_decision_check" CHECK ("decision_code" IN ('confirmed', 'confirmed-alternative', 'unsuccessful'))
);

CREATE FUNCTION admissions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER application_received_payload_append_only BEFORE UPDATE OR DELETE ON "application_received_payload"
  FOR EACH ROW EXECUTE FUNCTION admissions_append_only();
CREATE TRIGGER application_assessment_append_only BEFORE UPDATE OR DELETE ON "application_assessment"
  FOR EACH ROW EXECUTE FUNCTION admissions_append_only();
CREATE TRIGGER offer_confirmation_decision_append_only BEFORE UPDATE OR DELETE ON "offer_confirmation_decision"
  FOR EACH ROW EXECUTE FUNCTION admissions_append_only();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['application_received_payload', 'student_application', 'application_assessment', 'admissions_offer',
                           'offer_condition', 'condition_evidence', 'offer_confirmation_decision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('application-channel-code', 'Application Channel', 'srs-internal', NULL, 'Route by which an application arrives', true),
  ('application-assessment-type-code', 'Application Assessment Type', 'srs-internal', NULL, 'Kind of application assessment', true),
  ('application-assessment-outcome-code', 'Application Assessment Outcome', 'srs-internal', NULL, 'Outcome of an application assessment', false),
  ('offer-condition-type-code', 'Offer Condition Type', 'srs-internal', NULL, 'Kind of offer condition', true),
  ('evidence-provenance-code', 'Evidence Provenance', 'srs-internal', NULL, 'Where condition evidence came from', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('application-channel-code', 'ucas',                 'UCAS',                   10),
  ('application-channel-code', 'direct',               'Direct',                 20),
  ('application-channel-code', 'agent',                'Agent',                  30),
  ('application-channel-code', 'international-direct', 'International direct',   40),
  ('application-channel-code', 'international-agent',  'International agent',    50),
  ('application-channel-code', 'clearing',             'Clearing',               60),
  ('application-assessment-type-code', 'academic',     'Academic evidence',  10),
  ('application-assessment-type-code', 'contextual',   'Contextual data',    20),
  ('application-assessment-type-code', 'interview',    'Interview',          30),
  ('application-assessment-type-code', 'portfolio',    'Portfolio',          40),
  ('application-assessment-type-code', 'safeguarding', 'Safeguarding and compliance', 50),
  ('application-assessment-outcome-code', 'meets',         'Meets criteria',        10),
  ('application-assessment-outcome-code', 'does-not-meet', 'Does not meet criteria', 20),
  ('application-assessment-outcome-code', 'clear',         'No concern',            30),
  ('application-assessment-outcome-code', 'concern',       'Concern raised',        40),
  ('offer-condition-type-code', 'academic',    'Academic result',        10),
  ('offer-condition-type-code', 'language',    'English language',       20),
  ('offer-condition-type-code', 'document',    'Document or verification', 30),
  ('offer-condition-type-code', 'non-academic','Other non-academic',     40),
  ('evidence-provenance-code', 'ucas-results',  'UCAS results',      10),
  ('evidence-provenance-code', 'awarding-body', 'Awarding body',     20),
  ('evidence-provenance-code', 'applicant',     'Applicant upload',  30),
  ('evidence-provenance-code', 'test-provider', 'Test provider',     40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('student_application', 'channel_code', 'application-channel-code', NULL),
  ('application_assessment', 'assessment_type_code', 'application-assessment-type-code', NULL),
  ('application_assessment', 'outcome_code', 'application-assessment-outcome-code', NULL),
  ('offer_condition', 'condition_type_code', 'offer-condition-type-code', NULL),
  ('condition_evidence', 'provenance_code', 'evidence-provenance-code', NULL)
ON CONFLICT DO NOTHING;

-- Originally 0008_registration_integrations_and_rule_depth.sql

-- 0008 — Rule exceptions, admissions bridge and person indexes; registration
-- and the other Phase 2 processes; Phase 3 integrations and outputs; Phase 4
-- rule depth in module selection and status.
-- Squashed 2026-11-17 from 0008 and 0009.


-- Originally 0008_rules_admissions_and_person_indexes.sql
-- Refinements after the business-process aggregates: rule exceptions applied by
-- the rules engine (BPR-D05), the UCAS adapter feeding the channel-neutral
-- application (BPR-D01), and indexes on every foreign key into person.

-- Originally 0008_rule_exceptions_and_ucas_bridge.sql
-- Rule exceptions and recognised credit applied by the rules engine (BPR-D05),
-- and the UCAS adapter feeding the channel-neutral application (BPR-D01).

-- Originally 0008_exception_values_and_credit_years.sql
-- 0008 — Rule exception values and recognised-credit years (BPR-D05 wiring)
--
-- rule_exception.variation_value: what an approved variation replaces the
--   programme rule's value with, in that rule's own shape (e.g.
--   {"maxCredits": 140} for max-credits-per-period). A waiver has none.
-- recognised_credit.academic_year: the academic year whose progression the
--   credit counts towards; null means it counts only towards the award.

ALTER TABLE "rule_exception" ADD COLUMN IF NOT EXISTS "variation_value" jsonb;
ALTER TABLE "rule_exception" DROP CONSTRAINT IF EXISTS "rule_exception_variation_value_check";
ALTER TABLE "rule_exception" ADD CONSTRAINT "rule_exception_variation_value_check"
  CHECK (("exception_type_code" = 'variation') = ("variation_value" IS NOT NULL));

ALTER TABLE "recognised_credit" ADD COLUMN IF NOT EXISTS "academic_year" text;
CREATE INDEX IF NOT EXISTS "recognised_credit_year_idx" ON "recognised_credit" ("tenant_id", "enrolment_id", "academic_year");

-- Originally 0009_ucas_application_bridge.sql
-- 0009 — The UCAS adapter feeds the channel-neutral application (BPR-D01)
--
-- A channel can send an application before it names a recognised programme,
-- intake or mode of study. Such an application is still received and kept,
-- on the incomplete worklist, instead of being refused: the route facts are
-- nullable, but only while the application is incomplete.

ALTER TABLE "student_application" ALTER COLUMN "programme_id" DROP NOT NULL;
ALTER TABLE "student_application" ALTER COLUMN "intake_code" DROP NOT NULL;
ALTER TABLE "student_application" ALTER COLUMN "mode_of_study_code" DROP NOT NULL;

ALTER TABLE "student_application" DROP CONSTRAINT IF EXISTS "student_application_route_facts_check";
ALTER TABLE "student_application" ADD CONSTRAINT "student_application_route_facts_check"
  CHECK ("status_code" = 'incomplete'
    OR ("programme_id" IS NOT NULL AND "intake_code" IS NOT NULL AND "mode_of_study_code" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "student_application_ucas_idx"
  ON "student_application" ("tenant_id", "ucas_application_id") WHERE "ucas_application_id" IS NOT NULL;

-- Originally 0009_person_foreign_key_indexes.sql
-- 0009 — Index every foreign key into person
--
-- Each column below references person(id) but had no index leading with it
-- (some had (tenant_id, person_id), which a foreign-key check cannot use).
-- Deleting a person then scanned every one of these tables in full: slow for
-- an erasure or identity merge, and over a minute for a demo reset of a
-- large scenario. Postgres does not index foreign-key columns itself.

CREATE INDEX IF NOT EXISTS data_correction_case_person_id_fk_idx ON data_correction_case (person_id);
CREATE INDEX IF NOT EXISTS disability_declaration_person_id_fk_idx ON disability_declaration (person_id);
CREATE INDEX IF NOT EXISTS enrolment_person_id_fk_idx ON enrolment (person_id);
CREATE INDEX IF NOT EXISTS examiner_appointment_person_id_fk_idx ON examiner_appointment (person_id);
CREATE INDEX IF NOT EXISTS fee_liability_person_id_fk_idx ON fee_liability (person_id);
CREATE INDEX IF NOT EXISTS hesa_identifier_assignment_person_id_fk_idx ON hesa_identifier_assignment (person_id);
CREATE INDEX IF NOT EXISTS identity_redirect_new_person_id_fk_idx ON identity_redirect (new_person_id);
CREATE INDEX IF NOT EXISTS identity_redirect_old_person_id_fk_idx ON identity_redirect (old_person_id);
CREATE INDEX IF NOT EXISTS identity_resolution_candidate_candidate_person_id_fk_idx ON identity_resolution_candidate (candidate_person_id);
CREATE INDEX IF NOT EXISTS identity_resolution_decision_survivor_person_id_fk_idx ON identity_resolution_decision (survivor_person_id);
CREATE INDEX IF NOT EXISTS identity_verification_check_person_id_fk_idx ON identity_verification_check (person_id);
CREATE INDEX IF NOT EXISTS individual_rights_request_person_id_fk_idx ON individual_rights_request (person_id);
CREATE INDEX IF NOT EXISTS person_identity_link_source_person_id_fk_idx ON person_identity_link (source_person_id);
CREATE INDEX IF NOT EXISTS person_identity_link_target_person_id_fk_idx ON person_identity_link (target_person_id);
CREATE INDEX IF NOT EXISTS person_identity_person_id_fk_idx ON person_identity (person_id);
CREATE INDEX IF NOT EXISTS pgr_review_member_person_id_fk_idx ON pgr_review_member (person_id);
CREATE INDEX IF NOT EXISTS pgr_supervisor_nomination_person_id_fk_idx ON pgr_supervisor_nomination (person_id);
CREATE INDEX IF NOT EXISTS processing_restriction_person_id_fk_idx ON processing_restriction (person_id);
CREATE INDEX IF NOT EXISTS staff_assignment_person_id_fk_idx ON staff_assignment (person_id);
CREATE INDEX IF NOT EXISTS student_address_person_id_fk_idx ON student_address (person_id);
CREATE INDEX IF NOT EXISTS student_contact_method_person_id_fk_idx ON student_contact_method (person_id);
CREATE INDEX IF NOT EXISTS student_regulatory_profile_person_id_fk_idx ON student_regulatory_profile (person_id);

-- Originally 0009_registration_and_phase2.sql
-- 0009 — Registration and the other Phase 2 processes
-- (docs/decisions/phase-2-gap-closure-decisions.md, D-8 to D-13)
--
-- D-8  Annual re-registration: who opened and closed a period, its kind
--      (annual or initial), and on each confirmation who confirmed it,
--      through which channel, the terms version accepted and, for an
--      assisted confirmation, why. One current confirmation per enrolment
--      and period; one fee liability per enrolment and year.
-- D-10 A new enrolment status, pre-registration, before a new entrant
--      registers. The enrolment created from a confirmed offer has an ID
--      derived from the offer, so no column is needed on the append-only
--      offer_confirmation_decision.
-- D-11 The reason for changing one student's curriculum binding.
-- D-12 No two live reassessment plans of one type per decision and module.
-- D-13 A verbal Clearing offer is an offer type.

-- ── D-8 Re-registration ─────────────────────────────────────────────────────

ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "period_type_code" text NOT NULL DEFAULT 'annual';
ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "opened_by" text;
ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "closed_at" timestamptz;
ALTER TABLE "reenrolment_period" ADD COLUMN IF NOT EXISTS "closed_by" text;
ALTER TABLE "reenrolment_period" DROP CONSTRAINT IF EXISTS "reenrolment_period_type_check";
ALTER TABLE "reenrolment_period" ADD CONSTRAINT "reenrolment_period_type_check" CHECK ("period_type_code" IN ('annual', 'initial'));

ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "confirmed_by" text;
ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "channel_code" text;
ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "terms_version" text;
ALTER TABLE "reenrolment_confirmation" ADD COLUMN IF NOT EXISTS "assisted_reason_code" text;
ALTER TABLE "reenrolment_confirmation" DROP CONSTRAINT IF EXISTS "reenrolment_confirmation_channel_check";
ALTER TABLE "reenrolment_confirmation" ADD CONSTRAINT "reenrolment_confirmation_channel_check"
  CHECK ("channel_code" IS NULL OR "channel_code" IN ('portal', 'assisted'));
ALTER TABLE "reenrolment_confirmation" DROP CONSTRAINT IF EXISTS "reenrolment_confirmation_assisted_reason_check";
ALTER TABLE "reenrolment_confirmation" ADD CONSTRAINT "reenrolment_confirmation_assisted_reason_check"
  CHECK (("channel_code" = 'assisted') = ("assisted_reason_code" IS NOT NULL) OR "channel_code" IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "reenrolment_confirmation_one_per_period"
  ON "reenrolment_confirmation" ("tenant_id", "enrolment_id", "reenrolment_period_id") WHERE "recorded_until" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "fee_liability_one_per_year"
  ON "fee_liability" ("tenant_id", "enrolment_id", "academic_year");

-- ── D-11 Curriculum binding change reason ───────────────────────────────────

ALTER TABLE "enrolment_curriculum_binding" ADD COLUMN IF NOT EXISTS "change_reason_code" text;

-- A change that something already depends on (module registrations, a
-- selection proposal or marks in the current year) is proposed by one
-- person and decided by a programme approver, never the proposer.
CREATE TABLE IF NOT EXISTS "curriculum_binding_change" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant" ("id"),
  "enrolment_id"          uuid        NOT NULL,
  "programme_route_id"    uuid,
  "programme_rule_set_id" uuid        NOT NULL,
  "change_reason_code"    text        NOT NULL,   -- value set curriculum-binding-change-reason-code
  "reason"                text        NOT NULL,
  "effective_date"        date        NOT NULL,
  "status_code"           text        NOT NULL DEFAULT 'proposed',
  "proposed_by"           text        NOT NULL,
  "proposed_at"           timestamptz NOT NULL DEFAULT now(),
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text,
  CONSTRAINT "curriculum_binding_change_status_check" CHECK ("status_code" IN ('proposed', 'approved', 'rejected', 'applied-directly'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "curriculum_binding_change_one_open"
  ON "curriculum_binding_change" ("tenant_id", "enrolment_id") WHERE "status_code" = 'proposed';
ALTER TABLE "curriculum_binding_change" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curriculum_binding_change" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "curriculum_binding_change";
CREATE POLICY tenant_isolation ON "curriculum_binding_change" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-12 No duplicate live plan of a type per decision and module ───────────
-- A decision can hold several plans for one module (a deferral, a referral,
-- then an additional attempt), but never two live plans of the same type:
-- repeating ratification cannot duplicate the plans it created.

CREATE UNIQUE INDEX IF NOT EXISTS "reassessment_plan_one_live_per_type"
  ON "reassessment_plan" ("progression_decision_id", COALESCE("module_registration_id", '00000000-0000-0000-0000-000000000000'::uuid), "plan_type_code")
  WHERE "status_code" <> 'cancelled';

-- ── D-13 Verbal Clearing offers ─────────────────────────────────────────────

ALTER TABLE "admissions_offer" DROP CONSTRAINT IF EXISTS "admissions_offer_type_check";
ALTER TABLE "admissions_offer" ADD CONSTRAINT "admissions_offer_type_check"
  CHECK ("offer_type_code" IN ('conditional', 'unconditional', 'clearing-verbal'));

-- ── Value sets ──────────────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('registration-assisted-reason-code', 'Assisted Registration Reason', 'srs-internal', NULL, 'Why the registry confirmed a registration on a student''s behalf', true),
  ('curriculum-binding-change-reason-code', 'Curriculum Binding Change Reason', 'srs-internal', NULL, 'Why one student''s route or rule set was changed', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('enrolment-status-code', 'pre-registration', 'Pre-registration', 5),
  ('registration-assisted-reason-code', 'in-person',         'In person',                  10),
  ('registration-assisted-reason-code', 'phone',             'By phone',                   20),
  ('registration-assisted-reason-code', 'accessibility',     'Accessibility need',         30),
  ('registration-assisted-reason-code', 'provider-failure',  'Online registration failed', 40),
  ('registration-assisted-reason-code', 'late',              'Late registration',          50),
  ('curriculum-binding-change-reason-code', 'pathway-change',            'Pathway change',            10),
  ('curriculum-binding-change-reason-code', 'rule-set-correction',       'Rule set correction',       20),
  ('curriculum-binding-change-reason-code', 'recognised-prior-learning', 'Recognised prior learning', 30),
  ('curriculum-binding-change-reason-code', 'error',                     'Recorded in error',         40),
  ('student-status-reason-code', 'non-registration', 'Did not register', 130)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('reenrolment_confirmation', 'assisted_reason_code', 'registration-assisted-reason-code', NULL),
  ('enrolment_curriculum_binding', 'change_reason_code', 'curriculum-binding-change-reason-code', NULL)
ON CONFLICT DO NOTHING;

-- ── Failure to register (BP-02-011; D-9) ────────────────────────────────────
-- A lapsed registration opens a business case (process BP-02-011); contact
-- attempts are case evidence and the outcome is a case decision, so no new
-- table is needed. Only the picklists are new.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('registration-contact-channel-code', 'Registration Contact Channel', 'srs-internal', NULL, 'How the registry contacted a student who did not register', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('registration-contact-channel-code', 'portal',    'Portal notification', 10),
  ('registration-contact-channel-code', 'email',     'Email',               20),
  ('registration-contact-channel-code', 'phone',     'Phone call',          30),
  ('registration-contact-channel-code', 'letter',    'Letter',              40),
  ('registration-contact-channel-code', 'in-person', 'In person',           50),
  ('ukvi-alert-type-code', 'non-enrolment', 'Sponsored student did not register', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('non_registration_case', 'contact_channel_code', 'registration-contact-channel-code', 'Business case BP-02-011 contact attempts (stored as case evidence source_system)')
ON CONFLICT DO NOTHING;

-- Originally 0009_integrations_and_outputs.sql
-- 0009 — Integrations and outputs (Phase 3)
-- (docs/decisions/phase-3-gap-closure-decisions.md, D-14 to D-22)

-- ── D-16: one CAS record ────────────────────────────────────────────────────
-- cas_case becomes the system of record. A CAS is needed before the visa
-- application, so before any enrolment: a case belongs to an application (new
-- entrant) or an enrolment (in-country extension or course change).

ALTER TABLE "cas_case"
  ADD COLUMN IF NOT EXISTS "person_id"        uuid,
  ADD COLUMN IF NOT EXISTS "application_id"   uuid,
  ADD COLUMN IF NOT EXISTS "prepared_payload" jsonb,
  ADD COLUMN IF NOT EXISTS "prepared_by"      text;
ALTER TABLE "cas_case" ALTER COLUMN "enrolment_id" DROP NOT NULL;

UPDATE "cas_case" c SET "person_id" = e."person_id"
FROM "enrolment" e
WHERE e."id" = c."enrolment_id" AND e."tenant_id" = c."tenant_id" AND e."recorded_until" IS NULL AND c."person_id" IS NULL;

-- Carry any CAS request that has no case into cas_case, so no CAS is lost.
INSERT INTO "cas_case" ("version_id", "id", "tenant_id", "enrolment_id", "person_id", "cas_reference", "status_code", "actor_id", "valid_from", "recorded_at")
SELECT gen_random_uuid(), r."id", r."tenant_id", r."enrolment_id", e."person_id", r."cas_reference",
  CASE r."status_code" WHEN 'assigned' THEN 'assigned' WHEN 'used' THEN 'assigned' WHEN 'withdrawn' THEN 'withdrawn' WHEN 'expired' THEN 'withdrawn' ELSE 'opened' END,
  'migration-0009', r."valid_from", r."recorded_at"
FROM "ukvi_cas_request" r
JOIN "enrolment" e ON e."id" = r."enrolment_id" AND e."tenant_id" = r."tenant_id" AND e."recorded_until" IS NULL
WHERE r."recorded_until" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "cas_case" c WHERE c."tenant_id" = r."tenant_id" AND c."enrolment_id" = r."enrolment_id");

DELETE FROM "cas_case" WHERE "person_id" IS NULL;
ALTER TABLE "cas_case" ALTER COLUMN "person_id" SET NOT NULL;
ALTER TABLE "cas_case" DROP CONSTRAINT IF EXISTS "cas_case_subject_check";
ALTER TABLE "cas_case" ADD CONSTRAINT "cas_case_subject_check" CHECK ("application_id" IS NOT NULL OR "enrolment_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "cas_case_application_idx" ON "cas_case" ("tenant_id", "application_id");
CREATE INDEX IF NOT EXISTS "cas_case_person_idx" ON "cas_case" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "cas_case_reference_idx" ON "cas_case" ("tenant_id", "cas_reference") WHERE "recorded_until" IS NULL;

ALTER TABLE "ukvi_visa_status" ADD COLUMN IF NOT EXISTS "cas_case_id" uuid;
ALTER TABLE "ukvi_visa_status" ALTER COLUMN "enrolment_id" DROP NOT NULL;
ALTER TABLE "ukvi_compliance_alert" ADD COLUMN IF NOT EXISTS "cas_case_id" uuid;

DELETE FROM "field_value_set" WHERE "entity_name" = 'ukvi_cas_request';
DROP TABLE IF EXISTS "ukvi_cas_request";

-- The CAS case lifecycle (migration 0004) gains the preparation, approval and SMS steps.
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('cas-case-status-code', 'prepared',  'Prepared for approval', 22),
  ('cas-case-status-code', 'approved',  'Approved',              24),
  ('cas-case-status-code', 'requested', 'Sent to SMS',           26)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

-- ── D-17: right to study as its own outcome ─────────────────────────────────
-- Who checked, on what basis, by which method, and when permission expires:
-- separate from identity verification (D-6). Bitemporal: a specialist
-- decision or a recheck is a new version of the same check.

CREATE TABLE IF NOT EXISTS "right_to_study_check" (
  "version_id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                             uuid        NOT NULL,
  "tenant_id"                      uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"                      uuid        NOT NULL,
  "enrolment_id"                   uuid,
  "cas_case_id"                    uuid,
  "basis_code"                     text,
  "method_code"                    text,
  "outcome_code"                   text        NOT NULL,
  "checked_by"                     text        NOT NULL,
  "checked_at"                     timestamptz NOT NULL DEFAULT now(),
  "permission_expires_on"          date,
  "uk_entry_date"                  date,
  "restriction_code"               text,
  "evidence_ref"                   text,
  "identity_verification_check_id" uuid,
  "recheck_due_on"                 date,
  "share_code"                     text,
  "note"                           text,
  "expiry_warning_sent_at"         timestamptz,
  "valid_from"                     timestamptz NOT NULL,
  "valid_to"                       timestamptz,
  "recorded_at"                    timestamptz NOT NULL DEFAULT now(),
  "recorded_until"                 timestamptz,
  CONSTRAINT "right_to_study_check_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "right_to_study_check_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at),
  CONSTRAINT "right_to_study_check_outcome_check" CHECK ("outcome_code" IN ('pending', 'eligible', 'not-eligible', 'referred', 'recheck-required')),
  CONSTRAINT "right_to_study_check_decided_check" CHECK ("outcome_code" IN ('pending', 'referred') OR ("basis_code" IS NOT NULL AND "method_code" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "right_to_study_check_unique_logical_transaction" ON "right_to_study_check" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "right_to_study_check_current_version_unique" ON "right_to_study_check" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX IF NOT EXISTS "right_to_study_check_person_idx" ON "right_to_study_check" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "right_to_study_check_expiry_idx" ON "right_to_study_check" ("tenant_id", "permission_expires_on") WHERE "recorded_until" IS NULL;
ALTER TABLE "right_to_study_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "right_to_study_check" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "right_to_study_check";
CREATE POLICY tenant_isolation ON "right_to_study_check"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-18: financial registration ────────────────────────────────────────────
-- The SRS owns fee status (a provider determination); Finance owns amounts,
-- payments and debt. Financial registration is a state on each year's fee
-- liability, separate from academic registration.

ALTER TABLE "enrolment" ADD COLUMN IF NOT EXISTS "fee_status_code" text;

ALTER TABLE "fee_liability"
  ADD COLUMN IF NOT EXISTS "fee_status_code"        text,
  ADD COLUMN IF NOT EXISTS "financial_status_code"  text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "payer_arrangement_code" text,
  ADD COLUMN IF NOT EXISTS "finance_reference"      text,
  ADD COLUMN IF NOT EXISTS "hold_reason_code"       text,
  ADD COLUMN IF NOT EXISTS "status_source_code"     text,
  ADD COLUMN IF NOT EXISTS "status_updated_by"      text,
  ADD COLUMN IF NOT EXISTS "status_updated_at"      timestamptz;
ALTER TABLE "fee_liability" DROP CONSTRAINT IF EXISTS "fee_liability_financial_status_check";
ALTER TABLE "fee_liability" ADD CONSTRAINT "fee_liability_financial_status_check"
  CHECK ("financial_status_code" IN ('pending', 'arranged', 'hold', 'not-required'));
ALTER TABLE "fee_liability" DROP CONSTRAINT IF EXISTS "fee_liability_hold_reason_check";
ALTER TABLE "fee_liability" ADD CONSTRAINT "fee_liability_hold_reason_check"
  CHECK (("financial_status_code" = 'hold') = ("hold_reason_code" IS NOT NULL));

-- ── D-17 and D-18 picklists ─────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('right-to-study-basis-code',         'Right to Study Basis',          'srs-internal', NULL, 'Why a person may study in the UK', true),
  ('right-to-study-method-code',        'Right to Study Check Method',   'srs-internal', NULL, 'How the right to study was checked', true),
  ('right-to-study-restriction-code',   'Right to Study Restriction',    'srs-internal', NULL, 'A condition on the permission that affects study', true),
  ('fee-status-code',                   'Fee Status',                    'srs-internal', NULL, 'The provider''s fee status determination', true),
  ('payer-arrangement-code',            'Payer Arrangement',             'srs-internal', NULL, 'Who is paying the year''s tuition', true),
  ('financial-hold-reason-code',        'Financial Hold Reason',         'srs-internal', NULL, 'Why a year''s financial registration is on hold; source_metadata.tuition marks a tuition-fee hold', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', v.meta::jsonb
FROM "value_set" vs,
(VALUES
  ('right-to-study-basis-code', 'british-irish',        'British or Irish citizen',                10, NULL),
  ('right-to-study-basis-code', 'euss-settled',         'EU Settlement Scheme: settled',           20, NULL),
  ('right-to-study-basis-code', 'euss-pre-settled',     'EU Settlement Scheme: pre-settled',       30, NULL),
  ('right-to-study-basis-code', 'student-route',        'Sponsored on the Student route',          40, NULL),
  ('right-to-study-basis-code', 'other-permission',     'Other permission that allows study',      50, NULL),
  ('right-to-study-basis-code', 'indefinite-leave',     'Indefinite leave to remain',              60, NULL),
  ('right-to-study-method-code', 'view-and-prove',      'Online (View and Prove share code)',      10, NULL),
  ('right-to-study-method-code', 'document-in-person',  'Document seen in person',                 20, NULL),
  ('right-to-study-method-code', 'document-remote',     'Document seen by remote video',           30, NULL),
  ('right-to-study-method-code', 'identity-passport',   'Passport from the identity check',        40, NULL),
  ('right-to-study-restriction-code', 'study-restricted', 'Study condition on the permission',     10, NULL),
  ('right-to-study-restriction-code', 'atas-required',  'ATAS certificate required',               20, NULL),
  ('fee-status-code', 'home',                           'Home',                                    10, NULL),
  ('fee-status-code', 'overseas',                       'Overseas',                                20, NULL),
  ('fee-status-code', 'islands',                        'Channel Islands and Isle of Man',         30, NULL),
  ('fee-status-code', 'not-assessed',                   'Not yet assessed',                        90, NULL),
  ('payer-arrangement-code', 'self-pay',                'Self-pay',                                10, NULL),
  ('payer-arrangement-code', 'slc-tuition-loan',        'Student Loans Company tuition fee loan',  20, NULL),
  ('payer-arrangement-code', 'sponsor',                 'Sponsor',                                 30, NULL),
  ('payer-arrangement-code', 'scholarship',             'Scholarship',                             40, NULL),
  ('payer-arrangement-code', 'mixed',                   'More than one payer',                     50, NULL),
  ('financial-hold-reason-code', 'tuition-unpaid',      'Tuition fees unpaid',                     10, '{"tuition": true}'),
  ('financial-hold-reason-code', 'sponsor-not-confirmed', 'Sponsor has not confirmed payment',     20, '{"tuition": true}'),
  ('financial-hold-reason-code', 'accommodation-debt',  'Accommodation or other non-tuition debt', 30, '{"tuition": false}'),
  ('ukvi-alert-type-code', 'permission-expired',        'Permission to stay has expired',          50, NULL)
) AS v(set_code, code, display_label, sort_order, meta)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('right_to_study_check', 'basis_code',          'right-to-study-basis-code',       NULL),
  ('right_to_study_check', 'method_code',         'right-to-study-method-code',      NULL),
  ('right_to_study_check', 'restriction_code',    'right-to-study-restriction-code', NULL),
  ('admissions_offer',     'fee_status_basis_code','fee-status-code',                NULL),
  ('enrolment',            'fee_status_code',     'fee-status-code',                 NULL),
  ('fee_liability',        'payer_arrangement_code','payer-arrangement-code',        NULL),
  ('fee_liability',        'hold_reason_code',    'financial-hold-reason-code',      NULL)
ON CONFLICT DO NOTHING;

-- ── D-22: curriculum publication beyond programmes and modules ──────────────
ALTER TABLE "curriculum_publication_item" DROP CONSTRAINT IF EXISTS "curriculum_publication_item_type_check";
ALTER TABLE "curriculum_publication_item" ADD CONSTRAINT "curriculum_publication_item_type_check"
  CHECK ("object_type_code" IN ('programme', 'module', 'route', 'rule-set', 'module-group', 'module-group-member', 'learning-outcome', 'module-offering'));

-- ── D-20: rendering and signing award documents ─────────────────────────────
ALTER TABLE "document_issue"
  ADD COLUMN IF NOT EXISTS "rendered_document_id" uuid,
  ADD COLUMN IF NOT EXISTS "template_code"        text,
  ADD COLUMN IF NOT EXISTS "template_version"     text,
  ADD COLUMN IF NOT EXISTS "pdf_sha256"           text,
  ADD COLUMN IF NOT EXISTS "signing_key_id"       text,
  ADD COLUMN IF NOT EXISTS "signature_jws"        text;
CREATE UNIQUE INDEX IF NOT EXISTS "document_issue_pdf_sha256_unique" ON "document_issue" ("tenant_id", "pdf_sha256") WHERE "pdf_sha256" IS NOT NULL;

-- The institution's public signing keys, published at its JWKS endpoint; retired keys stay published.
CREATE TABLE IF NOT EXISTS "document_signing_key" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid        NOT NULL REFERENCES "tenant"("id"),
  "key_id"         text        NOT NULL,
  "algorithm"      text        NOT NULL DEFAULT 'ES256',
  "public_key_pem" text        NOT NULL,
  "provider_code"  text        NOT NULL,
  "status_code"    text        NOT NULL DEFAULT 'active',
  "registered_by"  text        NOT NULL,
  "registered_at"  timestamptz NOT NULL DEFAULT now(),
  "retired_at"     timestamptz,
  "compromised_at" timestamptz,
  CONSTRAINT "document_signing_key_status_check" CHECK ("status_code" IN ('active', 'retired', 'compromised')),
  CONSTRAINT "document_signing_key_provider_check" CHECK ("provider_code" IN ('local-key', 'openbao-transit'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_signing_key_unique" ON "document_signing_key" ("tenant_id", "key_id");
ALTER TABLE "document_signing_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_signing_key" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "document_signing_key";
CREATE POLICY tenant_isolation ON "document_signing_key"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-21: verification without an account ───────────────────────────────────
-- Public checks are logged with a salted hash of the IP, never the IP; a staff
-- lookup by name and date of birth records the holder's consent.
ALTER TABLE "document_verification"
  ADD COLUMN IF NOT EXISTS "requester_ip_hash"    text,
  ADD COLUMN IF NOT EXISTS "consent_evidence_ref" text,
  ADD COLUMN IF NOT EXISTS "method_code"          text NOT NULL DEFAULT 'code';
ALTER TABLE "document_verification" DROP CONSTRAINT IF EXISTS "document_verification_method_check";
ALTER TABLE "document_verification" ADD CONSTRAINT "document_verification_method_check" CHECK ("method_code" IN ('code', 'file', 'staff-lookup'));

-- ── D-14, D-15: UCAS outbound decisions and results mapped to conditions ────
-- Outbound items are integration_exchange rows queued with the decision (an
-- outbox); a later decision supersedes a queued one; an inbound UCAS status
-- that agrees reconciles a sent one.
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('integration-exchange-status', 'queued',     'Queued',     5),
  ('integration-exchange-status', 'superseded', 'Superseded', 70),
  ('integration-exchange-status', 'reconciled', 'Reconciled', 80),
  ('integration-exchange-status', 'mismatch',   'Mismatch',   90)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

-- Structured criteria a result can be matched to; free-text conditions are only ever suggested for review.
ALTER TABLE "offer_condition" ADD COLUMN IF NOT EXISTS "match_criteria" jsonb;
ALTER TABLE "condition_evidence"
  ADD COLUMN IF NOT EXISTS "match_outcome_code" text,
  ADD COLUMN IF NOT EXISTS "embargoed_until"    date;
ALTER TABLE "condition_evidence" DROP CONSTRAINT IF EXISTS "condition_evidence_match_outcome_check";
ALTER TABLE "condition_evidence" ADD CONSTRAINT "condition_evidence_match_outcome_check"
  CHECK ("match_outcome_code" IS NULL OR "match_outcome_code" IN ('meets', 'below', 'needs-review'));

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('ucas-decision-crosswalk', 'UCAS Decision Crosswalk', 'srs-internal', NULL,
   'SRS outcomes sent to UCAS: source_metadata.ucasCode is the UCAS decision code, source_metadata.reconcilesWith the inbound statuses that confirm it; confirm per cycle', true),
  ('qualification-type-code', 'Qualification Type', 'srs-internal', NULL, 'Qualification a result is for', true),
  ('grade-scale-a-level', 'A level grades', 'srs-internal', NULL, 'Ordered from highest (lowest sort order) to lowest', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', v.meta::jsonb
FROM "value_set" vs,
(VALUES
  ('ucas-decision-crosswalk', 'offer-conditional',     'Conditional offer',             10, '{"ucasCode": "C", "reconcilesWith": ["offer-made", "offer-accepted"]}'),
  ('ucas-decision-crosswalk', 'offer-unconditional',   'Unconditional offer',           20, '{"ucasCode": "U", "reconcilesWith": ["offer-made", "offer-accepted"]}'),
  ('ucas-decision-crosswalk', 'reject',                'Unsuccessful application',      30, '{"ucasCode": "R", "reconcilesWith": ["withdrawn"]}'),
  ('ucas-decision-crosswalk', 'withdraw',              'Offer withdrawn',               40, '{"ucasCode": "W", "reconcilesWith": ["withdrawn"]}'),
  ('ucas-decision-crosswalk', 'confirmed',             'Confirmed',                     50, '{"ucasCode": "UF", "reconcilesWith": ["confirmed"]}'),
  ('ucas-decision-crosswalk', 'confirmed-alternative', 'Confirmed on another course',   60, '{"ucasCode": "CC", "reconcilesWith": ["confirmed"]}'),
  ('ucas-decision-crosswalk', 'unsuccessful',          'Unsuccessful at confirmation',  70, '{"ucasCode": "R", "reconcilesWith": ["withdrawn"]}'),
  ('qualification-type-code', 'a-level',               'A level',                       10, NULL),
  ('qualification-type-code', 'btec-extended-diploma', 'BTEC Extended Diploma',         20, NULL),
  ('qualification-type-code', 'ib-diploma',            'International Baccalaureate',   30, NULL),
  ('grade-scale-a-level', 'A*', 'A*', 10, NULL),
  ('grade-scale-a-level', 'A',  'A',  20, NULL),
  ('grade-scale-a-level', 'B',  'B',  30, NULL),
  ('grade-scale-a-level', 'C',  'C',  40, NULL),
  ('grade-scale-a-level', 'D',  'D',  50, NULL),
  ('grade-scale-a-level', 'E',  'E',  60, NULL),
  ('grade-scale-a-level', 'U',  'U',  70, NULL)
) AS v(set_code, code, display_label, sort_order, meta)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES ('ucas-results-inbound.v1', 'UCAS Results (Awarding Body Linkage)', 'regulatory', 'inbound', 'file-and-api', '1.0.0', 'personal')
ON CONFLICT ("contract_id") DO NOTHING;

-- Originally 0009_rule_depth.sql

-- 0009 — Rule depth in module selection and status (Phase 4)
-- (docs/decisions/phase-4-gap-closure-decisions.md, D-23 to D-34)

-- ── D-23: the rule-type picklist matches the rule types the engine defines ──
UPDATE "value_set_member" SET "active_to" = '2026-11-17T00:00:00Z'
WHERE "value_set_id" = (SELECT "id" FROM "value_set" WHERE "set_code" = 'academic-rule-type-code')
  AND "code" IN ('progression', 'classification', 'assessment', 'credit-transfer', 'resit-eligibility', 'award-eligibility')
  AND "active_to" IS NULL;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', jsonb_build_object('domain', v.domain)
FROM "value_set" vs,
(VALUES
  ('max-credits-per-period',         'Maximum credits per period',        110, 'selection'),
  ('credit-load-requirement',        'Credit load requirement',           120, 'selection'),
  ('level-credit-requirement',       'Credits at the current level',      130, 'selection'),
  ('adjacent-level-credit-limit',    'Credits at an adjacent level',      140, 'selection'),
  ('joint-honours-balance',          'Joint honours balance',             150, 'selection'),
  ('repeat-module-requirement',      'Repeat module requirement',         160, 'selection'),
  ('timetable-clash-policy',         'Timetable clash policy',            170, 'selection'),
  ('pass-mark',                      'Pass mark',                         210, 'assessment'),
  ('late-penalty-rate',              'Late submission penalty rate',      220, 'assessment'),
  ('late-penalty-cap',               'Late submission penalty cap',       230, 'assessment'),
  ('resit-mark-cap',                 'Resit mark cap',                    240, 'assessment'),
  ('compensation-threshold',         'Compensation threshold',            310, 'progression'),
  ('compensation-credit-limit',      'Compensation credit limit',         320, 'progression'),
  ('condonement-threshold',          'Condonement threshold',             330, 'progression'),
  ('progression-credit-requirement', 'Progression credit requirement',    340, 'progression'),
  ('progression-pass-requirement',   'Progression pass requirement',      350, 'progression'),
  ('classification-boundary',        'Classification boundary',           410, 'award'),
  ('classification-algorithm',       'Classification algorithm',          420, 'award'),
  ('classification-discretion-zone', 'Classification discretion zone',    430, 'award'),
  ('award-credit-requirement',       'Award credit requirement',          440, 'award'),
  ('ukvi-attendance-threshold',      'UKVI attendance threshold',         510, 'regulatory')
) AS v(code, display_label, sort_order, domain)
WHERE vs."set_code" = 'academic-rule-type-code'
ON CONFLICT DO NOTHING;

-- ── D-29: selection windows ─────────────────────────────────────────────────
ALTER TABLE IF EXISTS "registration_window" RENAME TO "module_selection_window";
ALTER TABLE "module_selection_window" DROP CONSTRAINT IF EXISTS "registration_window_tenant_period_unique";
ALTER TABLE "module_selection_window" RENAME CONSTRAINT "registration_window_closes_after_opens" TO "module_selection_window_closes_after_opens";
ALTER INDEX IF EXISTS "registration_window_tenant_period_idx" RENAME TO "module_selection_window_tenant_period_idx";
ALTER TABLE "module_selection_window"
  ADD COLUMN IF NOT EXISTS "programme_id"           uuid,
  ADD COLUMN IF NOT EXISTS "fheq_level"             smallint,
  ADD COLUMN IF NOT EXISTS "resubmission_closes_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "allocation_mode_code"   text NOT NULL DEFAULT 'first-come',
  ADD COLUMN IF NOT EXISTS "allocation_seed"        bytea,
  ADD COLUMN IF NOT EXISTS "created_by"             text,
  ADD COLUMN IF NOT EXISTS "created_at"             timestamptz NOT NULL DEFAULT now();
ALTER TABLE "module_selection_window" ALTER COLUMN "allocation_mode_code" SET DEFAULT 'ranked';
ALTER TABLE "module_selection_window" DROP CONSTRAINT IF EXISTS "module_selection_window_allocation_mode_check";
ALTER TABLE "module_selection_window" ADD CONSTRAINT "module_selection_window_allocation_mode_check"
  CHECK ("allocation_mode_code" IN ('first-come', 'ranked'));
ALTER TABLE "module_selection_window" DROP CONSTRAINT IF EXISTS "module_selection_window_resubmission_check";
ALTER TABLE "module_selection_window" ADD CONSTRAINT "module_selection_window_resubmission_check"
  CHECK ("resubmission_closes_at" IS NULL OR "resubmission_closes_at" >= "closes_at");
-- One window per scope; overlap between windows of the same scope is refused by the service.
CREATE INDEX IF NOT EXISTS "module_selection_window_scope_idx"
  ON "module_selection_window" ("tenant_id", "academic_period_id", "programme_id", "fheq_level");
DROP POLICY IF EXISTS tenant_isolation ON "module_selection_window";
CREATE POLICY tenant_isolation ON "module_selection_window"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- registrationWindowMode becomes moduleSelection.windowEnforcement.
UPDATE "tenant" SET "configuration" = jsonb_set(
  COALESCE("configuration", '{}'::jsonb) - 'registrationWindowMode', '{moduleSelection}',
  COALESCE("configuration"->'moduleSelection', '{}'::jsonb) || '{"windowEnforcement": "required"}'::jsonb)
WHERE "configuration"->>'registrationWindowMode' = 'academic-period';

-- ── Proposal statuses, sources, late submission, ranked choices, repeats ────
ALTER TABLE "module_selection_proposal" DROP CONSTRAINT IF EXISTS "module_selection_proposal_status_code_check";
ALTER TABLE "module_selection_proposal" ADD CONSTRAINT "module_selection_proposal_status_code_check"
  CHECK ("status_code" IN ('draft','submitted','validated','approved','returned','waitlisted','rejected','confirmed','awaiting-allocation'));
ALTER TABLE "module_selection_proposal" DROP CONSTRAINT IF EXISTS "module_selection_proposal_decision_authority_code_check";
ALTER TABLE "module_selection_proposal" ADD CONSTRAINT "module_selection_proposal_decision_authority_code_check"
  CHECK ("decision_authority_code" IS NULL OR "decision_authority_code" IN ('automatic','registry-administrator','programme-approver','allocation'));
ALTER TABLE "module_selection_proposal"
  ADD COLUMN IF NOT EXISTS "late_submission_reason_code" text,
  ADD COLUMN IF NOT EXISTS "late_submission_note"        text,
  ADD COLUMN IF NOT EXISTS "late_submitted_by"           text,
  -- The student's current FHEQ level for the proposal: scopes windows and allocation tiers.
  ADD COLUMN IF NOT EXISTS "fheq_level"                  smallint;

ALTER TABLE "module_selection_proposal_item" DROP CONSTRAINT IF EXISTS "module_selection_proposal_item_source_code_check";
ALTER TABLE "module_selection_proposal_item" ADD CONSTRAINT "module_selection_proposal_item_source_code_check"
  CHECK ("source_code" IN ('compulsory-auto','student-choice','staff-assisted','repeat-required'));
ALTER TABLE "module_selection_proposal_item"
  ADD COLUMN IF NOT EXISTS "choice_slot"          smallint,
  ADD COLUMN IF NOT EXISTS "reassessment_plan_id" uuid,
  ADD COLUMN IF NOT EXISTS "is_replacement"       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "held_until"           timestamptz;
ALTER TABLE "module_selection_proposal_item" DROP CONSTRAINT IF EXISTS "module_selection_proposal_item_replacement_check";
ALTER TABLE "module_selection_proposal_item" ADD CONSTRAINT "module_selection_proposal_item_replacement_check"
  CHECK (NOT "is_replacement" OR "reassessment_plan_id" IS NOT NULL);
DROP POLICY IF EXISTS tenant_isolation ON "module_selection_proposal_item";
CREATE POLICY tenant_isolation ON "module_selection_proposal_item"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── D-28: the registration a repeat plan produced ───────────────────────────
ALTER TABLE "reassessment_plan" ADD COLUMN IF NOT EXISTS "repeat_module_registration_id" uuid;

-- ── D-27: subject areas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_subject" (
  "version_id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "id"                 uuid        NOT NULL,
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "module_id"          uuid        NOT NULL,
  "subject_area_code"  text        NOT NULL,
  "proportion_percent" smallint    NOT NULL CHECK ("proportion_percent" BETWEEN 1 AND 100),
  "valid_from"         timestamptz NOT NULL,
  "valid_to"           timestamptz,
  "recorded_at"        timestamptz NOT NULL DEFAULT now(),
  "recorded_until"     timestamptz,
  CONSTRAINT "module_subject_temporal_check_valid" CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT "module_subject_temporal_check_recorded" CHECK (recorded_until IS NULL OR recorded_until > recorded_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS "module_subject_unique_logical_transaction" ON "module_subject" ("tenant_id", "id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "module_subject_current_version_unique" ON "module_subject" ("tenant_id", "id") WHERE "recorded_until" IS NULL;
CREATE INDEX IF NOT EXISTS "module_subject_module_idx" ON "module_subject" ("tenant_id", "module_id") WHERE "recorded_until" IS NULL;
ALTER TABLE "module_subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "module_subject" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_subject";
CREATE POLICY tenant_isolation ON "module_subject"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "module_group_member" ADD COLUMN IF NOT EXISTS "counts_towards_subject_area_code" text;

-- ── D-24: timetable publications, activities and slots ──────────────────────
CREATE TABLE IF NOT EXISTS "timetable_publication" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "academic_period_id" uuid        NOT NULL REFERENCES "academic_period"("id"),
  "source_system_code" text        NOT NULL CHECK ("source_system_code" IN ('ttb', 'srs-admin', 'simulator')),
  "source_version"     text        NOT NULL,
  "full_period"        boolean     NOT NULL DEFAULT false,
  "status_code"        text        NOT NULL CHECK ("status_code" IN ('applied', 'rejected')),
  "rejection_reasons"  jsonb,
  "payload_hash"       text        NOT NULL,
  "row_count"          integer     NOT NULL DEFAULT 0,
  "received_by"        text        NOT NULL,
  "received_at"        timestamptz NOT NULL DEFAULT now(),
  "applied_at"         timestamptz,
  CONSTRAINT "timetable_publication_source_version_unique" UNIQUE ("tenant_id", "source_system_code", "source_version")
);
CREATE INDEX IF NOT EXISTS "timetable_publication_period_idx" ON "timetable_publication" ("tenant_id", "academic_period_id", "received_at");

CREATE TABLE IF NOT EXISTS "timetable_activity" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"          uuid        NOT NULL REFERENCES "tenant"("id"),
  "publication_id"     uuid        NOT NULL REFERENCES "timetable_publication"("id"),
  "module_offering_id" uuid        NOT NULL,
  "activity_ref"       text        NOT NULL,
  "activity_type_code" text        NOT NULL,
  "group_set_code"     text,
  "group_code"         text
);
CREATE INDEX IF NOT EXISTS "timetable_activity_offering_idx" ON "timetable_activity" ("tenant_id", "module_offering_id", "publication_id");

CREATE TABLE IF NOT EXISTS "timetable_slot" (
  "id"               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid     NOT NULL REFERENCES "tenant"("id"),
  "activity_id"      uuid     NOT NULL REFERENCES "timetable_activity"("id"),
  "day_of_week"      smallint NOT NULL CHECK ("day_of_week" BETWEEN 1 AND 7),
  "start_time"       time     NOT NULL,
  "end_time"         time     NOT NULL,
  "week_commencing"  date[]   NOT NULL CHECK (cardinality("week_commencing") > 0),
  "location_ref"     text,
  CONSTRAINT "timetable_slot_time_check" CHECK ("end_time" > "start_time")
);
CREATE INDEX IF NOT EXISTS "timetable_slot_activity_idx" ON "timetable_slot" ("tenant_id", "activity_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['timetable_publication', 'timetable_activity', 'timetable_slot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── D-30: allocation runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "module_allocation_run" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant"("id"),
  "window_id"            uuid        NOT NULL REFERENCES "module_selection_window"("id"),
  "kind_code"            text        NOT NULL DEFAULT 'main' CHECK ("kind_code" IN ('main', 'top-up')),
  "status_code"          text        NOT NULL DEFAULT 'previewed'
                           CHECK ("status_code" IN ('previewed', 'submitted', 'approved', 'applied', 'superseded', 'rejected')),
  "algorithm_version"    text        NOT NULL DEFAULT 'rsd-1',
  "priority_order"       jsonb       NOT NULL,
  "inputs_hash"          text        NOT NULL,
  "summary"              jsonb,
  "workflow_instance_id" uuid,
  "created_by"           text        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "submitted_by"         text,
  "approved_by"          text,
  "applied_at"           timestamptz
);
CREATE INDEX IF NOT EXISTS "module_allocation_run_window_idx" ON "module_allocation_run" ("tenant_id", "window_id", "created_at");

CREATE TABLE IF NOT EXISTS "module_allocation_result" (
  "id"                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid     NOT NULL REFERENCES "tenant"("id"),
  "run_id"            uuid     NOT NULL REFERENCES "module_allocation_run"("id"),
  "proposal_id"       uuid     NOT NULL,
  "choice_slot"       smallint,
  "allocated_item_id" uuid,
  "outcome_code"      text     NOT NULL CHECK ("outcome_code" IN ('allocated', 'unallocated', 'fixed')),
  "order_position"    integer  NOT NULL,
  "tier"              integer  NOT NULL DEFAULT 0,
  "reason"            text
);
CREATE INDEX IF NOT EXISTS "module_allocation_result_run_idx" ON "module_allocation_result" ("tenant_id", "run_id");
CREATE INDEX IF NOT EXISTS "module_allocation_result_proposal_idx" ON "module_allocation_result" ("tenant_id", "proposal_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['module_allocation_run', 'module_allocation_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── D-31: study intensity ───────────────────────────────────────────────────
ALTER TABLE "enrolment" ADD COLUMN IF NOT EXISTS "study_intensity_percent" smallint;
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_study_intensity_check";
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_study_intensity_check"
  CHECK ("study_intensity_percent" IS NULL OR "study_intensity_percent" BETWEEN 1 AND 100);
ALTER TABLE "student_status_case" ADD COLUMN IF NOT EXISTS "destination_study_intensity_percent" smallint;
ALTER TABLE "student_status_case" DROP CONSTRAINT IF EXISTS "student_status_case_intensity_check";
ALTER TABLE "student_status_case" ADD CONSTRAINT "student_status_case_intensity_check"
  CHECK ("destination_study_intensity_percent" IS NULL OR "destination_study_intensity_percent" BETWEEN 1 AND 100);

-- ── D-32: where transferred credit came from ────────────────────────────────
ALTER TABLE "recognised_credit" ADD COLUMN IF NOT EXISTS "source_module_result_id" uuid;

-- ── Picklists ───────────────────────────────────────────────────────────────
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('timetable-activity-type-code', 'Timetable Activity Type', 'srs-internal', NULL, 'Kind of timetabled teaching activity', true),
  ('subject-area-code',            'Subject Area',            'srs-internal', NULL, 'Institution-defined subject areas for joint-honours balance; each tenant adds its own', true),
  ('late-selection-reason-code',   'Late Selection Reason',   'srs-internal', NULL, 'Why staff submitted a module selection outside its window', true),
  ('module-selection-window-allocation-mode-code', 'Selection Window Allocation', 'srs-internal', NULL, 'How oversubscribed offerings are allocated in a selection window', false),
  ('proposal-item-source-code',    'Selection Item Source',   'srs-internal', NULL, 'How a module came to be in a selection proposal', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('timetable-activity-type-code', 'lecture',             'Lecture',                       10),
  ('timetable-activity-type-code', 'seminar',             'Seminar',                       20),
  ('timetable-activity-type-code', 'tutorial',            'Tutorial',                      30),
  ('timetable-activity-type-code', 'practical',           'Practical',                     40),
  ('timetable-activity-type-code', 'laboratory',          'Laboratory',                    50),
  ('timetable-activity-type-code', 'workshop',            'Workshop',                      60),
  ('timetable-activity-type-code', 'fieldwork',           'Fieldwork',                     70),
  ('timetable-activity-type-code', 'assessment',          'Timetabled assessment',         80),
  ('timetable-activity-type-code', 'online-synchronous',  'Online, live',                  90),
  ('timetable-activity-type-code', 'online-asynchronous', 'Online, self-paced',           100),
  ('timetable-activity-type-code', 'drop-in',             'Drop-in',                      110),
  ('late-selection-reason-code', 'late-enrolment',            'Late enrolment',                 10),
  ('late-selection-reason-code', 'transfer',                  'Transfer of programme or mode',  20),
  ('late-selection-reason-code', 'return-from-interruption',  'Return from interruption',       30),
  ('late-selection-reason-code', 'extenuating-circumstances', 'Extenuating circumstances',      40),
  ('late-selection-reason-code', 'administrative-error',      'Administrative error',           50),
  ('late-selection-reason-code', 'other',                     'Other',                          90),
  ('module-selection-window-allocation-mode-code', 'ranked',     'Ranked preferences, allocated after the window', 10),
  ('module-selection-window-allocation-mode-code', 'first-come', 'First come, first served',                       20),
  ('proposal-item-source-code', 'compulsory-auto', 'Compulsory (added automatically)', 10),
  ('proposal-item-source-code', 'student-choice',  'Student choice',                   20),
  ('proposal-item-source-code', 'staff-assisted',  'Added by staff',                   30),
  ('proposal-item-source-code', 'repeat-required', 'Repeat required by the board',     40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('timetable_activity',             'activity_type_code',               'timetable-activity-type-code', NULL),
  ('module_subject',                 'subject_area_code',                'subject-area-code',            NULL),
  ('module_group_member',            'counts_towards_subject_area_code', 'subject-area-code',            NULL),
  ('module_selection_proposal',      'late_submission_reason_code',      'late-selection-reason-code',   NULL),
  ('module_selection_window',        'allocation_mode_code',             'module-selection-window-allocation-mode-code', NULL),
  ('module_selection_proposal_item', 'source_code',                      'proposal-item-source-code',    NULL)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Allocation run approval (D-30): the runner submits a run for review, and a
-- different holder of module-selection:decide approves (and so applies) or
-- rejects it, through the governed review family, on Temporal when the
-- tenant's rollout selects it.

INSERT INTO "workflow_definition" (
  "definition_code", "display_name", "owner_module_code", "status_code", "current_version_number", "description", "created_by"
) VALUES (
  'module-allocation-run',
  'Module allocation run approval',
  'registration',
  'active',
  1,
  'A ranked allocation run submitted for approval. A person other than its runner and submitter approves it, which applies it while its inputs are unchanged, or rejects it.',
  'system'
)
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" (
  "workflow_definition_id", "version_number", "status_code", "definition_json", "effective_from", "created_by"
)
SELECT
  wd."id", 1, 'active',
  jsonb_build_object(
    'source', 'docs/decisions/phase-4-gap-closure-decisions.md',
    'decisionStepKey', 'approve-or-reject-allocation',
    'decisionGatewayAuditTable', 'workflow_decision_audit'
  ),
  '2026-11-17T00:00:00Z'::timestamptz, 'system'
FROM "workflow_definition" wd
WHERE wd."definition_code" = 'module-allocation-run'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" (
  "workflow_definition_version_id", "step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration"
)
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('run-submitted',                'start',      'Allocation run submitted',          null,                 10, '{}'),
  ('approve-or-reject-allocation', 'human-task', 'Second-person allocation approval', 'programme-approver', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway',             'decision',   'Allocation decision gateway',       'programme-approver', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('run-closed',                   'end',        'Allocation run closed',             null,                 40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'module-allocation-run'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" (
  "workflow_definition_version_id", "gateway_key", "display_name", "decision_type_code", "source_reference", "configuration"
)
SELECT
  wdv."id", 'G01', 'Approve or reject the allocation run?', 'exclusive', 'phase-4-gap-closure-decisions.md',
  jsonb_build_object('ownerRole', 'Programme approver or registry (not the runner)', 'policySource', 'D-30 allocation governance')
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'module-allocation-run'
  AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- Originally 0009_audiences_and_evidence.sql

-- 0009 — Audiences and evidence (Phase 5)
-- (docs/decisions/phase-5-gap-closure-decisions.md, D-35 to D-47)

-- ── D-35: every calculation records the rule versions it used ───────────────
ALTER TABLE "mark"          ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "module_result" ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "progression_calculation_evidence" ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "mark_calculation_evidence"        ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "ukvi_compliance_alert"            ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';

-- Classification evidence is written at recommendation, before an award exists.
ALTER TABLE "award_calculation_evidence" ADD COLUMN IF NOT EXISTS "rule_versions" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "award_calculation_evidence" ADD COLUMN IF NOT EXISTS "award_recommendation_id" uuid;
ALTER TABLE "award_calculation_evidence" ALTER COLUMN "award_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "award_calc_evidence_recommendation_idx"
  ON "award_calculation_evidence" ("tenant_id", "award_recommendation_id");

-- The evidence tables predate the RLS convention; they now get it, as
-- evidence is written inside the decision's tenant transaction.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mark_calculation_evidence', 'progression_calculation_evidence', 'award_calculation_evidence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK ("tenant_id" = current_setting(''app.current_tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

-- ── D-36: data pack hash, rule manifest, decisions that cite the hash ───────
-- A rule manifest is content-addressed: rule_manifest_ref on a pack holds the
-- manifest's sha256 hash, so the reference also proves the content.
CREATE TABLE IF NOT EXISTS "rule_manifest" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "manifest_hash" text        NOT NULL CHECK ("manifest_hash" ~ '^sha256:[0-9a-f]{64}$'),
  "content"       jsonb       NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "manifest_hash")
);
ALTER TABLE "rule_manifest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_manifest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rule_manifest";
CREATE POLICY tenant_isolation ON "rule_manifest"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- Append-only: a manifest is never changed once written.
CREATE OR REPLACE FUNCTION "rule_manifest_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rule_manifest is append-only';
END $$;
DROP TRIGGER IF EXISTS "rule_manifest_append_only" ON "rule_manifest";
CREATE TRIGGER "rule_manifest_append_only" BEFORE UPDATE OR DELETE ON "rule_manifest"
  FOR EACH ROW EXECUTE FUNCTION "rule_manifest_append_only"();

ALTER TABLE "exam_board_data_pack" DROP CONSTRAINT IF EXISTS "exam_board_data_pack_pack_hash_check";
ALTER TABLE "exam_board_data_pack" ADD CONSTRAINT "exam_board_data_pack_pack_hash_check"
  CHECK ("pack_hash" IS NULL OR "pack_hash" ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE "exam_board_decision" ADD COLUMN IF NOT EXISTS "pack_hash" text;
-- A logical reference: exam_board_data_pack already references exam_board, and
-- a foreign key back would make a cycle (which the demo reset refuses).
ALTER TABLE "exam_board" ADD COLUMN IF NOT EXISTS "ratified_data_pack_id" uuid;
ALTER TABLE "exam_board" ADD COLUMN IF NOT EXISTS "ratified_pack_hash" text;

-- ── D-37: before and after version references on corrections ────────────────
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_before_version_ref_fkey";
ALTER TABLE "post_ratification_amendment" ADD CONSTRAINT "post_ratification_amendment_before_version_ref_fkey"
  FOREIGN KEY ("before_version_ref") REFERENCES "source_version_reference"("id");
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_after_version_ref_fkey";
ALTER TABLE "post_ratification_amendment" ADD CONSTRAINT "post_ratification_amendment_after_version_ref_fkey"
  FOREIGN KEY ("after_version_ref") REFERENCES "source_version_reference"("id");
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_version_refs_paired";
ALTER TABLE "post_ratification_amendment" ADD CONSTRAINT "post_ratification_amendment_version_refs_paired"
  CHECK (("before_version_ref" IS NULL) = ("after_version_ref" IS NULL));

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('source-version-purpose-code', 'Source Version Purpose', 'srs-internal', NULL, 'Why a record version was cited', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('source-version-purpose-code', 'decision-basis',     'Basis of a decision',          10),
  ('source-version-purpose-code', 'published-artefact', 'Published artefact',           20),
  ('source-version-purpose-code', 'submission-source',  'Source of a submission',       30),
  ('source-version-purpose-code', 'amendment-before',   'Version a correction replaced', 40),
  ('source-version-purpose-code', 'amendment-after',    'Version a correction created',  50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('source_version_reference', 'purpose_code', 'source-version-purpose-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-39: applicant self-service ────────────────────────────────────────────
ALTER TABLE "admissions_offer" ADD COLUMN IF NOT EXISTS "responded_by" text;
ALTER TABLE "admissions_offer" ADD COLUMN IF NOT EXISTS "response_channel_code" text;
ALTER TABLE "student_application" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamptz;
ALTER TABLE "student_application" ADD COLUMN IF NOT EXISTS "withdrawn_by" text;
ALTER TABLE "student_application" ADD COLUMN IF NOT EXISTS "withdrawal_reason_code" text;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('offer-response-channel-code', 'Offer Response Channel', 'srs-internal', NULL, 'Where an applicant''s reply to an offer was made', false),
  ('application-withdrawal-reason-code', 'Application Withdrawal Reason', 'srs-internal', NULL, 'Why an applicant withdrew; optional', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('offer-response-channel-code', 'ucas',             'UCAS',                     10),
  ('offer-response-channel-code', 'applicant-portal', 'Applicant portal',         20),
  ('offer-response-channel-code', 'staff-recorded',   'Recorded by staff',        30),
  ('application-withdrawal-reason-code', 'accepted-elsewhere', 'Accepted a place elsewhere', 10),
  ('application-withdrawal-reason-code', 'changed-plans',      'Changed plans',              20),
  ('application-withdrawal-reason-code', 'financial',          'Financial reasons',          30),
  ('application-withdrawal-reason-code', 'personal',           'Personal reasons',           40),
  ('application-withdrawal-reason-code', 'other',              'Other',                      90)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('admissions_offer',    'response_channel_code',  'offer-response-channel-code', NULL),
  ('student_application', 'withdrawal_reason_code', 'application-withdrawal-reason-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-40: examiner reports entered by examiners themselves ──────────────────
ALTER TABLE "examiner_report" ADD COLUMN IF NOT EXISTS "submitted_by" text;
ALTER TABLE "examiner_report" ADD COLUMN IF NOT EXISTS "entry_channel_code" text;
ALTER TABLE "examiner_report" ADD COLUMN IF NOT EXISTS "on_behalf_reason" text;
-- One independent preliminary report per appointment.
CREATE UNIQUE INDEX IF NOT EXISTS "examiner_report_one_per_appointment" ON "examiner_report" ("examiner_appointment_id");
ALTER TABLE "examiner_report" DROP CONSTRAINT IF EXISTS "examiner_report_on_behalf_reason_check";
ALTER TABLE "examiner_report" ADD CONSTRAINT "examiner_report_on_behalf_reason_check"
  CHECK ("entry_channel_code" IS DISTINCT FROM 'staff-on-behalf' OR "on_behalf_reason" IS NOT NULL);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('examiner-report-entry-channel-code', 'Examiner Report Entry Channel', 'srs-internal', NULL, 'Who entered an examiner''s preliminary report', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('examiner-report-entry-channel-code', 'examiner-portal', 'Submitted by the examiner', 10),
  ('examiner-report-entry-channel-code', 'staff-on-behalf', 'Entered by staff for the examiner', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('examiner_report', 'entry_channel_code', 'examiner-report-entry-channel-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-41: exceptional-circumstances outcomes through a governed determination ─
-- A proposed outcome is decided by someone other than its proposer and the
-- person who recorded the submission; until then the EC keeps its outcome.
CREATE TABLE IF NOT EXISTS "ec_determination" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL REFERENCES "tenant"("id"),
  "exceptional_circumstances_id" uuid NOT NULL,
  "proposed_outcome_code" text        NOT NULL,
  "reason"                text        NOT NULL,
  "status_code"           text        NOT NULL DEFAULT 'proposed' CHECK ("status_code" IN ('proposed', 'upheld', 'not-upheld')),
  "proposed_by"           text        NOT NULL,
  "proposed_at"           timestamptz NOT NULL DEFAULT now(),
  "recorded_by"           text        NOT NULL,
  "workflow_instance_id"  uuid,
  "decided_by"            text,
  "decided_at"            timestamptz,
  "decision_reason"       text
);
CREATE INDEX IF NOT EXISTS "ec_determination_ec_idx" ON "ec_determination" ("tenant_id", "exceptional_circumstances_id");
-- One open proposal per EC.
CREATE UNIQUE INDEX IF NOT EXISTS "ec_determination_one_open" ON "ec_determination" ("tenant_id", "exceptional_circumstances_id") WHERE "status_code" = 'proposed';
ALTER TABLE "ec_determination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ec_determination" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ec_determination";
CREATE POLICY tenant_isolation ON "ec_determination"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "workflow_definition" ("definition_code", "display_name", "owner_module_code", "status_code", "current_version_number", "description", "created_by")
VALUES ('ec-determination', 'Exceptional circumstances determination', 'circumstances', 'active', 1,
  'A proposed outcome for an exceptional-circumstances claim, decided by someone other than its proposer and the person who recorded the claim.', 'system')
ON CONFLICT DO NOTHING;

INSERT INTO "workflow_definition_version" ("workflow_definition_id", "version_number", "status_code", "definition_json", "effective_from", "created_by")
SELECT wd."id", 1, 'active',
  jsonb_build_object('source', 'docs/decisions/phase-5-gap-closure-decisions.md', 'decisionStepKey', 'decide-ec-outcome', 'decisionGatewayAuditTable', 'workflow_decision_audit'),
  '2026-11-18T00:00:00Z'::timestamptz, 'system'
FROM "workflow_definition" wd WHERE wd."definition_code" = 'ec-determination'
ON CONFLICT ("workflow_definition_id", "version_number") DO NOTHING;

INSERT INTO "workflow_step" ("workflow_definition_version_id", "step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration")
SELECT wdv."id", s."step_key", s."step_type_code", s."display_name", s."owner_role_code", s."sort_order", s."configuration"::jsonb
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
JOIN (VALUES
  ('outcome-proposed',  'start',      'EC outcome proposed',           null,                     10, '{}'),
  ('decide-ec-outcome', 'human-task', 'Decide the EC outcome',         'registry-administrator', 20, '{"assignmentRulesRequired": true}'),
  ('decision-gateway',  'decision',   'EC determination gateway',      'registry-administrator', 30, '{"auditTable": "workflow_decision_audit"}'),
  ('determination-closed', 'end',     'EC determination closed',       null,                     40, '{}')
) AS s("step_key", "step_type_code", "display_name", "owner_role_code", "sort_order", "configuration") ON true
WHERE wd."definition_code" = 'ec-determination' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "step_key") DO NOTHING;

INSERT INTO "workflow_decision_gateway" ("workflow_definition_version_id", "gateway_key", "display_name", "decision_type_code", "source_reference", "configuration")
SELECT wdv."id", 'G01', 'Uphold the proposed EC outcome?', 'exclusive', 'bp-04-005', jsonb_build_object('policySource', 'Institutional exceptional circumstances policy')
FROM "workflow_definition_version" wdv
JOIN "workflow_definition" wd ON wd."id" = wdv."workflow_definition_id"
WHERE wd."definition_code" = 'ec-determination' AND wdv."version_number" = 1
ON CONFLICT ("workflow_definition_version_id", "gateway_key") DO NOTHING;

-- EC outcomes were free text; a determination validates against this set (D-41).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('ec-outcome-code', 'Exceptional Circumstances Outcome', 'srs-internal', NULL, 'The determined effect of an exceptional-circumstances claim; institutions add their own', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('ec-outcome-code', 'pending',   'Awaiting determination',                 10),
  ('ec-outcome-code', 'defer',     'Deferral (assessment at the next opportunity)', 20),
  ('ec-outcome-code', 'first-sit', 'Uncapped attempt (treated as a first sit)', 30),
  ('ec-outcome-code', 'extension', 'Extension granted',                      40),
  ('ec-outcome-code', 'condone',   'Considered by the board in its discretion', 50),
  ('ec-outcome-code', 'no-action', 'Not upheld: no change',                  60)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('exceptional_circumstances', 'outcome_code', 'ec-outcome-code', NULL)
ON CONFLICT DO NOTHING;

-- ── D-42: working-day calendar for statutory deadlines ──────────────────────
CREATE TABLE IF NOT EXISTS "non_working_day" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid        NOT NULL REFERENCES "tenant"("id"),
  "date"          date        NOT NULL,
  "division_code" text        NOT NULL,
  "description"   text        NOT NULL,
  "source"        text        NOT NULL,
  "created_by"    text        NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "date", "division_code")
);
ALTER TABLE "non_working_day" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "non_working_day" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "non_working_day";
CREATE POLICY tenant_isolation ON "non_working_day"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('calendar-division-code', 'Calendar Division', 'srs-internal', NULL, 'Which bank holidays a non-working day belongs to; tenant closures apply everywhere', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z', NULL
FROM "value_set" vs,
(VALUES
  ('calendar-division-code', 'england-and-wales', 'England and Wales',  10),
  ('calendar-division-code', 'scotland',          'Scotland',           20),
  ('calendar-division-code', 'northern-ireland',  'Northern Ireland',   30),
  ('calendar-division-code', 'tenant',            'Institution closure', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('non_working_day', 'division_code', 'calendar-division-code', NULL)
ON CONFLICT DO NOTHING;

-- ── Wellbeing case screens: code sets for the wellbeing module's records ────
-- The wellbeing module is a separate service with its own database; its
-- coded fields are listed here so the admin screens draw their choices from
-- the value-set system. Entity names are the module's schema-qualified
-- tables. Status sets give labels only: the module enforces each lifecycle.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('wellbeing-disability-support-type', 'Disability Support Type',         'srs-internal', NULL, 'How a disability support case is funded', false),
  ('wellbeing-disability-case-status',  'Disability Case Status',          'srs-internal', NULL, 'Where a disability support case is in its lifecycle', false),
  ('wellbeing-support-plan-status',     'Support Plan Status',             'srs-internal', NULL, 'Status of a disability support plan', false),
  ('wellbeing-dsa-entitlement-type',    'DSA Entitlement Type',            'srs-internal', NULL, 'What a Disabled Students'' Allowance entitlement provides', true),
  ('wellbeing-evidence-type',           'Wellbeing Evidence Type',         'srs-internal', NULL, 'Kind of supporting evidence held for a disability case', true),
  ('wellbeing-evidence-status',         'Wellbeing Evidence Status',       'srs-internal', NULL, 'Where a piece of evidence is in its lifecycle', false),
  ('wellbeing-presenting-concern',      'Presenting Concern',              'srs-internal', NULL, 'Main concern on referral to mental-health support', true),
  ('wellbeing-mh-case-status',          'Mental Health Case Status',       'srs-internal', NULL, 'Where a mental-health case is in its lifecycle', false),
  ('wellbeing-risk-level',              'Risk Level',                      'srs-internal', NULL, 'Practitioner-assessed risk for a mental-health case', false),
  ('wellbeing-intervention-plan-type',  'Intervention Plan Type',          'srs-internal', NULL, 'Kind of support an intervention plan provides', true),
  ('wellbeing-intervention-plan-status','Intervention Plan Status',        'srs-internal', NULL, 'Where an intervention plan is in its lifecycle', false),
  ('wellbeing-session-frequency',       'Session Frequency',               'srs-internal', NULL, 'How often planned sessions take place', false),
  ('wellbeing-session-type',            'Session Type',                    'srs-internal', NULL, 'Kind of mental-health support session', false),
  ('wellbeing-alert-type',              'Early Warning Alert Type',        'srs-internal', NULL, 'What raised an early-warning alert', false),
  ('wellbeing-alert-source',            'Early Warning Alert Source',      'srs-internal', NULL, 'Where an early-warning alert came from', false),
  ('wellbeing-alert-triage-status',     'Early Warning Triage Status',     'srs-internal', NULL, 'Where an early-warning alert is in triage', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('wellbeing-disability-support-type', 'dsa',            'Disabled Students'' Allowance', 10),
  ('wellbeing-disability-support-type', 'institutional',  'Institutional support',          20),
  ('wellbeing-disability-support-type', 'interim',        'Interim support',                30),
  ('wellbeing-disability-case-status', 'assessment_pending', 'Assessment pending', 10),
  ('wellbeing-disability-case-status', 'evidence_pending',   'Evidence pending',   20),
  ('wellbeing-disability-case-status', 'active',             'Active support',     30),
  ('wellbeing-disability-case-status', 'rejected',           'Not eligible',       40),
  ('wellbeing-disability-case-status', 'closed',             'Closed',             50),
  ('wellbeing-support-plan-status', 'none',    'No plan', 10),
  ('wellbeing-support-plan-status', 'draft',   'Draft',   20),
  ('wellbeing-support-plan-status', 'active',  'Active',  30),
  ('wellbeing-support-plan-status', 'expired', 'Expired', 40),
  ('wellbeing-dsa-entitlement-type', 'equipment',            'Equipment',               10),
  ('wellbeing-dsa-entitlement-type', 'support-worker',       'Support worker',          20),
  ('wellbeing-dsa-entitlement-type', 'non-medical-helper',   'Non-medical helper',      30),
  ('wellbeing-dsa-entitlement-type', 'specialist-mentoring', 'Specialist mentoring',    40),
  ('wellbeing-dsa-entitlement-type', 'other',                'Other',                   90),
  ('wellbeing-evidence-type', 'medical',            'Medical evidence',      10),
  ('wellbeing-evidence-type', 'assessment',         'Needs assessment',      20),
  ('wellbeing-evidence-type', 'personal-statement', 'Personal statement',    30),
  ('wellbeing-evidence-type', 'other',              'Other',                 90),
  ('wellbeing-evidence-status', 'pending',  'Awaited',  10),
  ('wellbeing-evidence-status', 'received', 'Received', 20),
  ('wellbeing-evidence-status', 'verified', 'Verified', 30),
  ('wellbeing-evidence-status', 'rejected', 'Rejected', 40),
  ('wellbeing-presenting-concern', 'anxiety',    'Anxiety',    10),
  ('wellbeing-presenting-concern', 'depression', 'Depression', 20),
  ('wellbeing-presenting-concern', 'crisis',     'Crisis',     30),
  ('wellbeing-presenting-concern', 'other',      'Other',      90),
  ('wellbeing-mh-case-status', 'referral_received',  'Referral received',  10),
  ('wellbeing-mh-case-status', 'assessment_pending', 'Assessment pending', 20),
  ('wellbeing-mh-case-status', 'active',             'Active',             30),
  ('wellbeing-mh-case-status', 'on_hold',            'On hold',            40),
  ('wellbeing-mh-case-status', 'discharged',         'Discharged',         50),
  ('wellbeing-mh-case-status', 'closed',             'Closed',             60),
  ('wellbeing-risk-level', 'low',    'Low',    10),
  ('wellbeing-risk-level', 'medium', 'Medium', 20),
  ('wellbeing-risk-level', 'high',   'High',   30),
  ('wellbeing-risk-level', 'crisis', 'Crisis', 40),
  ('wellbeing-intervention-plan-type', 'counselling',    'Counselling',    10),
  ('wellbeing-intervention-plan-type', 'crisis-support', 'Crisis support', 20),
  ('wellbeing-intervention-plan-type', 'signposting',    'Signposting',    30),
  ('wellbeing-intervention-plan-type', 'peer-support',   'Peer support',   40),
  ('wellbeing-intervention-plan-status', 'draft',        'Draft',        10),
  ('wellbeing-intervention-plan-status', 'active',       'Active',       20),
  ('wellbeing-intervention-plan-status', 'completed',    'Completed',    30),
  ('wellbeing-intervention-plan-status', 'discontinued', 'Discontinued', 40),
  ('wellbeing-session-frequency', 'weekly',      'Weekly',      10),
  ('wellbeing-session-frequency', 'fortnightly', 'Fortnightly', 20),
  ('wellbeing-session-frequency', 'monthly',     'Monthly',     30),
  ('wellbeing-session-frequency', 'ad-hoc',      'As needed',   40),
  ('wellbeing-session-type', 'individual', 'Individual', 10),
  ('wellbeing-session-type', 'group',      'Group',      20),
  ('wellbeing-session-type', 'telephone',  'Telephone',  30),
  ('wellbeing-session-type', 'crisis',     'Crisis',     40),
  ('wellbeing-session-type', 'assessment', 'Assessment', 50),
  ('wellbeing-alert-type', 'ukvi-compliance', 'UKVI compliance', 10),
  ('wellbeing-alert-type', 'tutor-concern',   'Tutor concern',   20),
  ('wellbeing-alert-type', 'staff-referral',  'Staff referral',  30),
  ('wellbeing-alert-source', 'ukvi',   'UKVI monitoring', 10),
  ('wellbeing-alert-source', 'tutor',  'Tutor',           20),
  ('wellbeing-alert-source', 'staff',  'Staff',           30),
  ('wellbeing-alert-source', 'system', 'System',          40),
  ('wellbeing-alert-triage-status', 'pending',   'Awaiting triage', 10),
  ('wellbeing-alert-triage-status', 'reviewed',  'Reviewed',        20),
  ('wellbeing-alert-triage-status', 'assigned',  'Assigned to case', 30),
  ('wellbeing-alert-triage-status', 'resolved',  'Resolved',        40),
  ('wellbeing-alert-triage-status', 'dismissed', 'Dismissed',       50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('wellbeing.disability_support_case', 'support_type_code',        'wellbeing-disability-support-type', NULL),
  ('wellbeing.disability_support_case', 'status_code',              'wellbeing-disability-case-status', NULL),
  ('wellbeing.disability_support_case', 'support_plan_status_code', 'wellbeing-support-plan-status', NULL),
  ('wellbeing.dsa_entitlement',         'entitlement_type_code',    'wellbeing-dsa-entitlement-type', NULL),
  ('wellbeing.evidence_reference',      'evidence_type_code',       'wellbeing-evidence-type', NULL),
  ('wellbeing.evidence_reference',      'status_code',              'wellbeing-evidence-status', NULL),
  ('wellbeing.mental_health_case',      'presenting_concern_code',  'wellbeing-presenting-concern', NULL),
  ('wellbeing.mental_health_case',      'status_code',              'wellbeing-mh-case-status', NULL),
  ('wellbeing.mental_health_case',      'risk_level_code',          'wellbeing-risk-level', NULL),
  ('wellbeing.intervention_plan',       'plan_type_code',           'wellbeing-intervention-plan-type', NULL),
  ('wellbeing.intervention_plan',       'status_code',              'wellbeing-intervention-plan-status', NULL),
  ('wellbeing.intervention_plan',       'session_frequency_code',   'wellbeing-session-frequency', NULL),
  ('wellbeing.mh_session_note',         'session_type_code',        'wellbeing-session-type', NULL),
  ('wellbeing.early_warning_alert',     'alert_type_code',          'wellbeing-alert-type', NULL),
  ('wellbeing.early_warning_alert',     'alert_source_code',        'wellbeing-alert-source', NULL),
  ('wellbeing.early_warning_alert',     'triage_status_code',       'wellbeing-alert-triage-status', NULL)
ON CONFLICT DO NOTHING;

-- ── Email: the institution's mailbox and the fake mail server ───────────────
-- email_message is the SRS's own record of every email it sent or received.
-- Outbound mail goes through a transport; the only one shipped is the fake
-- mail server, whose store is email_simulator_message (what external
-- mailboxes "received", and what external senders sent in). Inbound mail
-- arrives through the provider hook, which the simulator also uses.
CREATE TABLE IF NOT EXISTS "email_message" (
  "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                 uuid        NOT NULL REFERENCES "tenant"("id"),
  "direction_code"            text        NOT NULL CHECK ("direction_code" IN ('outbound', 'inbound')),
  "from_address"              text        NOT NULL,
  "to_address"                text        NOT NULL,
  "subject"                   text        NOT NULL,
  "body_text"                 text        NOT NULL,
  "person_id"                 uuid,
  "thread_id"                 uuid        NOT NULL,
  "in_reply_to_id"            uuid        REFERENCES "email_message"("id"),
  "communication_dispatch_id" uuid,
  "status_code"               text        NOT NULL CHECK ("status_code" IN ('sent', 'failed', 'received')),
  "failure_reason"            text,
  "transport_code"            text        NOT NULL,
  "transport_message_id"      text,
  "sent_by"                   text,
  "read_at"                   timestamptz,
  "read_by"                   text,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  CHECK (("direction_code" = 'inbound') = ("status_code" = 'received'))
);
CREATE INDEX IF NOT EXISTS "email_message_mailbox_idx" ON "email_message" ("tenant_id", "direction_code", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "email_message_person_idx" ON "email_message" ("tenant_id", "person_id");
CREATE INDEX IF NOT EXISTS "email_message_thread_idx" ON "email_message" ("tenant_id", "thread_id");
-- A provider retrying its inbound hook delivers the same Message-ID again.
CREATE UNIQUE INDEX IF NOT EXISTS "email_message_transport_id" ON "email_message" ("tenant_id", "transport_message_id") WHERE "transport_message_id" IS NOT NULL;
ALTER TABLE "email_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_message" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "email_message";
CREATE POLICY tenant_isolation ON "email_message"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS "email_simulator_message" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL REFERENCES "tenant"("id"),
  "direction_code"         text        NOT NULL CHECK ("direction_code" IN ('to-external', 'to-institution')),
  "message_id"             text        NOT NULL,
  "from_address"           text        NOT NULL,
  "to_address"             text        NOT NULL,
  "subject"                text        NOT NULL,
  "body_text"              text        NOT NULL,
  "in_reply_to_message_id" text,
  "created_by"             text        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "message_id")
);
CREATE INDEX IF NOT EXISTS "email_simulator_message_to_idx" ON "email_simulator_message" ("tenant_id", "to_address");
CREATE INDEX IF NOT EXISTS "email_simulator_message_from_idx" ON "email_simulator_message" ("tenant_id", "from_address");
ALTER TABLE "email_simulator_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_simulator_message" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "email_simulator_message";
CREATE POLICY tenant_isolation ON "email_simulator_message"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── Valid values: institutions relabel and hide platform values ─────────────
-- A platform value's code never changes, so records, returns and
-- integrations are unaffected; an override changes only the wording one
-- institution sees, or takes the value out of its pickers. A hidden value
-- still labels the records that hold it and still validates. Sets whose
-- values the system writes itself (lifecycle statuses) can be relabelled
-- but not hidden: allows_tenant_hide = false.
ALTER TABLE "value_set" ADD COLUMN IF NOT EXISTS "allows_tenant_hide" boolean NOT NULL DEFAULT true;
UPDATE "value_set" SET "allows_tenant_hide" = false WHERE "set_code" LIKE '%status%';

CREATE TABLE IF NOT EXISTS "value_set_member_override" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid        NOT NULL REFERENCES "tenant"("id"),
  "value_set_member_id" uuid        NOT NULL REFERENCES "value_set_member"("id"),
  "display_label"       text,
  "description"         text,
  "hidden"              boolean     NOT NULL DEFAULT false,
  "updated_by"          text        NOT NULL,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "value_set_member_id"),
  CHECK ("display_label" IS NULL OR length(trim("display_label")) > 0)
);
ALTER TABLE "value_set_member_override" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "value_set_member_override" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "value_set_member_override";
CREATE POLICY tenant_isolation ON "value_set_member_override"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- ── Valid values: code sets for the coded fields that had none ─────────────
-- Every coded field a screen shows or offers now has a value set, so screens
-- show a label, never a bare code. Lifecycle sets the system writes are
-- relabel-only (allows_tenant_hide = false). Fields that hold identifiers
-- or references (period, intake, template, flow, currency, locale, workflow
-- and role codes) are not picklists and have no set.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('admissions-offer-type-code', 'Offer Type', 'srs-internal', NULL, 'Kind of admissions offer', false, false),
  ('admissions-offer-status-code', 'Offer Status', 'srs-internal', NULL, 'Where an admissions offer is', false, false),
  ('offer-response-code', 'Offer Response', 'srs-internal', NULL, 'The applicant''s reply to an offer', false, false),
  ('offer-condition-status-code', 'Offer Condition Status', 'srs-internal', NULL, 'Whether an offer condition has been met', false, false),
  ('condition-match-outcome-code', 'Condition Match Outcome', 'srs-internal', NULL, 'How results compare with an offer condition', false, false),
  ('offer-confirmation-decision-code', 'Confirmation Decision', 'srs-internal', NULL, 'The decision when results arrive', false, false),
  ('application-status-code', 'Application Status', 'srs-internal', NULL, 'Where an application is', false, false),
  ('application-identity-match-code', 'Applicant Identity Match', 'srs-internal', NULL, 'Whether an applicant was matched to an existing person', false, false),
  ('application-routing-reason-code', 'Application Routing Reason', 'srs-internal', NULL, 'Why an application needs attention', false, false),
  ('application-recommendation-code', 'Admissions Recommendation', 'srs-internal', NULL, 'The assessor''s recommendation', false, false),
  ('reassessment-plan-status-code', 'Reassessment Plan Status', 'srs-internal', NULL, 'Where a reassessment plan is', false, false),
  ('award-recommendation-status-code', 'Award Recommendation Status', 'srs-internal', NULL, 'Where an award recommendation is', false, false),
  ('award-classification-code', 'Award Classification', 'srs-internal', NULL, 'Classification of an award', true, true),
  ('document-issue-status-code', 'Issued Document Status', 'srs-internal', NULL, 'Whether an issued document is still current', false, false),
  ('document-verification-outcome-code', 'Document Verification Outcome', 'srs-internal', NULL, 'The result of checking a document', false, false),
  ('document-verification-method-code', 'Verification Method', 'srs-internal', NULL, 'How a document was checked', false, false),
  ('document-signing-key-status-code', 'Signing Key Status', 'srs-internal', NULL, 'Whether a document signing key is in use', false, false),
  ('document-signing-provider-code', 'Signing Provider', 'srs-internal', NULL, 'Where a signing key is held', false, false),
  ('graduation-cycle-status-code', 'Graduation Cycle Status', 'srs-internal', NULL, 'Where a graduation cycle is', false, false),
  ('graduation-response-code', 'Graduation Response', 'srs-internal', NULL, 'A graduand''s reply to a ceremony invitation', false, true),
  ('ceremony-attendance-code', 'Ceremony Attendance', 'srs-internal', NULL, 'Whether an allocated graduand attended', false, false),
  ('curriculum-publication-status-code', 'Curriculum Publication Status', 'srs-internal', NULL, 'Where a curriculum publication is', false, false),
  ('curriculum-object-type-code', 'Curriculum Object Type', 'srs-internal', NULL, 'Kind of object in a curriculum publication', false, false),
  ('curriculum-change-type-code', 'Curriculum Change Type', 'srs-internal', NULL, 'What a publication does to an object', false, false),
  ('curriculum-binding-change-status-code', 'Curriculum Binding Change Status', 'srs-internal', NULL, 'Where a change to a student''s curriculum is', false, false),
  ('module-relationship-type-code', 'Module Relationship', 'srs-internal', NULL, 'How two modules relate', false, true),
  ('academic-period-type-code', 'Academic Period Type', 'srs-internal', NULL, 'Kind of teaching period', false, true),
  ('credit-framework-code', 'Credit Framework', 'srs-internal', NULL, 'The credit scheme a programme uses', true, true),
  ('delivery-mode-code', 'Delivery Mode', 'srs-internal', NULL, 'How a module offering is taught', true, true),
  ('recognised-credit-status-code', 'Recognised Credit Status', 'srs-internal', NULL, 'Where a credit recognition is', false, false),
  ('rule-exception-status-code', 'Rule Exception Status', 'srs-internal', NULL, 'Where a rule exception is', false, false),
  ('module-registration-status-code', 'Module Registration Status', 'srs-internal', NULL, 'Where a module registration is', false, false),
  ('allocation-run-status-code', 'Allocation Run Status', 'srs-internal', NULL, 'Where a module allocation run is', false, false),
  ('allocation-run-kind-code', 'Allocation Run Kind', 'srs-internal', NULL, 'Main or top-up allocation', false, false),
  ('allocation-outcome-code', 'Allocation Outcome', 'srs-internal', NULL, 'What allocation gave a choice', false, false),
  ('timetable-publication-status-code', 'Timetable Publication Status', 'srs-internal', NULL, 'Whether a timetable publication was applied', false, false),
  ('timetable-source-code', 'Timetable Source', 'srs-internal', NULL, 'Where a timetable came from', false, false),
  ('financial-status-code', 'Financial Status', 'srs-internal', NULL, 'Whether a student''s finances are arranged', false, false),
  ('fee-liability-status-code', 'Fee Liability Status', 'srs-internal', NULL, 'Whether a fee liability is current', false, false),
  ('financial-status-source-code', 'Financial Status Source', 'srs-internal', NULL, 'Who set a financial status', false, false),
  ('downstream-trigger-type-code', 'Downstream Notice Type', 'srs-internal', NULL, 'A notice sent after enrolment', false, false),
  ('downstream-trigger-status-code', 'Downstream Notice Status', 'srs-internal', NULL, 'Where an enrolment notice is', false, false),
  ('reenrolment-period-type-code', 'Registration Period Type', 'srs-internal', NULL, 'Initial or annual registration', false, false),
  ('reenrolment-confirmation-status-code', 'Registration Confirmation Status', 'srs-internal', NULL, 'Whether a student has registered for the year', false, false),
  ('reenrolment-channel-code', 'Registration Channel', 'srs-internal', NULL, 'How a student registered', false, false),
  ('identity-verification-status-code', 'Identity Verification Status', 'srs-internal', NULL, 'Where an identity check is', false, false),
  ('right-to-study-outcome-code', 'Right-to-Study Outcome', 'srs-internal', NULL, 'The outcome of a right-to-study check', false, false),
  ('student-status-case-status-code', 'Status Case Status', 'srs-internal', NULL, 'Where a student status case is', false, false),
  ('status-case-condition-status-code', 'Status Case Condition Status', 'srs-internal', NULL, 'Whether a status case condition is met', false, false),
  ('support-award-status-code', 'Support Award Status', 'srs-internal', NULL, 'Where a student support award is', false, false),
  ('support-instalment-status-code', 'Support Instalment Status', 'srs-internal', NULL, 'Where a support payment is', false, false),
  ('employment-link-source-code', 'Employment Link Source', 'srs-internal', NULL, 'Where a student employment link came from', false, false),
  ('ec-determination-status-code', 'EC Determination Status', 'srs-internal', NULL, 'Where a proposed EC outcome is', false, false),
  ('misconduct-case-status-code', 'Misconduct Case Status', 'srs-internal', NULL, 'Where a misconduct case is', false, false),
  ('selection-decision-authority-code', 'Selection Decision Authority', 'srs-internal', NULL, 'Who decided a module selection', false, false),
  ('ukvi-sponsor-outcome-code', 'Sponsor Decision Outcome', 'srs-internal', NULL, 'A UKVI sponsor reporting decision', false, false),
  ('ukvi-sponsor-decision-status-code', 'Sponsor Decision Status', 'srs-internal', NULL, 'Whether a sponsor decision is authorised', false, false),
  ('ukvi-evidence-quality-code', 'Engagement Evidence Quality', 'srs-internal', NULL, 'How reliable sponsor engagement evidence is', false, false),
  ('hesa-validation-source-code', 'Validation Source', 'srs-internal', NULL, 'Who produced a HESA validation report', false, false),
  ('regulatory-transform-code', 'Field Derivation', 'srs-internal', NULL, 'How a return field was produced', false, false),
  ('communication-channel-code', 'Communication Channel', 'srs-internal', NULL, 'How a communication is sent', false, false),
  ('communication-dispatch-status-code', 'Dispatch Status', 'srs-internal', NULL, 'What happened to a communication', false, false),
  ('email-direction-code', 'Email Direction', 'srs-internal', NULL, 'Sent or received', false, false),
  ('email-status-code', 'Email Status', 'srs-internal', NULL, 'What happened to an email', false, false),
  ('email-simulator-direction-code', 'Fake Mail Direction', 'srs-internal', NULL, 'Which way mail went through the fake mail server', false, false),
  ('delivery-item-status-code', 'Delivery Status', 'srs-internal', NULL, 'Where a hand-off to another system is', false, false),
  ('exam-board-role-code', 'Exam Board Role', 'srs-internal', NULL, 'A member''s role at a board meeting', true, true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('admissions-offer-type-code', 'conditional', 'Conditional', 10),
  ('admissions-offer-type-code', 'unconditional', 'Unconditional', 20),
  ('admissions-offer-type-code', 'clearing-verbal', 'Clearing verbal offer', 30),
  ('admissions-offer-status-code', 'made', 'Made', 10),
  ('admissions-offer-status-code', 'accepted', 'Accepted', 20),
  ('admissions-offer-status-code', 'declined', 'Declined', 30),
  ('admissions-offer-status-code', 'withdrawn', 'Withdrawn', 40),
  ('admissions-offer-status-code', 'expired', 'Expired', 50),
  ('admissions-offer-status-code', 'superseded', 'Superseded', 60),
  ('admissions-offer-status-code', 'confirmed', 'Confirmed', 70),
  ('admissions-offer-status-code', 'unsuccessful', 'Unsuccessful', 80),
  ('offer-response-code', 'accept', 'Accepted', 10),
  ('offer-response-code', 'decline', 'Declined', 20),
  ('offer-condition-status-code', 'pending', 'Pending', 10),
  ('offer-condition-status-code', 'met', 'Met', 20),
  ('offer-condition-status-code', 'waived', 'Waived', 30),
  ('offer-condition-status-code', 'unmet', 'Not met', 40),
  ('condition-match-outcome-code', 'meets', 'Results meet this', 10),
  ('condition-match-outcome-code', 'below', 'Results fall below this', 20),
  ('condition-match-outcome-code', 'needs-review', 'Check against the results', 30),
  ('offer-confirmation-decision-code', 'confirmed', 'Confirmed', 10),
  ('offer-confirmation-decision-code', 'confirmed-alternative', 'Confirmed on an alternative course', 20),
  ('offer-confirmation-decision-code', 'unsuccessful', 'Unsuccessful', 30),
  ('application-status-code', 'received', 'Received', 10),
  ('application-status-code', 'incomplete', 'Incomplete', 20),
  ('application-status-code', 'under-assessment', 'Under assessment', 30),
  ('application-status-code', 'recommended', 'Recommended', 40),
  ('application-status-code', 'rejected', 'Rejected', 50),
  ('application-status-code', 'offered', 'Offered', 60),
  ('application-status-code', 'withdrawn', 'Withdrawn', 70),
  ('application-identity-match-code', 'matched', 'Matched to an existing person', 10),
  ('application-identity-match-code', 'created', 'New person created', 20),
  ('application-identity-match-code', 'needs-review', 'Identity to confirm', 30),
  ('application-routing-reason-code', 'identity', 'Identity to confirm', 10),
  ('application-routing-reason-code', 'incomplete', 'Incomplete', 20),
  ('application-routing-reason-code', 'duplicate', 'Possible duplicate', 30),
  ('application-routing-reason-code', 'restricted', 'Restricted', 40),
  ('application-recommendation-code', 'offer', 'Make an offer', 10),
  ('application-recommendation-code', 'reject', 'Reject', 20),
  ('reassessment-plan-status-code', 'planned', 'Planned', 10),
  ('reassessment-plan-status-code', 'completed', 'Completed', 20),
  ('reassessment-plan-status-code', 'expired', 'Expired', 30),
  ('reassessment-plan-status-code', 'cancelled', 'Cancelled', 40),
  ('award-recommendation-status-code', 'recommended', 'Recommended', 10),
  ('award-recommendation-status-code', 'conferred', 'Conferred', 20),
  ('award-recommendation-status-code', 'withdrawn', 'Withdrawn', 30),
  ('award-classification-code', 'first', 'First class honours', 10),
  ('award-classification-code', 'upper-second', 'Upper second class honours (2:1)', 20),
  ('award-classification-code', 'lower-second', 'Lower second class honours (2:2)', 30),
  ('award-classification-code', 'third', 'Third class honours', 40),
  ('award-classification-code', 'distinction', 'Distinction', 50),
  ('award-classification-code', 'merit', 'Merit', 60),
  ('award-classification-code', 'pass', 'Pass', 70),
  ('document-issue-status-code', 'issued', 'Issued', 10),
  ('document-issue-status-code', 'superseded', 'Superseded', 20),
  ('document-issue-status-code', 'revoked', 'Revoked', 30),
  ('document-verification-outcome-code', 'valid', 'Genuine and current', 10),
  ('document-verification-outcome-code', 'revoked', 'Revoked', 20),
  ('document-verification-outcome-code', 'superseded', 'Superseded by a newer document', 30),
  ('document-verification-outcome-code', 'not-found', 'Not found', 40),
  ('document-verification-method-code', 'code', 'Verification code', 10),
  ('document-verification-method-code', 'file', 'Uploaded file', 20),
  ('document-verification-method-code', 'staff-lookup', 'Looked up by staff', 30),
  ('document-signing-key-status-code', 'active', 'Active', 10),
  ('document-signing-key-status-code', 'retired', 'Retired', 20),
  ('document-signing-key-status-code', 'compromised', 'Compromised', 30),
  ('document-signing-provider-code', 'local-key', 'Local key', 10),
  ('document-signing-provider-code', 'openbao-transit', 'OpenBao Transit', 20),
  ('graduation-cycle-status-code', 'open', 'Open', 10),
  ('graduation-cycle-status-code', 'frozen', 'Frozen', 20),
  ('graduation-cycle-status-code', 'closed', 'Closed', 30),
  ('graduation-response-code', 'invited', 'No reply yet', 10),
  ('graduation-response-code', 'attending', 'Attending', 20),
  ('graduation-response-code', 'in-absentia', 'In absentia', 30),
  ('graduation-response-code', 'deferred', 'Deferred', 40),
  ('graduation-response-code', 'declined', 'Declined', 50),
  ('ceremony-attendance-code', 'allocated', 'Allocated', 10),
  ('ceremony-attendance-code', 'attended', 'Attended', 20),
  ('ceremony-attendance-code', 'absent', 'Absent', 30),
  ('curriculum-publication-status-code', 'validated', 'Ready to apply', 10),
  ('curriculum-publication-status-code', 'rejected', 'Rejected', 20),
  ('curriculum-publication-status-code', 'applied', 'Applied', 30),
  ('curriculum-object-type-code', 'programme', 'Programme', 10),
  ('curriculum-object-type-code', 'module', 'Module', 20),
  ('curriculum-object-type-code', 'route', 'Route', 30),
  ('curriculum-object-type-code', 'rule-set', 'Rule set', 40),
  ('curriculum-object-type-code', 'module-group', 'Module group', 50),
  ('curriculum-object-type-code', 'module-group-member', 'Group member', 60),
  ('curriculum-object-type-code', 'learning-outcome', 'Learning outcome', 70),
  ('curriculum-object-type-code', 'module-offering', 'Module offering', 80),
  ('curriculum-change-type-code', 'add', 'Added', 10),
  ('curriculum-change-type-code', 'change', 'Changed', 20),
  ('curriculum-change-type-code', 'close', 'Closed', 30),
  ('curriculum-change-type-code', 'unchanged', 'Unchanged', 40),
  ('curriculum-change-type-code', 'invalid', 'Invalid', 50),
  ('curriculum-binding-change-status-code', 'proposed', 'Proposed', 10),
  ('curriculum-binding-change-status-code', 'approved', 'Approved', 20),
  ('curriculum-binding-change-status-code', 'rejected', 'Rejected', 30),
  ('curriculum-binding-change-status-code', 'applied-directly', 'Applied directly', 40),
  ('module-relationship-type-code', 'prerequisite', 'Prerequisite', 10),
  ('module-relationship-type-code', 'co-requisite', 'Co-requisite', 20),
  ('module-relationship-type-code', 'exclusion', 'Exclusion', 30),
  ('academic-period-type-code', 'semester', 'Semester', 10),
  ('academic-period-type-code', 'term', 'Term', 20),
  ('academic-period-type-code', 'year', 'Full year', 30),
  ('credit-framework-code', 'cats', 'CATS (UK credit)', 10),
  ('credit-framework-code', 'ects', 'ECTS (European credit)', 20),
  ('credit-framework-code', 'institutional', 'Institutional scheme', 30),
  ('delivery-mode-code', 'in-person', 'In person', 10),
  ('delivery-mode-code', 'online', 'Online', 20),
  ('delivery-mode-code', 'blended', 'Blended', 30),
  ('recognised-credit-status-code', 'proposed', 'Proposed', 10),
  ('recognised-credit-status-code', 'approved', 'Approved', 20),
  ('recognised-credit-status-code', 'rejected', 'Rejected', 30),
  ('rule-exception-status-code', 'proposed', 'Proposed', 10),
  ('rule-exception-status-code', 'approved', 'Approved', 20),
  ('rule-exception-status-code', 'rejected', 'Rejected', 30),
  ('rule-exception-status-code', 'revoked', 'Revoked', 40),
  ('module-registration-status-code', 'registered', 'Registered', 10),
  ('module-registration-status-code', 'withdrawn', 'Withdrawn', 20),
  ('module-registration-status-code', 'completed', 'Completed', 30),
  ('allocation-run-status-code', 'previewed', 'Preview', 10),
  ('allocation-run-status-code', 'submitted', 'Awaiting approval', 20),
  ('allocation-run-status-code', 'approved', 'Approved', 30),
  ('allocation-run-status-code', 'applied', 'Applied', 40),
  ('allocation-run-status-code', 'superseded', 'Superseded', 50),
  ('allocation-run-status-code', 'rejected', 'Rejected', 60),
  ('allocation-run-kind-code', 'main', 'Main allocation', 10),
  ('allocation-run-kind-code', 'top-up', 'Top-up allocation', 20),
  ('allocation-outcome-code', 'allocated', 'Allocated', 10),
  ('allocation-outcome-code', 'unallocated', 'Not allocated', 20),
  ('allocation-outcome-code', 'fixed', 'Fixed', 30),
  ('timetable-publication-status-code', 'applied', 'Applied', 10),
  ('timetable-publication-status-code', 'rejected', 'Rejected', 20),
  ('timetable-source-code', 'ttb', 'Timetabling system', 10),
  ('timetable-source-code', 'srs-admin', 'Entered by registry', 20),
  ('timetable-source-code', 'simulator', 'Simulator', 30),
  ('financial-status-code', 'pending', 'Not yet arranged', 10),
  ('financial-status-code', 'arranged', 'Arranged', 20),
  ('financial-status-code', 'hold', 'On hold', 30),
  ('financial-status-code', 'not-required', 'Not required', 40),
  ('fee-liability-status-code', 'generated', 'Current', 10),
  ('fee-liability-status-code', 'superseded', 'Superseded', 20),
  ('fee-liability-status-code', 'cancelled', 'Cancelled', 30),
  ('financial-status-source-code', 'finance', 'Finance system', 10),
  ('financial-status-source-code', 'slc', 'Student Loans Company', 20),
  ('financial-status-source-code', 'manual', 'Recorded by staff', 30),
  ('downstream-trigger-type-code', 'ucas-confirmation', 'UCAS confirmation', 10),
  ('downstream-trigger-type-code', 'slc-confirmation', 'SLC attendance confirmation', 20),
  ('downstream-trigger-type-code', 'ukvi-cas', 'UKVI CAS', 30),
  ('downstream-trigger-status-code', 'pending', 'Pending', 10),
  ('downstream-trigger-status-code', 'sent', 'Sent', 20),
  ('downstream-trigger-status-code', 'processed', 'Processed', 30),
  ('downstream-trigger-status-code', 'acknowledged', 'Acknowledged', 40),
  ('downstream-trigger-status-code', 'failed', 'Failed', 50),
  ('downstream-trigger-status-code', 'cancelled', 'Cancelled', 60),
  ('reenrolment-period-type-code', 'initial', 'Initial registration', 10),
  ('reenrolment-period-type-code', 'annual', 'Annual re-registration', 20),
  ('reenrolment-confirmation-status-code', 'pending', 'Not yet registered', 10),
  ('reenrolment-confirmation-status-code', 'confirmed', 'Registered', 20),
  ('reenrolment-confirmation-status-code', 'lapsed', 'Lapsed', 30),
  ('reenrolment-channel-code', 'portal', 'Self-service portal', 10),
  ('reenrolment-channel-code', 'assisted', 'Assisted by staff', 20),
  ('identity-verification-status-code', 'requested', 'Requested', 10),
  ('identity-verification-status-code', 'verified', 'Verified', 20),
  ('identity-verification-status-code', 'failed', 'Failed', 30),
  ('identity-verification-status-code', 'fraud-flagged', 'Flagged for fraud', 40),
  ('right-to-study-outcome-code', 'pending', 'Waiting for a check', 10),
  ('right-to-study-outcome-code', 'eligible', 'Eligible', 20),
  ('right-to-study-outcome-code', 'not-eligible', 'Not eligible', 30),
  ('right-to-study-outcome-code', 'referred', 'Referred to a regulatory officer', 40),
  ('right-to-study-outcome-code', 'recheck-required', 'Recheck needed', 50),
  ('student-status-case-status-code', 'requested', 'Requested', 10),
  ('student-status-case-status-code', 'approved', 'Approved', 20),
  ('student-status-case-status-code', 'rejected', 'Rejected', 30),
  ('student-status-case-status-code', 'withdrawn', 'Withdrawn', 40),
  ('status-case-condition-status-code', 'open', 'Open', 10),
  ('status-case-condition-status-code', 'met', 'Met', 20),
  ('status-case-condition-status-code', 'waived', 'Waived', 30),
  ('support-award-status-code', 'draft', 'Draft', 10),
  ('support-award-status-code', 'approved', 'Approved', 20),
  ('support-award-status-code', 'suspended', 'Suspended', 30),
  ('support-award-status-code', 'ended', 'Ended', 40),
  ('support-instalment-status-code', 'planned', 'Planned', 10),
  ('support-instalment-status-code', 'approved', 'Approved', 20),
  ('support-instalment-status-code', 'paid', 'Paid', 30),
  ('support-instalment-status-code', 'rejected', 'Rejected', 40),
  ('support-instalment-status-code', 'cancelled', 'Cancelled', 50),
  ('employment-link-source-code', 'connector', 'HR system', 10),
  ('employment-link-source-code', 'person', 'Declared by the student', 20),
  ('ec-determination-status-code', 'proposed', 'Proposed', 10),
  ('ec-determination-status-code', 'upheld', 'Upheld', 20),
  ('ec-determination-status-code', 'not-upheld', 'Not upheld', 30),
  ('misconduct-case-status-code', 'open', 'Open', 10),
  ('misconduct-case-status-code', 'closed', 'Closed', 20),
  ('misconduct-case-status-code', 'withdrawn', 'Withdrawn', 30),
  ('selection-decision-authority-code', 'automatic', 'Automatic', 10),
  ('selection-decision-authority-code', 'registry-administrator', 'Registry', 20),
  ('selection-decision-authority-code', 'programme-approver', 'Programme approver', 30),
  ('selection-decision-authority-code', 'allocation', 'Allocation run', 40),
  ('ukvi-sponsor-outcome-code', 'report', 'Report to UKVI', 10),
  ('ukvi-sponsor-outcome-code', 'no-report', 'No report', 20),
  ('ukvi-sponsor-outcome-code', 'further-review', 'Further review', 30),
  ('ukvi-sponsor-decision-status-code', 'pending-authorisation', 'Awaiting authorisation', 10),
  ('ukvi-sponsor-decision-status-code', 'authorised', 'Authorised', 20),
  ('ukvi-evidence-quality-code', 'verified', 'Verified', 10),
  ('ukvi-evidence-quality-code', 'reconciliation-required', 'Needs reconciling', 20),
  ('hesa-validation-source-code', 'internal', 'Our checks', 10),
  ('hesa-validation-source-code', 'hesa-authority', 'HESA', 20),
  ('regulatory-transform-code', 'identity', 'Copied as recorded', 10),
  ('regulatory-transform-code', 'derived', 'Derived', 20),
  ('regulatory-transform-code', 'aggregated', 'Aggregated', 30),
  ('communication-channel-code', 'email', 'Email', 10),
  ('communication-channel-code', 'crm-handoff', 'CRM hand-off', 20),
  ('communication-channel-code', 'integration-event', 'Integration event', 30),
  ('communication-dispatch-status-code', 'dispatched', 'Sent', 10),
  ('communication-dispatch-status-code', 'suppressed', 'Not sent: channel off', 20),
  ('communication-dispatch-status-code', 'failed', 'Failed', 30),
  ('email-direction-code', 'outbound', 'Sent', 10),
  ('email-direction-code', 'inbound', 'Received', 20),
  ('email-status-code', 'sent', 'Sent', 10),
  ('email-status-code', 'failed', 'Not delivered', 20),
  ('email-status-code', 'received', 'Received', 30),
  ('email-simulator-direction-code', 'to-external', 'Delivered to an external mailbox', 10),
  ('email-simulator-direction-code', 'to-institution', 'Sent to the institution', 20),
  ('delivery-item-status-code', 'pending', 'Waiting', 10),
  ('delivery-item-status-code', 'delivered', 'Delivered', 20),
  ('delivery-item-status-code', 'failed', 'Could not deliver', 30),
  ('delivery-item-status-code', 'superseded', 'Superseded', 40),
  ('exam-board-role-code', 'chair', 'Chair', 10),
  ('exam-board-role-code', 'member', 'Member', 20),
  ('exam-board-role-code', 'external-examiner', 'External examiner', 30),
  ('exam-board-role-code', 'secretary', 'Secretary', 40),
  ('exam-board-role-code', 'observer', 'Observer', 50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('admissions_offer', 'offer_type_code', 'admissions-offer-type-code', NULL),
  ('admissions_offer', 'status_code', 'admissions-offer-status-code', NULL),
  ('admissions_offer', 'response_code', 'offer-response-code', NULL),
  ('offer_condition', 'status_code', 'offer-condition-status-code', NULL),
  ('condition_evidence', 'match_outcome_code', 'condition-match-outcome-code', NULL),
  ('offer_confirmation_decision', 'decision_code', 'offer-confirmation-decision-code', NULL),
  ('student_application', 'status_code', 'application-status-code', NULL),
  ('student_application', 'identity_match_code', 'application-identity-match-code', NULL),
  ('student_application', 'routing_reason_code', 'application-routing-reason-code', NULL),
  ('student_application', 'recommendation_code', 'application-recommendation-code', NULL),
  ('reassessment_plan', 'status_code', 'reassessment-plan-status-code', NULL),
  ('award_recommendation', 'status_code', 'award-recommendation-status-code', NULL),
  ('award', 'classification_code', 'award-classification-code', NULL),
  ('award_recommendation', 'classification_code', 'award-classification-code', NULL),
  ('award_recommendation', 'calculated_classification_code', 'award-classification-code', NULL),
  ('award_calculation_evidence', 'classification_code', 'award-classification-code', NULL),
  ('document_issue', 'status_code', 'document-issue-status-code', NULL),
  ('document_verification', 'outcome_code', 'document-verification-outcome-code', NULL),
  ('document_verification', 'method_code', 'document-verification-method-code', NULL),
  ('document_signing_key', 'status_code', 'document-signing-key-status-code', NULL),
  ('document_signing_key', 'provider_code', 'document-signing-provider-code', NULL),
  ('graduation_cycle', 'status_code', 'graduation-cycle-status-code', NULL),
  ('graduation_invitation', 'response_code', 'graduation-response-code', NULL),
  ('ceremony_allocation', 'attendance_code', 'ceremony-attendance-code', NULL),
  ('curriculum_publication', 'status_code', 'curriculum-publication-status-code', NULL),
  ('curriculum_publication_item', 'object_type_code', 'curriculum-object-type-code', NULL),
  ('curriculum_publication_item', 'change_type_code', 'curriculum-change-type-code', NULL),
  ('curriculum_binding_change', 'status_code', 'curriculum-binding-change-status-code', NULL),
  ('module_relationship', 'relationship_type_code', 'module-relationship-type-code', NULL),
  ('academic_period', 'period_type_code', 'academic-period-type-code', NULL),
  ('programme', 'credit_framework_code', 'credit-framework-code', NULL),
  ('module_offering', 'delivery_mode_code', 'delivery-mode-code', NULL),
  ('recognised_credit', 'status_code', 'recognised-credit-status-code', NULL),
  ('rule_exception', 'status_code', 'rule-exception-status-code', NULL),
  ('module_registration', 'status_code', 'module-registration-status-code', NULL),
  ('module_allocation_run', 'status_code', 'allocation-run-status-code', NULL),
  ('module_allocation_run', 'kind_code', 'allocation-run-kind-code', NULL),
  ('module_allocation_result', 'outcome_code', 'allocation-outcome-code', NULL),
  ('timetable_publication', 'status_code', 'timetable-publication-status-code', NULL),
  ('timetable_publication', 'source_system_code', 'timetable-source-code', NULL),
  ('fee_liability', 'financial_status_code', 'financial-status-code', NULL),
  ('fee_liability', 'status_code', 'fee-liability-status-code', NULL),
  ('fee_liability', 'status_source_code', 'financial-status-source-code', NULL),
  ('enrolment_downstream_trigger', 'trigger_type_code', 'downstream-trigger-type-code', NULL),
  ('enrolment_downstream_trigger', 'status_code', 'downstream-trigger-status-code', NULL),
  ('reenrolment_period', 'period_type_code', 'reenrolment-period-type-code', NULL),
  ('reenrolment_confirmation', 'status_code', 'reenrolment-confirmation-status-code', NULL),
  ('reenrolment_confirmation', 'channel_code', 'reenrolment-channel-code', NULL),
  ('identity_verification_check', 'status_code', 'identity-verification-status-code', NULL),
  ('right_to_study_check', 'outcome_code', 'right-to-study-outcome-code', NULL),
  ('student_status_case', 'status_code', 'student-status-case-status-code', NULL),
  ('status_case_condition', 'status_code', 'status-case-condition-status-code', NULL),
  ('support_award', 'status_code', 'support-award-status-code', NULL),
  ('support_instalment', 'status_code', 'support-instalment-status-code', NULL),
  ('student_employment_link', 'source_code', 'employment-link-source-code', NULL),
  ('ec_determination', 'status_code', 'ec-determination-status-code', NULL),
  ('misconduct_case_reference', 'case_status_code', 'misconduct-case-status-code', NULL),
  ('module_selection_proposal', 'decision_authority_code', 'selection-decision-authority-code', NULL),
  ('ukvi_sponsor_decision', 'outcome_code', 'ukvi-sponsor-outcome-code', NULL),
  ('ukvi_sponsor_decision', 'status_code', 'ukvi-sponsor-decision-status-code', NULL),
  ('ukvi_engagement_evidence_snapshot', 'evidence_quality_code', 'ukvi-evidence-quality-code', NULL),
  ('hesa_validation_report', 'source_code', 'hesa-validation-source-code', NULL),
  ('regulatory_field_lineage', 'transform_code', 'regulatory-transform-code', NULL),
  ('communication_template', 'channel_code', 'communication-channel-code', NULL),
  ('communication_dispatch_log', 'channel_code', 'communication-channel-code', NULL),
  ('communication_dispatch_log', 'status_code', 'communication-dispatch-status-code', NULL),
  ('email_message', 'direction_code', 'email-direction-code', NULL),
  ('email_message', 'status_code', 'email-status-code', NULL),
  ('email_simulator_message', 'direction_code', 'email-simulator-direction-code', NULL),
  ('delivery_item', 'status_code', 'delivery-item-status-code', NULL),
  ('exam_board_member_attendance', 'role_code', 'exam-board-role-code', NULL),
  ('admissions_offer', 'mode_of_study_code', 'mode-of-study-code', NULL),
  ('student_application', 'mode_of_study_code', 'mode-of-study-code', NULL),
  ('student_status_case', 'destination_mode_of_study_code', 'mode-of-study-code', NULL),
  ('fee_liability', 'fee_band_code', 'fee-band-code', NULL),
  ('fee_liability', 'funding_source_code', 'funding-source-code', NULL),
  ('fee_liability', 'fee_status_code', 'fee-status-code', NULL),
  ('enrolment_status_transition', 'from_status_code', 'enrolment-status-code', NULL),
  ('enrolment_status_transition', 'to_status_code', 'enrolment-status-code', NULL),
  ('delivery_item', 'fulfilment_mode_code', 'distribution-fulfilment-mode-code', NULL),
  ('adjustment_distribution', 'fulfilment_mode_code', 'distribution-fulfilment-mode-code', NULL),
  ('ec_determination', 'proposed_outcome_code', 'ec-outcome-code', NULL),
  ('curriculum_binding_change', 'change_reason_code', 'curriculum-binding-change-reason-code', NULL),
  ('progression_calculation_evidence', 'decision_code', 'decision-code', NULL),
  ('feature_flag', 'flag_class_code', 'feature-flag-class', NULL),
  ('feature_flag', 'risk_class_code', 'feature-flag-risk-class', NULL)
ON CONFLICT DO NOTHING;

-- Logical fields: a value held in a shared column (case_decision.decision_type_code)
-- whose valid values depend on the kind of case. Screens label them through these.
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('pgr_progress_review', 'outcome_code', 'pgr-review-outcome-code', 'The progress review decision, held in case_decision.decision_type_code')
ON CONFLICT DO NOTHING;

-- Wellbeing reasonable-adjustment cases (the wellbeing module's tables) and
-- PGR supervision decisions.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('wellbeing-adjustment-case-status', 'Adjustment Case Status', 'srs-internal', NULL, 'Where a reasonable-adjustment case is', false, false),
  ('wellbeing-adjustment-case-type', 'Adjustment Need', 'srs-internal', NULL, 'The kind of adjustment a referral asks for', true, true),
  ('wellbeing-assessment-outcome', 'Adjustment Assessment Outcome', 'srs-internal', NULL, 'A specialist assessor''s finding', false, false),
  ('wellbeing-panel-decision', 'Adjustment Panel Decision', 'srs-internal', NULL, 'The panel''s decision on a recommendation', false, false),
  ('wellbeing-adjustment-evidence-type', 'Adjustment Evidence Type', 'srs-internal', NULL, 'Kind of evidence attached to an adjustment case', true, true),
  ('pgr-supervision-decision-code', 'Supervision Decision', 'srs-internal', NULL, 'The decision on a supervisory team', false, false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('wellbeing-adjustment-case-status', 'referral_received',  'Referral received',    10),
  ('wellbeing-adjustment-case-status', 'assessment_pending', 'Assessment pending',   20),
  ('wellbeing-adjustment-case-status', 'under_assessment',   'Under assessment',     30),
  ('wellbeing-adjustment-case-status', 'determination_made', 'Determination made',   40),
  ('wellbeing-adjustment-case-status', 'under_review',       'Under review (panel)', 50),
  ('wellbeing-adjustment-case-status', 'approved',           'Approved',             60),
  ('wellbeing-adjustment-case-status', 'rejected',           'Rejected',             70),
  ('wellbeing-adjustment-case-status', 'review_complete',    'Review complete',      80),
  ('wellbeing-adjustment-case-status', 'closed',             'Closed',               90),
  ('wellbeing-adjustment-case-type', 'exam-time',  'Exam time',  10),
  ('wellbeing-adjustment-case-type', 'venue',      'Venue',      20),
  ('wellbeing-adjustment-case-type', 'coursework', 'Coursework', 30),
  ('wellbeing-adjustment-case-type', 'placement',  'Placement',  40),
  ('wellbeing-adjustment-case-type', 'other',      'Other',      90),
  ('wellbeing-assessment-outcome', 'recommended',       'Recommended',     10),
  ('wellbeing-assessment-outcome', 'not-recommended',   'Not recommended', 20),
  ('wellbeing-assessment-outcome', 'deferred',          'Deferred',        30),
  ('wellbeing-assessment-outcome', 'referred-to-panel', 'Refer to panel',  40),
  ('wellbeing-panel-decision', 'upheld',   'Upheld',   10),
  ('wellbeing-panel-decision', 'modified', 'Modified', 20),
  ('wellbeing-panel-decision', 'rejected', 'Rejected', 30),
  ('wellbeing-adjustment-evidence-type', 'medical-letter',   'Medical letter',   10),
  ('wellbeing-adjustment-evidence-type', 'assessor-report',  'Assessor report',  20),
  ('wellbeing-adjustment-evidence-type', 'dsa-award-letter', 'DSA award letter', 30),
  ('wellbeing-adjustment-evidence-type', 'other',            'Other',            90),
  ('pgr-supervision-decision-code', 'approve', 'Approve', 10),
  ('pgr-supervision-decision-code', 'return',  'Return',  20),
  ('pgr-supervision-decision-code', 'reject',  'Reject',  30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('wellbeing.adjustment_case',          'status_code',          'wellbeing-adjustment-case-status', NULL),
  ('wellbeing.adjustment_case',          'adjustment_type_code', 'wellbeing-adjustment-case-type', NULL),
  ('wellbeing.adjustment_assessment',    'outcome_code',         'wellbeing-assessment-outcome', NULL),
  ('wellbeing.adjustment_panel_decision','decision_code',        'wellbeing-panel-decision', NULL),
  ('wellbeing.adjustment_case_evidence', 'evidence_type_code',   'wellbeing-adjustment-evidence-type', NULL),
  ('pgr_supervision_case',               'decision_code',        'pgr-supervision-decision-code', 'The supervision decision, held in case_decision.decision_type_code')
ON CONFLICT DO NOTHING;

-- Staff and system roles, so workflow steps, tasks and assignment rules show a
-- role's name. The codes are the platform's roles: relabel only.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES ('srs-role-code', 'Role', 'srs-internal', NULL, 'A staff, student or system role', false, false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('srs-role-code', 'student', 'Student', 10),
  ('srs-role-code', 'applicant', 'Applicant', 20),
  ('srs-role-code', 'module-tutor', 'Module tutor', 30),
  ('srs-role-code', 'personal-tutor', 'Personal tutor', 40),
  ('srs-role-code', 'engagement-officer', 'Engagement officer', 50),
  ('srs-role-code', 'research-supervisor', 'Research supervisor', 60),
  ('srs-role-code', 'wellbeing-advisor', 'Wellbeing advisor', 70),
  ('srs-role-code', 'wellbeing-mental-health-advisor', 'Mental health advisor', 80),
  ('srs-role-code', 'wellbeing-specialist-assessor', 'Specialist assessor', 90),
  ('srs-role-code', 'wellbeing-panel-chair', 'Wellbeing panel chair', 100),
  ('srs-role-code', 'wellbeing-auditor', 'Wellbeing auditor', 110),
  ('srs-role-code', 'exam-board-member', 'Exam board member', 120),
  ('srs-role-code', 'exam-board-chair', 'Exam board chair', 130),
  ('srs-role-code', 'external-examiner', 'External examiner', 140),
  ('srs-role-code', 'integrity-officer', 'Academic integrity officer', 150),
  ('srs-role-code', 'registry-administrator', 'Registry administrator', 160),
  ('srs-role-code', 'regulatory-officer', 'Regulatory officer', 170),
  ('srs-role-code', 'finance-administrator', 'Finance administrator', 180),
  ('srs-role-code', 'dpo', 'Data protection officer', 190),
  ('srs-role-code', 'tenant-administrator', 'Tenant administrator', 200),
  ('srs-role-code', 'system-administrator', 'System administrator', 210),
  ('srs-role-code', 'integration-service', 'Integration service', 220),
  ('srs-role-code', 'programme-approver', 'Programme approver', 230),
  ('srs-role-code', 'pgr-administrator', 'PGR administrator', 240),
  ('srs-role-code', 'pgr-director', 'PGR director', 250),
  ('srs-role-code', 'pgr-examiner', 'PGR examiner', 260)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('workflow_step',            'owner_role_code',     'srs-role-code', NULL),
  ('workflow_task',            'assignee_role_code',  'srs-role-code', NULL),
  ('workflow_assignment_rule', 'assignee_role_code',  'srs-role-code', NULL),
  ('workflow_assignment_rule', 'role_code',           'srs-role-code', NULL),
  ('feature_flag_assignment',  'role_code',           'srs-role-code', NULL)
ON CONFLICT DO NOTHING;

-- Attendance and engagement (the attendance module's tables). Their mappings
-- were removed in 0003 when the tables moved to the module; screens label
-- them through these schema-qualified entities.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('engagement-alert-severity-code', 'Engagement Alert Severity', 'srs-internal', NULL, 'How serious an engagement alert is', false, false),
  ('engagement-policy-status-code', 'Engagement Policy Status', 'srs-internal', NULL, 'Whether an engagement policy version is approved', false, false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('engagement-alert-severity-code', 'low',    'Low',    10),
  ('engagement-alert-severity-code', 'medium', 'Medium', 20),
  ('engagement-alert-severity-code', 'high',   'High',   30),
  ('engagement-policy-status-code', 'draft',    'Draft',    10),
  ('engagement-policy-status-code', 'approved', 'Approved', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('attendance.expected_engagement_event',    'activity_type_code',  'engagement-activity-type-code', NULL),
  ('attendance.expected_engagement_event',    'event_mode_code',     'engagement-event-mode-code', NULL),
  ('attendance.engagement_observation',       'capture_method_code', 'engagement-capture-method-code', NULL),
  ('attendance.engagement_observation',       'outcome_code',        'engagement-observation-outcome-code', NULL),
  ('attendance.engagement_observation',       'data_quality_code',   'engagement-data-quality-code', NULL),
  ('attendance.engagement_alert',             'status_code',         'engagement-alert-status-code', NULL),
  ('attendance.engagement_alert',             'severity_code',       'engagement-alert-severity-code', NULL),
  ('attendance.engagement_intervention_case', 'status_code',         'engagement-case-status-code', NULL),
  ('attendance.engagement_intervention_case', 'outcome_code',        'engagement-case-outcome-code', NULL),
  ('attendance.engagement_policy_version',    'status_code',         'engagement-policy-status-code', NULL),
  ('engagement_outcome',                      'severity_code',       'engagement-alert-severity-code', NULL),
  ('workflow_task',                           'task_type_code',      'workflow-step-type-code', NULL)
ON CONFLICT DO NOTHING;

-- Where an approved adjustment is applied.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES ('adjustment-target-system-code', 'Adjustment Target', 'srs-internal', NULL, 'A system an approved adjustment is applied in', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('adjustment-target-system-code', 'vle',        'VLE',        10),
  ('adjustment-target-system-code', 'attendance', 'Attendance', 20),
  ('adjustment-target-system-code', 'exams',      'Exams',      30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('adjustment_target_config', 'target_system',  'adjustment-target-system-code', NULL),
  ('adjustment_distribution',  'target_system',  'adjustment-target-system-code', NULL)
ON CONFLICT DO NOTHING;

-- Issued documents share the student-document types; a verification also
-- reports the signature check, a value the API derives (logical field).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES ('document-signature-status-code', 'Signature Check', 'srs-internal', NULL, 'What checking a document''s signature found', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('document-signature-status-code', 'valid',         'Signature valid',          NULL, 10),
  ('document-signature-status-code', 'invalid',       'Signature does not match', 'Treat the document as not genuine', 20),
  ('document-signature-status-code', 'key-withdrawn', 'Signed with a withdrawn key', 'Signed with a key the institution has withdrawn', 30),
  ('document-signature-status-code', 'unsigned',      'Not signed',               'Issued before documents were signed', 40)
) AS v(set_code, code, display_label, description, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('document_issue',        'document_type_code', 'student-document-type-code', NULL),
  ('document_verification', 'signature_status',   'document-signature-status-code', 'Derived by the verification service')
ON CONFLICT DO NOTHING;

-- Values the API derives or holds in shared columns (logical fields).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('slc-confirmation-type-code', 'SLC Confirmation Type', 'srs-internal', NULL, 'What an SLC attendance confirmation reports', false, false),
  ('non-registration-outcome-code', 'Non-Registration Outcome', 'srs-internal', NULL, 'How a non-registration case was resolved', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('slc-confirmation-type-code', 'enrolment',    'Enrolment',    10),
  ('slc-confirmation-type-code', 'withdrawal',   'Withdrawal',   20),
  ('slc-confirmation-type-code', 'intermission', 'Interruption', 30),
  ('non-registration-outcome-code', 'registered-late',  'Registered late', 10),
  ('non-registration-outcome-code', 'referred',         'Referred to the student''s own request', 20),
  ('non-registration-outcome-code', 'non-registration', 'Non-registration decided', 30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('slc_confirmation',      'confirmation_type', 'slc-confirmation-type-code', 'Derived from the enrolment status'),
  ('non_registration_case', 'outcome_code',      'non-registration-outcome-code', 'Held in case_decision.decision_type_code')
ON CONFLICT DO NOTHING;

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('rule-source-code', 'Rule Source', 'srs-internal', NULL, 'Where an applied academic rule came from', false, false),
  ('non-registration-flag-code', 'Non-Registration Flag', 'srs-internal', NULL, 'Why a non-registration case needs care', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('rule-source-code', 'programme',          'Programme rule', 10),
  ('rule-source-code', 'tenant-default',     'Institution rule', 20),
  ('rule-source-code', 'exception',          'Rule exception for this student', 30),
  ('rule-source-code', 'component-override', 'Assessment component override', 40),
  ('rule-source-code', 'reassessment-plan',  'Reassessment plan cap', 50),
  ('rule-source-code', 'built-in-default',   'Built-in default (no rule configured)', 60),
  ('non-registration-flag-code', 'results-pending',       'Last year''s results not ratified', 10),
  ('non-registration-flag-code', 'open-status-request',   'Has an open status request', 20),
  ('non-registration-flag-code', 'approved-interruption', 'Has an approved interruption', 30),
  ('non-registration-flag-code', 'sponsored',             'Student visa sponsored', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('rule_version_reference', 'source',   'rule-source-code', 'Derived when a rule is resolved'),
  ('non_registration_case',  'flag_code', 'non-registration-flag-code', 'Derived for the worklist')
ON CONFLICT DO NOTHING;

-- Engagement intervention cases (attendance module): contact attempts,
-- actions and referrals. Free text in the module until now; institutions
-- can add their own channels, action types and services.
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('engagement-contact-channel-code', 'Contact Channel', 'srs-internal', NULL, 'How a student was contacted about engagement', true, true),
  ('engagement-contact-outcome-code', 'Contact Outcome', 'srs-internal', NULL, 'What came of a contact attempt', true, true),
  ('engagement-action-type-code', 'Engagement Action', 'srs-internal', NULL, 'A planned action in an engagement case', true, true),
  ('engagement-referral-target-code', 'Referral Service', 'srs-internal', NULL, 'The service an engagement case is referred to', true, true),
  ('engagement-referral-type-code', 'Referral Type', 'srs-internal', NULL, 'The kind of engagement referral', true, true)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('engagement-contact-channel-code', 'portal',    'Portal message', 10),
  ('engagement-contact-channel-code', 'email',     'Email',          20),
  ('engagement-contact-channel-code', 'telephone', 'Telephone',      30),
  ('engagement-contact-channel-code', 'sms',       'Text message',   40),
  ('engagement-contact-channel-code', 'in-person', 'In person',      50),
  ('engagement-contact-channel-code', 'letter',    'Letter',         60),
  ('engagement-contact-outcome-code', 'no-response',           'No response',           10),
  ('engagement-contact-outcome-code', 'contacted',             'Contacted',             20),
  ('engagement-contact-outcome-code', 'response-received',     'Response received',     30),
  ('engagement-contact-outcome-code', 'wrong-contact-details', 'Wrong contact details', 40),
  ('engagement-action-type-code', 'academic-meeting', 'Academic meeting', 10),
  ('engagement-referral-target-code', 'wellbeing',                 'Wellbeing service',            10),
  ('engagement-referral-target-code', 'safeguarding',              'Safeguarding',                 20),
  ('engagement-referral-target-code', 'academic-status-review',    'Academic-status review',       30),
  ('engagement-referral-target-code', 'sponsor-compliance-review', 'Sponsor-compliance review',    40),
  ('engagement-referral-type-code', 'support-request',   'Support request',   10),
  ('engagement-referral-type-code', 'compliance-review', 'Compliance review', 20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('attendance.engagement_contact_attempt', 'channel_code',        'engagement-contact-channel-code', NULL),
  ('attendance.engagement_contact_attempt', 'outcome_code',        'engagement-contact-outcome-code', NULL),
  ('attendance.engagement_action',          'action_type_code',    'engagement-action-type-code', NULL),
  ('attendance.engagement_action',          'owner_role_code',     'srs-role-code', NULL),
  ('attendance.engagement_referral',        'target_service_code', 'engagement-referral-target-code', NULL),
  ('attendance.engagement_referral',        'referral_type_code',  'engagement-referral-type-code', NULL),
  ('attendance.engagement_referral',        'status_code',         'engagement-referral-status-code', NULL)
ON CONFLICT DO NOTHING;

-- Wording the portal shows students. Labels clear to everyone replace the
-- staff-only wording; a choice a student makes is described in their words
-- (the portal's pickers show the description).
UPDATE "value_set_member" m SET "display_label" = v.label
FROM "value_set" vs, (VALUES
  ('wellbeing-adjustment-case-status', 'under_assessment',   'Being assessed'),
  ('wellbeing-adjustment-case-status', 'determination_made', 'Assessment complete'),
  ('wellbeing-adjustment-case-status', 'under_review',       'Under panel review'),
  ('wellbeing-adjustment-case-status', 'rejected',           'Not approved'),
  ('student-status-case-status-code',  'requested',          'Awaiting a decision'),
  ('student-status-case-status-code',  'rejected',           'Not approved')
) AS v(set_code, code, label)
WHERE vs."set_code" = v.set_code AND m."value_set_id" = vs."id" AND m."code" = v.code AND m."tenant_id" IS NULL;

UPDATE "value_set_member" m SET "description" = v.description
FROM "value_set" vs, (VALUES
  ('wellbeing-adjustment-case-type', 'exam-time',  'Extra time in exams'),
  ('wellbeing-adjustment-case-type', 'venue',      'Alternative venue (e.g. separate room)'),
  ('wellbeing-adjustment-case-type', 'coursework', 'Coursework deadline extension'),
  ('wellbeing-adjustment-case-type', 'placement',  'Placement adjustment'),
  ('student-status-case-type-code', 'interruption', 'Take a break from my studies (interruption)'),
  ('student-status-case-type-code', 'return',       'Return from my interruption'),
  ('student-status-case-type-code', 'withdrawal',   'Leave my course (withdrawal)'),
  ('student-status-case-type-code', 'transfer',     'Change my course or mode of study (transfer)'),
  ('graduation-response-code', 'attending',   'I will attend'),
  ('graduation-response-code', 'in-absentia', 'Graduate without attending (in absentia)'),
  ('graduation-response-code', 'deferred',    'Defer to a later ceremony'),
  ('graduation-response-code', 'declined',    'I do not want a ceremony')
) AS v(set_code, code, description)
WHERE vs."set_code" = v.set_code AND m."value_set_id" = vs."id" AND m."code" = v.code AND m."tenant_id" IS NULL;

-- Worklist reasons and outbox states the API derives (logical fields).
INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible", "allows_tenant_hide")
VALUES
  ('right-to-study-work-reason-code', 'Right-to-Study Worklist Reason', 'srs-internal', NULL, 'Why a right-to-study check is on the worklist', false, false),
  ('ucas-decision-send-status-code', 'UCAS Decision Sending', 'srs-internal', NULL, 'Where an admissions decision for UCAS is', false, false)
ON CONFLICT ("set_code") DO NOTHING;
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('right-to-study-work-reason-code', 'share-code-submitted', 'Student shared a code', 10),
  ('right-to-study-work-reason-code', 'referred',             'Referred for a decision', 20),
  ('right-to-study-work-reason-code', 'recheck-required',     'Recheck needed after a visa change', 30),
  ('right-to-study-work-reason-code', 'expiring',             'Permission expiring soon', 40),
  ('right-to-study-work-reason-code', 'expired',              'Permission expired', 50),
  ('ucas-decision-send-status-code', 'queued',     'Waiting to send', 10),
  ('ucas-decision-send-status-code', 'sent',       'Sent, not yet confirmed', 20),
  ('ucas-decision-send-status-code', 'reconciled', 'Confirmed by UCAS', 30),
  ('ucas-decision-send-status-code', 'mismatch',   'UCAS reports something else', 40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('right_to_study_work_item', 'reason',      'right-to-study-work-reason-code', 'Derived for the registration-checks worklist'),
  ('ucas_outbound_decision',   'status_code', 'ucas-decision-send-status-code', 'Derived from the UCAS decision outbox')
ON CONFLICT DO NOTHING;

-- ── Valid values: one wording table for relabels and translations ───────────
-- value_set_member_label holds every wording that replaces a value's own
-- label: for one institution (tenant_id) or the platform (tenant_id NULL),
-- in one language (locale_code) or any (NULL). A screen shows the most
-- specific match: institution + reader's language, institution, platform +
-- reader's language, then the value's own label. Hiding stays a separate,
-- per-institution setting in value_set_member_override.
ALTER TABLE "value_set_member_label" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenant"("id");
ALTER TABLE "value_set_member_label" ALTER COLUMN "locale_code" DROP NOT NULL;
ALTER TABLE "value_set_member_label" ALTER COLUMN "display_label" DROP NOT NULL;
ALTER TABLE "value_set_member_label" ADD COLUMN IF NOT EXISTS "updated_by" text;
ALTER TABLE "value_set_member_label" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "value_set_member_label" DROP CONSTRAINT IF EXISTS "value_set_member_label_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "value_set_member_label_scope"
  ON "value_set_member_label" ("value_set_member_id", COALESCE("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("locale_code", ''));
ALTER TABLE "value_set_member_label" DROP CONSTRAINT IF EXISTS "value_set_member_label_has_wording";
ALTER TABLE "value_set_member_label" ADD CONSTRAINT "value_set_member_label_has_wording"
  CHECK ("display_label" IS NOT NULL OR "description" IS NOT NULL);
-- The platform's any-language wording is the value's own label.
ALTER TABLE "value_set_member_label" DROP CONSTRAINT IF EXISTS "value_set_member_label_platform_has_locale";
ALTER TABLE "value_set_member_label" ADD CONSTRAINT "value_set_member_label_platform_has_locale"
  CHECK ("tenant_id" IS NOT NULL OR "locale_code" IS NOT NULL);
ALTER TABLE "value_set_member_label" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "value_set_member_label" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "value_set_member_label";
CREATE POLICY tenant_isolation ON "value_set_member_label"
  USING ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" IS NULL OR "tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

-- An institution's relabels move into the wording table (any language).
INSERT INTO "value_set_member_label" ("tenant_id", "value_set_member_id", "locale_code", "display_label", "description", "updated_by", "updated_at")
SELECT o."tenant_id", o."value_set_member_id", NULL, o."display_label", o."description", o."updated_by", o."updated_at"
FROM "value_set_member_override" o
WHERE o."display_label" IS NOT NULL OR o."description" IS NOT NULL
ON CONFLICT DO NOTHING;
ALTER TABLE "value_set_member_override" DROP CONSTRAINT IF EXISTS "value_set_member_override_display_label_check";
ALTER TABLE "value_set_member_override" DROP COLUMN IF EXISTS "display_label";
ALTER TABLE "value_set_member_override" DROP COLUMN IF EXISTS "description";
DELETE FROM "value_set_member_override" WHERE NOT "hidden";

-- Welsh wording the portal kept in its translation file, now platform wording.
INSERT INTO "value_set_member_label" ("tenant_id", "value_set_member_id", "locale_code", "display_label", "updated_by")
SELECT NULL, m."id", 'cy-GB', v.label, 'system'
FROM "value_set" vs
JOIN "value_set_member" m ON m."value_set_id" = vs."id" AND m."tenant_id" IS NULL
JOIN (VALUES
  ('enrolment-status-code', 'pre-registration', 'Heb gofrestru eto'),
  ('enrolment-status-code', 'enrolled', 'Wedi cofrestru'),
  ('enrolment-status-code', 'intermitting', 'Yn seibio'),
  ('enrolment-status-code', 'suspended', 'Wedi''i ohirio'),
  ('enrolment-status-code', 'withdrawn', 'Wedi tynnu''n ôl'),
  ('enrolment-status-code', 'graduated', 'Wedi graddio'),
  ('admissions-offer-type-code', 'conditional', 'Amodol'),
  ('admissions-offer-type-code', 'unconditional', 'Diamod'),
  ('application-channel-code', 'ucas', 'UCAS'),
  ('application-channel-code', 'direct', 'Uniongyrchol'),
  ('application-channel-code', 'agent', 'Drwy asiant'),
  ('application-channel-code', 'international-direct', 'Rhyngwladol'),
  ('application-channel-code', 'international-agent', 'Rhyngwladol, drwy asiant'),
  ('application-channel-code', 'clearing', 'Clirio'),
  ('module-selection-proposal-status-code', 'draft', 'Drafft'),
  ('module-selection-proposal-status-code', 'submitted', 'Wedi cyflwyno'),
  ('module-selection-proposal-status-code', 'validated', 'Wedi dilysu'),
  ('module-selection-proposal-status-code', 'approved', 'Wedi cymeradwyo'),
  ('module-selection-proposal-status-code', 'returned', 'Wedi''i ddychwelyd — angen newidiadau'),
  ('module-selection-proposal-status-code', 'waitlisted', 'Ar restr aros'),
  ('module-selection-proposal-status-code', 'rejected', 'Wedi''i wrthod'),
  ('module-selection-proposal-status-code', 'confirmed', 'Wedi cadarnhau'),
  ('module-selection-proposal-status-code', 'awaiting-allocation', 'Yn aros am ddyraniad'),
  ('result-code', 'pass', 'Pasio'),
  ('result-code', 'compensated', 'Pasio Cymhwyso'),
  ('result-code', 'fail', 'Methu'),
  ('result-code', 'defer', 'Gohiriwyd'),
  ('result-code', 'distinction', 'Rhagoriaeth'),
  ('result-code', 'merit', 'Teilyngdod'),
  ('pgr-examiner-role-code', 'internal', 'Arholwr mewnol'),
  ('pgr-examiner-role-code', 'external', 'Arholwr allanol'),
  ('pgr-supervisor-role-code', 'principal', 'Prif oruchwyliwr'),
  ('pgr-supervisor-role-code', 'additional', 'Goruchwyliwr ychwanegol'),
  ('pgr-supervisor-role-code', 'external', 'Goruchwyliwr allanol')
) AS v(set_code, code, label) ON v.set_code = vs."set_code" AND v.code = m."code"
ON CONFLICT DO NOTHING;

-- The portal's student wording, now the platform labels; the selection
-- status set gains the 'awaiting-allocation' status proposals can hold.
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", 'awaiting-allocation', 'Waiting for allocation', 90, NULL, NULL
FROM "value_set" vs WHERE vs."set_code" = 'module-selection-proposal-status-code'
ON CONFLICT DO NOTHING;
INSERT INTO "value_set_member_label" ("tenant_id", "value_set_member_id", "locale_code", "display_label", "updated_by")
SELECT NULL, m."id", 'cy-GB', 'Yn aros am ddyraniad', 'system'
FROM "value_set" vs JOIN "value_set_member" m ON m."value_set_id" = vs."id" AND m."tenant_id" IS NULL AND m."code" = 'awaiting-allocation'
WHERE vs."set_code" = 'module-selection-proposal-status-code'
ON CONFLICT DO NOTHING;
UPDATE "value_set_member" m SET "display_label" = v.label
FROM "value_set" vs, (VALUES
  ('enrolment-status-code',                  'pre-registration',    'Not yet registered'),
  ('application-channel-code',               'agent',               'Through an agent'),
  ('application-channel-code',               'international-direct','International'),
  ('application-channel-code',               'international-agent', 'International, through an agent'),
  ('module-selection-proposal-status-code',  'returned',            'Returned — needs changes')
) AS v(set_code, code, label)
WHERE vs."set_code" = v.set_code AND m."value_set_id" = vs."id" AND m."code" = v.code AND m."tenant_id" IS NULL;
