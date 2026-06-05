export * from './student/created.v1.js';
export * from './student/identity-updated.v1.js';
export * from './student/enrolled.v1.js';
export * from './student/status-changed.v1.js';
export * from './student/disability-declaration-updated.v1.js';
export * from './identity/verification-requested.v1.js';
export * from './identity/verification-completed.v1.js';
export * from './enrolment/fee-liability-generated.v1.js';
export * from './enrolment/downstream-trigger-created.v1.js';
export * from './enrolment/module-registered.v1.js';
export * from './enrolment/module-registration-withdrawn.v1.js';
export * from './enrolment/module-registration-completed.v1.js';
export * from './catalogue/programme-updated.v1.js';
export * from './catalogue/module-updated.v1.js';
export * from './catalogue/module-relationship-updated.v1.js';
export * from './catalogue/learning-outcome-updated.v1.js';
export * from './assessment/mark-received.v1.js';
export * from './assessment/mark-updated.v1.js';
export * from './assessment/module-result-calculated.v1.js';
export * from './assessment/module-result-ratified.v1.js';
export * from './adjustment/approved.v1.js';
export * from './adjustment/distributed.v1.js';
export * from './adjustment/expired.v1.js';
export * from './circumstances/exceptional-circumstances-flagged.v1.js';
export * from './circumstances/exceptional-circumstances-updated.v1.js';
export * from './governance/exam-board-data-pack-ready.v1.js';
export * from './governance/exam-board-ratified.v1.js';
export * from './governance/record-locked.v1.js';
export * from './governance/record-amended-post-ratification.v1.js';
export * from './progression/decided.v1.js';
export * from './award/conferred.v1.js';

/** Canonical NATS subject names for all domain events. */
export const EVENT_TYPES = {
  // ── Phase 4 ──────────────────────────────────────────────────────────────
  STUDENT_CREATED:                          'srs.student.created',
  STUDENT_IDENTITY_UPDATED:                 'srs.student.identity-updated',
  STUDENT_ENROLLED:                         'srs.student.enrolled',
  STUDENT_STATUS_CHANGED:                   'srs.student.status-changed',
  STUDENT_DISABILITY_DECLARATION_UPDATED:   'srs.student.disability-declaration-updated',
  IDENTITY_VERIFICATION_REQUESTED:          'srs.identity.verification-requested',
  IDENTITY_VERIFICATION_COMPLETED:          'srs.identity.verification-completed',
  ENROLMENT_FEE_LIABILITY_GENERATED:        'srs.enrolment.fee-liability-generated',
  ENROLMENT_DOWNSTREAM_TRIGGER_CREATED:     'srs.enrolment.downstream-trigger-created',
  ENROLMENT_MODULE_REGISTERED:              'srs.enrolment.module-registered',
  ENROLMENT_MODULE_REGISTRATION_WITHDRAWN:  'srs.enrolment.module-registration-withdrawn',
  ENROLMENT_MODULE_REGISTRATION_COMPLETED:  'srs.enrolment.module-registration-completed',
  CATALOGUE_PROGRAMME_UPDATED:              'srs.catalogue.programme-updated',
  CATALOGUE_MODULE_UPDATED:                 'srs.catalogue.module-updated',
  CATALOGUE_MODULE_RELATIONSHIP_UPDATED:    'srs.catalogue.module-relationship-updated',
  CATALOGUE_LEARNING_OUTCOME_UPDATED:       'srs.catalogue.learning-outcome-updated',
  // ── Phase 5 ──────────────────────────────────────────────────────────────
  ASSESSMENT_MARK_RECEIVED:                 'srs.assessment.mark-received',
  ASSESSMENT_MARK_UPDATED:                  'srs.assessment.mark-updated',
  ASSESSMENT_MODULE_RESULT_CALCULATED:      'srs.assessment.module-result-calculated',
  ASSESSMENT_MODULE_RESULT_RATIFIED:        'srs.assessment.module-result-ratified',
  ADJUSTMENT_APPROVED:                      'srs.adjustment.approved',
  ADJUSTMENT_DISTRIBUTED:                   'srs.adjustment.distributed',
  ADJUSTMENT_EXPIRED:                       'srs.adjustment.expired',
  CIRCUMSTANCES_EC_FLAGGED:                 'srs.circumstances.exceptional-circumstances-flagged',
  CIRCUMSTANCES_EC_UPDATED:                 'srs.circumstances.exceptional-circumstances-updated',
  GOVERNANCE_EXAM_BOARD_DATA_PACK_READY:    'srs.governance.exam-board-data-pack-ready',
  GOVERNANCE_EXAM_BOARD_RATIFIED:           'srs.governance.exam-board-ratified',
  GOVERNANCE_RECORD_LOCKED:                 'srs.governance.record-locked',
  GOVERNANCE_RECORD_AMENDED:                'srs.governance.record-amended-post-ratification',
  PROGRESSION_DECIDED:                      'srs.progression.decided',
  AWARD_CONFERRED:                          'srs.award.conferred',
} as const;
