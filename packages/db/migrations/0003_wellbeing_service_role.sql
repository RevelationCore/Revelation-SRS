-- 0003_wellbeing_service_role
--
-- ADR-029 (BL-234): the wellbeing service authenticates to core as itself,
-- through a client bound to one tenant, and holds the role
-- `wellbeing-service` for its two hand-offs. Roles are a value set
-- (srs-role-code), so screens label it and workflow rules can name it.

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('srs-role-code', 'wellbeing-service', 'Wellbeing service (system)', 290)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
