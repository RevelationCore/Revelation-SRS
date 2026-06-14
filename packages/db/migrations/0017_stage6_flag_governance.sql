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
