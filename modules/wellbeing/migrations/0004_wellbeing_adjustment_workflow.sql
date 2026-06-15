-- Stage 4: Transactional outbox for SRS adjustment handoff
--
-- Records a pending delivery to SRS for every approved adjustment case.
-- The idempotency_key uniqueness constraint ensures that even if the approve
-- action is called multiple times, only one SRS submission is ever attempted.
-- The background processor reads 'pending' rows and delivers to F063; on
-- success it marks 'sent', on failure 'failed' so the next retry picks it up.

CREATE TABLE wellbeing.srs_handoff_outbox (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  adjustment_case_id uuid       NOT NULL,
  person_id         uuid        NOT NULL,
  idempotency_key   text        NOT NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  status_code       text        NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempt_count     int         NOT NULL DEFAULT 0,
  last_attempted_at timestamptz,
  sent_at           timestamptz,
  srs_response      jsonb,
  error_detail      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT srs_handoff_outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX srs_handoff_outbox_pending ON wellbeing.srs_handoff_outbox (tenant_id, status_code)
  WHERE status_code = 'pending';

-- No RLS on the outbox — accessed by the background handoff processor
-- which runs as a service account without tenant context.
