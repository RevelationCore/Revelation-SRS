import {
  adjustmentProposals,
  workflowDefinitionVersions,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
  type AdjustmentProposal,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, DomainError, NotFoundError, ValidationError, type AdjustmentAmountV1 } from '@revelation-srs/domain';
import { and, asc, eq } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';
import { GovernedReview } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { AdjustmentService, RecordAdjustmentInput } from './adjustment-service.js';
import { amountFromRow } from './amount.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const ADJUSTMENT_MANUAL_APPROVAL_WORKFLOW_CODE = 'adjustment-manual-approval';
export const MANUAL_PROPOSALS_FLAG = 'adjustments.manual-proposals.enabled';
const DECISION_STEP_KEY = 'decide-manual-adjustment';

export type ProposalDecisionCode = 'approved' | 'rejected';

/** The signed-in person acting, from the token, never the body (P-23). */
export interface ProposalActor {
  sub: string;
  srsPersonId?: string | undefined;
}

export interface ProposeAdjustmentInput extends RecordAdjustmentInput {
  manualReasonCode: string;
  externalReference: string;
}

export interface AdjustmentProposalDto {
  proposalId: string;
  personId: string;
  enrolmentId: string;
  adjustmentTypeCode: string;
  scopeCode: string;
  amount: AdjustmentAmountV1 | null;
  validFrom: Date;
  validTo: Date | null;
  manualReasonCode: string;
  externalReference: string;
  statusCode: string;
  proposedBy: string;
  proposedAt: Date;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  adjustmentId: string | null;
}

/** 403, separate from a missing permission, so the screen can say why. */
export class SeparationOfDutiesError extends DomainError {
  constructor(message: string) {
    super(message, 'separation-of-duties', 403);
    this.name = 'SeparationOfDutiesError';
  }
}

export class ManualAdjustmentsDisabledError extends DomainError {
  constructor() {
    super('Manual adjustment proposals are not enabled for this institution; adjustments are recorded through a wellbeing case', 'manual-adjustments-disabled', 403);
    this.name = 'ManualAdjustmentsDisabledError';
  }
}

/** What the approval needs after the adjustment is written: refresh exam entries (BL-058). */
export interface ExamEntryRefresher {
  applyExamAdditions(tenantId: string): Promise<number>;
}

/**
 * Manual adjustment proposals (ADR-033 items 2 to 4, BL-378). A core
 * adjustment with no wellbeing case behind it is proposed here, with a reason
 * code and the reference of wherever the decision is held, and decided by an
 * adjustment approver through a governed review. Nothing is distributed, and
 * no reader of reasonable_adjustment sees anything, until it is approved.
 */
export class AdjustmentProposalService {
  constructor(
    private readonly db: Db,
    private readonly adjustments: AdjustmentService,
    private readonly valueSets: ValueSetService,
    private readonly featureFlags: FeatureFlagService | undefined,
    private readonly workflowBridge: WorkflowBridgeService,
    private readonly examEntries: ExamEntryRefresher | undefined,
    private readonly reviewExecution?: ReviewExecutionService,
    private readonly log?: { warn: (obj: unknown, msg: string) => void },
  ) {}

  readonly #review = (): GovernedReview => new GovernedReview(this.workflowBridge, this.reviewExecution, {
    workflowCode: ADJUSTMENT_MANUAL_APPROVAL_WORKFLOW_CODE,
    stepKey: DECISION_STEP_KEY,
    gatewayKey: 'G01',
    outcomeStepKey: 'manual-adjustment-closed',
    assigneeRoleCode: 'adjustment-approver',
    subjectEntityType: 'adjustment_proposal',
    // Both change the proposal; a rejection must reach it on Temporal too.
    effectDecisionCodes: ['approved', 'rejected'],
  });

  registerWorkflowEffects(activities: ReviewActivitiesService): void {
    this.#review().register(activities, async (input) => {
      const proposalId = input.context['proposalId'] as string;
      return this.#applyDecision(input.tenantId, proposalId, input.decisionCode as ProposalDecisionCode, { sub: input.actorId }, input.reason);
    });
  }

  async propose(tenantId: string, personId: string, input: ProposeAdjustmentInput, actor: ProposalActor): Promise<AdjustmentProposalDto> {
    if (!(await this.#manualPathEnabled(tenantId))) throw new ManualAdjustmentsDisabledError();
    if (actor.srsPersonId && actor.srsPersonId === personId) {
      throw new SeparationOfDutiesError('You cannot propose an adjustment for your own record');
    }
    const externalReference = input.externalReference.trim();
    if (externalReference.length < 1 || externalReference.length > 100) {
      throw new ValidationError('externalReference must be 1 to 100 characters', [{ field: 'externalReference', message: 'Where the decision is held, for example a case number' }]);
    }
    await this.#validateReasonCode(tenantId, input.manualReasonCode);
    const { manualReasonCode, externalReference: _ref, ...recording } = input;
    await this.adjustments.validateForRecording(tenantId, personId, recording);

    const [created] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(adjustmentProposals).values({
      tenantId: tenantId as Uuid,
      personId: personId as Uuid,
      enrolmentId: input.enrolmentId as Uuid,
      adjustmentTypeCode: input.adjustmentTypeCode,
      scopeCode: input.scopeCode,
      amountValue: input.amount ? input.amount.value.toFixed(2) : null,
      amountUnitCode: input.amount?.unitCode ?? null,
      validFrom: new Date(input.validFrom),
      validTo: input.validTo ? new Date(input.validTo) : null,
      manualReasonCode,
      externalReference,
      proposedBy: actor.sub,
      proposedByPersonId: (actor.srsPersonId ?? null) as Uuid | null,
    }).returning()) as [AdjustmentProposal];

    const started = await this.#review().start(tenantId, {
      workflowDefinitionVersionId: await this.#activeVersionId(tenantId),
      subjectEntityId: created.id,
      startedBy: actor.sub,
      // Identifiers only: the task payload is visible on the workflow screens.
      context: { proposalId: created.id, personId, proposedBy: actor.sub },
    });
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(adjustmentProposals)
      .set({ workflowInstanceId: started.workflowInstanceId }).where(eq(adjustmentProposals.id, created.id)).returning());
    return toDto(row!);
  }

  async decide(
    tenantId: string,
    proposalId: string,
    decision: ProposalDecisionCode,
    actor: ProposalActor,
    reason?: string,
  ): Promise<AdjustmentProposalDto & { decisionStatus: 'applied' | 'pending' }> {
    const proposal = await this.#get(tenantId, proposalId);
    if (proposal.statusCode !== 'proposed') throw new ConflictError(`This proposal is already ${proposal.statusCode}`);
    this.#assertIndependent(proposal, actor);
    const trimmedReason = reason?.trim() || undefined;
    if (decision === 'rejected' && !trimmedReason) {
      throw new ValidationError('A rejection needs a reason', [{ field: 'reason', message: 'Say why the proposal is rejected' }]);
    }
    // A backlog can still be rejected after the path is switched off.
    if (decision === 'approved' && !(await this.#manualPathEnabled(tenantId))) throw new ManualAdjustmentsDisabledError();
    if (!proposal.workflowInstanceId) throw new ConflictError('This proposal has no review');

    const [instance] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(workflowInstances).where(and(
      eq(workflowInstances.tenantId, tenantId as Uuid), eq(workflowInstances.id, proposal.workflowInstanceId!),
      eq(workflowInstances.workflowCode, ADJUSTMENT_MANUAL_APPROVAL_WORKFLOW_CODE),
    )).limit(1));
    if (!instance) throw new NotFoundError('WorkflowInstance', proposal.workflowInstanceId);
    const [task] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: workflowTasks.id }).from(workflowTasks).where(and(
      eq(workflowTasks.tenantId, tenantId as Uuid), eq(workflowTasks.workflowInstanceId, instance.id), eq(workflowTasks.stepKey, DECISION_STEP_KEY),
    )).limit(1));

    const result = await this.#review().decide(tenantId, {
      instance, legacyTaskId: task?.id ?? null, decisionCode: decision, actorId: actor.sub,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
      metadata: { proposalId },
      effect: () => this.#applyDecision(tenantId, proposalId, decision, actor, trimmedReason),
    });
    return { ...toDto(await this.#get(tenantId, proposalId)), decisionStatus: result.status };
  }

  async list(tenantId: string, filter: { statusCode?: string; personId?: string; limit?: number; offset?: number } = {}): Promise<AdjustmentProposalDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(adjustmentProposals).where(and(
      eq(adjustmentProposals.tenantId, tenantId as Uuid),
      ...(filter.statusCode ? [eq(adjustmentProposals.statusCode, filter.statusCode)] : []),
      ...(filter.personId ? [eq(adjustmentProposals.personId, filter.personId as Uuid)] : []),
    )).orderBy(asc(adjustmentProposals.proposedAt), asc(adjustmentProposals.id)).limit(filter.limit ?? 50).offset(filter.offset ?? 0));
    return rows.map(toDto);
  }

  async get(tenantId: string, proposalId: string): Promise<AdjustmentProposalDto> {
    return toDto(await this.#get(tenantId, proposalId));
  }

  async #applyDecision(tenantId: string, proposalId: string, decision: ProposalDecisionCode, actor: ProposalActor, reason?: string): Promise<Record<string, unknown>> {
    if (decision === 'approved') return { proposalId, adjustmentId: await this.#approve(tenantId, proposalId, actor) };
    if (!reason) throw new ValidationError('A rejection needs a reason');
    await this.#reject(tenantId, proposalId, actor, reason);
    return { proposalId };
  }

  /**
   * The approval effect: records the adjustment under the proposal's
   * authority and marks the proposal approved, in one transaction. A retried
   * activity finds the same adjustment through the idempotency key.
   */
  async #approve(tenantId: string, proposalId: string, actor: ProposalActor): Promise<string> {
    const proposal = await this.#get(tenantId, proposalId);
    if (proposal.statusCode === 'approved' && proposal.adjustmentId) return proposal.adjustmentId;
    if (proposal.statusCode !== 'proposed') throw new ConflictError(`This proposal is already ${proposal.statusCode}`);
    this.#assertIndependent(proposal, actor);
    if (!(await this.#manualPathEnabled(tenantId))) throw new ManualAdjustmentsDisabledError();

    // Re-validate: codes may have been retired, or the enrolment closed, since it was proposed.
    if (proposal.validTo && proposal.validTo <= clockNow()) {
      throw new ValidationError('This adjustment has already ended, so there is nothing to approve', [{ field: 'validTo', message: 'In the past' }]);
    }
    await this.#validateReasonCode(tenantId, proposal.manualReasonCode);
    const amount = amountFromRow(proposal);
    const input: RecordAdjustmentInput = {
      enrolmentId: proposal.enrolmentId,
      adjustmentTypeCode: proposal.adjustmentTypeCode,
      scopeCode: proposal.scopeCode,
      validFrom: proposal.validFrom.toISOString(),
      ...(proposal.validTo ? { validTo: proposal.validTo.toISOString() } : {}),
      ...(amount ? { amount } : {}),
    };

    const { adjustmentId } = await this.adjustments.recordAuthorisedAdjustment(
      tenantId, proposal.personId, input, { kind: 'manual-proposal', proposalId }, actor.sub, `adjustment-proposal:${proposalId}`,
      async (tx, recordedId) => {
        const updated = await tx.update(adjustmentProposals).set({
          statusCode: 'approved', adjustmentId: recordedId, decidedBy: actor.sub,
          decidedByPersonId: (actor.srsPersonId ?? null), decidedAt: clockNow(),
        }).where(and(eq(adjustmentProposals.id, proposal.id), eq(adjustmentProposals.statusCode, 'proposed'))).returning({ id: adjustmentProposals.id });
        if (updated.length === 0) throw new ConflictError('This proposal was decided by someone else');
      },
    );

    // The SRS is itself the 'exams' target (BL-058); the reconcile loop retries a failure.
    try {
      await this.examEntries?.applyExamAdditions(tenantId);
    } catch (err) {
      this.log?.warn({ err, adjustmentId }, 'Exam entry refresh deferred to the reconcile loop');
    }
    return adjustmentId;
  }

  /** Safe to repeat, as a retried activity does. */
  async #reject(tenantId: string, proposalId: string, actor: ProposalActor, reason: string): Promise<void> {
    const proposal = await this.#get(tenantId, proposalId);
    if (proposal.statusCode === 'rejected') return;
    if (proposal.statusCode !== 'proposed') throw new ConflictError(`This proposal is already ${proposal.statusCode}`);
    this.#assertIndependent(proposal, actor);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(adjustmentProposals).set({
      statusCode: 'rejected', decidedBy: actor.sub, decidedByPersonId: (actor.srsPersonId ?? null),
      decidedAt: clockNow(), decisionReason: reason,
    }).where(and(eq(adjustmentProposals.id, proposalId as Uuid), eq(adjustmentProposals.statusCode, 'proposed'))));
  }

  /** P-22: neither the proposer nor the student it is about may decide it. */
  #assertIndependent(proposal: AdjustmentProposal, actor: ProposalActor): void {
    if (proposal.proposedBy === actor.sub
      || (actor.srsPersonId && proposal.proposedByPersonId && actor.srsPersonId === proposal.proposedByPersonId)) {
      throw new SeparationOfDutiesError('The person who proposed an adjustment cannot decide it');
    }
    if (actor.srsPersonId && actor.srsPersonId === proposal.personId) {
      throw new SeparationOfDutiesError('You cannot decide an adjustment for your own record');
    }
  }

  async #validateReasonCode(tenantId: string, code: string): Promise<void> {
    // Fails closed: an unbound or missing value set refuses every code.
    if ((await this.valueSets.validateFieldValue('adjustment_proposal', 'manual_reason_code', code, tenantId)) !== true) {
      throw new ValidationError(`Invalid value '${code}' for adjustment_proposal.manual_reason_code`, [{ field: 'manualReasonCode', message: 'Value is not active in the configured value set' }]);
    }
  }

  /** Off unless the tenant turns it on; any evaluation failure counts as off. */
  async #manualPathEnabled(tenantId: string): Promise<boolean> {
    if (!this.featureFlags) return false;
    try {
      const flag = await this.featureFlags.getFlagByKey(MANUAL_PROPOSALS_FLAG);
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, { tenantId });
      return result.value === true;
    } catch {
      return false;
    }
  }

  async #get(tenantId: string, id: string): Promise<AdjustmentProposal> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(adjustmentProposals)
      .where(and(eq(adjustmentProposals.tenantId, tenantId as Uuid), eq(adjustmentProposals.id, id as Uuid))).limit(1));
    if (!row) throw new NotFoundError('AdjustmentProposal', id);
    return row;
  }

  async #activeVersionId(tenantId: string): Promise<string> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ versionId: workflowDefinitionVersions.id })
      .from(workflowDefinitions)
      .innerJoin(workflowDefinitionVersions, and(
        eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
        eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
      ))
      .where(and(eq(workflowDefinitions.definitionCode, ADJUSTMENT_MANUAL_APPROVAL_WORKFLOW_CODE), eq(workflowDefinitions.statusCode, 'active'), eq(workflowDefinitionVersions.statusCode, 'active')))
      .limit(1));
    if (!row) throw new NotFoundError('WorkflowDefinition', ADJUSTMENT_MANUAL_APPROVAL_WORKFLOW_CODE);
    return row.versionId;
  }
}

function toDto(row: AdjustmentProposal): AdjustmentProposalDto {
  return {
    proposalId: row.id,
    personId: row.personId,
    enrolmentId: row.enrolmentId,
    adjustmentTypeCode: row.adjustmentTypeCode,
    scopeCode: row.scopeCode,
    amount: amountFromRow(row),
    validFrom: row.validFrom,
    validTo: row.validTo,
    manualReasonCode: row.manualReasonCode,
    externalReference: row.externalReference,
    statusCode: row.statusCode,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt,
    workflowInstanceId: row.workflowInstanceId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
    adjustmentId: row.adjustmentId,
  };
}
