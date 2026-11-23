import type { PersonReference } from '@revelation-srs/domain';

/**
 * ADR-031 item 5: every column in the wellbeing schema that references a
 * person, and what applying srs.person.merged does to it (BL-358). The guard
 * test/person-references.int.test.ts fails when a person column is missing.
 */
export const WELLBEING_PERSON_REFERENCES: readonly PersonReference[] = [
  { table: 'adjustment_case',         column: 'person_id', mode: 'versioned-move' },
  { table: 'disability_support_case', column: 'person_id', mode: 'versioned-move' },
  { table: 'dsa_entitlement',         column: 'person_id', mode: 'versioned-move' },
  { table: 'ec_claim',                column: 'person_id', mode: 'versioned-move' },
  { table: 'intervention_plan',       column: 'person_id', mode: 'versioned-move' },
  { table: 'mental_health_case',      column: 'person_id', mode: 'versioned-move' },
  { table: 'early_warning_alert',     column: 'person_id', mode: 'ledgered-move' },
  { table: 'enrolment_person_map',    column: 'person_id', mode: 'ledgered-move', note: 'Projection of core enrolments' },
  { table: 'mh_session_note',         column: 'person_id', mode: 'ledgered-move', note: 'Follows its case' },
  { table: 'module_reg_person_map',   column: 'person_id', mode: 'ledgered-move', note: 'Projection of core registrations' },
  { table: 'srs_context_projection',  column: 'person_id', mode: 'ledgered-move', note: 'Projection of core context' },
  { table: 'wellbeing_case',          column: 'person_id', mode: 'ledgered-move' },
  { table: 'audit_log',               column: 'person_id', mode: 'history-in-place' },
  { table: 'sar_export_log',          column: 'exported_for_person_id', mode: 'history-in-place', note: 'Who an export was made for' },
  { table: 'srs_ec_handoff_outbox',   column: 'person_id', mode: 'history-in-place', note: 'Messages already sent to core' },
  { table: 'srs_handoff_outbox',      column: 'person_id', mode: 'history-in-place', note: 'Messages already sent to core' },
];
