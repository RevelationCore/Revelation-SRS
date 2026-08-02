/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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

  await applyMigration('0000_platform_foundations.sql');
  await applyMigration('0001_platform_hardening_and_refinements.sql');
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
          'integration_exchange_idempotency_unique'
        )
    `) as Array<{ indexname: string }>;

    // integration_registration_tenant_code_unique is deliberately dropped
    // later in the same clean-build file (originally migration 0020):
    // tenants legitimately need multiple registrations for one contract type.
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'academic_rule_current_version_unique',
      'academic_rule_unique_logical_transaction',
      'integration_exchange_idempotency_unique',
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

describe('Platform workflow, feature flag, and environment migration', () => {
  it('seeds enrolment trigger controls', async () => {
    const flags = await db.execute(sql`
      SELECT flag_key, default_variant_key
      FROM feature_flag
      WHERE flag_key = 'enrolment.downstream-triggers.configured-mode'
    `) as Array<{ flag_key: string; default_variant_key: string }>;

    const variants = await db.execute(sql`
      SELECT ffv.variant_key, ffv.value
      FROM feature_flag_variant ffv
      JOIN feature_flag ff ON ff.id = ffv.flag_id
      WHERE ff.flag_key = 'enrolment.downstream-triggers.configured-mode'
      ORDER BY ffv.sort_order
    `) as Array<{ variant_key: string; value: boolean }>;

    const triggerRules = await db.execute(sql`
      SELECT trigger_key, event_type, target_workflow_code, active
      FROM workflow_trigger_rule
      WHERE trigger_key IN (
        'enrolment-created-ucas-confirmation',
        'enrolment-created-slc-confirmation',
        'enrolment-created-ukvi-cas',
        'enrolment-status-slc-confirmation',
        'enrolment-created-future-communication'
      )
      ORDER BY trigger_key
    `) as Array<{
      trigger_key: string;
      event_type: string;
      target_workflow_code: string;
      active: boolean;
    }>;

    expect(flags).toEqual([
      {
        flag_key: 'enrolment.downstream-triggers.configured-mode',
        default_variant_key: 'on',
      },
    ]);
    expect(variants).toEqual([
      { variant_key: 'off', value: false },
      { variant_key: 'on', value: true },
    ]);
    expect(triggerRules).toHaveLength(5);
    expect(triggerRules).toContainEqual({
      trigger_key: 'enrolment-created-future-communication',
      event_type: 'enrolment.created',
      target_workflow_code: 'future-communication-endpoint',
      active: false,
    });
  });

  it('seeds Admissions workflow definitions, gateways, and feature flags', async () => {
    const definitions = await db.execute(sql`
      SELECT definition_code, owner_module_code, status_code, current_version_number
      FROM workflow_definition
      WHERE definition_code IN (
        'admissions-ucas-domestic',
        'admissions-direct-domestic',
        'admissions-international-direct',
        'admissions-international-agent',
        'admissions-clearing'
      )
      ORDER BY definition_code
    `) as Array<{
      definition_code: string;
      owner_module_code: string;
      status_code: string;
      current_version_number: number;
    }>;

    const gatewayRows = await db.execute(sql`
      SELECT DISTINCT wdg.gateway_key
      FROM workflow_decision_gateway wdg
      JOIN workflow_definition_version wdv ON wdv.id = wdg.workflow_definition_version_id
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.owner_module_code = 'admissions'
        AND wdg.gateway_key IN ('G01', 'G02', 'G03', 'G04', 'G05', 'G09', 'G10', 'G11')
      ORDER BY wdg.gateway_key
    `) as Array<{ gateway_key: string }>;

    const handoffSteps = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM workflow_step ws
      JOIN workflow_definition_version wdv ON wdv.id = ws.workflow_definition_version_id
      JOIN workflow_definition wd ON wd.id = wdv.workflow_definition_id
      WHERE wd.owner_module_code = 'admissions'
        AND ws.step_key = 'handoff-to-srs-enrolment'
    `) as Array<{ count: number }>;

    const flags = await db.execute(sql`
      SELECT flag_key, default_variant_key
      FROM feature_flag
      WHERE flag_key IN (
        'admissions.enabled',
        'admissions.ucas-adapter.enabled',
        'admissions.direct-applications.enabled',
        'admissions.agent-applications.enabled',
        'admissions.international-route.enabled',
        'admissions.cas-precheck.required',
        'admissions.legacy-ucas-auto-enrolment.enabled'
      )
      ORDER BY flag_key
    `) as Array<{ flag_key: string; default_variant_key: string }>;

    expect(definitions).toHaveLength(5);
    expect(definitions.every((definition) =>
      definition.owner_module_code === 'admissions'
      && definition.status_code === 'active'
      && definition.current_version_number === 1,
    )).toBe(true);
    expect(gatewayRows.map((row) => row.gateway_key)).toEqual(['G01', 'G02', 'G03', 'G04', 'G05', 'G09', 'G10', 'G11']);
    expect(handoffSteps).toEqual([{ count: 5 }]);
    expect(flags).toHaveLength(7);
    expect(flags).toContainEqual({
      flag_key: 'admissions.legacy-ucas-auto-enrolment.enabled',
      default_variant_key: 'off',
    });
    expect(flags).toContainEqual({
      flag_key: 'admissions.enabled',
      default_variant_key: 'on',
    });
    expect(flags).toContainEqual({
      flag_key: 'admissions.ucas-adapter.enabled',
      default_variant_key: 'on',
    });
    expect(flags).toContainEqual({
      flag_key: 'admissions.cas-precheck.required',
      default_variant_key: 'on',
    });
  });
});

describe('Platform alignment Stage 8 migration', () => {
  it('relaxes extensible business-code checks while retaining structural checks', async () => {
    const removed = await db.execute(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'enrolment_status_code_check',
        'enrolment_mode_of_study_code_check',
        'enrolment_funding_source_code_check',
        'enrolment_downstream_trigger_trigger_type_code_check',
        'module_registration_status_code_check',
        'module_result_result_code_check',
        'progression_decision_decision_code_check',
        'post_ratification_case_status_code_check'
      )
    `) as Array<{ conname: string }>;

    const retained = await db.execute(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN (
        'enrolment_temporal_check_valid',
        'learning_outcome_exactly_one_parent',
        'academic_period_end_after_start',
        'environment_promotion_distinct_envs'
      )
      ORDER BY conname
    `) as Array<{ conname: string }>;

    expect(removed).toEqual([]);
    expect(retained.map((row) => row.conname)).toEqual([
      'academic_period_end_after_start',
      'enrolment_temporal_check_valid',
      'environment_promotion_distinct_envs',
      'learning_outcome_exactly_one_parent',
    ]);
  });
});

describe('Platform alignment Stage 9 migration', () => {
  it('seeds integration endpoint safety classes and environment defaults', async () => {
    const members = await db.execute(sql`
      SELECT vsm.code
      FROM value_set_member vsm
      JOIN value_set vs ON vs.id = vsm.value_set_id
      WHERE vs.set_code = 'integration-endpoint-safety-class'
      ORDER BY vsm.sort_order
    `) as Array<{ code: string }>;

    const environments = await db.execute(sql`
      SELECT environment_code, configuration
      FROM deployment_environment
      WHERE environment_code IN ('local', 'test', 'uat', 'preprod', 'prod')
      ORDER BY environment_code
    `) as Array<{ environment_code: string; configuration: Record<string, unknown> }>;

    const mappings = await db.execute(sql`
      SELECT entity_name, field_name, value_set_code
      FROM field_value_set
      WHERE entity_name = 'integration_registration.configuration'
        AND field_name = 'endpointSafetyClass'
    `) as Array<{ entity_name: string; field_name: string; value_set_code: string }>;

    expect(members.map((member) => member.code)).toEqual(['simulator', 'external-test', 'external-production']);
    expect(environments).toContainEqual(expect.objectContaining({
      environment_code: 'prod',
      configuration: expect.objectContaining({
        defaultEndpointSafetyClass: 'external-production',
        requiresLiveTrafficApproval: false,
      }),
    }));
    expect(environments).toContainEqual(expect.objectContaining({
      environment_code: 'preprod',
      configuration: expect.objectContaining({
        defaultEndpointSafetyClass: 'external-test',
        requiresLiveTrafficApproval: true,
      }),
    }));
    expect(mappings).toEqual([
      {
        entity_name: 'integration_registration.configuration',
        field_name: 'endpointSafetyClass',
        value_set_code: 'integration-endpoint-safety-class',
      },
    ]);
  });
});

describe('Platform workflow, feature flag, and environment migrations', () => {
  it('creates all Stage 1 foundation tables', async () => {
    const rows = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'deployment_environment',
          'environment_configuration',
          'environment_promotion_record',
          'workflow_definition',
          'workflow_definition_version',
          'workflow_step',
          'workflow_transition',
          'workflow_decision_gateway',
          'workflow_assignment_rule',
          'workflow_trigger_rule',
          'workflow_instance',
          'workflow_task',
          'workflow_decision_audit',
          'feature_flag',
          'feature_flag_variant',
          'feature_flag_assignment',
          'feature_flag_evaluation_log'
        )
    `) as Array<{ table_name: string }>;

    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'deployment_environment',
      'environment_configuration',
      'environment_promotion_record',
      'feature_flag',
      'feature_flag_assignment',
      'feature_flag_evaluation_log',
      'feature_flag_variant',
      'workflow_assignment_rule',
      'workflow_decision_audit',
      'workflow_decision_gateway',
      'workflow_definition',
      'workflow_definition_version',
      'workflow_instance',
      'workflow_step',
      'workflow_task',
      'workflow_transition',
      'workflow_trigger_rule',
    ]);
  });

  it('enables and forces RLS on tenant-scoped Stage 1 tables', async () => {
    const rows = await db.execute(sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'environment_configuration',
        'environment_promotion_record',
        'workflow_definition',
        'workflow_definition_version',
        'workflow_step',
        'workflow_transition',
        'workflow_decision_gateway',
        'workflow_assignment_rule',
        'workflow_trigger_rule',
        'workflow_instance',
        'workflow_task',
        'workflow_decision_audit',
        'feature_flag_assignment',
        'feature_flag_evaluation_log'
      )
    `) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>;

    expect(rows).toHaveLength(14);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('creates Stage 1 uniqueness and versioning indexes', async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'deployment_environment_code_unique',
          'environment_configuration_current_unique',
          'workflow_definition_scope_code_unique',
          'workflow_definition_version_unique',
          'workflow_step_version_key_unique',
          'workflow_transition_version_key_unique',
          'workflow_decision_gateway_version_key_unique',
          'workflow_assignment_rule_scope_key_unique',
          'workflow_trigger_rule_scope_key_unique',
          'feature_flag_key_unique',
          'feature_flag_variant_key_unique',
          'feature_flag_assignment_eval_idx'
        )
    `) as Array<{ indexname: string }>;

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'deployment_environment_code_unique',
      'environment_configuration_current_unique',
      'feature_flag_assignment_eval_idx',
      'feature_flag_key_unique',
      'feature_flag_variant_key_unique',
      'workflow_assignment_rule_scope_key_unique',
      'workflow_decision_gateway_version_key_unique',
      'workflow_definition_scope_code_unique',
      'workflow_definition_version_unique',
      'workflow_step_version_key_unique',
      'workflow_transition_version_key_unique',
      'workflow_trigger_rule_scope_key_unique',
    ]);
  });

  it('seeds Stage 1 value sets, field mappings, and environments', async () => {
    const sets = await db.execute(sql`
      SELECT set_code
      FROM value_set
      WHERE set_code IN (
        'workflow-definition-status-code',
        'workflow-step-type-code',
        'workflow-instance-status-code',
        'workflow-task-status-code',
        'workflow-decision-code',
        'feature-flag-status-code',
        'feature-flag-assignment-status-code',
        'feature-flag-value-type-code',
        'deployment-environment-type-code',
        'environment-promotion-status-code',
        'environment-promotion-artefact-type-code'
      )
    `) as Array<{ set_code: string }>;

    const mappings = await db.execute(sql`
      SELECT entity_name, field_name, value_set_code
      FROM field_value_set
      WHERE entity_name IN (
        'workflow_definition',
        'workflow_definition_version',
        'workflow_step',
        'workflow_instance',
        'workflow_task',
        'workflow_decision_audit',
        'feature_flag',
        'feature_flag_assignment',
        'deployment_environment',
        'environment_promotion_record'
      )
      ORDER BY entity_name, field_name
    `) as Array<{ entity_name: string; field_name: string; value_set_code: string }>;

    const environments = await db.execute(sql`
      SELECT environment_code, live_integrations_allowed
      FROM deployment_environment
      WHERE environment_code IN ('local', 'test', 'uat', 'preprod', 'prod')
    `) as Array<{ environment_code: string; live_integrations_allowed: boolean }>;

    expect(sets).toHaveLength(11);
    expect(environments).toHaveLength(5);
    expect(environments).toContainEqual({ environment_code: 'prod', live_integrations_allowed: true });
    expect(environments).toContainEqual({ environment_code: 'test', live_integrations_allowed: false });
    expect(mappings).toContainEqual({
      entity_name: 'workflow_instance',
      field_name: 'status_code',
      value_set_code: 'workflow-instance-status-code',
    });
    expect(mappings).toContainEqual({
      entity_name: 'feature_flag',
      field_name: 'value_type_code',
      value_set_code: 'feature-flag-value-type-code',
    });
    expect(mappings).toContainEqual({
      entity_name: 'environment_promotion_record',
      field_name: 'status_code',
      value_set_code: 'environment-promotion-status-code',
    });
  });
});
