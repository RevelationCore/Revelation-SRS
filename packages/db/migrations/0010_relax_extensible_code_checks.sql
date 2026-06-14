-- Revelation SRS — Relax Extensible Business Code Checks
-- Migration: 0010_relax_extensible_code_checks
--
-- Stage 8 of the platform alignment plan moves institution/process variation to
-- value sets, workflow definitions, trigger rules, and feature flags. Database
-- constraints remain for temporal, ownership, uniqueness, range, and structural
-- invariants, but tenant-extensible business code lists are validated in
-- services through field_value_set mappings.

-- Phase 4 extensible code fields
ALTER TABLE "person" DROP CONSTRAINT IF EXISTS "person_person_status_code_check";
ALTER TABLE "student_address" DROP CONSTRAINT IF EXISTS "student_address_address_type_code_check";
ALTER TABLE "disability_declaration" DROP CONSTRAINT IF EXISTS "disability_declaration_declaration_status_code_check";
ALTER TABLE "identity_verification_check" DROP CONSTRAINT IF EXISTS "identity_verification_check_status_code_check";
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_status_code_check";
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_mode_of_study_code_check";
ALTER TABLE "enrolment" DROP CONSTRAINT IF EXISTS "enrolment_funding_source_code_check";
ALTER TABLE "fee_liability" DROP CONSTRAINT IF EXISTS "fee_liability_status_code_check";
ALTER TABLE "enrolment_downstream_trigger" DROP CONSTRAINT IF EXISTS "enrolment_downstream_trigger_trigger_type_code_check";
ALTER TABLE "enrolment_downstream_trigger" DROP CONSTRAINT IF EXISTS "enrolment_downstream_trigger_status_code_check";
ALTER TABLE "reenrolment_confirmation" DROP CONSTRAINT IF EXISTS "reenrolment_confirmation_status_code_check";
ALTER TABLE "module_relationship" DROP CONSTRAINT IF EXISTS "module_relationship_relationship_type_code_check";
ALTER TABLE "academic_period" DROP CONSTRAINT IF EXISTS "academic_period_period_type_code_check";
ALTER TABLE "module_registration" DROP CONSTRAINT IF EXISTS "module_registration_status_code_check";

-- Phase 5 extensible code fields
ALTER TABLE "module_result" DROP CONSTRAINT IF EXISTS "module_result_result_code_check";
ALTER TABLE "adjustment_distribution" DROP CONSTRAINT IF EXISTS "adjustment_distribution_status_code_check";
ALTER TABLE "misconduct_penalty_effect" DROP CONSTRAINT IF EXISTS "misconduct_penalty_effect_penalty_code_check";
ALTER TABLE "exam_board" DROP CONSTRAINT IF EXISTS "exam_board_board_type_code_check";
ALTER TABLE "progression_decision" DROP CONSTRAINT IF EXISTS "progression_decision_decision_code_check";
ALTER TABLE "post_ratification_case" DROP CONSTRAINT IF EXISTS "post_ratification_case_case_type_code_check";
ALTER TABLE "post_ratification_case" DROP CONSTRAINT IF EXISTS "post_ratification_case_status_code_check";
ALTER TABLE "post_ratification_amendment" DROP CONSTRAINT IF EXISTS "post_ratification_amendment_entity_type_check";

-- Preserve non-code CHECK constraints such as temporal validity, percentages,
-- mutually-exclusive references, date ordering, and statutory numeric ranges.
