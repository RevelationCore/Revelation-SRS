-- Stage 5: Transactional outbox for SRS exceptional-circumstances handoff (F066)
--
-- Written atomically with an 'upheld' or 'partially_upheld' determination.
-- Only upheld claims are transmitted to SRS; not_upheld / withdrawn claims
-- remain entirely within Wellbeing and never appear in SRS board preparation.
--
-- UNIQUE(idempotency_key) is the exactly-once delivery guarantee.

CREATE TABLE wellbeing.srs_ec_handoff_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  ec_claim_id       uuid        NOT NULL,
  person_id         uuid        NOT NULL,
  idempotency_key   text        NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  status_code       text        NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  attempt_count     int         NOT NULL DEFAULT 0,
  last_attempted_at timestamptz,
  sent_at           timestamptz,
  srs_response      jsonb,
  error_detail      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT srs_ec_handoff_outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX srs_ec_handoff_outbox_pending ON wellbeing.srs_ec_handoff_outbox (tenant_id, status_code)
  WHERE status_code = 'pending';
