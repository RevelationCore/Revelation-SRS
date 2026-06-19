-- Revelation SRS — Correction Case Status Value Set
-- Migration: 0028_valueset_correction_status
--
-- Adds the correction-case-status-code value set and field mapping so the
-- status picklist in the corrections/appeals UI is database-driven rather
-- than hardcoded.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('correction-case-status-code', 'Correction Case Status', 'srs-internal', NULL,
        'Lifecycle status of a correction or appeal case (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('open',          'Open',          10),
  ('under-review',  'Under Review',  20),
  ('upheld',        'Upheld',        30),
  ('not-upheld',    'Not Upheld',    40),
  ('withdrawn',     'Withdrawn',     50)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'correction-case-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('correction_case', 'case_status_code', 'correction-case-status-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
