-- Revelation SRS — Value-Set Picklist Normalisation
-- Migration: 0027_valueset_picklists
--
-- Principle: every code column surfaced to a UI picklist must be backed by a
-- value_set + field_value_set mapping so that the list of valid values is
-- authoritative in the database and can be extended per-tenant without a
-- code deployment.
--
-- This migration:
--   1. Corrects student-address-type members (term-time, next-of-kin).
--   2. Adds exam-board-type-code value set + members + field mapping.
--   3. Adds correction-case-type-code value set + members + field mapping.
--   4. Adds academic-rule-type-code value set + members + field mapping.
--   5. Adds foi-status-code value set + members (no domain field mapping —
--      used by admin workflow only).

-- ── 1. Fix student-address-type ──────────────────────────────────────────────
-- The original seed used 'term' but the application code expects 'term-time'.
-- Rename the code in place and add next-of-kin.

UPDATE "value_set_member"
SET    "code" = 'term-time', "display_label" = 'Term-time address'
WHERE  "value_set_id" = (SELECT "id" FROM "value_set" WHERE "set_code" = 'student-address-type')
  AND  "code" = 'term';

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('next-of-kin', 'Next-of-kin address', 40)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'student-address-type'
ON CONFLICT DO NOTHING;

-- ── 2. Exam Board Type ───────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('exam-board-type-code', 'Exam Board Type', 'srs-internal', NULL,
        'Category of examination board (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('undergraduate',        'Undergraduate',         10),
  ('postgraduate-taught',  'Postgraduate Taught',   20),
  ('postgraduate-research','Postgraduate Research',  30),
  ('progression',          'Progression',           40),
  ('resit',                'Resit',                 50)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'exam-board-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('exam_board', 'board_type_code', 'exam-board-type-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ── 3. Correction Case Type ──────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('correction-case-type-code', 'Correction Case Type', 'srs-internal', NULL,
        'Type of academic correction or appeal case (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('appeal',                    'Academic Appeal',            10),
  ('administrative-correction', 'Administrative Correction',  20),
  ('misconduct',                'Academic Misconduct',        30)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'correction-case-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('correction_case', 'case_type_code', 'correction-case-type-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ── 4. Academic Rule Type ────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('academic-rule-type-code', 'Academic Rule Type', 'srs-internal', NULL,
        'Category of academic regulation rule (institution-extensible)', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('progression',       'Progression',        10),
  ('classification',    'Classification',     20),
  ('assessment',        'Assessment',         30),
  ('credit-transfer',   'Credit Transfer',    40),
  ('resit-eligibility', 'Resit Eligibility',  50),
  ('award-eligibility', 'Award Eligibility',  60)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'academic-rule-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('academic_rule', 'rule_type_code', 'academic-rule-type-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;

-- ── 5. FOI Status ────────────────────────────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES ('foi-status-code', 'FOI Request Status', 'srs-internal', NULL,
        'Lifecycle status of a Freedom of Information request', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM   "value_set" vs,
(VALUES
  ('open',        'Open',        10),
  ('in-progress', 'In Progress', 20),
  ('completed',   'Completed',   30),
  ('rejected',    'Rejected',    40),
  ('withdrawn',   'Withdrawn',   50)
) AS v(code, display_label, sort_order)
WHERE  vs."set_code" = 'foi-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES ('foi_request', 'status_code', 'foi-status-code', NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
