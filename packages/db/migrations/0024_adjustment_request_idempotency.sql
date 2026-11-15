-- Reasonable adjustments: idempotent recording (AJ-21 A21-AC04).
--
-- The wellbeing module sends an x-idempotency-key with each approved-outcome
-- handoff. If the SRS commits the adjustment but the response is lost, the
-- module's retry must return the original adjustment rather than create a
-- second one with its own distributions. One row per accepted request key;
-- the payload hash detects reuse of a key for a different request.
--
-- A separate table rather than columns on reasonable_adjustment, because that
-- table is bitemporal: a key belongs to the logical request, not to any one
-- recorded version.

CREATE TABLE IF NOT EXISTS "adjustment_request" (
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "idempotency_key"  text        NOT NULL,
  "payload_hash"     text        NOT NULL,
  "adjustment_id"    uuid        NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "idempotency_key")
);

ALTER TABLE "adjustment_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment_request" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "adjustment_request";
CREATE POLICY tenant_isolation ON "adjustment_request"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
