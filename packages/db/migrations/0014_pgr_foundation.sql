-- Revelation SRS — PGR lifecycle foundation
-- Migration: 0014_pgr_foundation
--
-- Stage 0 of the PGR lifecycle build (ADR-023): seeds the shared vocabulary
-- and integration-contract registrations needed before any PGR schema lands.
-- PGR is built core-hosted, rooted on the existing business_case/case_decision
-- primitive (packages/db/src/schema/business-case.ts) — no new case/workflow
-- engine is introduced here.

-- ── Value set: PGR examination outcome (verbatim from docs/domain-glossary.md) ─

INSERT INTO "value_set" ("set_code", "display_name", "source", "description", "is_extensible")
VALUES
  ('pgr-examination-outcome-code', 'PGR Examination Outcome', 'srs-internal', 'Outcome of a PGR thesis viva voce examination', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pass',                     'Pass',                              10),
  ('pass-minor-corrections',   'Pass with minor corrections',       20),
  ('pass-major-corrections',   'Pass with major corrections',       30),
  ('resubmission',             'Resubmission',                      40),
  ('fail',                     'Fail',                              50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'pgr-examination-outcome-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code")
VALUES
  ('pgr_examination_outcome', 'outcome_code', 'pgr-examination-outcome-code')
ON CONFLICT DO NOTHING;

-- ── Integration contracts: HR and CRIS boundaries (BP-03-007, BP-04-003) ──────
-- Seeded now for completeness/documentation; research-proposal-eligibility.v1
-- is not built against until a concrete research-proposals consumer exists.

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('hr-staff-assignments.v1',        'HR Staff Assignments',              'pgr', 'inbound',       'api', '1.0.0', 'personal'),
  ('cris-pgr-profile.v1',            'CRIS PGR Profile',                  'pgr', 'outbound',      'api', '1.0.0', 'personal'),
  ('cris-pgr-milestones.v1',         'CRIS PGR Milestones',               'pgr', 'bidirectional', 'api', '1.0.0', 'personal'),
  ('research-proposal-eligibility.v1','Research Proposal Eligibility',    'pgr', 'outbound',      'api', '1.0.0', 'personal')
ON CONFLICT ("contract_id") DO NOTHING;
