import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';

import type { WellbeingTx } from '../db/client.js';
import {
  adjustmentCases,
  adjustmentAssessments,
  adjustmentPanelDecisions,
  type AdjustmentCase,
  type AdjustmentAssessment,
  type AdjustmentPanelDecision,
} from '../db/schema/adjustment.js';
import { srsContextProjections } from '../db/schema/wellbeing-case.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateAdjustmentCaseInput {
  wellbeingCaseId:          string;
  disabilitySupportCaseId:  string;
  personId:                 string;
  adjustmentTypeCode:       string;
  rationale?:               string;
  dsaEntitlementId?:        string;
}

export interface RecordAssessmentInput {
  adjustmentCaseId: string;
  assessorId:       string;
  assessedAt:       Date;
  outcomeCode:      string;
  findings?:        string;
  recommendedAction?: string;
}

export interface RecordPanelDecisionInput {
  adjustmentCaseId:   string;
  panelChairId:       string;
  panelDate:          Date;
  decisionCode:       string;
  decisionRationale?: string;
}

export interface StatusTransitionUpdates {
  recommendedAdjustment?: string;
  rationale?:             string;
  srsApplicationRef?:     string;
}

// ── State machine ─────────────────────────────────────────────────────────────

export const ADJUSTMENT_STATUSES = [
  'referral_received', 'assessment_pending', 'under_assessment', 'determination_made',
  'approved', 'rejected', 'under_review', 'review_complete', 'closed',
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/**
 * Legal next-states per current state. Referral/assessment stages are the
 * Disability Adviser / Specialist Assessor main flow (BP-04-004); panel
 * review is the escalation branch (a 'referred-to-panel' assessment outcome,
 * or a manual refer-to-panel action) rather than a mandatory step for every
 * case — matching the business process doc, which names no "panel" actor
 * in its main flow.
 */
const ALLOWED_TRANSITIONS: Record<AdjustmentStatus, AdjustmentStatus[]> = {
  // 'under_review' is reachable directly from any pre-determination state —
  // a panel referral can be raised at any point once a case exists, not
  // only after a full assessment has run. 'rejected' is likewise reachable
  // early (e.g. a referral that's plainly out of scope) — rejection grants
  // nothing, so unlike approve() it carries no evidentiary precondition of
  // its own (that's checked separately, only for approve, via
  // hasApprovableDetermination).
  referral_received:   ['assessment_pending', 'under_assessment', 'under_review', 'rejected', 'closed'],
  assessment_pending:  ['under_assessment', 'under_review', 'rejected', 'closed'],
  under_assessment:    ['determination_made', 'under_review', 'rejected', 'closed'],
  determination_made:  ['approved', 'rejected', 'under_review'],
  under_review:        ['determination_made', 'approved', 'rejected', 'review_complete'],
  review_complete:     ['closed'],
  approved:            ['under_review', 'closed'],
  rejected:            ['under_review', 'closed'],
  closed:              [],
};

export class IllegalStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition adjustment case from '${from}' to '${to}'`);
    this.name = 'IllegalStatusTransitionError';
  }
}

export class ApprovalPreconditionError extends Error {
  constructor() {
    super('Approval requires either a recommending needs assessment or an upheld/modified panel decision');
    this.name = 'ApprovalPreconditionError';
  }
}

// ── Case CRUD ─────────────────────────────────────────────────────────────────

/**
 * Create the first bitemporal version of an adjustment case.
 * Returns the logical ID shared across all future versions.
 */
export async function createAdjustmentCase(
  tx:       WellbeingTx,
  tenantId: string,
  actorId:  string,
  input:    CreateAdjustmentCaseInput,
): Promise<string> {
  const logicalId = randomUUID();
  await tx.insert(adjustmentCases).values({
    id:                      logicalId,
    tenantId,
    wellbeingCaseId:         input.wellbeingCaseId,
    disabilitySupportCaseId: input.disabilitySupportCaseId,
    personId:                input.personId,
    adjustmentTypeCode:      input.adjustmentTypeCode,
    statusCode:              'referral_received',
    recommendedAdjustment:   null,
    rationale:               input.rationale ?? null,
    dsaEntitlementId:        input.dsaEntitlementId ?? null,
    srsApplicationRef:       null,
    actorId,
    validFrom:               new Date(),
    validTo:                 null,
    recordedAt:              new Date(),
    recordedUntil:           null,
  });
  return logicalId;
}

/** Return the current (open) version of an adjustment case by logical ID. */
export async function findCurrentAdjustmentCase(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<AdjustmentCase | null> {
  const rows = await tx
    .select()
    .from(adjustmentCases)
    .where(
      and(
        eq(adjustmentCases.tenantId, tenantId),
        eq(adjustmentCases.id, caseId),
        isNull(adjustmentCases.recordedUntil),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** List current versions of all adjustment cases for a person. */
export async function listAdjustmentCasesForPerson(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
): Promise<AdjustmentCase[]> {
  return tx
    .select()
    .from(adjustmentCases)
    .where(
      and(
        eq(adjustmentCases.tenantId, tenantId),
        eq(adjustmentCases.personId, personId),
        isNull(adjustmentCases.recordedUntil),
      ),
    )
    .orderBy(adjustmentCases.recordedAt);
}

/**
 * Cross-student triage queue — staff-only (see routes.ts's permission
 * gate). Without this, a disability adviser has no way to discover a new
 * referral without already knowing the student's personId.
 */
export async function listAllAdjustmentCases(
  tx:       WellbeingTx,
  tenantId: string,
  statusCode?: string,
): Promise<AdjustmentCase[]> {
  return tx
    .select()
    .from(adjustmentCases)
    .where(
      and(
        eq(adjustmentCases.tenantId, tenantId),
        isNull(adjustmentCases.recordedUntil),
        ...(statusCode ? [eq(adjustmentCases.statusCode, statusCode)] : []),
      ),
    )
    .orderBy(adjustmentCases.recordedAt);
}

/**
 * Transition an adjustment case to a new status (bitemporal close + reopen).
 * Optional updates to non-status fields are carried into the new version.
 *
 * Validates the transition against ALLOWED_TRANSITIONS unless
 * `skipValidation` is set — that escape hatch exists only for the
 * permission-gated administrative-correction path (a distinct action from
 * a normal workflow transition; see routes.ts's status-correction route),
 * never for ordinary case progression.
 */
export async function transitionAdjustmentStatus(
  tx:        WellbeingTx,
  tenantId:  string,
  caseId:    string,
  newStatus: string,
  actorId:   string,
  updates?:  StatusTransitionUpdates,
  options?:  { skipValidation?: boolean },
): Promise<void> {
  const current = await findCurrentAdjustmentCase(tx, tenantId, caseId);
  if (!current) {
    throw Object.assign(new Error(`Adjustment case ${caseId} not found`), { statusCode: 404 });
  }

  // A same-status "transition" isn't a workflow jump at all — it's the
  // bitemporal amendment pattern used to persist an updated field (e.g.
  // attaching srsApplicationRef once the SRS call returns) as a new
  // version without changing where the case sits in the workflow. Always
  // legal, unlike a genuine state change.
  if (!options?.skipValidation && newStatus !== current.statusCode) {
    const from = current.statusCode as AdjustmentStatus;
    const legalNextStates = ALLOWED_TRANSITIONS[from] ?? [];
    if (!legalNextStates.includes(newStatus as AdjustmentStatus)) {
      throw Object.assign(new IllegalStatusTransitionError(from, newStatus), { statusCode: 409 });
    }
  }

  const now = new Date();

  await tx
    .update(adjustmentCases)
    .set({ recordedUntil: now })
    .where(
      and(
        eq(adjustmentCases.tenantId, tenantId),
        eq(adjustmentCases.id, caseId),
        isNull(adjustmentCases.recordedUntil),
      ),
    );

  await tx.insert(adjustmentCases).values({
    id:                      caseId,
    tenantId,
    wellbeingCaseId:         current.wellbeingCaseId,
    disabilitySupportCaseId: current.disabilitySupportCaseId,
    personId:                current.personId,
    adjustmentTypeCode:      current.adjustmentTypeCode,
    statusCode:              newStatus,
    recommendedAdjustment:   updates?.recommendedAdjustment ?? current.recommendedAdjustment ?? null,
    rationale:               updates?.rationale              ?? current.rationale              ?? null,
    dsaEntitlementId:        current.dsaEntitlementId        ?? null,
    srsApplicationRef:       updates?.srsApplicationRef      ?? current.srsApplicationRef      ?? null,
    actorId,
    validFrom:               now,
    validTo:                 null,
    recordedAt:              now,
    recordedUntil:           null,
  });
}

// ── Module registration validation ───────────────────────────────────────────

/**
 * Check whether the person has active module registrations in the local
 * SRS context projection.  Returns true if they do; false if the projection
 * is empty (projection may not have caught up yet).
 */
export async function personHasActiveModules(
  tx:       WellbeingTx,
  tenantId: string,
  personId: string,
): Promise<boolean> {
  const rows = await tx
    .select({
      activeCodes: srsContextProjections.activeModuleCodes,
    })
    .from(srsContextProjections)
    .where(
      and(
        eq(srsContextProjections.tenantId, tenantId),
        eq(srsContextProjections.personId, personId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return false;
  const codes = row.activeCodes as string[];
  return Array.isArray(codes) && codes.length > 0;
}

// ── Assessment records ────────────────────────────────────────────────────────

export async function recordAssessment(
  tx:       WellbeingTx,
  tenantId: string,
  input:    RecordAssessmentInput,
): Promise<string> {
  const [row] = await tx.insert(adjustmentAssessments).values({
    tenantId,
    adjustmentCaseId:  input.adjustmentCaseId,
    assessorId:        input.assessorId,
    assessedAt:        input.assessedAt,
    outcomeCode:       input.outcomeCode,
    findings:          input.findings ?? null,
    recommendedAction: input.recommendedAction ?? null,
  }).returning({ id: adjustmentAssessments.id });

  if (!row) throw new Error('Failed to record assessment');
  return row.id;
}

export async function listAssessments(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<AdjustmentAssessment[]> {
  return tx
    .select()
    .from(adjustmentAssessments)
    .where(
      and(
        eq(adjustmentAssessments.tenantId, tenantId),
        eq(adjustmentAssessments.adjustmentCaseId, caseId),
      ),
    )
    .orderBy(adjustmentAssessments.assessedAt);
}

// ── Panel decisions ───────────────────────────────────────────────────────────

export async function recordPanelDecision(
  tx:       WellbeingTx,
  tenantId: string,
  input:    RecordPanelDecisionInput,
): Promise<string> {
  const [row] = await tx.insert(adjustmentPanelDecisions).values({
    tenantId,
    adjustmentCaseId:  input.adjustmentCaseId,
    panelChairId:      input.panelChairId,
    panelDate:         input.panelDate,
    decisionCode:      input.decisionCode,
    decisionRationale: input.decisionRationale ?? null,
    distributedToSrs:  false,
  }).returning({ id: adjustmentPanelDecisions.id });

  if (!row) throw new Error('Failed to record panel decision');
  return row.id;
}

export async function getCurrentPanelDecision(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<AdjustmentPanelDecision | null> {
  const rows = await tx
    .select()
    .from(adjustmentPanelDecisions)
    .where(
      and(
        eq(adjustmentPanelDecisions.tenantId, tenantId),
        eq(adjustmentPanelDecisions.adjustmentCaseId, caseId),
      ),
    )
    .orderBy(desc(adjustmentPanelDecisions.panelDate))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Approval precondition: a case may only be approved on the strength of
 * either a recommending needs assessment or an upheld/modified panel
 * decision — never on referral information alone. Checks the most recent
 * record of each kind.
 */
export async function hasApprovableDetermination(
  tx:       WellbeingTx,
  tenantId: string,
  caseId:   string,
): Promise<boolean> {
  const [latestAssessment] = await tx
    .select({ outcomeCode: adjustmentAssessments.outcomeCode })
    .from(adjustmentAssessments)
    .where(and(eq(adjustmentAssessments.tenantId, tenantId), eq(adjustmentAssessments.adjustmentCaseId, caseId)))
    .orderBy(desc(adjustmentAssessments.assessedAt))
    .limit(1);
  if (latestAssessment?.outcomeCode === 'recommended') return true;

  const panelDecision = await getCurrentPanelDecision(tx, tenantId, caseId);
  return panelDecision !== null && ['upheld', 'modified'].includes(panelDecision.decisionCode);
}

export async function markPanelDecisionDistributed(
  tx:              WellbeingTx,
  tenantId:        string,
  panelDecisionId: string,
): Promise<void> {
  await tx
    .update(adjustmentPanelDecisions)
    .set({ distributedToSrs: true, distributedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(adjustmentPanelDecisions.tenantId, tenantId),
        eq(adjustmentPanelDecisions.id, panelDecisionId),
      ),
    );
}
