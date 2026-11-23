-- 0015_conferment_authority
--
-- BP-06 pre-review G5 (BL-279): awards are conferred by a named academic
-- authority (a Registrar or Senate delegate), not by tenant administrators.
-- Which people hold the role is the institution's to say (adoption checklist).

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", v.code, v.display_label, v.sort_order, NULL, NULL
FROM "value_set" vs, (VALUES ('srs-role-code', 'conferment-authority', 'Conferment authority', 340)) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;
