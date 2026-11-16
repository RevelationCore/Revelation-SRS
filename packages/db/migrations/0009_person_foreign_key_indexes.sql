-- 0009 — Index every foreign key into person
--
-- Each column below references person(id) but had no index leading with it
-- (some had (tenant_id, person_id), which a foreign-key check cannot use).
-- Deleting a person then scanned every one of these tables in full: slow for
-- an erasure or identity merge, and over a minute for a demo reset of a
-- large scenario. Postgres does not index foreign-key columns itself.

CREATE INDEX IF NOT EXISTS data_correction_case_person_id_fk_idx ON data_correction_case (person_id);
CREATE INDEX IF NOT EXISTS disability_declaration_person_id_fk_idx ON disability_declaration (person_id);
CREATE INDEX IF NOT EXISTS enrolment_person_id_fk_idx ON enrolment (person_id);
CREATE INDEX IF NOT EXISTS examiner_appointment_person_id_fk_idx ON examiner_appointment (person_id);
CREATE INDEX IF NOT EXISTS fee_liability_person_id_fk_idx ON fee_liability (person_id);
CREATE INDEX IF NOT EXISTS hesa_identifier_assignment_person_id_fk_idx ON hesa_identifier_assignment (person_id);
CREATE INDEX IF NOT EXISTS identity_redirect_new_person_id_fk_idx ON identity_redirect (new_person_id);
CREATE INDEX IF NOT EXISTS identity_redirect_old_person_id_fk_idx ON identity_redirect (old_person_id);
CREATE INDEX IF NOT EXISTS identity_resolution_candidate_candidate_person_id_fk_idx ON identity_resolution_candidate (candidate_person_id);
CREATE INDEX IF NOT EXISTS identity_resolution_decision_survivor_person_id_fk_idx ON identity_resolution_decision (survivor_person_id);
CREATE INDEX IF NOT EXISTS identity_verification_check_person_id_fk_idx ON identity_verification_check (person_id);
CREATE INDEX IF NOT EXISTS individual_rights_request_person_id_fk_idx ON individual_rights_request (person_id);
CREATE INDEX IF NOT EXISTS person_identity_link_source_person_id_fk_idx ON person_identity_link (source_person_id);
CREATE INDEX IF NOT EXISTS person_identity_link_target_person_id_fk_idx ON person_identity_link (target_person_id);
CREATE INDEX IF NOT EXISTS person_identity_person_id_fk_idx ON person_identity (person_id);
CREATE INDEX IF NOT EXISTS pgr_review_member_person_id_fk_idx ON pgr_review_member (person_id);
CREATE INDEX IF NOT EXISTS pgr_supervisor_nomination_person_id_fk_idx ON pgr_supervisor_nomination (person_id);
CREATE INDEX IF NOT EXISTS processing_restriction_person_id_fk_idx ON processing_restriction (person_id);
CREATE INDEX IF NOT EXISTS staff_assignment_person_id_fk_idx ON staff_assignment (person_id);
CREATE INDEX IF NOT EXISTS student_address_person_id_fk_idx ON student_address (person_id);
CREATE INDEX IF NOT EXISTS student_contact_method_person_id_fk_idx ON student_contact_method (person_id);
CREATE INDEX IF NOT EXISTS student_regulatory_profile_person_id_fk_idx ON student_regulatory_profile (person_id);
