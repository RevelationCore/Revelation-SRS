-- Phase 9 Stage 4 — Course Provisioning (F015)
-- Adds the student-enrolment lookup table.
--
-- srs.student.enrolled carries personId + enrolmentId.
-- srs.enrolment.module-registered carries enrolmentId but NOT personId.
-- This table bridges the gap so module-registered handlers can resolve the person.

CREATE TABLE IF NOT EXISTS vle_connector.vle_student_enrolment_map (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid        NOT NULL,
  "enrolment_id" uuid        NOT NULL,
  "person_id"    uuid        NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "enrolment_id")
);

CREATE INDEX IF NOT EXISTS vle_student_enrolment_map_tenant_person_idx
  ON vle_connector.vle_student_enrolment_map ("tenant_id", "person_id");
