-- ADR-031 item 7 (BL-358): srs.person.merged is applied once per merge, and
-- every row it moves is recorded, so srs.person.unmerged (BL-359) can reverse it.

CREATE TABLE IF NOT EXISTS vle_connector."person_merge_applied" (
  "tenant_id"  uuid        NOT NULL,
  "merge_id"   uuid        NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "unmerged_at" timestamptz,
  PRIMARY KEY ("tenant_id", "merge_id")
);

CREATE TABLE IF NOT EXISTS vle_connector."person_merge_move" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL,
  "merge_id"          uuid        NOT NULL,
  "table_name"        text        NOT NULL,
  "column_name"       text        NOT NULL,
  "row_key"           text        NOT NULL,
  "mode"              text        NOT NULL CHECK ("mode" IN ('versioned-move', 'ledgered-move')),
  "from_person_id"    uuid        NOT NULL,
  "to_person_id"      uuid        NOT NULL,
  "closed_version_id" uuid,
  "new_version_id"    uuid
);
CREATE INDEX IF NOT EXISTS "person_merge_move_merge_idx" ON vle_connector."person_merge_move" ("tenant_id", "merge_id");
