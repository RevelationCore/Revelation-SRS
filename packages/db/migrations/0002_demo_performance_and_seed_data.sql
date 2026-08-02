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

