/**
 * Generates JSON Schema v7 artefacts for every published domain event payload.
 *
 * Output: schemas/events/{domain}/{event-name}/v1.json  (workspace root)
 * Also writes:
 *   schemas/events/envelope.v1.json  — shared envelope wrapper schema
 *   schemas/events/registry.json     — machine-readable event registry index
 *
 * Usage:  pnpm --filter @revelation-srs/domain generate:schemas
 *
 * Internal events (downstream-trigger-created, workflow.*, ofs-extract-generated)
 * are excluded from the published registry and flagged in the internal list below.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createGenerator } from 'ts-json-schema-generator';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const DOMAIN_ROOT = join(__dirname, '..');
const SCHEMA_ROOT = join(__dirname, '..', '..', '..', 'schemas', 'events');
const TSCONFIG    = join(DOMAIN_ROOT, 'tsconfig.json');

// ---------------------------------------------------------------------------
// Published event definitions
// ---------------------------------------------------------------------------

interface EventDef {
  typeName:    string;
  file:        string;  // relative to packages/domain/src/events/
  subject:     string;  // canonical NATS subject
  schemaPath:  string;  // output path under schemas/events/
  dataClass:   'standard' | 'personal' | 'sensitive' | 'special-category' | 'regulatory';
  partitionKey: string; // primary field for message ordering
  consumers:   string[];
}

export const PUBLISHED_EVENTS: EventDef[] = [
  // ── Student ─────────────────────────────────────────────────────────────
  {
    typeName: 'StudentCreatedV1Payload',
    file: 'student/created.v1.ts',
    subject: 'srs.student.created',
    schemaPath: 'student/created',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['identity-service', 'admissions-adapter', 'vle-adapter', 'finance-adapter'],
  },
  {
    typeName: 'StudentIdentityUpdatedV1Payload',
    file: 'student/identity-updated.v1.ts',
    subject: 'srs.student.identity-updated',
    schemaPath: 'student/identity-updated',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['identity-service', 'vle-adapter', 'finance-adapter'],
  },
  {
    typeName: 'StudentEnrolledV1Payload',
    file: 'student/enrolled.v1.ts',
    subject: 'srs.student.enrolled',
    schemaPath: 'student/enrolled',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['finance-adapter', 'vle-adapter', 'wellbeing-module'],
  },
  {
    typeName: 'StudentStatusChangedV1Payload',
    file: 'student/status-changed.v1.ts',
    subject: 'srs.student.status-changed',
    schemaPath: 'student/status-changed',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['finance-adapter', 'vle-adapter', 'wellbeing-module'],
  },
  {
    typeName: 'DisabilityDeclarationUpdatedV1Payload',
    file: 'student/disability-declaration-updated.v1.ts',
    subject: 'srs.student.disability-declaration-updated',
    schemaPath: 'student/disability-declaration-updated',
    dataClass: 'special-category',
    partitionKey: 'personId',
    consumers: ['wellbeing-module', 'disability-service'],
  },
  // ── Identity ─────────────────────────────────────────────────────────────
  {
    typeName: 'IdentityVerificationRequestedV1Payload',
    file: 'identity/verification-requested.v1.ts',
    subject: 'srs.identity.verification-requested',
    schemaPath: 'identity/verification-requested',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['identity-service'],
  },
  {
    typeName: 'IdentityVerificationCompletedV1Payload',
    file: 'identity/verification-completed.v1.ts',
    subject: 'srs.identity.verification-completed',
    schemaPath: 'identity/verification-completed',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['identity-service', 'admissions-adapter'],
  },
  // ── Enrolment ────────────────────────────────────────────────────────────
  {
    typeName: 'EnrolmentFeeLiabilityGeneratedV1Payload',
    file: 'enrolment/fee-liability-generated.v1.ts',
    subject: 'srs.enrolment.fee-liability-generated',
    schemaPath: 'enrolment/fee-liability-generated',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['finance-adapter'],
  },
  {
    typeName: 'EnrolmentModuleRegisteredV1Payload',
    file: 'enrolment/module-registered.v1.ts',
    subject: 'srs.enrolment.module-registered',
    schemaPath: 'enrolment/module-registered',
    dataClass: 'standard',
    partitionKey: 'enrolmentId',
    consumers: ['vle-adapter', 'timetabling-adapter', 'finance-adapter'],
  },
  {
    typeName: 'EnrolmentModuleRegistrationWithdrawnV1Payload',
    file: 'enrolment/module-registration-withdrawn.v1.ts',
    subject: 'srs.enrolment.module-registration-withdrawn',
    schemaPath: 'enrolment/module-registration-withdrawn',
    dataClass: 'standard',
    partitionKey: 'enrolmentId',
    consumers: ['vle-adapter', 'timetabling-adapter'],
  },
  {
    typeName: 'EnrolmentModuleRegistrationCompletedV1Payload',
    file: 'enrolment/module-registration-completed.v1.ts',
    subject: 'srs.enrolment.module-registration-completed',
    schemaPath: 'enrolment/module-registration-completed',
    dataClass: 'standard',
    partitionKey: 'enrolmentId',
    consumers: ['vle-adapter', 'transcript-service'],
  },
  // ── Catalogue ────────────────────────────────────────────────────────────
  {
    typeName: 'CatalogueProgrammeUpdatedV1Payload',
    file: 'catalogue/programme-updated.v1.ts',
    subject: 'srs.catalogue.programme-updated',
    schemaPath: 'catalogue/programme-updated',
    dataClass: 'standard',
    partitionKey: 'programmeId',
    consumers: ['vle-adapter', 'prospectus-adapter', 'bi-adapter'],
  },
  {
    typeName: 'CatalogueModuleUpdatedV1Payload',
    file: 'catalogue/module-updated.v1.ts',
    subject: 'srs.catalogue.module-updated',
    schemaPath: 'catalogue/module-updated',
    dataClass: 'standard',
    partitionKey: 'moduleId',
    consumers: ['vle-adapter', 'timetabling-adapter', 'bi-adapter'],
  },
  {
    typeName: 'CatalogueModuleRelationshipUpdatedV1Payload',
    file: 'catalogue/module-relationship-updated.v1.ts',
    subject: 'srs.catalogue.module-relationship-updated',
    schemaPath: 'catalogue/module-relationship-updated',
    dataClass: 'standard',
    partitionKey: 'moduleId',
    consumers: ['curriculum-adapter'],
  },
  {
    typeName: 'CatalogueLearningOutcomeUpdatedV1Payload',
    file: 'catalogue/learning-outcome-updated.v1.ts',
    subject: 'srs.catalogue.learning-outcome-updated',
    schemaPath: 'catalogue/learning-outcome-updated',
    dataClass: 'standard',
    partitionKey: 'learningOutcomeId',
    consumers: ['curriculum-adapter', 'hear-service'],
  },
  // ── Assessment ──────────────────────────────────────────────────────────
  {
    typeName: 'AssessmentMarkReceivedV1Payload',
    file: 'assessment/mark-received.v1.ts',
    subject: 'srs.assessment.mark-received',
    schemaPath: 'assessment/mark-received',
    dataClass: 'standard',
    partitionKey: 'moduleRegistrationId',
    consumers: ['bi-adapter', 'wellbeing-module'],
  },
  {
    typeName: 'AssessmentMarkUpdatedV1Payload',
    file: 'assessment/mark-updated.v1.ts',
    subject: 'srs.assessment.mark-updated',
    schemaPath: 'assessment/mark-updated',
    dataClass: 'standard',
    partitionKey: 'moduleRegistrationId',
    consumers: ['bi-adapter'],
  },
  {
    typeName: 'AssessmentModuleResultCalculatedV1Payload',
    file: 'assessment/module-result-calculated.v1.ts',
    subject: 'srs.assessment.module-result-calculated',
    schemaPath: 'assessment/module-result-calculated',
    dataClass: 'standard',
    partitionKey: 'moduleRegistrationId',
    consumers: ['bi-adapter', 'transcript-service'],
  },
  {
    typeName: 'AssessmentModuleResultRatifiedV1Payload',
    file: 'assessment/module-result-ratified.v1.ts',
    subject: 'srs.assessment.module-result-ratified',
    schemaPath: 'assessment/module-result-ratified',
    dataClass: 'standard',
    partitionKey: 'moduleRegistrationId',
    consumers: ['bi-adapter', 'transcript-service', 'hear-service'],
  },
  // ── Adjustment ──────────────────────────────────────────────────────────
  {
    typeName: 'AdjustmentApprovedV1Payload',
    file: 'adjustment/approved.v1.ts',
    subject: 'srs.adjustment.approved',
    schemaPath: 'adjustment/approved',
    dataClass: 'sensitive',
    partitionKey: 'enrolmentId',
    consumers: ['assessment-venue-adapter', 'wellbeing-module'],
  },
  {
    typeName: 'AdjustmentDistributedV1Payload',
    file: 'adjustment/distributed.v1.ts',
    subject: 'srs.adjustment.distributed',
    schemaPath: 'adjustment/distributed',
    dataClass: 'sensitive',
    partitionKey: 'adjustmentId',
    consumers: ['assessment-venue-adapter'],
  },
  {
    typeName: 'AdjustmentExpiredV1Payload',
    file: 'adjustment/expired.v1.ts',
    subject: 'srs.adjustment.expired',
    schemaPath: 'adjustment/expired',
    dataClass: 'sensitive',
    partitionKey: 'enrolmentId',
    consumers: ['assessment-venue-adapter', 'wellbeing-module'],
  },
  // ── Attendance and engagement ───────────────────────────────────────────
  {
    typeName: 'EngagementExpectedEventCreatedV1Payload',
    file: 'engagement/expected-event-created.v1.ts',
    subject: 'srs.engagement.expected-event.created',
    schemaPath: 'engagement/expected-event-created',
    dataClass: 'personal',
    partitionKey: 'personId',
    consumers: ['attendance-adapter', 'engagement-service'],
  },
  {
    typeName: 'EngagementObservationRecordedV1Payload',
    file: 'engagement/observation-recorded.v1.ts',
    subject: 'srs.engagement.observation.recorded',
    schemaPath: 'engagement/observation-recorded',
    dataClass: 'sensitive',
    partitionKey: 'personId',
    consumers: ['engagement-service'],
  },
  {
    typeName: 'EngagementObservationCorrectedV1Payload',
    file: 'engagement/observation-corrected.v1.ts',
    subject: 'srs.engagement.observation.corrected',
    schemaPath: 'engagement/observation-corrected',
    dataClass: 'sensitive',
    partitionKey: 'observationId',
    consumers: ['engagement-service', 'integration-operations'],
  },
  {
    typeName: 'EngagementAlertRaisedV1Payload',
    file: 'engagement/alert-raised.v1.ts',
    subject: 'srs.engagement.alert.raised',
    schemaPath: 'engagement/alert-raised',
    dataClass: 'sensitive',
    partitionKey: 'personId',
    consumers: ['engagement-service', 'personal-tutor-portal'],
  },
  {
    typeName: 'EngagementAlertSuspendedV1Payload',
    file: 'engagement/alert-suspended.v1.ts',
    subject: 'srs.engagement.alert.suspended',
    schemaPath: 'engagement/alert-suspended',
    dataClass: 'sensitive',
    partitionKey: 'personId',
    consumers: ['engagement-service', 'integration-operations'],
  },
  // ── Circumstances ────────────────────────────────────────────────────────
  {
    typeName: 'CircumstancesEcFlaggedV1Payload',
    file: 'circumstances/exceptional-circumstances-flagged.v1.ts',
    subject: 'srs.circumstances.exceptional-circumstances-flagged',
    schemaPath: 'circumstances/exceptional-circumstances-flagged',
    dataClass: 'sensitive',
    partitionKey: 'enrolmentId',
    consumers: ['wellbeing-module', 'bi-adapter'],
  },
  {
    typeName: 'CircumstancesEcUpdatedV1Payload',
    file: 'circumstances/exceptional-circumstances-updated.v1.ts',
    subject: 'srs.circumstances.exceptional-circumstances-updated',
    schemaPath: 'circumstances/exceptional-circumstances-updated',
    dataClass: 'sensitive',
    partitionKey: 'exceptionalCircumstancesId',
    consumers: ['wellbeing-module', 'bi-adapter'],
  },
  {
    typeName: 'CircumstancesMisconductOutcomeRecordedV1Payload',
    file: 'circumstances/misconduct-outcome-recorded.v1.ts',
    subject: 'srs.circumstances.misconduct-outcome-recorded',
    schemaPath: 'circumstances/misconduct-outcome-recorded',
    dataClass: 'sensitive',
    partitionKey: 'enrolmentId',
    consumers: ['bi-adapter'],
  },
  // ── Governance ───────────────────────────────────────────────────────────
  {
    typeName: 'GovernanceExamBoardDataPackReadyV1Payload',
    file: 'governance/exam-board-data-pack-ready.v1.ts',
    subject: 'srs.governance.exam-board-data-pack-ready',
    schemaPath: 'governance/exam-board-data-pack-ready',
    dataClass: 'standard',
    partitionKey: 'examBoardId',
    consumers: ['exam-board-portal'],
  },
  {
    typeName: 'GovernanceExamBoardRatifiedV1Payload',
    file: 'governance/exam-board-ratified.v1.ts',
    subject: 'srs.governance.exam-board-ratified',
    schemaPath: 'governance/exam-board-ratified',
    dataClass: 'standard',
    partitionKey: 'examBoardId',
    consumers: ['transcript-service', 'hear-service', 'bi-adapter'],
  },
  {
    typeName: 'GovernanceRecordLockedV1Payload',
    file: 'governance/record-locked.v1.ts',
    subject: 'srs.governance.record-locked',
    schemaPath: 'governance/record-locked',
    dataClass: 'standard',
    partitionKey: 'examBoardId',
    consumers: ['bi-adapter'],
  },
  {
    typeName: 'GovernanceRecordAmendedPostRatificationV1Payload',
    file: 'governance/record-amended-post-ratification.v1.ts',
    subject: 'srs.governance.record-amended-post-ratification',
    schemaPath: 'governance/record-amended-post-ratification',
    dataClass: 'standard',
    partitionKey: 'examBoardId',
    consumers: ['transcript-service', 'hear-service', 'bi-adapter'],
  },
  {
    typeName: 'GovernanceExamEntrySubmittedV1Payload',
    file: 'governance/exam-entry-submitted.v1.ts',
    subject: 'srs.governance.exam-entry-submitted',
    schemaPath: 'governance/exam-entry-submitted',
    dataClass: 'standard',
    partitionKey: 'examBoardId',
    consumers: ['timetabling-adapter'],
  },
  {
    typeName: 'GovernanceExamScheduleReceivedV1Payload',
    file: 'governance/exam-schedule-received.v1.ts',
    subject: 'srs.governance.exam-schedule-received',
    schemaPath: 'governance/exam-schedule-received',
    dataClass: 'standard',
    partitionKey: 'examBoardId',
    consumers: ['timetabling-adapter', 'assessment-venue-adapter'],
  },
  // ── Progression ──────────────────────────────────────────────────────────
  {
    typeName: 'ProgressionDecidedV1Payload',
    file: 'progression/decided.v1.ts',
    subject: 'srs.progression.decided',
    schemaPath: 'progression/decided',
    dataClass: 'standard',
    partitionKey: 'enrolmentId',
    consumers: ['bi-adapter', 'transcript-service'],
  },
  // ── Award ────────────────────────────────────────────────────────────────
  {
    typeName: 'AwardConferredV1Payload',
    file: 'award/conferred.v1.ts',
    subject: 'srs.award.conferred',
    schemaPath: 'award/conferred',
    dataClass: 'standard',
    partitionKey: 'enrolmentId',
    consumers: ['transcript-service', 'hear-service', 'bi-adapter', 'alumni-service'],
  },
  // ── Regulatory ──────────────────────────────────────────────────────────
  {
    typeName: 'RegulatoryUcasApplicationReceivedV1Payload',
    file: 'regulatory/ucas-application-received.v1.ts',
    subject: 'srs.regulatory.ucas-application-received',
    schemaPath: 'regulatory/ucas-application-received',
    dataClass: 'personal',
    partitionKey: 'applicationId',
    consumers: ['admissions-adapter'],
  },
  {
    typeName: 'RegulatoryUcasConfirmationSentV1Payload',
    file: 'regulatory/ucas-confirmation-sent.v1.ts',
    subject: 'srs.regulatory.ucas-confirmation-sent',
    schemaPath: 'regulatory/ucas-confirmation-sent',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['admissions-adapter'],
  },
  {
    typeName: 'RegulatoryHesaReturnGeneratedV1Payload',
    file: 'regulatory/hesa-return-generated.v1.ts',
    subject: 'srs.regulatory.hesa-return-generated',
    schemaPath: 'regulatory/hesa-return-generated',
    dataClass: 'regulatory',
    partitionKey: 'returnId',
    consumers: ['regulatory-reporting-adapter'],
  },
  {
    typeName: 'RegulatoryHesaReturnSubmittedV1Payload',
    file: 'regulatory/hesa-return-submitted.v1.ts',
    subject: 'srs.regulatory.hesa-return-submitted',
    schemaPath: 'regulatory/hesa-return-submitted',
    dataClass: 'regulatory',
    partitionKey: 'returnId',
    consumers: ['regulatory-reporting-adapter', 'bi-adapter'],
  },
  {
    typeName: 'RegulatoryHesaIdAssignedV1Payload',
    file: 'regulatory/hesa-id-assigned.v1.ts',
    subject: 'srs.regulatory.hesa-id-assigned',
    schemaPath: 'regulatory/hesa-id-assigned',
    dataClass: 'personal',
    partitionKey: 'enrolmentId',
    consumers: ['regulatory-reporting-adapter'],
  },
  {
    typeName: 'RegulatorySlcConfirmationSentV1Payload',
    file: 'regulatory/slc-confirmation-sent.v1.ts',
    subject: 'srs.regulatory.slc-confirmation-sent',
    schemaPath: 'regulatory/slc-confirmation-sent',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['finance-adapter'],
  },
  {
    typeName: 'RegulatorySlcNotificationReceivedV1Payload',
    file: 'regulatory/slc-notification-received.v1.ts',
    subject: 'srs.regulatory.slc-notification-received',
    schemaPath: 'regulatory/slc-notification-received',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['finance-adapter'],
  },
  {
    typeName: 'RegulatoryUkviCasRequestedV1Payload',
    file: 'regulatory/ukvi-cas-requested.v1.ts',
    subject: 'srs.regulatory.ukvi-cas-requested',
    schemaPath: 'regulatory/ukvi-cas-requested',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['ukvi-adapter'],
  },
  {
    typeName: 'RegulatoryUkviCasAssignedV1Payload',
    file: 'regulatory/ukvi-cas-assigned.v1.ts',
    subject: 'srs.regulatory.ukvi-cas-assigned',
    schemaPath: 'regulatory/ukvi-cas-assigned',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['ukvi-adapter'],
  },
  {
    typeName: 'RegulatoryUkviAttendanceSubmittedV1Payload',
    file: 'regulatory/ukvi-attendance-submitted.v1.ts',
    subject: 'srs.regulatory.ukvi-attendance-submitted',
    schemaPath: 'regulatory/ukvi-attendance-submitted',
    dataClass: 'regulatory',
    partitionKey: 'academicPeriodId',
    consumers: ['ukvi-adapter'],
  },
  {
    typeName: 'RegulatoryUkviVisaStatusUpdatedV1Payload',
    file: 'regulatory/ukvi-visa-status-updated.v1.ts',
    subject: 'srs.regulatory.ukvi-visa-status-updated',
    schemaPath: 'regulatory/ukvi-visa-status-updated',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['ukvi-adapter', 'wellbeing-module'],
  },
  {
    typeName: 'RegulatoryUkviComplianceAlertRaisedV1Payload',
    file: 'regulatory/ukvi-compliance-alert-raised.v1.ts',
    subject: 'srs.regulatory.ukvi-compliance-alert-raised',
    schemaPath: 'regulatory/ukvi-compliance-alert-raised',
    dataClass: 'regulatory',
    partitionKey: 'enrolmentId',
    consumers: ['ukvi-adapter', 'wellbeing-module'],
  },
  {
    typeName: 'RegulatoryOfsExtractGeneratedV1Payload',
    file: 'regulatory/ofs-extract-generated.v1.ts',
    subject: 'srs.regulatory.ofs-extract-generated',
    schemaPath: 'regulatory/ofs-extract-generated',
    dataClass: 'regulatory',
    partitionKey: 'extractId',
    consumers: ['regulatory-reporting-adapter', 'bi-adapter'],
  },
];

/** Internal events — not included in the published schema registry. */
export const INTERNAL_EVENTS = [
  { subject: 'srs.enrolment.downstream-trigger-created', reason: 'Internal routing event; drives UCAS/SLC/UKVI trigger processing — not for external consumers.' },
  { subject: 'srs.workflow.task-assigned',    reason: 'Internal workflow coordination event.' },
  { subject: 'srs.workflow.task-completed',   reason: 'Internal workflow coordination event.' },
  { subject: 'srs.workflow.task-escalated',   reason: 'Internal workflow coordination event.' },
  { subject: 'srs.workflow.decision-recorded', reason: 'Internal workflow coordination event.' },
  { subject: 'srs.workflow.completed',        reason: 'Internal workflow coordination event.' },
];

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

const SCHEMA_URI_BASE = 'https://schemas.revelation-srs.io/events';

// eslint-disable-next-line @typescript-eslint/require-await
async function generateSchema(event: EventDef): Promise<object> {
  const config = {
    path:          join(DOMAIN_ROOT, 'src', 'events', event.file),
    type:          event.typeName,
    tsconfig:      TSCONFIG,
    skipTypeCheck: true,
    expose:        'none' as const,
    jsDoc:         'none' as const,
    additionalProperties: false,
  };
  const generator = createGenerator(config);
  return generator.createSchema(event.typeName);
}

async function writeJson(path: string, data: object): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Envelope schema (shared, written once)
// ---------------------------------------------------------------------------

const ENVELOPE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `${SCHEMA_URI_BASE}/envelope.v1.json`,
  title: 'DomainEventEnvelope',
  description: 'Standard envelope wrapping every Revelation SRS domain event.',
  type: 'object',
  required: ['id', 'type', 'version', 'schemaRef', 'tenantId', 'occurredAt', 'publishedAt', 'validAt', 'correlationId', 'causationId', 'source', 'dataClassification', 'payload'],
  additionalProperties: false,
  properties: {
    id:                 { type: 'string', format: 'uuid', description: 'Unique event ID — also the idempotency key for consumers.' },
    type:               { type: 'string', description: 'Fully qualified NATS subject, e.g. srs.student.created.' },
    version:            { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', description: 'Semver string. Breaking changes create a new version.' },
    schemaRef:          { type: 'string', format: 'uri', description: 'URI to the JSON Schema for the payload field.' },
    tenantId:           { type: 'string', format: 'uuid' },
    occurredAt:         { type: 'string', format: 'date-time' },
    publishedAt:        { type: 'string', format: 'date-time' },
    validAt:            { type: 'string', format: 'date-time' },
    correlationId:      { type: 'string', format: 'uuid' },
    causationId:        { type: 'string', format: 'uuid' },
    source:             { type: 'string' },
    dataClassification: { type: 'string', enum: ['standard', 'personal', 'sensitive', 'special-category', 'regulatory'] },
    payload:            { description: 'Event-specific payload. Validate against the schema identified by schemaRef.' },
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

await mkdir(SCHEMA_ROOT, { recursive: true });
await writeJson(join(SCHEMA_ROOT, 'envelope.v1.json'), ENVELOPE_SCHEMA);
console.log('Written: envelope.v1.json');

const registryEntries: object[] = [];
let generated = 0;
let failed = 0;

for (const event of PUBLISHED_EVENTS) {
  const outDir  = join(SCHEMA_ROOT, event.schemaPath);
  const outFile = join(outDir, 'v1.json');
  const schemaId = `${SCHEMA_URI_BASE}/${event.schemaPath}/v1.json`;

  try {
    const schema = await generateSchema(event);

    // Merge in $id and metadata extensions
    const finalSchema = {
      ...schema,
      $id:         schemaId,
      title:       event.typeName,
      description: `Payload schema for ${event.subject} v1.0.0`,
    };

    await mkdir(outDir, { recursive: true });
    await writeJson(outFile, finalSchema);

    registryEntries.push({
      subject:      event.subject,
      version:      '1.0.0',
      schemaRef:    schemaId,
      schemaPath:   `schemas/events/${event.schemaPath}/v1.json`,
      dataClass:    event.dataClass,
      partitionKey: event.partitionKey,
      consumers:    event.consumers,
      status:       'published',
    });

    console.log(`Generated: ${event.schemaPath}/v1.json`);
    generated++;
  } catch (err) {
    console.error(`FAILED: ${event.schemaPath}/v1.json — ${(err as Error).message}`);
    failed++;
  }
}

// Add internal events to registry as non-published
for (const ev of INTERNAL_EVENTS) {
  registryEntries.push({
    subject: ev.subject,
    version: '1.0.0',
    status:  'internal',
    reason:  ev.reason,
  });
}

const registry = {
  $schema:     'http://json-schema.org/draft-07/schema#',
  generated:   new Date().toISOString(),
  description: 'Machine-readable registry of all Revelation SRS domain events.',
  schemaUriBase: SCHEMA_URI_BASE,
  events:      registryEntries,
};

await writeJson(join(SCHEMA_ROOT, 'registry.json'), registry);
console.log(`\nRegistry written with ${registryEntries.length} events (${generated} schemas generated, ${INTERNAL_EVENTS.length} internal).`);

if (failed > 0) {
  console.error(`\n${failed} schema(s) failed to generate.`);
  process.exit(1);
}
