-- 0020_slc_change_of_circumstances
--
-- BP-02 pre-review F3 (BL-214): the seeded configured rule told SLC only of
-- withdrawal and interruption. It now also covers suspension and a return
-- from either. A tenant that changed the rule's condition keeps its own.

UPDATE "workflow_trigger_rule"
SET "condition_expression" = 'slcReference.present-and-status.change-of-circumstances'
WHERE "trigger_key" = 'enrolment-status-slc-confirmation'
  AND "condition_expression" = 'slcReference.present-and-status.withdrawn-or-intermitting';
