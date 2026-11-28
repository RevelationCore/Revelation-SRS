-- 0011_adjustment_withdrawal_authority
--
-- ADR-034 items 6 and 9 (BL-406): an adjustment ended early records the
-- authority that ended it and why, and the database enforces it. Before this,
-- POST /adjustments/:id/expire let one person end any adjustment with no
-- reason (BL-384). withdrawal_id gains its foreign key with the
-- adjustment_withdrawal table (BL-408). No backfill: versions ended by the old
-- route keep null columns and read as natural ends.

ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "withdrawal_authority_code" text;
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "withdrawal_reason_code" text;
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "withdrawal_id" uuid;
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "withdrawal_enrolment_transition_id" uuid REFERENCES "enrolment_status_transition"("id");
ALTER TABLE "reasonable_adjustment" ADD COLUMN IF NOT EXISTS "replacement_adjustment_id" uuid;

ALTER TABLE "reasonable_adjustment" ADD CONSTRAINT "reasonable_adjustment_withdrawal_ck" CHECK (
  (("withdrawal_authority_code" IS NULL) = ("withdrawal_reason_code" IS NULL))
  AND ("withdrawal_authority_code" IS NOT NULL OR ("withdrawal_id" IS NULL AND "withdrawal_enrolment_transition_id" IS NULL AND "replacement_adjustment_id" IS NULL))
  AND ("withdrawal_authority_code" IS NULL OR "withdrawal_authority_code" IN ('wellbeing-case', 'approved-withdrawal', 'enrolment-ended'))
  AND ("withdrawal_authority_code" IS NULL OR "valid_to" IS NOT NULL)
  AND ("withdrawal_authority_code" IS DISTINCT FROM 'wellbeing-case' OR "provenance_code" = 'wellbeing-case')
  AND ("withdrawal_authority_code" IS DISTINCT FROM 'approved-withdrawal' OR ("withdrawal_id" IS NOT NULL AND "provenance_code" <> 'wellbeing-case'))
  AND ("withdrawal_authority_code" IS DISTINCT FROM 'enrolment-ended' OR ("withdrawal_enrolment_transition_id" IS NOT NULL AND "withdrawal_reason_code" = 'enrolment-ended'))
  AND ("withdrawal_reason_code" IS DISTINCT FROM 'enrolment-ended' OR "withdrawal_authority_code" = 'enrolment-ended')
  AND ("withdrawal_reason_code" IS DISTINCT FROM 'superseded' OR "replacement_adjustment_id" IS NOT NULL)
);

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible") VALUES
  ('adjustment-withdrawal-reason-code', 'Adjustment Withdrawal Reason', 'srs-internal', 'Why a core adjustment ended before its end date (ADR-034)', false),
  ('adjustment-withdrawal-authority-code', 'Adjustment Withdrawal Authority', 'srs-internal', 'The authority that ended a core adjustment early (ADR-034)', false)
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('adjustment-withdrawal-reason-code', 'student-request',   'The student asked to stop it',                 10),
  ('adjustment-withdrawal-reason-code', 'no-longer-needed',  'A review found it is no longer needed',        20),
  ('adjustment-withdrawal-reason-code', 'recorded-in-error', 'It should never have been recorded',           30),
  ('adjustment-withdrawal-reason-code', 'superseded',        'Replaced by another adjustment',               40),
  ('adjustment-withdrawal-reason-code', 'enrolment-ended',   'The enrolment it belongs to has ended',        50),
  ('adjustment-withdrawal-authority-code', 'wellbeing-case',      'Withdrawn through its wellbeing case',     10),
  ('adjustment-withdrawal-authority-code', 'approved-withdrawal', 'Withdrawn, approved by a second person',   20),
  ('adjustment-withdrawal-authority-code', 'enrolment-ended',     'Ended with the enrolment',                30)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code") VALUES
  ('reasonable_adjustment', 'withdrawal_reason_code',    'adjustment-withdrawal-reason-code'),
  ('reasonable_adjustment', 'withdrawal_authority_code', 'adjustment-withdrawal-authority-code')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
