import {
  ecDeterminations,
  exceptionalCircumstances,
  workflowDefinitionVersions,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
  type Db,
  type EcDetermination,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, eq } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import { GovernedReview } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { ValueSetService } from '../value-sets/service.js';

import type { ExceptionalCircumstancesService } from './ec-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const EC_DETERMINATION_WORKFLOW_CODE = 'ec-determination';
const DECISION_STEP_KEY = 'decide-ec-outcome';

/**
 * Exceptional-circumstances determinations (Phase 5 D-41, BP-04-005). An
 * outcome is proposed with a reason and decided, through a governed review,
 * by someone who neither proposed it nor recorded the claim. Until it is
 * upheld the EC keeps its outcome, so a board pack never reads a proposal.
 */
export class EcDeterminationService {
  constructor(
    private readonly db: Db,
    private readonly ecs: ExceptionalCircumstancesService,
    private readonly valueSets: ValueSetService,
    private readonly workflowBridge: WorkflowBridgeService,
    private readonly reviewExecution?: ReviewExecutionService,
  ) {}

  readonly #review = (): GovernedReview => new GovernedReview(this.workflowBridge, this.reviewExecution, {
    workflowCode: EC_DETERMINATION_WORKFLOW_CODE,
    stepKey: DECISION_STEP_KEY,
    gatewayKey: 'G01',
    outcomeStepKey: 'determination-closed',
    assigneeRoleCode: 'registry-administrator',
    subjectEntityType: 'exceptional_circumstances',
    effectDecisionCodes: ['upheld', 'not-upheld'],
  });

  registerWorkflowEffects(activities: ReviewActivitiesService): void {
    this.#review().register(activities, async (input) => {
      const determinationId = input.context['determinationId'] as string;
      await this.#apply(input.tenantId, determinationId, input.decisionCode as 'upheld' | 'not-upheld', input.actorId, input.reason);
      return { determinationId };
    });
  }

  async propose(tenantId: string, ecId: string, input: { outcomeCode: string; reason: string }, actorId: string): Promise<EcDetermination> {
    const ec = await this.ecs.getCurrent(ecId, tenantId);
    if (!(await this.valueSets.validateFieldValue('exceptional_circumstances', 'outcome_code', input.outcomeCode, tenantId))) {
      throw new ValidationError(`Unknown EC outcome '${input.outcomeCode}'`);
    }
    if (input.outcomeCode === ec.outcomeCode) throw new ConflictError(`This EC's outcome is already '${ec.outcomeCode}'`);
    if (!input.reason.trim()) throw new ValidationError('A proposed outcome needs a reason');
    // Whoever recorded the claim: the actor on its first version.
    const [first] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ actorId: exceptionalCircumstances.actorId }).from(exceptionalCircumstances)
      .where(and(eq(exceptionalCircumstances.tenantId, tenantId as Uuid), eq(exceptionalCircumstances.id, ecId as Uuid)))
      .orderBy(asc(exceptionalCircumstances.recordedAt)).limit(1));

    let created: EcDetermination;
    try {
      [created] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(ecDeterminations).values({
        tenantId: tenantId as Uuid, exceptionalCircumstancesId: ecId as Uuid, proposedOutcomeCode: input.outcomeCode,
        reason: input.reason.trim(), proposedBy: actorId, recordedBy: first?.actorId ?? ec.actorId,
      }).returning()) as [EcDetermination];
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('This EC already has a determination awaiting a decision');
      throw err;
    }
    const started = await this.#review().start(tenantId, {
      workflowDefinitionVersionId: await this.#activeVersionId(tenantId),
      subjectEntityId: ecId,
      startedBy: actorId,
      context: { determinationId: created.id, exceptionalCircumstancesId: ecId, proposedOutcomeCode: input.outcomeCode, proposedBy: actorId, recordedBy: created.recordedBy },
    });
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(ecDeterminations)
      .set({ workflowInstanceId: started.workflowInstanceId }).where(eq(ecDeterminations.id, created.id)).returning());
    return row!;
  }

  async decide(tenantId: string, determinationId: string, decision: 'upheld' | 'not-upheld', actorId: string, reason?: string): Promise<EcDetermination & { decisionStatus: 'applied' | 'pending' }> {
    const det = await this.#get(tenantId, determinationId);
    if (det.statusCode !== 'proposed') throw new ConflictError(`This determination is already ${det.statusCode}`);
    this.#assertIndependent(det, actorId);
    if (!det.workflowInstanceId) throw new ConflictError('This determination has no review');
    const [instance] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(workflowInstances).where(and(
      eq(workflowInstances.tenantId, tenantId as Uuid), eq(workflowInstances.id, det.workflowInstanceId!), eq(workflowInstances.workflowCode, EC_DETERMINATION_WORKFLOW_CODE),
    )).limit(1));
    if (!instance) throw new NotFoundError('WorkflowInstance', det.workflowInstanceId);
    const [task] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: workflowTasks.id }).from(workflowTasks).where(and(
      eq(workflowTasks.tenantId, tenantId as Uuid), eq(workflowTasks.workflowInstanceId, instance.id), eq(workflowTasks.stepKey, DECISION_STEP_KEY),
    )).limit(1));
    const result = await this.#review().decide(tenantId, {
      instance, legacyTaskId: task?.id ?? null, decisionCode: decision, actorId, ...(reason ? { reason } : {}),
      metadata: { determinationId },
      effect: async (input) => {
        await this.#apply(tenantId, determinationId, decision, input.actorId, reason);
        return { determinationId };
      },
    });
    return { ...(await this.#get(tenantId, determinationId)), decisionStatus: result.status };
  }

  async list(tenantId: string, filter: { statusCode?: string; ecId?: string } = {}): Promise<EcDetermination[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(ecDeterminations).where(and(
      eq(ecDeterminations.tenantId, tenantId as Uuid),
      ...(filter.statusCode ? [eq(ecDeterminations.statusCode, filter.statusCode)] : []),
      ...(filter.ecId ? [eq(ecDeterminations.exceptionalCircumstancesId, filter.ecId as Uuid)] : []),
    )).orderBy(asc(ecDeterminations.proposedAt)));
  }

  /** Applies a decision; safe to repeat for one decision, as a retried activity does. */
  async #apply(tenantId: string, determinationId: string, decision: 'upheld' | 'not-upheld', actorId: string, reason?: string): Promise<void> {
    const det = await this.#get(tenantId, determinationId);
    if (det.statusCode === decision) return;
    if (det.statusCode !== 'proposed') throw new ConflictError(`This determination is already ${det.statusCode}`);
    try { this.#assertIndependent(det, actorId); } catch (err) { throw new ConflictError((err as Error).message); }
    if (decision === 'upheld') await this.ecs.applyDeterminedOutcome(det.exceptionalCircumstancesId, tenantId, det.proposedOutcomeCode, actorId);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(ecDeterminations).set({
      statusCode: decision, decidedBy: actorId, decidedAt: clockNow(), decisionReason: reason ?? null,
    }).where(and(eq(ecDeterminations.id, det.id), eq(ecDeterminations.statusCode, 'proposed'))));
  }

  #assertIndependent(det: EcDetermination, actorId: string): void {
    if (det.proposedBy === actorId) throw new ForbiddenError('The person who proposed an EC outcome cannot decide it');
    if (det.recordedBy === actorId) throw new ForbiddenError('The person who recorded the claim cannot decide its outcome');
  }

  async #get(tenantId: string, id: string): Promise<EcDetermination> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(ecDeterminations)
      .where(and(eq(ecDeterminations.tenantId, tenantId as Uuid), eq(ecDeterminations.id, id as Uuid))).limit(1));
    if (!row) throw new NotFoundError('EcDetermination', id);
    return row;
  }

  async #activeVersionId(tenantId: string): Promise<string> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ versionId: workflowDefinitionVersions.id })
      .from(workflowDefinitions)
      .innerJoin(workflowDefinitionVersions, and(
        eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
        eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
      ))
      .where(and(eq(workflowDefinitions.definitionCode, EC_DETERMINATION_WORKFLOW_CODE), eq(workflowDefinitions.statusCode, 'active'), eq(workflowDefinitionVersions.statusCode, 'active')))
      .limit(1));
    if (!row) throw new NotFoundError('WorkflowDefinition', EC_DETERMINATION_WORKFLOW_CODE);
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
