-- Phase 7 Stage 4 completions — contract deprecation fields and constraint correction

-- 1. Deprecation and minimum version support on integration_contract.
--    deprecated_at: when the contract was deprecated (NULL = still active).
--    minimum_supported_version: oldest registration contractVersion still accepted.
ALTER TABLE "integration_contract"
  ADD COLUMN "deprecated_at"             TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "minimum_supported_version" TEXT;

-- 2. Drop the overly restrictive unique constraint on (tenant_id, integration_code).
--    Tenants legitimately need multiple registrations for the same contract type
--    (e.g. multiple VLE instances, staging vs live endpoints, different transports).
ALTER TABLE "integration_registration"
  DROP CONSTRAINT IF EXISTS "integration_registration_tenant_code_unique";
