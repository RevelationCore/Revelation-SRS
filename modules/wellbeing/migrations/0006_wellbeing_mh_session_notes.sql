-- Stage 6: Mental Health session notes (local-only, never published to SRS events)
--
-- Append-only table. Session content is special-category health data (Equality Act 2010,
-- UK GDPR Art. 9). It must never appear in NATS events, SRS APIs, or aggregate reports.
-- Access is restricted to wellbeing-mental-health-advisor role (enforced at route layer).
-- RLS tenant-scopes rows identically to all other wellbeing tables.

CREATE TABLE IF NOT EXISTS wellbeing."mh_session_note" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid        NOT NULL REFERENCES "tenant" ("id"),
  "mental_health_case_id" uuid       NOT NULL,
  "person_id"            uuid        NOT NULL,
  "practitioner_id"      text        NOT NULL,
  "session_date"         timestamptz NOT NULL,
  "session_type_code"    text        NOT NULL,  -- individual | group | telephone | crisis | assessment
  "content"              text        NOT NULL,  -- clinical note — local only, never serialised to events
  "actor_id"             text        NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

-- No UPDATE or DELETE — append-only for audit integrity
CREATE INDEX "mh_session_note_case_idx"
  ON wellbeing."mh_session_note" ("tenant_id", "mental_health_case_id");

CREATE INDEX "mh_session_note_person_idx"
  ON wellbeing."mh_session_note" ("tenant_id", "person_id");

ALTER TABLE wellbeing."mh_session_note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellbeing."mh_session_note" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wellbeing."mh_session_note";
CREATE POLICY tenant_isolation ON wellbeing."mh_session_note"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
