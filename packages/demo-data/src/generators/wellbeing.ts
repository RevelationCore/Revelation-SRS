/**
 * Wellbeing generator — synthetic wellbeing scenario data for S4.
 *
 * The wellbeing module uses its own PostgreSQL schema ('wellbeing') and Drizzle
 * table definitions separate from packages/db. Rather than importing the full
 * @revelation-srs/wellbeing application package (which carries Fastify, NATS,
 * JWT as runtime deps), we define minimal inline Drizzle table stubs here that
 * mirror only the columns we write during demo data generation.
 *
 * All free-text fields carry 'DEMO - ' prefixes.
 * All records are explicitly synthetic (is_synthetic flag where the schema
 * supports it; DEMO- prefixes on all narrative/notes fields).
 */

import { boolean, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Db } from '@revelation-srs/db';

import { deterministicId } from './ids.js';

// ─── Minimal wellbeing schema stubs ───────────────────────────────────────────

const w = pgSchema('wellbeing');

const wellbeingCasesTable = w.table('wellbeing_case', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenantId:               uuid('tenant_id').notNull(),
  personId:               uuid('person_id').notNull(),
  caseRef:                text('case_ref').notNull(),
  statusCode:             text('status_code').notNull(),
  openedAt:               timestamp('opened_at', { withTimezone: true }).notNull(),
  closedAt:               timestamp('closed_at', { withTimezone: true }),
  assignedAdvisorId:      text('assigned_advisor_id'),
  notes:                  text('notes'),
  lawfulBasisCode:        text('lawful_basis_code').notNull(),
  dataClassificationCode: text('data_classification_code').notNull(),
  retentionDueDate:       timestamp('retention_due_date', { withTimezone: true }),
});

const disabilitySupportCasesTable = w.table('disability_support_case', {
  versionId:             uuid('version_id').primaryKey(),
  id:                    uuid('id').notNull(),
  tenantId:              uuid('tenant_id').notNull(),
  wellbeingCaseId:       uuid('wellbeing_case_id').notNull(),
  personId:              uuid('person_id').notNull(),
  supportTypeCode:       text('support_type_code').notNull(),
  statusCode:            text('status_code').notNull(),
  supportPlanStatusCode: text('support_plan_status_code').notNull(),
  dsaAwardRef:           text('dsa_award_ref'),
  actorId:               text('actor_id').notNull(),
  validFrom:             timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:               timestamp('valid_to',      { withTimezone: true }),
  recordedAt:            timestamp('recorded_at',   { withTimezone: true }).notNull(),
  recordedUntil:         timestamp('recorded_until',{ withTimezone: true }),
});

const mentalHealthCasesTable = w.table('mental_health_case', {
  versionId:             uuid('version_id').primaryKey(),
  id:                    uuid('id').notNull(),
  tenantId:              uuid('tenant_id').notNull(),
  wellbeingCaseId:       uuid('wellbeing_case_id').notNull(),
  personId:              uuid('person_id').notNull(),
  presentingConcernCode: text('presenting_concern_code').notNull(),
  statusCode:            text('status_code').notNull(),
  riskLevelCode:         text('risk_level_code').notNull(),
  consentGiven:          boolean('consent_given').notNull(),
  consentDate:           timestamp('consent_date', { withTimezone: true }),
  actorId:               text('actor_id').notNull(),
  validFrom:             timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:               timestamp('valid_to',      { withTimezone: true }),
  recordedAt:            timestamp('recorded_at',   { withTimezone: true }).notNull(),
  recordedUntil:         timestamp('recorded_until',{ withTimezone: true }),
});

const adjustmentCasesTable = w.table('adjustment_case', {
  versionId:                uuid('version_id').primaryKey(),
  id:                       uuid('id').notNull(),
  tenantId:                 uuid('tenant_id').notNull(),
  wellbeingCaseId:          uuid('wellbeing_case_id').notNull(),
  disabilitySupportCaseId:  uuid('disability_support_case_id').notNull(),
  personId:                 uuid('person_id').notNull(),
  adjustmentTypeCode:       text('adjustment_type_code').notNull(),
  statusCode:               text('status_code').notNull(),
  recommendedAdjustment:    text('recommended_adjustment'),
  rationale:                text('rationale'),
  dsaEntitlementId:         uuid('dsa_entitlement_id'),
  srsApplicationRef:        text('srs_application_ref'),
  actorId:                  text('actor_id').notNull(),
  validFrom:                timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:                  timestamp('valid_to',      { withTimezone: true }),
  recordedAt:               timestamp('recorded_at',   { withTimezone: true }).notNull(),
  recordedUntil:            timestamp('recorded_until',{ withTimezone: true }),
});

const ecClaimsTable = w.table('ec_claim', {
  versionId:               uuid('version_id').primaryKey(),
  id:                      uuid('id').notNull(),
  tenantId:                uuid('tenant_id').notNull(),
  wellbeingCaseId:         uuid('wellbeing_case_id').notNull(),
  personId:                uuid('person_id').notNull(),
  enrolmentId:             uuid('enrolment_id').notNull(),
  assessmentPeriodRef:     text('assessment_period_ref').notNull(),
  affectedModuleCodes:     jsonb('affected_module_codes').notNull(),
  statusCode:              text('status_code').notNull(),
  circumstancesNarrative:  text('circumstances_narrative'),
  submittedAt:             timestamp('submitted_at',       { withTimezone: true }).notNull(),
  evidenceDeadline:        timestamp('evidence_deadline',  { withTimezone: true }),
  actorId:                 text('actor_id').notNull(),
  validFrom:               timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:                 timestamp('valid_to',      { withTimezone: true }),
  recordedAt:              timestamp('recorded_at',   { withTimezone: true }).notNull(),
  recordedUntil:           timestamp('recorded_until',{ withTimezone: true }),
});

export {
  wellbeingCasesTable,
  disabilitySupportCasesTable,
  mentalHealthCasesTable,
  adjustmentCasesTable,
  ecClaimsTable,
};

// ─── Type helpers ─────────────────────────────────────────────────────────────

export type NewWellbeingCase            = typeof wellbeingCasesTable.$inferInsert;
export type NewDisabilitySupportCase    = typeof disabilitySupportCasesTable.$inferInsert;
export type NewMentalHealthCase         = typeof mentalHealthCasesTable.$inferInsert;
export type NewAdjustmentCase           = typeof adjustmentCasesTable.$inferInsert;
export type NewEcClaim                  = typeof ecClaimsTable.$inferInsert;

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function wellbeingCaseId(tenantId: string, seq: number): string {
  return deterministicId('wellbeing-case', tenantId, String(seq));
}

export function disabilityCaseId(tenantId: string, seq: number): string {
  return deterministicId('disability-case', tenantId, String(seq));
}

export function mentalHealthCaseId(tenantId: string, seq: number): string {
  return deterministicId('mh-case', tenantId, String(seq));
}

export function adjustmentCaseId(tenantId: string, seq: number): string {
  return deterministicId('adjustment-case', tenantId, String(seq));
}

export function ecClaimId(tenantId: string, seq: number): string {
  return deterministicId('ec-claim', tenantId, String(seq));
}

// ─── Wellbeing constants ──────────────────────────────────────────────────────

const ACTOR      = 'demo-data:assessment-marks';
const VALID_FROM = new Date('2025-08-01T00:00:00Z');

const ADJUSTMENT_TYPES  = ['exam-time', 'venue', 'coursework', 'other'] as const;
const SUPPORT_TYPES     = ['dsa', 'institutional', 'interim'] as const;
const MH_CONCERNS       = ['anxiety', 'depression', 'other'] as const;
const EC_STATUSES       = ['upheld', 'not_upheld', 'under_review'] as const;

// ─── Wellbeing case generator ─────────────────────────────────────────────────

/**
 * 2% of students (seq % 50 === 0) get a wellbeing case.
 * At 1,000 students → ~20 cases.
 */
export function hasWellbeingCase(seq: number): boolean {
  return seq % 50 === 0;
}

/**
 * Among wellbeing students: 3% get mental health referral (seq % 350 === 0),
 * 5% get an EC claim (seq % 200 === 0), rest get disability/adjustment only.
 */
export function hasMentalHealthCase(seq: number): boolean {
  return seq % 350 === 0;
}

export function hasEcClaim(seq: number): boolean {
  return seq % 200 === 0;
}

export function generateWellbeingCase(
  tenantId: string,
  personId: string,
  seq:      number,
): NewWellbeingCase {
  const wbId = wellbeingCaseId(tenantId, seq);
  return {
    id:                     wbId,
    tenantId,
    personId,
    caseRef:                `DEMO-WB-${String(seq).padStart(5, '0')}`,
    statusCode:             'active',
    openedAt:               VALID_FROM,
    assignedAdvisorId:      'demo-advisor',
    notes:                  'DEMO - Synthetic wellbeing case for demo purposes',
    lawfulBasisCode:        'gdpr-art6-e',
    dataClassificationCode: 'sensitive',
  };
}

export function generateDisabilitySupportCase(
  tenantId: string,
  personId: string,
  seq:      number,
): NewDisabilitySupportCase {
  const caseId = disabilityCaseId(tenantId, seq);
  const wbId   = wellbeingCaseId(tenantId, seq);
  const typeIdx = seq % SUPPORT_TYPES.length;
  return {
    versionId:             caseId,
    id:                    caseId,
    tenantId,
    wellbeingCaseId:       wbId,
    personId,
    supportTypeCode:       SUPPORT_TYPES[typeIdx]!,
    statusCode:            'active',
    supportPlanStatusCode: 'active',
    dsaAwardRef:           `DEMO-DSA-${String(seq).padStart(5, '0')}`,
    actorId:               ACTOR,
    validFrom:             VALID_FROM,
    recordedAt:            VALID_FROM,
  };
}

export function generateAdjustmentCase(
  tenantId:            string,
  personId:            string,
  seq:                 number,
): NewAdjustmentCase {
  const adjId          = adjustmentCaseId(tenantId, seq);
  const wbId           = wellbeingCaseId(tenantId, seq);
  const disId          = disabilityCaseId(tenantId, seq);
  const typeIdx        = seq % ADJUSTMENT_TYPES.length;
  return {
    versionId:                adjId,
    id:                       adjId,
    tenantId,
    wellbeingCaseId:          wbId,
    disabilitySupportCaseId:  disId,
    personId,
    adjustmentTypeCode:       ADJUSTMENT_TYPES[typeIdx]!,
    statusCode:               'approved',
    recommendedAdjustment:    'DEMO - 25% additional time in examinations',
    rationale:                'DEMO - DSA assessment outcome applied',
    actorId:                  ACTOR,
    validFrom:                VALID_FROM,
    recordedAt:               VALID_FROM,
  };
}

export function generateMentalHealthCase(
  tenantId: string,
  personId: string,
  seq:      number,
): NewMentalHealthCase {
  const mhId   = mentalHealthCaseId(tenantId, seq);
  const wbId   = wellbeingCaseId(tenantId, seq);
  const typeIdx = seq % MH_CONCERNS.length;
  return {
    versionId:             mhId,
    id:                    mhId,
    tenantId,
    wellbeingCaseId:       wbId,
    personId,
    presentingConcernCode: MH_CONCERNS[typeIdx]!,
    statusCode:            'active',
    riskLevelCode:         'low',
    consentGiven:          true,
    consentDate:           VALID_FROM,
    actorId:               ACTOR,
    validFrom:             VALID_FROM,
    recordedAt:            VALID_FROM,
  };
}

export function generateEcClaim(
  tenantId:   string,
  personId:   string,
  enrolmentId: string,
  seq:        number,
): NewEcClaim {
  const ecId    = ecClaimId(tenantId, seq);
  const wbId    = wellbeingCaseId(tenantId, seq);
  const statusIdx = seq % EC_STATUSES.length;
  return {
    versionId:              ecId,
    id:                     ecId,
    tenantId,
    wellbeingCaseId:        wbId,
    personId,
    enrolmentId,
    assessmentPeriodRef:    '2025-26:SPRING',
    affectedModuleCodes:    ['CS101', 'MA102'],
    statusCode:             EC_STATUSES[statusIdx]!,
    circumstancesNarrative: 'DEMO - Synthetic EC claim for demonstration purposes only',
    submittedAt:            VALID_FROM,
    evidenceDeadline:       new Date('2026-01-31T17:00:00Z'),
    actorId:                ACTOR,
    validFrom:              VALID_FROM,
    recordedAt:             VALID_FROM,
  };
}

// ─── Wellbeing schema existence check ─────────────────────────────────────────

export async function wellbeingSchemaExists(db: Db): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'wellbeing' LIMIT 1`,
  ) as Array<Record<string, unknown>>;
  return rows.length > 0;
}
