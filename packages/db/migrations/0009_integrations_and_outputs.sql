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
