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
