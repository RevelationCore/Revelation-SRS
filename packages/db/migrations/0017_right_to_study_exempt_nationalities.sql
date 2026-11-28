-- 0017_right_to_study_exempt_nationalities
--
-- Institution-confirmations pre-review F-5 (BL-182): with scope 'sponsored'
-- the right-to-study check skipped every unsponsored entrant, including the
-- non-UK, non-Irish entrants UKVI expects a sponsor to check (Doc 2, 2.17).
-- British and Irish citizens need no check; the exemption is data on their
-- nationality members, not a list in code.

UPDATE "value_set_member" m
SET "source_metadata" = COALESCE(m."source_metadata", '{}'::jsonb) || '{"rightToStudyExempt": true}'::jsonb
FROM "value_set" vs
WHERE vs."id" = m."value_set_id" AND vs."set_code" = 'hesa-nationality-code' AND m."code" IN ('GBR', 'IRL') AND m."tenant_id" IS NULL;
