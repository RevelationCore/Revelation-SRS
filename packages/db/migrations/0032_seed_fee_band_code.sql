-- ── Fee Band Code value set ───────────────────────────────────────────────────
-- Categorises the fee-paying status of an enrolment for funding purposes.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('fee-band-code', 'Fee Band', 'srs-internal', NULL,
        'Fee-paying status of the enrolment (home, international, etc.)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('home',          'Home (UK)',        10),
  ('international', 'International',    20),
  ('overseas',      'Overseas',         30),
  ('eu',            'EU',               40),
  ('channel-islands','Channel Islands', 50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'fee-band-code'
ON CONFLICT DO NOTHING;

-- Field mapping
INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('enrolment', 'fee_band_code', 'fee-band-code', NULL)
ON CONFLICT DO NOTHING;
