-- Retire support_outcome — reverses migration 0004's (originally
-- 0046_support_outcome_distribution's) stated intent to replace
-- adjustment_distribution with this table and the shared distribution_item
-- primitives.
--
-- That replacement never reached parity: no route anywhere in the codebase
-- ever drove a distribution_item past creation (recordAttempt/
-- recordAcknowledgement on BusinessCaseService had zero callers — no
-- acknowledge/reconcile path existed for it), it published no domain
-- events, and no writer ever set one to 'superseded'. adjustment_distribution
-- meanwhile remained the live, fully tested path, with two documented
-- external adapter contracts (VLE — F-SIS-VLE-02, attendance — F-SIS-AM-02)
-- keying their idempotency on it. Rather than finish an unused, untested
-- replacement and migrate a live Equality Act compliance flow plus two real
-- external contracts onto it, support_outcome is retired here.
--
-- Out of scope, deliberately untouched: business_case, case_decision,
-- distribution_item, distribution_attempt, distribution_acknowledgement,
-- and BusinessCaseService#createDistributionItem all remain — they are
-- genuinely used by correction-service.ts (BPR-D13) and by PGR, identity
-- resolution, audit review and rights-requests (business_case/case_decision
-- half only). support_outcome was their only adjustments-facing consumer.

DELETE FROM "field_value_set"
WHERE "entity_name" = 'support_outcome';

DELETE FROM "value_set_member"
WHERE "value_set_id" IN (
  SELECT "id" FROM "value_set"
  WHERE "set_code" IN ('support-outcome-type-code', 'support-outcome-visibility-scope-code')
);

DELETE FROM "value_set"
WHERE "set_code" IN ('support-outcome-type-code', 'support-outcome-visibility-scope-code');

DROP TABLE IF EXISTS "support_outcome";
