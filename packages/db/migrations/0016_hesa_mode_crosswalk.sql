-- 0016_hesa_mode_crosswalk
--
-- Four-nation pre-review F-05 (BL-307): HESA mode codes were hard-coded, and
-- wrong against the platform's own hesa-mode-of-study set (part-time sent as
-- 02, not 31; distance and sandwich sent as 03 and 04, which are not codes).
-- Each SRS mode of study now names its HESA code in source_metadata, and the
-- HESA service reads the crosswalk from here. The whole field model is still
-- the legacy Student Record, not Data Futures (BL-293).

UPDATE "value_set_member" m
SET "source_metadata" = COALESCE(m."source_metadata", '{}'::jsonb) || jsonb_build_object('hesaModeOfStudy', v.hesa)
FROM "value_set" vs, (VALUES
  ('full-time', '01'),
  ('part-time', '31'),
  ('sandwich',  '02'),
  ('distance',  '63')
) AS v(code, hesa)
WHERE vs."id" = m."value_set_id" AND vs."set_code" = 'mode-of-study-code' AND m."code" = v.code AND m."tenant_id" IS NULL;
