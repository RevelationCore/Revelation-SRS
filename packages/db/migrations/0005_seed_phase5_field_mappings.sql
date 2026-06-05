-- Revelation SRS — Phase 5 Value Sets and Field Mappings
-- Migration: 0005_seed_phase5_field_mappings
--
-- Adds new value sets for Phase 5 (assessment, adjustments, governance, progression).
-- Extends existing result-code value set with resit-required.
-- Adds field_value_set mappings for all new Phase 5 entity _code columns.

-- ── Extend existing value sets ───────────────────────────────────────────────

-- result-code: add resit-required (was missing from initial seed)
INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('resit-required', 'Resit Required', 60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'result-code'
ON CONFLICT DO NOTHING;

-- ── New Phase 5 value set definitions ───────────────────────────────────────

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('adjustment-type-code',               'Reasonable Adjustment Type',          'srs-internal', NULL, 'Type of disability/wellbeing accommodation',                          true),
  ('adjustment-scope-code',              'Reasonable Adjustment Scope',         'srs-internal', NULL, 'Assessment contexts the adjustment applies to',                       false),
  ('board-type-code',                    'Exam Board Type',                     'srs-internal', NULL, 'Whether a board considers module results or awards',                  false),
  ('decision-code',                      'Progression Decision',                'srs-internal', NULL, 'Year-end progression outcome for an enrolment',                       false),
  ('penalty-code',                       'Misconduct Penalty Type',             'srs-internal', NULL, 'Type of academic misconduct penalty',                                 false),
  ('distribution-status-code',           'Adjustment Distribution Status',      'srs-internal', NULL, 'Status of a downstream adjustment distribution',                      false),
  ('case-type-code',                     'Post-Ratification Case Type',         'srs-internal', NULL, 'Whether a post-ratification case is an appeal or admin correction',  false),
  ('post-ratification-case-status-code', 'Post-Ratification Case Status',       'srs-internal', NULL, 'Workflow status of a post-ratification case',                         false)
ON CONFLICT ("set_code") DO NOTHING;

-- ── Adjustment Type Codes ────────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('extra-time',          'Extra Time',              10),
  ('separate-room',       'Separate Room',           20),
  ('deadline-extension',  'Deadline Extension',      30),
  ('reader',              'Reader',                  40),
  ('scribe',              'Scribe',                  50),
  ('rest-breaks',         'Rest Breaks',             60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'adjustment-type-code'
ON CONFLICT DO NOTHING;

-- ── Adjustment Scope Codes ───────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('all',         'All assessments',     10),
  ('exam',        'Examinations only',   20),
  ('coursework',  'Coursework only',     30),
  ('attendance',  'Attendance only',     40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'adjustment-scope-code'
ON CONFLICT DO NOTHING;

-- ── Board Type Codes ─────────────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('module', 'Module Board', 10),
  ('award',  'Award Board',  20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'board-type-code'
ON CONFLICT DO NOTHING;

-- ── Progression Decision Codes ───────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('progress',     'Progress to Next Year',   10),
  ('resit',        'Resit Required',          20),
  ('repeat-year',  'Repeat Year',             30),
  ('withdraw',     'Withdraw',                40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'decision-code'
ON CONFLICT DO NOTHING;

-- ── Misconduct Penalty Codes ─────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('mark-reduction',    'Mark Reduction',     10),
  ('mark-cap',          'Mark Cap',           20),
  ('module-fail',       'Module Fail',        30),
  ('progression-block', 'Progression Block',  40),
  ('exclusion',         'Exclusion',          50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'penalty-code'
ON CONFLICT DO NOTHING;

-- ── Distribution Status Codes ────────────────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pending',     'Pending',     10),
  ('distributed', 'Distributed', 20),
  ('failed',      'Failed',      30),
  ('superseded',  'Superseded',  40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'distribution-status-code'
ON CONFLICT DO NOTHING;

-- ── Post-Ratification Case Type Codes ───────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('appeal',                   'Appeal',                   10),
  ('administrative-correction','Administrative Correction', 20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'case-type-code'
ON CONFLICT DO NOTHING;

-- ── Post-Ratification Case Status Codes ─────────────────────────────────────

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('submitted',    'Submitted',    10),
  ('under-review', 'Under Review', 20),
  ('upheld',       'Upheld',       30),
  ('dismissed',    'Dismissed',    40),
  ('not-eligible', 'Not Eligible', 50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'post-ratification-case-status-code'
ON CONFLICT DO NOTHING;

-- ── Field → Value Set Mappings ───────────────────────────────────────────────

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  -- Assessment Component
  ('assessment_component',     'component_type_code',         'assessment-component-type',           NULL),
  -- Mark (status is a closed platform enum; no value set entry)
  -- Module Result
  ('module_result',            'result_code',                 'result-code',                         NULL),
  -- Reasonable Adjustment
  ('reasonable_adjustment',    'adjustment_type_code',        'adjustment-type-code',                NULL),
  ('reasonable_adjustment',    'scope_code',                  'adjustment-scope-code',               NULL),
  -- Adjustment Distribution
  ('adjustment_distribution',  'status_code',                 'distribution-status-code',            NULL),
  -- Exceptional Circumstances (outcome_code is institution-defined; no platform value set)
  -- Misconduct Outcome
  ('misconduct_outcome',       'penalty_code',                'penalty-code',                        NULL),
  -- Exam Board
  ('exam_board',               'board_type_code',             'board-type-code',                     NULL),
  -- Progression Decision
  ('progression_decision',     'decision_code',               'decision-code',                       NULL),
  -- Award (qualification_code and classification_code are institution-defined; no platform value set)
  -- Post-Ratification Case
  ('post_ratification_case',   'case_type_code',              'case-type-code',                      NULL),
  ('post_ratification_case',   'status_code',                 'post-ratification-case-status-code',  NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
