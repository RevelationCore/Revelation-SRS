import type { PersonReference } from '@revelation-srs/domain';

/**
 * ADR-031 item 5: every core column that references a person, and what an
 * identity merge does to it. packages/db/test/person-references.int.test.ts
 * fails when a person column is missing from here, so a new table must be
 * classified before it ships. The modules keep their own registries.
 */
export const PERSON_REFERENCES: readonly PersonReference[] = [
  // ── Bitemporal ownership: the survivor gets the current version ──────────
  { table: 'award',                       column: 'person_id', mode: 'versioned-move' },
  { table: 'business_case',               column: 'subject_id', subjectType: 'person', mode: 'versioned-move', note: 'Bitemporal, so not the ledgered move ADR-031 item 5 listed' },
  { table: 'cas_case',                    column: 'person_id', mode: 'versioned-move' },
  { table: 'disability_declaration',      column: 'person_id', mode: 'versioned-move' },
  { table: 'engagement_outcome',          column: 'person_id', mode: 'versioned-move' },
  { table: 'enrolment',                   column: 'person_id', mode: 'versioned-move' },
  { table: 'exceptional_circumstances',   column: 'person_id', mode: 'versioned-move' },
  { table: 'identity_verification_check', column: 'person_id', mode: 'versioned-move' },
  { table: 'misconduct_case_reference',   column: 'person_id', mode: 'versioned-move' },
  { table: 'reasonable_adjustment',       column: 'person_id', mode: 'versioned-move' },
  { table: 'right_to_study_check',        column: 'person_id', mode: 'versioned-move' },
  { table: 'staff_assignment',            column: 'person_id', mode: 'versioned-move' },
  { table: 'student_address',             column: 'person_id', mode: 'versioned-move' },
  { table: 'student_contact_method',      column: 'person_id', mode: 'versioned-move' },

  // ── One per person: the proposal's fact choice decides ───────────────────
  { table: 'person_identity',             column: 'person_id', mode: 'survivor-chooses' },
  { table: 'student_regulatory_profile',  column: 'person_id', mode: 'survivor-chooses' },

  // ── Current state, not bitemporal: moved and recorded for unmerge ────────
  { table: 'adjustment_proposal',         column: 'person_id', mode: 'ledgered-move', note: 'A proposal awaiting a decision follows the student' },
  { table: 'award_recommendation',        column: 'person_id', mode: 'ledgered-move' },
  { table: 'examiner_appointment',        column: 'person_id', mode: 'ledgered-move', note: 'The examiner; a duplicate staff record merges like any other' },
  { table: 'fee_liability',               column: 'person_id', mode: 'ledgered-move', note: 'Not bitemporal although core principle 3 says it should be (BL-362)' },
  { table: 'graduation_invitation',       column: 'person_id', mode: 'ledgered-move' },
  { table: 'notification',                column: 'person_id', mode: 'ledgered-move', note: 'The inbox the survivor now reads' },
  { table: 'pgr_review_member',           column: 'person_id', mode: 'ledgered-move', note: 'A reviewer, as for examiner_appointment' },
  { table: 'pgr_supervisor_nomination',   column: 'person_id', mode: 'ledgered-move', note: 'A supervisor, as for examiner_appointment' },
  { table: 'student_application',         column: 'person_id', mode: 'ledgered-move' },
  { table: 'student_document',            column: 'person_id', mode: 'ledgered-move' },
  { table: 'student_employment_link',     column: 'person_id', mode: 'ledgered-move' },
  { table: 'student_status_case',         column: 'person_id', mode: 'ledgered-move' },
  { table: 'support_award',               column: 'person_id', mode: 'ledgered-move' },

  // ── What happened to whom, or who acted: kept as it is ───────────────────
  { table: 'adjustment_proposal',          column: 'proposed_by_person_id', mode: 'history-in-place', note: 'Who proposed it' },
  { table: 'adjustment_proposal',          column: 'decided_by_person_id',  mode: 'history-in-place', note: 'Who decided it' },
  { table: 'delivery_item',                column: 'person_id',  mode: 'history-in-place', note: 'What was sent; a merge requests a person-merged notice and a fresh snapshot instead (item 8)' },
  { table: 'delivery_item',                column: 'subject_id', subjectType: 'person', mode: 'history-in-place' },
  { table: 'email_message',                column: 'person_id',  mode: 'history-in-place' },
  { table: 'exam_board_candidate_profile', column: 'person_id',  mode: 'history-in-place', note: 'The data pack a board saw' },
  { table: 'external_record',              column: 'person_id',  mode: 'history-in-place' },
  { table: 'feature_flag_evaluation_log',  column: 'subject_id', subjectType: 'person', mode: 'history-in-place' },
  { table: 'hesa_identifier_assignment',   column: 'person_id',  mode: 'history-in-place', note: 'Regulatory lineage (ADR-018); a conflict opens a correction case (item 4)' },
  { table: 'individual_rights_request',    column: 'person_id',  mode: 'history-in-place' },
  { table: 'processing_restriction',       column: 'person_id',  mode: 'history-in-place', note: 'An active restriction refuses the merge (item 3)' },
  { table: 'record_disposition',           column: 'person_id',  mode: 'history-in-place' },
  { table: 'retention_disposal_plan_item', column: 'person_id',  mode: 'history-in-place' },

  // ── The merge machinery ──────────────────────────────────────────────────
  { table: 'data_correction_case',          column: 'person_id',           mode: 'identity-infra' },
  { table: 'identity_merge_proposal',       column: 'merged_person_id',    mode: 'identity-infra' },
  { table: 'identity_merge_proposal',       column: 'survivor_person_id',  mode: 'identity-infra' },
  { table: 'identity_redirect',             column: 'new_person_id',       mode: 'identity-infra' },
  { table: 'identity_redirect',             column: 'old_person_id',       mode: 'identity-infra' },
  { table: 'identity_resolution_candidate', column: 'candidate_person_id', mode: 'identity-infra' },
  { table: 'identity_resolution_decision',  column: 'survivor_person_id',  mode: 'identity-infra' },
  { table: 'person_identifier_alias',       column: 'person_id',           mode: 'identity-infra' },
  { table: 'person_identifier_alias',       column: 'source_person_id',    mode: 'identity-infra' },
  { table: 'person_identity_link',          column: 'source_person_id',    mode: 'identity-infra' },
  { table: 'person_identity_link',          column: 'target_person_id',    mode: 'identity-infra' },
];

/**
 * ADR-031 item 4: the statutory identifiers a merge must reconcile. Two
 * different values of one class across the two people block the merge
 * until the proposal says which to keep; the other becomes an alias. A class
 * with no column yet is listed so that a column added later is covered.
 */
export const STATUTORY_IDENTIFIERS: Readonly<Record<string, ReadonlyArray<{ table: string; column: string }>>> = {
  'husid':                  [{ table: 'person', column: 'hesa_id' }],
  'ucas-personal-id':       [{ table: 'enrolment', column: 'ucas_personal_id' }, { table: 'ucas_application', column: 'ucas_personal_id' }],
  'uln':                    [],
  'slc-customer-reference': [{ table: 'enrolment', column: 'slc_reference' }],
};

/**
 * Columns that hold a statutory identifier as lineage (what was submitted or
 * assigned), not as the person's current value. A merge leaves them alone.
 */
export const STATUTORY_IDENTIFIER_LINEAGE: ReadonlyArray<{ table: string; column: string; note: string }> = [
  { table: 'hesa_identifier_assignment', column: 'hesa_id', note: 'The assignment record (ADR-018)' },
  { table: 'hesa_student_return_record', column: 'hesa_id', note: 'What a return submitted' },
];
