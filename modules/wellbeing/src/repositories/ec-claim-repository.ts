import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import {
  ecClaims,
  ecEvidenceReviews,
  ecDeterminations,
  type EcClaim,
  type EcEvidenceReview,
  type EcDetermination,
} from '../db/schema/circumstances.js';

// ── Sentinel: codes that should never reach SRS ───────────────────────────────

export const NON_SRS_DETERMINATION_CODES = new Set(['not_upheld']);

/** Return true when a determination warrants SRS board visibility. */
export function isBoardVisible(determinationCode: string): boolean {
  return !NON_SRS_DETERMINATION_CODES.has(determinationCode);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateEcClaimInput {
  wellbeingCaseId:         string;
  personId:                string;
  enrolmentId:             string;
  assessmentPeriodRef:     string;
  affectedModuleCodes:     string[];
  circumstancesNarrative?: string;
  evidenceDeadline?:       Date;
}

export interface RecordEvidenceReviewInput {
  ecClaimId:          string;
  reviewerId:         string;
  reviewedAt:         Date;
  evidenceStatusCode: string;
  reviewNotes?:       string;
}

export interface RecordDeterminationInput {
  ecClaimId:               string;
  authorisedById:          string;
  determinationCode:       string;
  determinationRationale?: string;
  moduleOutcomes:          Array<{ moduleCode: string; outcome: string }>;
  determinedAt:            Date;
}

export interface StatusTransitionUpdates {
  circumstancesNarrative?: string;
  evidenceDeadline?:       Date;
}

// ── Claim CRUD ────────────────────────────────────────────────────────────────

/** Create the first bitemporal version of an EC claim. */
export async function createEcClaim(
  tx:       WellbeingTx,
  tenantId: string,
  actorId:  string,
  input:    CreateEcClaimInput,
): Promise<string> {
  const logicalId = randomUUID();
  await tx.insert(ecClaims).values({
    id:                    logicalId,
    tenantId,
    wellbeingCaseId:       input.wellbeingCaseId,
    personId:              input.personId,
    enrolmentId:           input.enrolmentId,
    assessmentPeriodRef:   input.assessmentPeriodRef,
    affectedModuleCodes:   input.affectedModuleCodes,
    statusCode:            'submitted',
    circumstancesNarrative: input.circumstancesNarrative ?? null,
    submittedAt:           new Date(),
    evidenceDeadline:      input.evidenceDeadline ?? null,
    actorId,
    validFrom:             new Date(),
    validTo:               null,
    recordedAt:            new Date(),
    recordedUntil:         null,
  });
  return logicalId;
}

/** Return the current (open) version of an EC claim. */
export async function findCurrentEcClaim(
  tx:       WellbeingTx,
  tenantId: string,
  claimId:  string,
): Promise<EcClaim | null> {
  const rows = await tx
    .select()
    .from(ecClaims)
    .where(
      and(
        eq(ecClaims.tenantId, tenantId),
        eq(ecClaims.id, claimId),
        isNull(ecClaims.recordedUntil),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** List current versions of all EC claims for a person. */
export async function listEcClaimsForPerson(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
): Promise<EcClaim[]> {
  return tx
    .select()
    .from(ecClaims)
    .where(
      and(
        eq(ecClaims.tenantId, tenantId),
        eq(ecClaims.personId, personId),
        isNull(ecClaims.recordedUntil),
      ),
    )
    .orderBy(ecClaims.submittedAt);
}

/**
 * Transition an EC claim to a new status (bitemporal close + reopen).
 * Carries all non-status fields forward; optional updates override specific fields.
 */
export async function transitionEcStatus(
  tx:        WellbeingTx,
  tenantId:  string,
  claimId:   string,
  newStatus: string,
  actorId:   string,
  updates?:  StatusTransitionUpdates,
): Promise<void> {
  const current = await findCurrentEcClaim(tx, tenantId, claimId);
  if (!current) {
    throw Object.assign(new Error(`EC claim ${claimId} not found`), { statusCode: 404 });
  }

  const now = new Date();

  await tx
    .update(ecClaims)
    .set({ recordedUntil: now })
    .where(
      and(
        eq(ecClaims.tenantId, tenantId),
        eq(ecClaims.id, claimId),
        isNull(ecClaims.recordedUntil),
      ),
    );

  await tx.insert(ecClaims).values({
    id:                    claimId,
    tenantId,
    wellbeingCaseId:       current.wellbeingCaseId,
    personId:              current.personId,
    enrolmentId:           current.enrolmentId,
    assessmentPeriodRef:   current.assessmentPeriodRef,
    affectedModuleCodes:   current.affectedModuleCodes,
    statusCode:            newStatus,
    circumstancesNarrative: updates?.circumstancesNarrative ?? current.circumstancesNarrative ?? null,
    submittedAt:           current.submittedAt,
    evidenceDeadline:      updates?.evidenceDeadline ?? current.evidenceDeadline ?? null,
    actorId,
    validFrom:             now,
    validTo:               null,
    recordedAt:            now,
    recordedUntil:         null,
  });
}

// ── Evidence reviews ──────────────────────────────────────────────────────────

export async function recordEvidenceReview(
  tx:       WellbeingTx,
  tenantId: string,
  input:    RecordEvidenceReviewInput,
): Promise<string> {
  const [row] = await tx.insert(ecEvidenceReviews).values({
    tenantId,
    ecClaimId:          input.ecClaimId,
    reviewerId:         input.reviewerId,
    reviewedAt:         input.reviewedAt,
    evidenceStatusCode: input.evidenceStatusCode,
    reviewNotes:        input.reviewNotes ?? null,
  }).returning({ id: ecEvidenceReviews.id });

  if (!row) throw new Error('Failed to record evidence review');
  return row.id;
}

export async function listEvidenceReviews(
  tx:       WellbeingTx,
  tenantId: string,
  claimId:  string,
): Promise<EcEvidenceReview[]> {
  return tx
    .select()
    .from(ecEvidenceReviews)
    .where(
      and(
        eq(ecEvidenceReviews.tenantId, tenantId),
        eq(ecEvidenceReviews.ecClaimId, claimId),
      ),
    )
    .orderBy(ecEvidenceReviews.reviewedAt);
}

// ── Determinations ────────────────────────────────────────────────────────────

export async function recordDetermination(
  tx:       WellbeingTx,
  tenantId: string,
  input:    RecordDeterminationInput,
): Promise<string> {
  const [row] = await tx.insert(ecDeterminations).values({
    tenantId,
    ecClaimId:               input.ecClaimId,
    authorisedById:          input.authorisedById,
    determinationCode:       input.determinationCode,
    determinationRationale:  input.determinationRationale ?? null,
    moduleOutcomes:          input.moduleOutcomes,
    determinedAt:            input.determinedAt,
  }).returning({ id: ecDeterminations.id });

  if (!row) throw new Error('Failed to record determination');
  return row.id;
}

export async function findLatestDetermination(
  tx:       WellbeingTx,
  tenantId: string,
  claimId:  string,
): Promise<EcDetermination | null> {
  const rows = await tx
    .select()
    .from(ecDeterminations)
    .where(
      and(
        eq(ecDeterminations.tenantId, tenantId),
        eq(ecDeterminations.ecClaimId, claimId),
      ),
    )
    .orderBy(ecDeterminations.determinedAt)
    .limit(1);
  return rows[0] ?? null;
}
