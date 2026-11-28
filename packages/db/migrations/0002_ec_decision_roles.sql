-- 0002_ec_decision_roles
--
-- ADR-028 (BL-169, BL-171): exceptional-circumstances claims are run by an
-- `ec-case-officer` and decided by an `ec-decision-maker`, named after the
-- BP-04-005 actors. Roles are a value set (srs-role-code), so screens label
-- them and workflow rules can name them.

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs,
(VALUES
  ('srs-role-code', 'ec-case-officer',   'EC case officer',   270),
  ('srs-role-code', 'ec-decision-maker', 'EC decision maker', 280)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
