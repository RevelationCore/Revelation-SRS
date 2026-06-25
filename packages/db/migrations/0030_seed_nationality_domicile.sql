-- ── Nationality & Domicile value-set members (ISO 3166-1 alpha-3) ────────────
-- Seeds the subset of ISO 3166-1 alpha-3 country codes used by demo data.
-- The hesa-nationality-code and hesa-domicile-code sets were defined in
-- 0001_seed_value_sets.sql but left empty; validation requires members to exist.

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'ISO 3166-1 alpha-3')
FROM "value_set" vs,
(VALUES
  ('AUS', 'Australia',            50),
  ('CAN', 'Canada',               70),
  ('CHN', 'China',                80),
  ('DEU', 'Germany',             100),
  ('ESP', 'Spain',               110),
  ('FRA', 'France',              120),
  ('GBR', 'United Kingdom',      130),
  ('IND', 'India',               140),
  ('IRL', 'Ireland',             145),
  ('ITA', 'Italy',               150),
  ('JPN', 'Japan',               160),
  ('NGA', 'Nigeria',             200),
  ('NLD', 'Netherlands',         210),
  ('NZL', 'New Zealand',         220),
  ('PAK', 'Pakistan',            230),
  ('POL', 'Poland',              240),
  ('PRT', 'Portugal',            250),
  ('USA', 'United States',       310),
  ('ZZZ', 'Not known',           999)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-nationality-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'ISO 3166-1 alpha-3')
FROM "value_set" vs,
(VALUES
  ('AUS', 'Australia',            50),
  ('CAN', 'Canada',               70),
  ('CHN', 'China',                80),
  ('DEU', 'Germany',             100),
  ('ESP', 'Spain',               110),
  ('FRA', 'France',              120),
  ('GBR', 'United Kingdom',      130),
  ('IND', 'India',               140),
  ('IRL', 'Ireland',             145),
  ('ITA', 'Italy',               150),
  ('JPN', 'Japan',               160),
  ('NGA', 'Nigeria',             200),
  ('NLD', 'Netherlands',         210),
  ('NZL', 'New Zealand',         220),
  ('PAK', 'Pakistan',            230),
  ('POL', 'Poland',              240),
  ('PRT', 'Portugal',            250),
  ('USA', 'United States',       310),
  ('ZZZ', 'Not known',           999)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-domicile-code'
ON CONFLICT DO NOTHING;
