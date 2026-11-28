import {
  adjustmentWithdrawals,
  workflowDefinitionVersions,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
  type AdjustmentWithdrawal,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, eq, sql } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import { GovernedReview } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { ValueSetService } from '../value-sets/service.js';

import { SeparationOfDutiesError, type ProposalActor, type ProposalDecisionCode } from './adjustment-proposal-service.js';
import { CASE_WITHDRAWAL_REASONS, type AdjustmentService, type CaseWithdrawalReason } from './adjustment-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const ADJUSTMENT_WITHDRAWAL_WORKFLOW_CODE = 'adjustment-withdrawal-approval';
const DECISION_STEP_KEY = 'decide-withdrawal';

export interface ProposeWithdrawalInput {
  withdrawalReasonCode: string;
  externalReference: string;
  replacementAdjustmentId?: string;
}

export interface AdjustmentWithdrawalDto {
  withdrawalId: string;
  adjustmentId: string;
  personId: string;
  withdrawalReasonCode: string;
  externalReference: string;
  replacementAdjustmentId: string | null;
  statusCode: string;
  proposedBy: string;
  proposedAt: Date;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  withdrawnAt: Date | null;
}

/** What the approval needs after the adjustment ends: take it off exam entries not yet sat. */
export interface ExamEntryWithdrawer {
  applyExamWithdrawals(tenantId: string): Promise<unknown>;
}

/**
 * Withdrawal proposals (ADR-034 item 5, BL-408). A manual, migrated or legacy
 * adjustment is ended early only when an adjustment approver who neither
 * proposed it nor is its subject approves, through a governed review. Until
 * then the adjustment is unchanged. There is no feature flag: migrated
 * adjustments exist in tenants that leave manual proposals off.
 */
export class AdjustmentWithdrawalService {
  constructor(
    private readonly db: Db,
    private readonly adjustments: AdjustmentService,
    private readonly valueSets: ValueSetService,
    private readonly workflowBridge: WorkflowBridgeService,
    private readonly examEntries: ExamEntryWithdrawer | undefined,
    private readonly reviewExecution?: ReviewExecutionService,
    private readonly log?: { warn: (obj: unknown, msg: string) => void },
  ) {}

  readonly #review = (): GovernedReview => new GovernedReview(this.workflowBridge, this.reviewExecution, {
    workflowCode: ADJUSTMENT_WITHDRAWAL_WORKFLOW_CODE,
    stepKey: DECISION_STEP_KEY,
    gatewayKey: 'G01',
    outcomeStepKey: 'withdrawal-closed',
    assigneeRoleCode: 'adjustment-approver',
    subjectEntityType: 'adjustment_withdrawal',
    effectDecisionCodes: ['approved', 'rejected'],
  });

  registerWorkflowEffects(activities: ReviewActivitiesService): void {
    this.#review().register(activities, async (input) => {
      const withdrawalId = input.context['withdrawalId'] as string;
      return this.#applyDecision(input.tenantId, withdrawalId, input.decisionCode as ProposalDecisionCode, { sub: input.actorId }, input.reason);
    });
  }

  async propose(tenantId: string, personId: string, adjustmentId: string, input: ProposeWithdrawalInput, actor: ProposalActor): Promise<AdjustmentWithdrawalDto> {
    if (actor.srsPersonId && actor.srsPersonId === personId) {
      throw new SeparationOfDutiesError('You cannot propose withdrawing an adjustment from your own record');
    }
    const reason = input.withdrawalReasonCode;
    if (!(CASE_WITHDRAWAL_REASONS as readonly string[]).includes(reason)
      || (await this.valueSets.validateFieldValue('adjustment_withdrawal', 'withdrawal_reason_code', reason, tenantId)) !== true) {
      throw new ValidationError(`'${reason}' is not a reason a withdrawal proposal may give`, [{ field: 'withdrawalReasonCode', message: 'One of student-request, no-longer-needed, recorded-in-error, superseded' }]);
    }
    if ((reason === 'superseded') !== Boolean(input.replacementAdjustmentId)) {
      throw new ValidationError('superseded names its replacement, and only superseded does', [{ field: 'replacementAdjustmentId', message: 'Required with superseded, refused otherwise' }]);
    }
    const externalReference = input.externalReference.trim();
    if (externalReference.length < 1 || externalReference.length > 100) {
      throw new ValidationError('externalReference must be 1 to 100 characters', [{ field: 'externalReference', message: 'Where the evidence is held, for example the student\'s written request' }]);
    }
    await this.adjustments.prepareWithdrawal(tenantId, personId, adjustmentId, input.replacementAdjustmentId);

    let created: AdjustmentWithdrawal;
    try {
      [created] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(adjustmentWithdrawals).values({
        tenantId: tenantId as Uuid, adjustmentId: adjustmentId as Uuid, personId: personId as Uuid,
        withdrawalReasonCode: reason, externalReference,
        replacementAdjustmentId: (input.replacementAdjustmentId ?? null) as Uuid | null,
        proposedBy: actor.sub, proposedByPersonId: (actor.srsPersonId ?? null) as Uuid | null,
      }).returning()) as [AdjustmentWithdrawal];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('This adjustment already has a withdrawal awaiting a decision');
      throw err;
    }
    const started = await this.#review().start(tenantId, {
      workflowDefinitionVersionId: await this.#activeVersionId(tenantId),
      subjectEntityId: created.id,
      startedBy: actor.sub,
      // Identifiers only: the task payload is visible on the workflow screens.
      context: { withdrawalId: created.id, adjustmentId, personId, proposedBy: actor.sub },
    });
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(adjustmentWithdrawals)
      .set({ workflowInstanceId: started.workflowInstanceId }).where(eq(adjustmentWithdrawals.id, created.id)).returning());
    return toDto(row!);
  }

  async decide(
    tenantId: string,
    withdrawalId: string,
    decision: ProposalDecisionCode,
    actor: ProposalActor,
    reason?: string,
  ): Promise<AdjustmentWithdrawalDto & { decisionStatus: 'applied' | 'pending' }> {
    const withdrawal = await this.#get(tenantId, withdrawalId);
    if (withdrawal.statusCode !== 'proposed') throw new ConflictError(`This withdrawal is already ${withdrawal.statusCode}`);
    this.#assertIndependent(withdrawal, actor);
    const trimmedReason = reason?.trim() || undefined;
    if (decision === 'rejected' && !trimmedReason) {
      throw new ValidationError('A rejection needs a reason', [{ field: 'reason', message: 'Say why the withdrawal is rejected' }]);
    }
    if (!withdrawal.workflowInstanceId) throw new ConflictError('This withdrawal has no review');
    const [instance] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(workflowInstances).where(and(
      eq(workflowInstances.tenantId, tenantId as Uuid), eq(workflowInstances.id, withdrawal.workflowInstanceId!),
      eq(workflowInstances.workflowCode, ADJUSTMENT_WITHDRAWAL_WORKFLOW_CODE),
    )).limit(1));
    if (!instance) throw new NotFoundError('WorkflowInstance', withdrawal.workflowInstanceId);
    const [task] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: workflowTasks.id }).from(workflowTasks).where(and(
      eq(workflowTasks.tenantId, tenantId as Uuid), eq(workflowTasks.workflowInstanceId, instance.id), eq(workflowTasks.stepKey, DECISION_STEP_KEY),
    )).limit(1));

    const result = await this.#review().decide(tenantId, {
      instance, legacyTaskId: task?.id ?? null, decisionCode: decision, actorId: actor.sub,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
      metadata: { withdrawalId },
      effect: () => this.#applyDecision(tenantId, withdrawalId, decision, actor, trimmedReason),
    });
    return { ...toDto(await this.#get(tenantId, withdrawalId)), decisionStatus: result.status };
  }

  async list(tenantId: string, filter: { statusCode?: string; personId?: string; limit?: number; offset?: number } = {}): Promise<AdjustmentWithdrawalDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(adjustmentWithdrawals).where(and(
      eq(adjustmentWithdrawals.tenantId, tenantId as Uuid),
      ...(filter.statusCode ? [eq(adjustmentWithdrawals.statusCode, filter.statusCode)] : []),
      ...(filter.personId ? [eq(adjustmentWithdrawals.personId, filter.personId as Uuid)] : []),
    )).orderBy(asc(adjustmentWithdrawals.proposedAt), asc(adjustmentWithdrawals.id)).limit(filter.limit ?? 50).offset(filter.offset ?? 0));
    return rows.map(toDto);
  }

  async get(tenantId: string, withdrawalId: string): Promise<AdjustmentWithdrawalDto> {
    return toDto(await this.#get(tenantId, withdrawalId));
  }

  /**
   * ADR-034 item 7 (BL-409): ends the current adjustments of every enrolment
   * whose current version is withdrawn or graduated and already in effect.
   * The authority is the latest transition to that status, itself the effect
   * of a governed decision. Idempotent: an ended adjustment is not found
   * again. A future-dated end waits until it takes effect; interruption and
   * suspension never end adjustments. Runs in the worker loop (the
   * guarantee) and after a terminal transition (for latency).
   */
  async withdrawForEndedEnrolments(tenantId: string): Promise<{ withdrawn: number; skipped: number }> {
    const due = await withTenantContext(this.db, tenantId, (tx) => tx.execute(sql`
      SELECT ra.id::text AS adjustment_id,
             (SELECT t.id::text FROM enrolment_status_transition t
               WHERE t.tenant_id = e.tenant_id AND t.enrolment_id = e.id AND t.to_status_code = e.status_code
               ORDER BY t.effective_at DESC, t.created_at DESC LIMIT 1) AS transition_id
      FROM reasonable_adjustment ra
      JOIN enrolment e ON e.tenant_id = ra.tenant_id AND e.id = ra.enrolment_id AND e.recorded_until IS NULL
      WHERE ra.tenant_id = ${tenantId}::uuid AND ra.recorded_until IS NULL
        AND (ra.valid_to IS NULL OR ra.valid_to > now())
        AND e.status_code IN ('withdrawn', 'graduated') AND e.valid_from <= now()`)) as unknown as Array<{ adjustment_id: string; transition_id: string | null }>;

    let withdrawn = 0; let skipped = 0;
    for (const row of due) {
      if (!row.transition_id) {
        // No recorded transition to name as the authority (an enrolment loaded
        // directly in that status): left for a person to resolve.
        this.log?.warn({ adjustmentId: row.adjustment_id }, 'Enrolment ended with no recorded transition; adjustment not withdrawn');
        skipped += 1;
        continue;
      }
      const result = await this.adjustments.withdrawAuthorisedAdjustment(tenantId, row.adjustment_id,
        { kind: 'enrolment-ended', enrolmentStatusTransitionId: row.transition_id },
        { actorId: 'system:enrolment-ended', actorType: 'system' });
      if (result.changed) withdrawn += 1;
    }
    if (withdrawn > 0) {
      try {
        await this.examEntries?.applyExamWithdrawals(tenantId);
      } catch (err) {
        this.log?.warn({ err }, 'Exam entry withdrawal deferred to the reconcile loop');
      }
    }
    return { withdrawn, skipped };
  }

  /** The review's effect for either decision; safe to repeat, as a retried activity does. */
  async #applyDecision(tenantId: string, withdrawalId: string, decision: ProposalDecisionCode, actor: ProposalActor, reason?: string): Promise<Record<string, unknown>> {
    const withdrawal = await this.#get(tenantId, withdrawalId);
    if (withdrawal.statusCode === decision) return { withdrawalId };
    if (withdrawal.statusCode !== 'proposed') throw new ConflictError(`This withdrawal is already ${withdrawal.statusCode}`);
    this.#assertIndependent(withdrawal, actor);
    const decided = { decidedBy: actor.sub, decidedByPersonId: (actor.srsPersonId ?? null) as Uuid | null, decidedAt: clockNow() };

    if (decision === 'rejected') {
      if (!reason) throw new ValidationError('A rejection needs a reason');
      await withTenantContext(this.db, tenantId, (tx) => tx.update(adjustmentWithdrawals)
        .set({ statusCode: 'rejected', decisionReason: reason, ...decided })
        .where(and(eq(adjustmentWithdrawals.id, withdrawal.id), eq(adjustmentWithdrawals.statusCode, 'proposed'))));
      return { withdrawalId };
    }

    // The adjustment ends and the withdrawal is marked in one transaction. If it
    // had already ended, the withdrawal is still approved, with no withdrawn_at.
    const result = await this.adjustments.withdrawAuthorisedAdjustment(tenantId, withdrawal.adjustmentId, {
      kind: 'approved-withdrawal', withdrawalId, reasonCode: withdrawal.withdrawalReasonCode as CaseWithdrawalReason,
      ...(withdrawal.replacementAdjustmentId ? { replacementAdjustmentId: withdrawal.replacementAdjustmentId } : {}),
    }, { actorId: actor.sub, actorType: 'user' }, async (tx, outcome) => {
      const updated = await tx.update(adjustmentWithdrawals).set({
        statusCode: 'approved', ...decided, withdrawnAt: outcome.changed ? outcome.validTo : null,
      }).where(and(eq(adjustmentWithdrawals.id, withdrawal.id), eq(adjustmentWithdrawals.statusCode, 'proposed'))).returning({ id: adjustmentWithdrawals.id });
      if (updated.length === 0) throw new ConflictError('This withdrawal was decided by someone else');
    });
    if (result.changed) {
      try {
        await this.examEntries?.applyExamWithdrawals(tenantId);
      } catch (err) {
        this.log?.warn({ err, adjustmentId: withdrawal.adjustmentId }, 'Exam entry withdrawal deferred to the reconcile loop');
      }
    }
    return { withdrawalId, adjustmentId: withdrawal.adjustmentId };
  }

  /** P-22: neither the proposer nor the student it is about may decide it. */
  #assertIndependent(withdrawal: AdjustmentWithdrawal, actor: ProposalActor): void {
    if (withdrawal.proposedBy === actor.sub
      || (actor.srsPersonId && withdrawal.proposedByPersonId && actor.srsPersonId === withdrawal.proposedByPersonId)) {
      throw new SeparationOfDutiesError('The person who proposed a withdrawal cannot decide it');
    }
    if (actor.srsPersonId && actor.srsPersonId === withdrawal.personId) {
      throw new SeparationOfDutiesError('You cannot decide a withdrawal from your own record');
    }
  }

  async #get(tenantId: string, id: string): Promise<AdjustmentWithdrawal> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(adjustmentWithdrawals)
      .where(and(eq(adjustmentWithdrawals.tenantId, tenantId as Uuid), eq(adjustmentWithdrawals.id, id as Uuid))).limit(1));
    if (!row) throw new NotFoundError('AdjustmentWithdrawal', id);
    return row;
  }

  async #activeVersionId(tenantId: string): Promise<string> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ versionId: workflowDefinitionVersions.id })
      .from(workflowDefinitions)
      .innerJoin(workflowDefinitionVersions, and(
        eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
        eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
      ))
      .where(and(eq(workflowDefinitions.definitionCode, ADJUSTMENT_WITHDRAWAL_WORKFLOW_CODE), eq(workflowDefinitions.statusCode, 'active'), eq(workflowDefinitionVersions.statusCode, 'active')))
      .limit(1));
    if (!row) throw new NotFoundError('WorkflowDefinition', ADJUSTMENT_WITHDRAWAL_WORKFLOW_CODE);
    return row.versionId;
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function toDto(row: AdjustmentWithdrawal): AdjustmentWithdrawalDto {
  return {
    withdrawalId: row.id,
    adjustmentId: row.adjustmentId,
    personId: row.personId,
    withdrawalReasonCode: row.withdrawalReasonCode,
    externalReference: row.externalReference,
    replacementAdjustmentId: row.replacementAdjustmentId,
    statusCode: row.statusCode,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt,
    workflowInstanceId: row.workflowInstanceId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
    withdrawnAt: row.withdrawnAt,
  };
}
