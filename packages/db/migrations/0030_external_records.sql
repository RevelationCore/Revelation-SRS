-- 0030 — Records other systems report about a student (inbound flows)
--
-- The inbound half of the adjacent-system pattern: what the library,
-- accommodation service and others tell the SRS (F-LIB-SIS-01 loans and
-- fines, F-ACC-SIS-01 allocation and check-in/out, ...). A connector posts
-- them (integration:manage); where none exists, staff enter them on the
-- student record. Append-only history; the latest observation per record
-- key (the library account, a booking reference) is current.
--
-- These records inform staff. They never change academic status: under
-- AJ-17 a library fine does not block results or an award, and Registry
-- relies on its own enrolment, not a housing check-in.

CREATE TABLE IF NOT EXISTS "external_record" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL REFERENCES "tenant" ("id"),
  "flow_code"        text        NOT NULL,   -- e.g. F-LIB-SIS-01
  "person_id"        uuid        NOT NULL,
  "record_key"       text        NOT NULL,   -- e.g. 'account', a booking reference
  "payload"          jsonb       NOT NULL,
  "summary"          text        NOT NULL,
  "observed_at"      timestamptz NOT NULL,   -- when the source system says it was true
  "received_at"      timestamptz NOT NULL DEFAULT now(),
  "received_via"     text        NOT NULL CHECK ("received_via" IN ('connector', 'person')),
  "actor_id"         text        NOT NULL,
  "idempotency_key"  text        NOT NULL,
  UNIQUE ("tenant_id", "flow_code", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "external_record_person_idx"
  ON "external_record" ("tenant_id", "person_id", "flow_code", "record_key", "observed_at" DESC);

ALTER TABLE "external_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_record" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "external_record";
CREATE POLICY tenant_isolation ON "external_record"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('library-account-status-code', 'Library Account Status', 'srs-internal', NULL, 'Status of a student''s library account, as reported by the library', true),
  ('accommodation-booking-status-code', 'Accommodation Booking Status', 'srs-internal', NULL, 'Status of an accommodation booking, as reported by the accommodation service', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('library-account-status-code', 'active',    'Active',    10),
  ('library-account-status-code', 'suspended', 'Suspended', 20),
  ('library-account-status-code', 'closed',    'Closed',    30),
  ('accommodation-booking-status-code', 'reserved',    'Reserved',    10),
  ('accommodation-booking-status-code', 'allocated',   'Allocated',   20),
  ('accommodation-booking-status-code', 'checked-in',  'Checked in',  30),
  ('accommodation-booking-status-code', 'checked-out', 'Checked out', 40),
  ('accommodation-booking-status-code', 'cancelled',   'Cancelled',   50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('external_record_library', 'account_status', 'library-account-status-code', 'F-LIB-SIS-01'),
  ('external_record_accommodation', 'booking_status', 'accommodation-booking-status-code', 'F-ACC-SIS-01')
ON CONFLICT DO NOTHING;
