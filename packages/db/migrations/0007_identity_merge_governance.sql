-- 0007_identity_merge_governance
--
-- ADR-031 (BL-353, part of BL-289): an identity merge is the execution of a
-- recorded decision, taken by someone who did not prepare it, on a versioned
-- proposal it must match. Conflicting statutory identifiers block the merge
-- until each is resolved; the value not kept is kept as an alias.

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('srs-role-code', 'identity-resolution-officer', 'Identity resolution officer', 310)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

-- Who added each candidate, so they cannot decide the case.
ALTER TABLE "identity_resolution_candidate" ADD COLUMN IF NOT EXISTS "added_by" text;

-- The proposal a decision was taken on, and why.
ALTER TABLE "identity_resolution_decision" ADD COLUMN IF NOT EXISTS "proposal_id" uuid;
ALTER TABLE "identity_resolution_decision" ADD COLUMN IF NOT EXISTS "reason" text;

CREATE TABLE IF NOT EXISTS "identity_merge_proposal" (
  "id"                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid        NOT NULL REFERENCES "tenant"("id"),
  "identity_resolution_case_id" uuid        NOT NULL REFERENCES "identity_resolution_case"("id"),
  "version"                     integer     NOT NULL,
  "survivor_person_id"          uuid        NOT NULL REFERENCES "person"("id"),
  "merged_person_id"            uuid        NOT NULL REFERENCES "person"("id"),
  -- For each one-per-person fact class (person-identity, regulatory-profile): 'survivor' | 'merged'.
  "fact_choices"                jsonb       NOT NULL DEFAULT '{}',
  -- For each conflicting statutory identifier class: { keep: 'survivor' | 'merged', reason }.
  "identifier_resolutions"      jsonb       NOT NULL DEFAULT '{}',
  "two_accounts_confirmed"      boolean     NOT NULL DEFAULT false,
  "proposed_by"                 text        NOT NULL,
  "proposed_at"                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "identity_merge_proposal_version_unique" UNIQUE ("identity_resolution_case_id", "version"),
  CONSTRAINT "identity_merge_proposal_two_people" CHECK ("survivor_person_id" <> "merged_person_id")
);

CREATE TABLE IF NOT EXISTS "person_identifier_alias" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant"("id"),
  "person_id"        uuid        NOT NULL REFERENCES "person"("id"),
  "identifier_class" text        NOT NULL,
  "value"            text        NOT NULL,
  "source_person_id" uuid        NOT NULL REFERENCES "person"("id"),
  "decision_id"      uuid        NOT NULL REFERENCES "identity_resolution_decision"("id"),
  "created_at"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "person_identifier_alias_lookup" ON "person_identifier_alias" ("tenant_id", "identifier_class", "value");

ALTER TABLE "identity_merge_proposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_merge_proposal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_merge_proposal"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

ALTER TABLE "person_identifier_alias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_identifier_alias" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "person_identifier_alias"
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

GRANT SELECT, INSERT ON "identity_merge_proposal", "person_identifier_alias" TO srs_app;

-- Which person's value a merge keeps, for a conflicting identifier (screens use it as a picklist).
INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('identity-merge-keep-code', 'Identity Merge: Value Kept', 'srs-internal', 'Whose value a merge keeps for a conflicting statutory identifier (ADR-031)', false)
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('identity-merge-keep-code', 'survivor', 'The surviving record''s value', 10),
  ('identity-merge-keep-code', 'merged',   'The merged record''s value',    20)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('identity_merge_proposal', 'identifier_keep', 'identity-merge-keep-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
