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

