import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../src/pool.js';

let container: StartedPostgreSqlContainer;
let db: Db;

async function applyMigration(fileName: string): Promise<void> {
  const migration = await readFile(new URL(`../migrations/${fileName}`, import.meta.url), 'utf8');
  await db.execute(sql.raw(migration));
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_DB: 'srs_migration_test' })
    .start();

  db = createDb(container.getConnectionUri());

  await applyMigration('0000_initial_platform_schema.sql');
  await applyMigration('0001_seed_value_sets.sql');
  await applyMigration('0002_phase4_domain_schema.sql');
  await applyMigration('0003_seed_phase4_field_mappings.sql');
  await applyMigration('0004_phase5_assessment_schema.sql');
  await applyMigration('0005_seed_phase5_field_mappings.sql');
  await applyMigration('0006_phase6_regulatory_schema.sql');
  await applyMigration('0007_seed_phase6_field_mappings.sql');
});

afterAll(async () => {
  await container?.stop();
});

describe('Phase 3 migrations', () => {
  it('creates the platform foundation tables', async () => {
    const rows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'tenant',
          'audit_record',
          'integration_contract',
          'integration_registration',
          'integration_exchange',
          'academic_rule',
          'value_set',
          'value_set_member',
          'field_value_set'
        )
    `) as Array<{ table_name: string }>;

    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'academic_rule',
      'audit_record',
      'field_value_set',
      'integration_contract',
      'integration_exchange',
      'integration_registration',
      'tenant',
      'value_set',
      'value_set_member',
    ]);
  });

  it('enables and forces RLS on tenant-scoped tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'integration_registration',
        'integration_exchange',
        'academic_rule',
        'value_set_member'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('creates bitemporal and integration uniqueness constraints', async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'academic_rule_unique_logical_transaction',
          'academic_rule_current_version_unique',
          'integration_registration_tenant_code_unique',
          'integration_exchange_idempotency_unique'
        )
    `) as Array<{ indexname: string }>;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'academic_rule_current_version_unique',
      'academic_rule_unique_logical_transaction',
      'integration_exchange_idempotency_unique',
      'integration_registration_tenant_code_unique',
    ]);
  });

  it('seeds platform value sets and field mappings', async () => {
    const sets = await db.execute(sql`
      SELECT set_code
      FROM value_set
      WHERE set_code IN (
        'hesa-disability-code',
        'enrolment-status-code',
        'integration-exchange-status'
      )
    `) as Array<{ set_code: string }>;

    const mappings = await db.execute(sql`
      SELECT entity_name, field_name, value_set_code
      FROM field_value_set
      WHERE entity_name = 'integration_exchange'
        AND field_name = 'status_code'
    `) as Array<{ entity_name: string; field_name: string; value_set_code: string }>;

    expect(sets).toHaveLength(3);
    expect(mappings).toEqual([
      {
        entity_name: 'integration_exchange',
        field_name: 'status_code',
        value_set_code: 'integration-exchange-status',
      },
    ]);
  });
});

describe('Phase 4 migrations', () => {
  it('creates all Phase 4 domain tables', async () => {
    const rows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'person',
          'person_identity',
          'student_address',
          'student_contact_method',
          'disability_declaration',
          'identity_verification_check',
          'enrolment',
          'enrolment_status_transition',
          'fee_liability',
          'enrolment_downstream_trigger',
          'reenrolment_period',
          'reenrolment_confirmation',
          'programme',
          'module',
          'academic_period',
          'module_offering',
          'module_registration'
        )
    `) as Array<{ table_name: string }>;

    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'academic_period',
      'disability_declaration',
      'enrolment',
      'enrolment_downstream_trigger',
      'enrolment_status_transition',
      'fee_liability',
      'identity_verification_check',
      'module',
      'module_offering',
      'module_registration',
      'person',
      'person_identity',
      'programme',
      'reenrolment_confirmation',
      'reenrolment_period',
      'student_address',
      'student_contact_method',
    ]);
  });

  it('enables and forces RLS on Phase 4 tenant-scoped tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'person_identity',
        'enrolment',
        'enrolment_status_transition',
        'fee_liability',
        'enrolment_downstream_trigger',
        'module_registration'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('creates bitemporal indexes on person_identity and enrolment', async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'person_identity_unique_logical_transaction',
          'person_identity_current_version_unique',
          'enrolment_unique_logical_transaction',
          'enrolment_current_version_unique'
        )
    `) as Array<{ indexname: string }>;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'enrolment_current_version_unique',
      'enrolment_unique_logical_transaction',
      'person_identity_current_version_unique',
      'person_identity_unique_logical_transaction',
    ]);
  });

  it('seeds Phase 4 field mappings', async () => {
    const mappings = await db.execute(sql`
      SELECT entity_name, field_name
      FROM field_value_set
      WHERE entity_name IN ('person', 'person_identity', 'enrolment')
      ORDER BY entity_name, field_name
    `) as Array<{ entity_name: string; field_name: string }>;

    const keys = mappings.map((m) => `${m.entity_name}.${m.field_name}`);
    expect(keys).toContain('person.person_status_code');
    expect(keys).toContain('person_identity.gender_code');
    expect(keys).toContain('enrolment.status_code');
    expect(keys).toContain('enrolment.mode_of_study_code');
  });
});

describe('Phase 5 migrations', () => {
  it('creates all Phase 5 foundation tables', async () => {
    const rows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'assessment_component',
          'assessment_submission',
          'mark',
          'module_result',
          'reasonable_adjustment',
          'adjustment_distribution',
          'exceptional_circumstances',
          'exceptional_circumstances_board_visibility',
          'misconduct_case_reference',
          'misconduct_outcome',
          'misconduct_penalty_effect',
          'exam_board',
          'exam_board_data_pack',
          'exam_board_candidate_profile',
          'exam_board_member_attendance',
          'external_examiner_signoff',
          'progression_decision',
          'award',
          'post_ratification_case',
          'post_ratification_amendment'
        )
    `) as Array<{ table_name: string }>;

    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'adjustment_distribution',
      'assessment_component',
      'assessment_submission',
      'award',
      'exam_board',
      'exam_board_candidate_profile',
      'exam_board_data_pack',
      'exam_board_member_attendance',
      'exceptional_circumstances',
      'exceptional_circumstances_board_visibility',
      'external_examiner_signoff',
      'mark',
      'misconduct_case_reference',
      'misconduct_outcome',
      'misconduct_penalty_effect',
      'module_result',
      'post_ratification_amendment',
      'post_ratification_case',
      'progression_decision',
      'reasonable_adjustment',
    ]);
  });

  it('enables and forces RLS on Phase 5 tenant-scoped tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'assessment_component',
        'mark',
        'module_result',
        'reasonable_adjustment',
        'adjustment_distribution',
        'exceptional_circumstances',
        'misconduct_outcome',
        'exam_board',
        'exam_board_data_pack',
        'progression_decision',
        'award',
        'post_ratification_case',
        'post_ratification_amendment'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(13);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('creates bitemporal indexes on Phase 5 bitemporal tables', async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'mark_unique_logical_transaction',
          'mark_current_version_unique',
          'module_result_unique_logical_transaction',
          'module_result_current_version_unique',
          'reasonable_adjustment_unique_logical_transaction',
          'reasonable_adjustment_current_version_unique',
          'progression_decision_unique_logical_transaction',
          'progression_decision_current_version_unique',
          'award_unique_logical_transaction',
          'award_current_version_unique',
          'post_ratification_case_unique_logical_transaction',
          'post_ratification_case_current_version_unique'
        )
    `) as Array<{ indexname: string }>;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'award_current_version_unique',
      'award_unique_logical_transaction',
      'mark_current_version_unique',
      'mark_unique_logical_transaction',
      'module_result_current_version_unique',
      'module_result_unique_logical_transaction',
      'post_ratification_case_current_version_unique',
      'post_ratification_case_unique_logical_transaction',
      'progression_decision_current_version_unique',
      'progression_decision_unique_logical_transaction',
      'reasonable_adjustment_current_version_unique',
      'reasonable_adjustment_unique_logical_transaction',
    ]);
  });

  it('seeds Phase 5 value sets and field mappings', async () => {
    const sets = await db.execute(sql`
      SELECT set_code
      FROM value_set
      WHERE set_code IN (
        'result-code',
        'assessment-component-type',
        'adjustment-type-code',
        'adjustment-scope-code',
        'board-type-code',
        'decision-code',
        'penalty-code',
        'distribution-status-code',
        'case-type-code',
        'post-ratification-case-status-code'
      )
    `) as Array<{ set_code: string }>;

    const mappings = await db.execute(sql`
      SELECT entity_name, field_name, value_set_code
      FROM field_value_set
      WHERE entity_name IN (
        'assessment_component',
        'module_result',
        'reasonable_adjustment',
        'adjustment_distribution',
        'misconduct_outcome',
        'exam_board',
        'progression_decision',
        'post_ratification_case'
      )
      ORDER BY entity_name, field_name
    `) as Array<{ entity_name: string; field_name: string; value_set_code: string }>;

    const resultMembers = await db.execute(sql`
      SELECT vsm.code
      FROM value_set_member vsm
      JOIN value_set vs ON vs.id = vsm.value_set_id
      WHERE vs.set_code = 'result-code'
        AND vsm.code = 'resit-required'
    `) as Array<{ code: string }>;

    expect(sets).toHaveLength(10);
    expect(resultMembers).toEqual([{ code: 'resit-required' }]);
    expect(mappings).toContainEqual({
      entity_name: 'assessment_component',
      field_name: 'component_type_code',
      value_set_code: 'assessment-component-type',
    });
    expect(mappings).toContainEqual({
      entity_name: 'module_result',
      field_name: 'result_code',
      value_set_code: 'result-code',
    });
    expect(mappings).toContainEqual({
      entity_name: 'post_ratification_case',
      field_name: 'status_code',
      value_set_code: 'post-ratification-case-status-code',
    });
  });
});

describe('Phase 6 migrations', () => {
  it('creates all Phase 6 foundation tables', async () => {
    const rows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'ucas_application',
          'hesa_student_return',
          'hesa_student_return_record',
          'hesa_submission',
          'hesa_validation_report',
          'hesa_validation_issue',
          'hesa_identifier_assignment',
          'slc_notification',
          'ukvi_cas_request',
          'ukvi_attendance_report',
          'ukvi_visa_status',
          'ukvi_compliance_alert',
          'ofs_extract',
          'foi_request',
          'foi_extract',
          'student_regulatory_profile',
          'exam_entry',
          'exam_timetable_receipt'
        )
    `) as Array<{ table_name: string }>;

    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'exam_entry',
      'exam_timetable_receipt',
      'foi_extract',
      'foi_request',
      'hesa_identifier_assignment',
      'hesa_student_return',
      'hesa_student_return_record',
      'hesa_submission',
      'hesa_validation_issue',
      'hesa_validation_report',
      'ofs_extract',
      'slc_notification',
      'student_regulatory_profile',
      'ucas_application',
      'ukvi_attendance_report',
      'ukvi_cas_request',
      'ukvi_compliance_alert',
      'ukvi_visa_status',
    ]);
  });

  it('enables and forces RLS on Phase 6 tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'ucas_application',
        'hesa_student_return',
        'hesa_student_return_record',
        'hesa_submission',
        'hesa_validation_report',
        'hesa_validation_issue',
        'hesa_identifier_assignment',
        'slc_notification',
        'ukvi_cas_request',
        'ukvi_attendance_report',
        'ukvi_visa_status',
        'ukvi_compliance_alert',
        'ofs_extract',
        'foi_request',
        'foi_extract',
        'student_regulatory_profile',
        'exam_entry',
        'exam_timetable_receipt'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(18);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('creates bitemporal indexes on Phase 6 bitemporal tables', async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'ucas_application_unique_logical_transaction',
          'ucas_application_current_version_unique',
          'ukvi_cas_request_unique_logical_transaction',
          'ukvi_cas_request_current_version_unique',
          'ukvi_visa_status_unique_logical_transaction',
          'ukvi_visa_status_current_version_unique',
          'foi_request_unique_logical_transaction',
          'foi_request_current_version_unique',
          'student_regulatory_profile_unique_logical_transaction',
          'student_regulatory_profile_current_version_unique',
          'exam_entry_unique_logical_transaction',
          'exam_entry_current_version_unique'
        )
    `) as Array<{ indexname: string }>;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'exam_entry_current_version_unique',
      'exam_entry_unique_logical_transaction',
      'foi_request_current_version_unique',
      'foi_request_unique_logical_transaction',
      'student_regulatory_profile_current_version_unique',
      'student_regulatory_profile_unique_logical_transaction',
      'ucas_application_current_version_unique',
      'ucas_application_unique_logical_transaction',
      'ukvi_cas_request_current_version_unique',
      'ukvi_cas_request_unique_logical_transaction',
      'ukvi_visa_status_current_version_unique',
      'ukvi_visa_status_unique_logical_transaction',
    ]);
  });

  it('seeds Phase 6 value sets, field mappings, and integration contracts', async () => {
    const sets = await db.execute(sql`
      SELECT set_code
      FROM value_set
      WHERE set_code IN (
        'ucas-application-status-code',
        'hesa-return-status-code',
        'hesa-validation-severity-code',
        'slc-notification-type-code',
        'cas-status-code',
        'ukvi-visa-status-code',
        'ukvi-alert-type-code',
        'ofs-extract-type-code',
        'regulatory-report-status-code',
        'foi-request-status-code',
        'exam-entry-status-code'
      )
    `) as Array<{ set_code: string }>;

    const mappings = await db.execute(sql`
      SELECT entity_name, field_name, value_set_code
      FROM field_value_set
      WHERE entity_name IN (
        'ucas_application',
        'hesa_student_return',
        'hesa_validation_issue',
        'slc_notification',
        'ukvi_cas_request',
        'ukvi_visa_status',
        'ukvi_compliance_alert',
        'ofs_extract',
        'foi_request',
        'exam_entry'
      )
      ORDER BY entity_name, field_name
    `) as Array<{ entity_name: string; field_name: string; value_set_code: string }>;

    const contracts = await db.execute(sql`
      SELECT contract_id
      FROM integration_contract
      WHERE contract_id IN (
        'ucas-admissions-exchange.{cycle}',
        'hesa-student-return.{year}',
        'slc-enrolment-exchange.v1',
        'ukvi-sponsor-compliance.v1',
        'exam-scheduling.v1'
      )
    `) as Array<{ contract_id: string }>;

    expect(sets).toHaveLength(11);
    expect(contracts).toHaveLength(5);
    expect(mappings).toContainEqual({
      entity_name: 'ucas_application',
      field_name: 'status_code',
      value_set_code: 'ucas-application-status-code',
    });
    expect(mappings).toContainEqual({
      entity_name: 'hesa_validation_issue',
      field_name: 'severity_code',
      value_set_code: 'hesa-validation-severity-code',
    });
    expect(mappings).toContainEqual({
      entity_name: 'exam_entry',
      field_name: 'status_code',
      value_set_code: 'exam-entry-status-code',
    });
    expect(mappings).toContainEqual({
      entity_name: 'ofs_extract',
      field_name: 'status_code',
      value_set_code: 'regulatory-report-status-code',
    });
  });
});
