-- Phase 11 Stage 2 — Performance Indexes
-- Adds composite indexes for high-query paths identified during the S6 load profile.
--
-- Targets:
--   1. Enrolment aggregate queries (reporting endpoint) — year of entry + mode group-bys
--   2. Student search — family-name text prefix scan
--   3. Module registration lookups — by offering for exam board data-pack queries
--   4. Mark lookups — by registration for result assembly
--   5. Exam board candidate profile listing — by board for ratification screens
--   6. Audit log — by entity type + id (Stage 3 entity audit API)
--   7. Fee liability — by academic year (SLC/fee reporting)
--   8. Exceptional circumstances — by enrolment + status (EC workload dashboard)

-- 1. Enrolment aggregate — academic year of entry (GROUP BY year)
CREATE INDEX IF NOT EXISTS "enrolment_year_of_entry_idx"
  ON "enrolment" ("tenant_id", "academic_year_of_entry")
  WHERE recorded_until IS NULL;

-- 2. Enrolment aggregate — programme id (top-N programme report)
CREATE INDEX IF NOT EXISTS "enrolment_programme_report_idx"
  ON "enrolment" ("tenant_id", "programme_id")
  WHERE recorded_until IS NULL AND programme_id IS NOT NULL;

-- 3. Person search by family name (LIKE 'Smith%' prefix scans on student search)
CREATE INDEX IF NOT EXISTS "person_identity_family_name_idx"
  ON "person_identity" ("tenant_id", "legal_family_name" text_pattern_ops)
  WHERE recorded_until IS NULL;

-- 4. Module registration by offering (exam board data-pack assembly)
CREATE INDEX IF NOT EXISTS "module_registration_offering_idx"
  ON "module_registration" ("tenant_id", "module_offering_id")
  WHERE recorded_until IS NULL;

-- 5. Mark by registration (result-lookup and mark submission reads)
CREATE INDEX IF NOT EXISTS "mark_registration_current_idx"
  ON "mark" ("tenant_id", "module_registration_id")
  WHERE recorded_until IS NULL;

-- 6. Exam board candidate profile by data pack (ratification screen paging)
CREATE INDEX IF NOT EXISTS "exam_board_candidate_profile_pack_idx"
  ON "exam_board_candidate_profile" ("tenant_id", "data_pack_id");

-- 7. Audit log by entity type + entity id (entity audit API)
CREATE INDEX IF NOT EXISTS "audit_record_entity_type_id_idx"
  ON "audit_record" ("tenant_id", "entity_type", "entity_id");

-- 8. Fee liability by academic year (SLC / fee reporting queries)
CREATE INDEX IF NOT EXISTS "fee_liability_year_idx"
  ON "fee_liability" ("tenant_id", "academic_year");

-- 9. Exceptional circumstances by enrolment (EC workload dashboard)
CREATE INDEX IF NOT EXISTS "ec_enrolment_idx"
  ON "exceptional_circumstances" ("tenant_id", "enrolment_id")
  WHERE recorded_until IS NULL;
