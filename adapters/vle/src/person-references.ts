import type { PersonReference } from '@revelation-srs/domain';

/**
 * ADR-031 item 5: every column in the vle_connector schema that references a
 * person, and what applying srs.person.merged does to it (BL-358). The guard
 * test/person-references.int.test.ts fails when a person column is missing.
 */
export const VLE_CONNECTOR_PERSON_REFERENCES: readonly PersonReference[] = [
  { table: 'vle_adjustment_map',        column: 'person_id', mode: 'ledgered-move' },
  { table: 'vle_enrolment_map',         column: 'person_id', mode: 'ledgered-move', note: 'The person-to-VLE-user mapping a merge updates (ADR-031 item 7)' },
  { table: 'vle_student_enrolment_map', column: 'person_id', mode: 'ledgered-move' },
  { table: 'person_merge_move', column: 'from_person_id', mode: 'identity-infra' },
  { table: 'person_merge_move', column: 'to_person_id', mode: 'identity-infra' },
];
