-- Revelation SRS — Phase 4 Field → Value Set Mappings
-- Migration: 0003_seed_phase4_field_mappings
--
-- Adds field_value_set entries for all Phase 4 domain entity _code columns.
-- Value set rows were pre-populated in 0001_seed_value_sets.sql.
-- This migration only adds mappings; it does not insert new value set members.

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  -- Person
  ('person',              'person_status_code',         'person-status-code',        NULL),
  -- Person Identity
  ('person_identity',     'gender_code',                'hesa-gender-code',          NULL),
  ('person_identity',     'nationality_code',           'hesa-nationality-code',     NULL),
  ('person_identity',     'domicile_code',              'hesa-domicile-code',        NULL),
  ('person_identity',     'ethnicity_code',             'hesa-ethnicity-code',       'Special category — read audit required'),
  -- Student Address
  ('student_address',     'address_type_code',          'student-address-type',      NULL),
  -- Student Contact Method
  ('student_contact_method', 'contact_type_code',       'contact-type-code',         NULL),
  -- Disability Declaration
  ('disability_declaration', 'disability_category_code', 'hesa-disability-code',    'Special category — read audit required'),
  ('disability_declaration', 'declaration_status_code', 'declaration-status-code',  NULL),
  -- Identity Verification Check
  -- (status_code uses a platform-internal enum with no external value set)
  -- Enrolment
  ('enrolment',           'status_code',                'enrolment-status-code',     NULL),
  ('enrolment',           'mode_of_study_code',         'mode-of-study-code',        NULL),
  ('enrolment',           'funding_source_code',        'funding-source-code',       NULL),
  -- Programme
  ('programme',           'qualification_type_code',    'hesa-qualification-type',   NULL),
  ('programme',           'mode_of_study_code',         'mode-of-study-code',        NULL),
  -- Module relationship
  -- (relationship_type_code is a closed platform enum; no separate value set entry)
  -- Module Registration
  -- (status_code is a closed platform enum)
  -- Academic Period
  -- (period_type_code is a closed platform enum)
  -- FHEQ levels (shared across programme and module)
  ('programme',           'fheq_level',                 'fheq-level',                NULL),
  ('module',              'fheq_level',                 'fheq-level',                NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
