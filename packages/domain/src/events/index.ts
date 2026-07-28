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
export * from './circumstances/misconduct-outcome-recorded.v1.js';
export * from './governance/exam-board-data-pack-ready.v1.js';
export * from './governance/exam-board-ratified.v1.js';
export * from './governance/record-locked.v1.js';
export * from './governance/record-amended-post-ratification.v1.js';
export * from './progression/decided.v1.js';
export * from './award/conferred.v1.js';
export * from './regulatory/ucas-application-received.v1.js';
export * from './regulatory/ucas-confirmation-sent.v1.js';
export * from './regulatory/hesa-return-generated.v1.js';
export * from './regulatory/hesa-return-submitted.v1.js';
export * from './regulatory/hesa-id-assigned.v1.js';
export * from './regulatory/slc-confirmation-sent.v1.js';
export * from './regulatory/slc-notification-received.v1.js';
export * from './regulatory/ukvi-cas-requested.v1.js';
export * from './regulatory/ukvi-cas-assigned.v1.js';
export * from './regulatory/ukvi-attendance-submitted.v1.js';
export * from './regulatory/ukvi-visa-status-updated.v1.js';
export * from './regulatory/ukvi-compliance-alert-raised.v1.js';
export * from './regulatory/ofs-extract-generated.v1.js';
export * from './governance/exam-entry-submitted.v1.js';
export * from './governance/exam-schedule-received.v1.js';
export * from './engagement/expected-event-created.v1.js';
export * from './engagement/observation-recorded.v1.js';
export * from './engagement/observation-corrected.v1.js';
export * from './engagement/alert-raised.v1.js';
export * from './engagement/alert-suspended.v1.js';
export * from './engagement/intervention-opened.v1.js';
export * from './engagement/intervention-reviewed.v1.js';
export * from './engagement/referral-created.v1.js';
export * from './engagement/intervention-closed.v1.js';
export * from './engagement/outcome-recorded.v1.js';

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
  CIRCUMSTANCES_MISCONDUCT_OUTCOME_RECORDED: 'srs.circumstances.misconduct-outcome-recorded',
  GOVERNANCE_EXAM_BOARD_DATA_PACK_READY:    'srs.governance.exam-board-data-pack-ready',
  GOVERNANCE_EXAM_BOARD_RATIFIED:           'srs.governance.exam-board-ratified',
  GOVERNANCE_RECORD_LOCKED:                 'srs.governance.record-locked',
  GOVERNANCE_RECORD_AMENDED:                'srs.governance.record-amended-post-ratification',
  PROGRESSION_DECIDED:                      'srs.progression.decided',
  AWARD_CONFERRED:                          'srs.award.conferred',
  // ── Phase 6 ──────────────────────────────────────────────────────────────
  REGULATORY_UCAS_APPLICATION_RECEIVED:      'srs.regulatory.ucas-application-received',
  REGULATORY_UCAS_CONFIRMATION_SENT:         'srs.regulatory.ucas-confirmation-sent',
  REGULATORY_HESA_RETURN_GENERATED:          'srs.regulatory.hesa-return-generated',
  REGULATORY_HESA_RETURN_SUBMITTED:          'srs.regulatory.hesa-return-submitted',
  REGULATORY_HESA_ID_ASSIGNED:               'srs.regulatory.hesa-id-assigned',
  REGULATORY_SLC_CONFIRMATION_SENT:          'srs.regulatory.slc-confirmation-sent',
  REGULATORY_SLC_NOTIFICATION_RECEIVED:      'srs.regulatory.slc-notification-received',
  REGULATORY_UKVI_CAS_REQUESTED:             'srs.regulatory.ukvi-cas-requested',
  REGULATORY_UKVI_CAS_ASSIGNED:              'srs.regulatory.ukvi-cas-assigned',
  REGULATORY_UKVI_ATTENDANCE_SUBMITTED:      'srs.regulatory.ukvi-attendance-submitted',
  REGULATORY_UKVI_VISA_STATUS_UPDATED:       'srs.regulatory.ukvi-visa-status-updated',
  REGULATORY_UKVI_COMPLIANCE_ALERT:          'srs.regulatory.ukvi-compliance-alert-raised',
  REGULATORY_OFS_EXTRACT_GENERATED:          'srs.regulatory.ofs-extract-generated',
  GOVERNANCE_EXAM_ENTRY_SUBMITTED:           'srs.governance.exam-entry-submitted',
  GOVERNANCE_EXAM_SCHEDULE_RECEIVED:         'srs.governance.exam-schedule-received',
  // ── Attendance and engagement ────────────────────────────────────────────
  ENGAGEMENT_EXPECTED_EVENT_CREATED:         'srs.engagement.expected-event.created',
  ENGAGEMENT_OBSERVATION_RECORDED:           'srs.engagement.observation.recorded',
  ENGAGEMENT_OBSERVATION_CORRECTED:          'srs.engagement.observation.corrected',
  ENGAGEMENT_ALERT_RAISED:                   'srs.engagement.alert.raised',
  ENGAGEMENT_ALERT_SUSPENDED:                'srs.engagement.alert.suspended',
  ENGAGEMENT_INTERVENTION_OPENED:            'srs.engagement.intervention.opened',
  ENGAGEMENT_INTERVENTION_REVIEWED:          'srs.engagement.intervention.reviewed',
  ENGAGEMENT_REFERRAL_CREATED:               'srs.engagement.referral.created',
  ENGAGEMENT_INTERVENTION_CLOSED:            'srs.engagement.intervention.closed',
  ENGAGEMENT_OUTCOME_RECORDED:               'srs.engagement.outcome-recorded',
  // ── Platform workflow controls ───────────────────────────────────────────
  WORKFLOW_TASK_ASSIGNED:                    'srs.workflow.task-assigned',
  WORKFLOW_TASK_COMPLETED:                   'srs.workflow.task-completed',
  WORKFLOW_TASK_ESCALATED:                   'srs.workflow.task-escalated',
  WORKFLOW_DECISION_RECORDED:                'srs.workflow.decision-recorded',
  WORKFLOW_COMPLETED:                        'srs.workflow.completed',
} as const;
