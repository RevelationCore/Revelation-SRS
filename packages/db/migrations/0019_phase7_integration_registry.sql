-- Phase 7 Stage 4 — Plugin Registry Runtime APIs
-- Adds the OfS regulatory extracts contract to the integration contract catalogue.
-- All other integration_contract, integration_registration, and integration_exchange
-- tables were created in 0006_phase6_regulatory_schema.sql.

INSERT INTO "integration_contract" (
  "contract_id",
  "display_name",
  "owner_module_code",
  "direction_code",
  "pattern_type",
  "current_contract_version",
  "data_classification_code"
) VALUES (
  'ofs-regulatory-extracts.v1',
  'OfS Regulatory Extracts',
  'regulatory',
  'outbound',
  'api-and-file',
  '1.0.0',
  'regulatory'
) ON CONFLICT ("contract_id") DO NOTHING;
