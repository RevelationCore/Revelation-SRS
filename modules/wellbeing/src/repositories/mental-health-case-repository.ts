import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import { wellbeingCases } from '../db/schema/wellbeing-case.js';
import {
  mentalHealthCases,
  interventionPlans,
  mhSessionNotes,
  type MentalHealthCase,
  type InterventionPlan,
  type MhSessionNote,
} from '../db/schema/mental-health.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateMentalHealthCaseInput {
  personId:              string;
  presentingConcernCode: string;
  riskLevelCode?:        string;
  assignedAdvisorId?:    string;
  notes?:                string;
}

export interface MhStatusTransitionUpdates {
  riskLevelCode?: string;
  consentGiven?:  boolean;
  consentDate?:   Date;
}

export interface CreateInterventionPlanInput {
  mentalHealthCaseId:       string;
  personId:                 string;
  planTypeCode:             string;
  practitionerId:           string;
  sessionFrequencyCode?:    string;
  plannedSessionCount?:     string;
  goals?:                   Array<{ goal: string; targetDate?: string }>;
  reviewDate?:              Date;
  externalReferral?:        boolean;
  externalReferralDetails?: string;
}

export interface AddSessionNoteInput {
  tenantId:           string;
  mentalHealthCaseId: string;
  personId:           string;
  practitionerId:     string;
  sessionDate:        Date;
  sessionTypeCode:    string;
  content:            string;
  actorId:            string;
}

// ── Internal helper ───────────────────────────────────────────────────────────

function generateCaseRef(): string {
  const year   = new Date().getFullYear();
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 8);
  return `MH-${year}-${suffix}`;
}

// ── Mental health case CRUD ───────────────────────────────────────────────────

/**
 * Create a parent wellbeing_case and the first bitemporal mental_health_case
 * version in a single transaction.
 */
export async function createMentalHealthCase(
  tx:       WellbeingTx,
  tenantId: string,
  actorId:  string,
  input:    CreateMentalHealthCaseInput,
): Promise<{ wellbeingCaseId: string; mhCaseId: string }> {
  const [wc] = await tx.insert(wellbeingCases).values({
    tenantId,
    personId:  input.personId,
    caseRef:   generateCaseRef(),
    statusCode: 'active',
    ...(input.assignedAdvisorId !== undefined ? { assignedAdvisorId: input.assignedAdvisorId } : {}),
    ...(input.notes             !== undefined ? { notes: input.notes }                         : {}),
  }).returning({ id: wellbeingCases.id });

  if (!wc) throw new Error('Failed to create wellbeing case');

  const logicalId = randomUUID();
  await tx.insert(mentalHealthCases).values({
    id:                    logicalId,
    tenantId,
    wellbeingCaseId:       wc.id,
    personId:              input.personId,
    presentingConcernCode: input.presentingConcernCode,
    statusCode:            'referral_received',
    riskLevelCode:         input.riskLevelCode ?? 'low',
    consentGiven:          false,
    consentDate:           null,
    actorId,
    validFrom:             new Date(),
    validTo:               null,
    recordedAt:            new Date(),
    recordedUntil:         null,
  });

  return { wellbeingCaseId: wc.id, mhCaseId: logicalId };
}

/** Return the current (open) version of an MH case by logical ID. */
export async function findCurrentMentalHealthCase(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<MentalHealthCase | null> {
  const rows = await tx
    .select()
    .from(mentalHealthCases)
    .where(
      and(
        eq(mentalHealthCases.tenantId, tenantId),
        eq(mentalHealthCases.id, caseId),
        isNull(mentalHealthCases.recordedUntil),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** List current MH cases for a person. */
export async function listMentalHealthCasesForPerson(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
): Promise<MentalHealthCase[]> {
  return tx
    .select()
    .from(mentalHealthCases)
    .where(
      and(
        eq(mentalHealthCases.tenantId, tenantId),
        eq(mentalHealthCases.personId, personId),
        isNull(mentalHealthCases.recordedUntil),
      ),
    )
    .orderBy(mentalHealthCases.validFrom);
}

// ── Bitemporal helpers ────────────────────────────────────────────────────────

function closeCurrentMhCase(tx: WellbeingTx, tenantId: string, caseId: string, now: Date) {
  return tx
    .update(mentalHealthCases)
    .set({ recordedUntil: now })
    .where(
      and(
        eq(mentalHealthCases.tenantId, tenantId),
        eq(mentalHealthCases.id, caseId),
        isNull(mentalHealthCases.recordedUntil),
      ),
    );
}

/** Transition an MH case to a new status (bitemporal close + reopen). */
export async function transitionMhStatus(
  tx:        WellbeingTx,
  tenantId:  string,
  caseId:    string,
  newStatus: string,
  actorId:   string,
  updates?:  MhStatusTransitionUpdates,
): Promise<void> {
  const current = await findCurrentMentalHealthCase(tx, tenantId, caseId);
  if (!current) {
    throw Object.assign(new Error(`MH case ${caseId} not found`), { statusCode: 404 });
  }

  const now = new Date();
  await closeCurrentMhCase(tx, tenantId, caseId, now);

  await tx.insert(mentalHealthCases).values({
    id:                    caseId,
    tenantId,
    wellbeingCaseId:       current.wellbeingCaseId,
    personId:              current.personId,
    presentingConcernCode: current.presentingConcernCode,
    statusCode:            newStatus,
    riskLevelCode:         updates?.riskLevelCode ?? current.riskLevelCode,
    consentGiven:          updates?.consentGiven  ?? current.consentGiven,
    consentDate:           updates?.consentDate   ?? current.consentDate ?? null,
    actorId,
    validFrom:             now,
    validTo:               null,
    recordedAt:            now,
    recordedUntil:         null,
  });
}

/** Update risk level only (bitemporal close + reopen). */
export async function updateRiskLevel(
  tx:            WellbeingTx,
  tenantId:      string,
  caseId:        string,
  riskLevelCode: string,
  actorId:       string,
): Promise<void> {
  const current = await findCurrentMentalHealthCase(tx, tenantId, caseId);
  if (!current) {
    throw Object.assign(new Error(`MH case ${caseId} not found`), { statusCode: 404 });
  }

  const now = new Date();
  await closeCurrentMhCase(tx, tenantId, caseId, now);

  await tx.insert(mentalHealthCases).values({
    id:                    caseId,
    tenantId,
    wellbeingCaseId:       current.wellbeingCaseId,
    personId:              current.personId,
    presentingConcernCode: current.presentingConcernCode,
    statusCode:            current.statusCode,
    riskLevelCode,
    consentGiven:          current.consentGiven,
    consentDate:           current.consentDate ?? null,
    actorId,
    validFrom:             now,
    validTo:               null,
    recordedAt:            now,
    recordedUntil:         null,
  });
}

/** Record consent (bitemporal close + reopen). */
export async function recordConsent(
  tx:          WellbeingTx,
  tenantId:    string,
  caseId:      string,
  consentDate: Date,
  actorId:     string,
): Promise<void> {
  const current = await findCurrentMentalHealthCase(tx, tenantId, caseId);
  if (!current) {
    throw Object.assign(new Error(`MH case ${caseId} not found`), { statusCode: 404 });
  }

  const now = new Date();
  await closeCurrentMhCase(tx, tenantId, caseId, now);

  await tx.insert(mentalHealthCases).values({
    id:                    caseId,
    tenantId,
    wellbeingCaseId:       current.wellbeingCaseId,
    personId:              current.personId,
    presentingConcernCode: current.presentingConcernCode,
    statusCode:            current.statusCode,
    riskLevelCode:         current.riskLevelCode,
    consentGiven:          true,
    consentDate,
    actorId,
    validFrom:             now,
    validTo:               null,
    recordedAt:            now,
    recordedUntil:         null,
  });
}

// ── Session notes ─────────────────────────────────────────────────────────────

/**
 * Append a session note (append-only — no update path exists).
 *
 * Content is special-category health data. It must never be forwarded to
 * NATS events, SRS APIs, or aggregate reporting endpoints.
 * Callers MUST write an audit_log entry after calling this function.
 */
export async function addSessionNote(
  tx:    WellbeingTx,
  input: AddSessionNoteInput,
): Promise<string> {
  const [row] = await tx.insert(mhSessionNotes).values({
    tenantId:           input.tenantId,
    mentalHealthCaseId: input.mentalHealthCaseId,
    personId:           input.personId,
    practitionerId:     input.practitionerId,
    sessionDate:        input.sessionDate,
    sessionTypeCode:    input.sessionTypeCode,
    content:            input.content,
    actorId:            input.actorId,
  }).returning({ id: mhSessionNotes.id });

  if (!row) throw new Error('Failed to add session note');
  return row.id;
}

/**
 * List session notes for an MH case, most-recent first.
 * Callers MUST audit-log every call — content is special-category.
 */
export async function listSessionNotes(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<MhSessionNote[]> {
  return tx
    .select()
    .from(mhSessionNotes)
    .where(
      and(
        eq(mhSessionNotes.tenantId, tenantId),
        eq(mhSessionNotes.mentalHealthCaseId, caseId),
      ),
    )
    .orderBy(desc(mhSessionNotes.sessionDate));
}

// ── Intervention plans ────────────────────────────────────────────────────────

/** Create the first bitemporal version of an intervention plan. */
export async function createInterventionPlan(
  tx:       WellbeingTx,
  tenantId: string,
  actorId:  string,
  input:    CreateInterventionPlanInput,
): Promise<string> {
  const logicalId = randomUUID();
  await tx.insert(interventionPlans).values({
    id:                 logicalId,
    tenantId,
    mentalHealthCaseId: input.mentalHealthCaseId,
    personId:           input.personId,
    planTypeCode:       input.planTypeCode,
    statusCode:         'draft',
    practitionerId:     input.practitionerId,
    goals:              (input.goals ?? []) as unknown as Record<string, unknown>,
    externalReferral:   input.externalReferral ?? false,
    actorId,
    validFrom:          new Date(),
    validTo:            null,
    recordedAt:         new Date(),
    recordedUntil:      null,
    ...(input.sessionFrequencyCode    !== undefined ? { sessionFrequencyCode: input.sessionFrequencyCode }       : {}),
    ...(input.plannedSessionCount     !== undefined ? { plannedSessionCount: input.plannedSessionCount }         : {}),
    ...(input.reviewDate              !== undefined ? { reviewDate: input.reviewDate }                           : {}),
    ...(input.externalReferralDetails !== undefined ? { externalReferralDetails: input.externalReferralDetails } : {}),
  });
  return logicalId;
}

/** Return the current (open) version of an intervention plan. */
export async function findCurrentInterventionPlan(
  tx:       WellbeingTx,
  tenantId: string,
  planId:   string,
): Promise<InterventionPlan | null> {
  const rows = await tx
    .select()
    .from(interventionPlans)
    .where(
      and(
        eq(interventionPlans.tenantId, tenantId),
        eq(interventionPlans.id, planId),
        isNull(interventionPlans.recordedUntil),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** List current versions of all intervention plans for an MH case. */
export async function listInterventionPlansForCase(
  tx:       WellbeingTx,
  tenantId: string,
  mhCaseId: string,
): Promise<InterventionPlan[]> {
  return tx
    .select()
    .from(interventionPlans)
    .where(
      and(
        eq(interventionPlans.tenantId, tenantId),
        eq(interventionPlans.mentalHealthCaseId, mhCaseId),
        isNull(interventionPlans.recordedUntil),
      ),
    )
    .orderBy(interventionPlans.validFrom);
}

/** Transition an intervention plan to a new status (bitemporal close + reopen). */
export async function transitionPlanStatus(
  tx:        WellbeingTx,
  tenantId:  string,
  planId:    string,
  newStatus: string,
  actorId:   string,
): Promise<void> {
  const current = await findCurrentInterventionPlan(tx, tenantId, planId);
  if (!current) {
    throw Object.assign(new Error(`Intervention plan ${planId} not found`), { statusCode: 404 });
  }

  const now = new Date();

  await tx
    .update(interventionPlans)
    .set({ recordedUntil: now })
    .where(
      and(
        eq(interventionPlans.tenantId, tenantId),
        eq(interventionPlans.id, planId),
        isNull(interventionPlans.recordedUntil),
      ),
    );

  await tx.insert(interventionPlans).values({
    id:                      planId,
    tenantId,
    mentalHealthCaseId:      current.mentalHealthCaseId,
    personId:                current.personId,
    planTypeCode:            current.planTypeCode,
    statusCode:              newStatus,
    practitionerId:          current.practitionerId,
    sessionFrequencyCode:    current.sessionFrequencyCode ?? null,
    plannedSessionCount:     current.plannedSessionCount  ?? null,
    goals:                   current.goals as unknown as Record<string, unknown>,
    externalReferral:        current.externalReferral,
    externalReferralDetails: current.externalReferralDetails ?? null,
    reviewDate:              current.reviewDate ?? null,
    actorId,
    validFrom:               now,
    validTo:                 null,
    recordedAt:              now,
    recordedUntil:           null,
  });
}
