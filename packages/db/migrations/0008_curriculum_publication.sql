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
