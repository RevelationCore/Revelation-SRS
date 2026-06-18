-- Phase 9 — VLE Connector integration contracts
-- Registers the three contracts consumed and produced by the VLE Connector adapter.
-- F015: VLE Course Provisioning (outbound event-driven)
-- F016: VLE Assessment Results  (inbound API)
-- F059: VLE Adjustment Distribution (outbound event-driven)

INSERT INTO "integration_contract" (
  "contract_id",
  "display_name",
  "owner_module_code",
  "direction_code",
  "pattern_type",
  "current_contract_version",
  "data_classification_code"
) VALUES
  (
    'vle-course-provisioning.v1',
    'VLE Course Provisioning',
    'vle',
    'outbound',
    'event-driven',
    '1.0.0',
    'internal'
  ),
  (
    'vle-assessment-results.v1',
    'VLE Assessment Results',
    'vle',
    'inbound',
    'api',
    '1.0.0',
    'confidential'
  ),
  (
    'vle-adjustments.v1',
    'VLE Adjustment Distribution',
    'vle',
    'outbound',
    'event-driven',
    '1.0.0',
    'special-category'
  )
ON CONFLICT ("contract_id") DO NOTHING;
