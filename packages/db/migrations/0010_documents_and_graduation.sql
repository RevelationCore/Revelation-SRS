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
