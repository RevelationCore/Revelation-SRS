import type { PersonReference } from '@revelation-srs/domain';

/**
 * ADR-031 item 5: every column in the attendance schema that references a
 * person, and what applying srs.person.merged does to it (BL-358). The guard
 * test/person-references.int.test.ts fails when a person column is missing.
 */
export const ATTENDANCE_PERSON_REFERENCES: readonly PersonReference[] = [
  { table: 'engagement_alert',             column: 'person_id', mode: 'versioned-move' },
  { table: 'engagement_intervention_case', column: 'person_id', mode: 'versioned-move' },
  { table: 'engagement_observation',       column: 'person_id', mode: 'versioned-move' },
  { table: 'expected_engagement_event',    column: 'person_id', mode: 'versioned-move' },
  { table: 'enrolment_person_map',         column: 'person_id', mode: 'ledgered-move', note: 'Projection of core enrolments' },
  { table: 'module_registration_map',      column: 'person_id', mode: 'ledgered-move', note: 'Projection of core registrations' },
];
