-- Revelation SRS — Platform Value Set Seed Data
-- Migration: 0001_seed_value_sets
--
-- Seeds all platform-managed value sets with their initial values.
-- Sources:
--   HESA: HESA Student Record 2024-25 Coding Manual
--   SRS:  Revelation SRS internal enumerations
--
-- To update for a new HESA coding year, insert updated members with
-- active_from set to the start of the new academic year and active_to
-- set on retired codes.  Do NOT delete retired codes — they are required
-- for historical data reconstruction.

-- ── Helper: define all value sets ───────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  -- HESA statutory sets
  ('hesa-disability-code',       'HESA Disability Coding',              'hesa', '2024-25', 'HESA Student Record disability field codes',                         false),
  ('hesa-qualification-type',    'HESA Qualification Type',             'hesa', '2024-25', 'HESA qualification type codes for awards and programmes',             false),
  ('hesa-mode-of-study',         'HESA Mode of Study',                  'hesa', '2024-25', 'HESA mode of study codes',                                            false),
  ('hesa-domicile-code',         'HESA Domicile',                       'hesa', '2024-25', 'Country of domicile prior to study (ISO 3166-1)',                     false),
  ('hesa-ethnicity-code',        'HESA Ethnicity Coding',               'hesa', '2024-25', 'HESA ethnicity field codes (special category)',                       false),
  ('hesa-gender-code',           'HESA Gender',                         'hesa', '2024-25', 'HESA gender codes',                                                   false),
  ('hesa-nationality-code',      'Nationality (ISO 3166-1)',             'hesa', '2024-25', 'Country of nationality (ISO 3166-1 alpha-3)',                         false),
  -- SRS internal enumerations
  ('enrolment-status-code',      'Enrolment Status',                    'srs-internal', NULL, 'Student enrolment lifecycle status',                               false),
  ('person-status-code',         'Person Lifecycle Status',             'srs-internal', NULL, 'Person record lifecycle status (separate from enrolment status)',   false),
  ('mark-status-code',           'Mark Status',                         'srs-internal', NULL, 'Assessment mark status',                                            false),
  ('result-code',                'Module Result',                       'srs-internal', NULL, 'Outcome of a module registration',                                  false),
  ('assessment-component-type',  'Assessment Component Type',           'srs-internal', NULL, 'Type of assessment component',                                      true),
  ('hold-type-code',             'Student Hold Type',                   'srs-internal', NULL, 'Reason for a hold applied to a student account',                   true),
  ('mode-of-study-code',         'Mode of Study',                       'srs-internal', NULL, 'Student mode of study',                                             false),
  ('funding-source-code',        'Funding Source',                      'srs-internal', NULL, 'Source of tuition fee funding',                                     true),
  ('fheq-level',                 'FHEQ Level',                          'srs-internal', NULL, 'Framework for Higher Education Qualifications level (4-8)',         false),
  ('audit-action-type',          'Audit Action Type',                   'srs-internal', NULL, 'Type of action recorded in the audit trail',                        false),
  ('audit-actor-type',           'Audit Actor Type',                    'srs-internal', NULL, 'Type of actor that performed the audited action',                   false),
  ('data-classification-code',   'Data Classification',                 'srs-internal', NULL, 'Personal data sensitivity classification',                           false),
  ('integration-direction-code', 'Integration Direction',               'srs-internal', NULL, 'Direction of an integration contract from the SRS perspective',     false),
  ('integration-exchange-status','Integration Exchange Status',         'srs-internal', NULL, 'Status of an integration exchange attempt',                          false),
  ('integration-transport-code', 'Integration Transport',               'srs-internal', NULL, 'Integration transport mechanism',                                    false),
  ('integration-health-status',  'Integration Health Status',           'srs-internal', NULL, 'Current health state of a registered integration',                  false),
  ('visa-type-code',             'Visa Type',                           'srs-internal', NULL, 'Student visa category',                                              false),
  ('cas-request-type-code',      'CAS Request Type',                    'srs-internal', NULL, 'Type of Confirmation of Acceptance for Studies request',             false),
  ('declaration-status-code',    'Declaration Status',                  'srs-internal', NULL, 'Status of a student disability declaration',                         false),
  ('student-address-type',       'Student Address Type',                'srs-internal', NULL, 'Category of student address',                                        false),
  ('contact-type-code',          'Contact Method Type',                 'srs-internal', NULL, 'Type of student contact method',                                     false),
  ('staff-assignment-type',      'Staff Assignment Type',               'srs-internal', NULL, 'Type of staff-to-student/module assignment',                         false),
  ('research-milestone-type',    'Research Milestone Type',             'srs-internal', NULL, 'PGR research degree milestone type',                                 false)
ON CONFLICT ("set_code") DO NOTHING;

-- ── HESA Disability Codes (2024-25) ─────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'DISABLE')
FROM "value_set" vs,
(VALUES
  ('00',  'No disability',                                          'No known disability',                                                                   0),
  ('01',  'Specific learning difficulty',                           'e.g. dyslexia, dyspraxia or AD(H)D',                                                   10),
  ('02',  'General learning disability',                            'e.g. Down''s syndrome',                                                                 20),
  ('03',  'Social/communication impairment',                        'e.g. Asperger''s syndrome or other autistic spectrum disorder',                          30),
  ('04',  'Long standing illness or health condition',              'e.g. cancer, HIV, diabetes, chronic heart disease or epilepsy',                         40),
  ('05',  'Mental health condition',                                'e.g. depression, schizophrenia or anxiety disorder',                                    50),
  ('06',  'Physical impairment or mobility issues',                 'e.g. difficulty using arms, or using a wheelchair or crutches',                         60),
  ('07',  'Deaf or serious hearing impairment',                     NULL,                                                                                   70),
  ('08',  'Blind or a serious visual impairment',                   'Uncorrected by glasses',                                                                80),
  ('09',  'A disability, impairment or medical condition not listed above', NULL,                                                                            90),
  ('96',  'Prefer not to say',                                      NULL,                                                                                   96),
  ('99',  'Not known / not yet sought',                             NULL,                                                                                   99)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'hesa-disability-code'
ON CONFLICT DO NOTHING;

-- ── HESA Qualification Type Codes (key subset, 2024-25) ─────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'QUALSBJ')
FROM "value_set" vs,
(VALUES
  ('051', 'First degree',                                    10),
  ('055', 'Integrated master''s degree',                     20),
  ('056', 'Foundation degree',                               30),
  ('057', 'Diploma of Higher Education (DipHE)',             40),
  ('058', 'Higher National Certificate/Diploma (HNC/HND)',   50),
  ('100', 'Research-based higher degree (doctoral)',         60),
  ('200', 'Taught higher degree (master''s)',                70),
  ('205', 'Postgraduate Certificate in Education (PGCE)',    80),
  ('300', 'Postgraduate diploma',                            90),
  ('400', 'Professional qualification',                     100),
  ('900', 'Other qualification or award',                   110)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-qualification-type'
ON CONFLICT DO NOTHING;

-- ── HESA Mode of Study (2024-25) ─────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'MODESTU')
FROM "value_set" vs,
(VALUES
  ('01', 'Full-time',                  10),
  ('02', 'Part-time / sandwich',       20),
  ('31', 'Part-time',                  30),
  ('63', 'Flexible / distance',        40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-mode-of-study'
ON CONFLICT DO NOTHING;

-- ── HESA Gender Codes (2024-25) ───────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'SEXID')
FROM "value_set" vs,
(VALUES
  ('1', 'Male',           10),
  ('2', 'Female',         20),
  ('3', 'Other',          30),
  ('4', 'Not known',      40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-gender-code'
ON CONFLICT DO NOTHING;

-- ── HESA Ethnicity Codes (2024-25) ───────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order,
       jsonb_build_object('spec', 'HESA Student Record 2024-25', 'field', 'ETHNIC', 'category', 'special-category')
FROM "value_set" vs,
(VALUES
  ('10', 'White',                                                 10),
  ('15', 'White - English / Welsh / Scottish / Northern Irish',  11),
  ('16', 'White - Irish',                                        12),
  ('17', 'White - Gypsy or Irish Traveller',                     13),
  ('18', 'White - Roma',                                         14),
  ('19', 'White - Other White background',                       15),
  ('21', 'Mixed / Multiple ethnic groups',                       20),
  ('22', 'Mixed - White and Black Caribbean',                    21),
  ('23', 'Mixed - White and Black African',                      22),
  ('24', 'Mixed - White and Asian',                              23),
  ('29', 'Mixed - Any other Mixed / Multiple ethnic background', 24),
  ('31', 'Asian or Asian British',                               30),
  ('32', 'Asian - Indian',                                       31),
  ('33', 'Asian - Pakistani',                                    32),
  ('34', 'Asian - Bangladeshi',                                  33),
  ('35', 'Asian - Chinese',                                      34),
  ('39', 'Asian - Any other Asian background',                   35),
  ('41', 'Black, African, Caribbean or Black British',           40),
  ('42', 'Black - African',                                      41),
  ('43', 'Black - Caribbean',                                    42),
  ('49', 'Black - Any other Black / African / Caribbean background', 43),
  ('50', 'Arab',                                                 50),
  ('80', 'Other ethnic group',                                   80),
  ('90', 'Not known',                                            90),
  ('98', 'Information refused / prefer not to say',              98)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-ethnicity-code'
ON CONFLICT DO NOTHING;

-- ── FHEQ Levels ───────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order
FROM "value_set" vs,
(VALUES
  ('4', 'Level 4', 'Certificate of Higher Education',                             4),
  ('5', 'Level 5', 'Foundation Degree or Higher National Diploma',                5),
  ('6', 'Level 6', 'Bachelor''s degree with or without honours; Graduate Diploma', 6),
  ('7', 'Level 7', 'Master''s degree; Postgraduate Certificate / Diploma',        7),
  ('8', 'Level 8', 'Doctoral degree',                                             8)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'fheq-level'
ON CONFLICT DO NOTHING;

-- ── Enrolment Status ──────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('enrolled',    'Enrolled',     10),
  ('intermitting','Intermitting', 20),
  ('suspended',   'Suspended',    30),
  ('withdrawn',   'Withdrawn',    40),
  ('graduated',   'Graduated',    50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'enrolment-status-code'
ON CONFLICT DO NOTHING;

-- ── Person Lifecycle Status ───────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('prospective', 'Prospective student', 10),
  ('student',     'Enrolled student',    20),
  ('alumnus',     'Alumni',              30),
  ('deceased',    'Deceased',            40),
  ('merged',      'Merged (duplicate)',  50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'person-status-code'
ON CONFLICT DO NOTHING;

-- ── Mark Status ───────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('provisional', 'Provisional', 10),
  ('confirmed',   'Confirmed',   20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'mark-status-code'
ON CONFLICT DO NOTHING;

-- ── Module Result ─────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pass',         'Pass',                  10),
  ('fail',         'Fail',                  20),
  ('compensated',  'Pass (Compensated)',    30),
  ('condoned',     'Pass (Condoned)',       40),
  ('deferred',     'Deferred',             50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'result-code'
ON CONFLICT DO NOTHING;

-- ── Assessment Component Types ────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('exam',          'Examination',           10),
  ('coursework',    'Coursework',            20),
  ('practical',     'Practical',             30),
  ('portfolio',     'Portfolio',             40),
  ('dissertation',  'Dissertation / Thesis', 50),
  ('presentation',  'Presentation',          60),
  ('project',       'Project',               70)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'assessment-component-type'
ON CONFLICT DO NOTHING;

-- ── Hold Types ────────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('financial',     'Financial hold',           10),
  ('library',       'Library hold',             20),
  ('compliance',    'Compliance hold',          30),
  ('disciplinary',  'Disciplinary hold',        40),
  ('document',      'Document outstanding',     50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hold-type-code'
ON CONFLICT DO NOTHING;

-- ── Mode of Study ─────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('full-time',       'Full-time',        10),
  ('part-time',       'Part-time',        20),
  ('distance',        'Distance learning',30),
  ('sandwich',        'Sandwich',         40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'mode-of-study-code'
ON CONFLICT DO NOTHING;

-- ── Funding Source ────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('slc',              'Student Loans Company',   10),
  ('self-funded',      'Self-funded',             20),
  ('employer',         'Employer-sponsored',      30),
  ('international',    'International fee payer', 40),
  ('bursary',          'Institutional bursary',   50),
  ('research-council', 'Research council stipend',60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'funding-source-code'
ON CONFLICT DO NOTHING;

-- ── Audit Action Type ─────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('create', 'Create', 10),
  ('update', 'Update', 20),
  ('delete', 'Delete', 30),
  ('read',   'Read',   40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'audit-action-type'
ON CONFLICT DO NOTHING;

-- ── Audit Actor Type ──────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('user',        'Human user',         10),
  ('system',      'System process',     20),
  ('integration', 'Integration service',30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'audit-actor-type'
ON CONFLICT DO NOTHING;

-- ── Data Classification ───────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "description", "sort_order")
SELECT vs."id", v.code, v.display_label, v.description, v.sort_order
FROM "value_set" vs,
(VALUES
  ('standard',         'Standard',          'Non-personal configuration and reference data',           10),
  ('personal',         'Personal',          'Personal data (GDPR — standard personal)',                20),
  ('sensitive',        'Sensitive',         'Sensitive institutional data (marks, progression, holds)', 30),
  ('special-category', 'Special category',  'GDPR special category (disability, health, ethnicity)',   40),
  ('regulatory',       'Regulatory',        'Statutory exchange data (HESA, SLC, UKVI)',               50)
) AS v(code, display_label, description, sort_order)
WHERE vs."set_code" = 'data-classification-code'
ON CONFLICT DO NOTHING;

-- ── Integration Direction ─────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('inbound',       'Inbound',         10),
  ('outbound',      'Outbound',        20),
  ('bidirectional', 'Bidirectional',   30),
  ('context',       'Reference context (non-SIS-facing)', 40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-direction-code'
ON CONFLICT DO NOTHING;

-- ── Integration Exchange Status ───────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('received',     'Received',          10),
  ('validated',    'Validated',         20),
  ('processed',    'Processed',         30),
  ('sent',         'Sent',              40),
  ('failed',       'Failed',            50),
  ('dead-lettered','Dead-lettered',     60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-exchange-status'
ON CONFLICT DO NOTHING;

-- ── Integration Transport ─────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('rest',       'REST API',   10),
  ('event',      'Event (NATS JetStream)', 20),
  ('sftp',       'SFTP file exchange',     30),
  ('https-file', 'HTTPS file exchange',   40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-transport-code'
ON CONFLICT DO NOTHING;

-- ── Integration Health Status ─────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('healthy',     'Healthy',     10),
  ('degraded',    'Degraded',    20),
  ('unreachable', 'Unreachable', 30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'integration-health-status'
ON CONFLICT DO NOTHING;

-- ── Visa Type ─────────────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('student',  'Student visa',  10),
  ('graduate', 'Graduate visa', 20),
  ('other',    'Other',         30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'visa-type-code'
ON CONFLICT DO NOTHING;

-- ── CAS Request Type ──────────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('new',     'New CAS',    10),
  ('renewal', 'Renewal',    20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'cas-request-type-code'
ON CONFLICT DO NOTHING;

-- ── Disability Declaration Status ────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('declared',  'Declared',   10),
  ('updated',   'Updated',    20),
  ('withdrawn', 'Withdrawn',  30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'declaration-status-code'
ON CONFLICT DO NOTHING;

-- ── Student Address Type ──────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('home',           'Home address',           10),
  ('term',           'Term-time address',      20),
  ('correspondence', 'Correspondence address', 30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'student-address-type'
ON CONFLICT DO NOTHING;

-- ── Contact Method Type ───────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('institutional-email', 'Institutional email', 10),
  ('personal-email',      'Personal email',      20),
  ('mobile-phone',        'Mobile phone',        30),
  ('landline',            'Landline',            40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'contact-type-code'
ON CONFLICT DO NOTHING;

-- ── Staff Assignment Type ─────────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('personal-tutor',  'Personal tutor',     10),
  ('supervisor',      'Research supervisor',20),
  ('module-tutor',    'Module tutor',       30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'staff-assignment-type'
ON CONFLICT DO NOTHING;

-- ── Research Milestone Type ───────────────────────────────────────────────────
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('confirmation-of-registration', 'Confirmation of Registration', 10),
  ('upgrade',                      'Upgrade to PhD',               20),
  ('thesis-submission',            'Thesis submission',            30),
  ('viva',                         'Viva voce examination',        40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'research-milestone-type'
ON CONFLICT DO NOTHING;

-- ── Field → Value Set Mappings ───────────────────────────────────────────────
-- Maps each _code column in the data model to its governing value set.
-- Add new mappings here as domain entities are created in Phase 4+.

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  -- Audit
  ('audit_record',           'action_type',              'audit-action-type',         NULL),
  ('audit_record',           'actor_type',               'audit-actor-type',          NULL),
  -- Integration
  ('integration_contract',   'direction_code',           'integration-direction-code', NULL),
  ('integration_contract',   'data_classification_code', 'data-classification-code',  NULL),
  ('integration_registration','transport_code',          'integration-transport-code', NULL),
  ('integration_registration','health_status_code',      'integration-health-status', NULL),
  ('integration_exchange',   'status_code',              'integration-exchange-status',NULL),
  ('integration_exchange',   'direction_code',           'integration-direction-code', NULL),
  -- Value set members
  ('value_set_member',       'source_metadata',          'data-classification-code',  'Relevant when source_metadata indicates special category')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
