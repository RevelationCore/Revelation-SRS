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
