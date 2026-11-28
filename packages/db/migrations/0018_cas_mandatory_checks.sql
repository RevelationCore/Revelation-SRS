-- 0018_cas_mandatory_checks
--
-- BP-01 pre-review F8 (BL-198): a CAS could be prepared once the latest
-- check of each *recorded* type had passed, with no required set, and on a
-- conditional offer. UKVI expects a CAS only after an unconditional offer is
-- accepted, and the requirements to be confirmed first (Doc 2, 3.22 and 5.10).
-- The required check types are now data (source_metadata.casMandatory), and a
-- check can be recorded as exempt only with a reason.

ALTER TABLE "cas_eligibility_check" ADD COLUMN IF NOT EXISTS "exemption_reason" text;
ALTER TABLE "cas_eligibility_check" ADD CONSTRAINT "cas_eligibility_check_exemption_ck" CHECK (
  ("result_code" = 'exempt') = ("exemption_reason" IS NOT NULL)
  AND ("exemption_reason" IS NULL OR char_length("exemption_reason") BETWEEN 1 AND 500)
);

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('cas-eligibility-check-type-code', 'identity',         'Identity and nationality',                 5),
  ('cas-eligibility-check-type-code', 'english-language', 'English language',                         25),
  ('cas-eligibility-check-type-code', 'atas',             'ATAS certificate (where the course needs one)', 50),
  ('cas-eligibility-result-code',     'exempt',           'Exempt (with a recorded reason)',          40)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

UPDATE "value_set_member" m
SET "source_metadata" = COALESCE(m."source_metadata", '{}'::jsonb) || '{"casMandatory": true}'::jsonb
FROM "value_set" vs
WHERE vs."id" = m."value_set_id" AND vs."set_code" = 'cas-eligibility-check-type-code' AND m."tenant_id" IS NULL
  AND m."code" IN ('identity', 'immigration-history', 'academic-progress', 'english-language', 'financial-requirement', 'genuine-student');
