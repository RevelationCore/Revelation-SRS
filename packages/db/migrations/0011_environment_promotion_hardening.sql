-- Revelation SRS — Environment Promotion Hardening
-- Migration: 0011_environment_promotion_hardening
--
-- Stage 9 makes environment identity and integration endpoint safety explicit.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('integration-endpoint-safety-class', 'Integration endpoint safety class', 'srs-internal', '2026-06-14', 'Safety classification for configured integration endpoints.', false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs.id, v.code, v.display_label, v.sort_order
FROM "value_set" vs
JOIN (VALUES
  ('integration-endpoint-safety-class', 'simulator', 'Simulator', 10),
  ('integration-endpoint-safety-class', 'external-test', 'External test endpoint', 20),
  ('integration-endpoint-safety-class', 'external-production', 'External production endpoint', 30)
) AS v(set_code, code, display_label, sort_order)
  ON v.set_code = vs.set_code
ON CONFLICT DO NOTHING;

UPDATE "deployment_environment"
SET "configuration" = "configuration" || jsonb_build_object(
  'defaultEndpointSafetyClass',
  CASE
    WHEN "environment_code" = 'prod' THEN 'external-production'
    WHEN "environment_code" IN ('uat', 'preprod') THEN 'external-test'
    ELSE 'simulator'
  END,
  'requiresLiveTrafficApproval',
  CASE
    WHEN "environment_code" = 'prod' THEN false
    ELSE true
  END
),
"updated_at" = now()
WHERE "environment_code" IN ('local', 'test', 'uat', 'preprod', 'prod');

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('integration_registration.configuration', 'endpointSafetyClass', 'integration-endpoint-safety-class', 'Integration endpoint safety class stored in registration configuration JSON.')
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
