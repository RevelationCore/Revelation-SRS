-- 0019_progression_defer
--
-- BP-06 pre-review G1 (BL-277): a progression decision on missing or
-- deferred results is deferred, not a resit; and no result at all is never a
-- repeat year (E1.1).

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from", "source_metadata")
SELECT vs."id", 'defer', 'Deferred until results are complete', 25, NULL, NULL
FROM "value_set" vs WHERE vs."set_code" = 'decision-code'
ON CONFLICT DO NOTHING;
