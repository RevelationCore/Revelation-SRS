import { createHash, createHmac, randomBytes } from 'node:crypto';

import {
  enrolments,
  moduleAllocationResults,
  moduleAllocationRuns,
  moduleOfferings,
  moduleRegistrations,
  moduleSelectionProposals,
  modules,
  tenants,
  type Db,
  type ModuleAllocationRun,
  withTenantContext,
  workflowDefinitionVersions,
  workflowDefinitions,
  workflowInstances,
  workflowTasks,
} from '@revelation-srs/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import { GovernedReview } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import type { TimetableService } from '../timetabling/timetable-service.js';
import { type ClashPolicy, clashBetween } from '../timetabling/clash-detector.js';

import type { ModuleSelectionService, ProposalItemDto } from './service.js';
import type { SelectionWindowService } from './window-service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const ALGORITHM_VERSION = 'rsd-1';

/** The governed review family a submitted run is approved through (D-30). */
export const ALLOCATION_REVIEW_WORKFLOW_CODE = 'module-allocation-run';
const ALLOCATION_DECISION_STEP_KEY = 'approve-or-reject-allocation';

export interface AllocationResultDto {
  proposalId: string;
  enrolmentId: string;
  orderPosition: number;
  tier: number;
  choiceSlot: number | null;
  outcomeCode: 'allocated' | 'unallocated' | 'fixed';
  allocatedItemId: string | null;
  moduleCode: string | null;
  reason: string | null;
}

export interface AllocationRunDto {
  allocationRunId: string;
  windowId: string;
  kindCode: 'main' | 'top-up';
  statusCode: string;
  algorithmVersion: string;
  priorityOrder: string[];
  inputsHash: string;
  summary: { proposals: number; fullyAllocated: number; partlyAllocated: number; compulsoryOverflow: Array<{ moduleCode: string; over: number }> };
  createdBy: string;
  createdAt: Date;
  submittedBy: string | null;
  approvedBy: string | null;
  appliedAt: Date | null;
  /** The run's approval review, once submitted. */
  workflowInstanceId: string | null;
  results?: AllocationResultDto[];
}

interface Candidate {
  proposalId: string;
  enrolmentId: string;
  programmeId: string | null;
  fheqLevel: number | null;
  items: ProposalItemDto[];
}

/**
 * Ranked preference allocation for oversubscribed offerings (Phase 4 D-30),
 * by random serial dictatorship (rsd-1). Students are ordered by priority
 * tier (by default a higher stage first), then by HMAC-SHA256 of the
 * window's seed and the proposal id, never by submission time. In that order
 * each student keeps their fixed items, and each choice slot gets the
 * highest-ranked alternative that has a place and does not introduce a
 * blocking clash, an exclusion or more credit than the first choice set.
 * Ranking honestly is each student's best strategy.
 *
 * Governance: a holder of module-selection:allocate previews runs (every
 * preview is kept) and submits one, which starts a governed review
 * (module-allocation-run, on Temporal when the tenant's rollout selects it).
 * A holder of module-selection:decide who neither ran nor submitted it
 * approves, and approval applies it, but only while the inputs are
 * unchanged; otherwise the review stays open and can be rejected. The seed is fixed per window at its first
 * preview, so re-running cannot reshuffle the order.
 */
export class AllocationService {
  constructor(
    private readonly db: Db,
    private readonly selection: ModuleSelectionService,
    private readonly windows: SelectionWindowService,
    private readonly timetables: TimetableService,
    private readonly workflowBridge: WorkflowBridgeService,
    private readonly reviewExecution?: ReviewExecutionService,
    private readonly onApplied?: (tenantId: string, academicPeriodId: string) => Promise<void>,
  ) {}

  readonly #review = (): GovernedReview => new GovernedReview(this.workflowBridge, this.reviewExecution, {
    workflowCode: ALLOCATION_REVIEW_WORKFLOW_CODE,
    stepKey: ALLOCATION_DECISION_STEP_KEY,
    gatewayKey: 'G01',
    outcomeStepKey: 'run-closed',
    assigneeRoleCode: 'programme-approver',
    subjectEntityType: 'module_allocation_run',
    effectDecisionCodes: ['approved', 'rejected'],
  });

  /** On Temporal-run reviews the worker applies the decision to the run before the review closes. */
  registerWorkflowEffects(activities: ReviewActivitiesService): void {
    this.#review().register(activities, async (input) => {
      const runId = input.context['allocationRunId'] as string;
      await this.#applyDecision(input.tenantId, runId, input.decisionCode as 'approved' | 'rejected', input.actorId);
      return { allocationRunId: runId };
    });
  }

  async preview(tenantId: string, windowId: string, kind: 'main' | 'top-up', actorId: string): Promise<AllocationRunDto> {
    const window = await this.windows.getWindow(tenantId, windowId);
    if (window.allocationModeCode !== 'ranked') throw new ValidationError('This window allocates first come; there is nothing to run');
    const seed = await this.windows.seed(tenantId, windowId, () => randomBytes(32));
    const priorityOrder = await this.#priority(tenantId);
    const candidates = await this.#candidates(tenantId, window, kind);
    const capacity = await this.#remainingCapacity(tenantId, candidates);
    const inputsHash = this.#inputsHash(candidates, capacity);

    const tierOf = (c: Candidate) => (priorityOrder.includes('stage-descending') ? -(c.fheqLevel ?? 0) : 0);
    const draw = (c: Candidate) => createHmac('sha256', seed).update(c.proposalId).digest('hex');
    const ordered = [...candidates].sort((a, b) => tierOf(a) - tierOf(b) || draw(a).localeCompare(draw(b)));

    const remaining = new Map(capacity);
    const overflow = new Map<string, { moduleCode: string; over: number }>();
    const results: Array<Omit<AllocationResultDto, 'enrolmentId' | 'moduleCode'> & { moduleCode: string | null }> = [];
    let fully = 0;
    let partly = 0;
    const offeringIds = [...new Set(candidates.flatMap((c) => c.items.map((i) => i.moduleOfferingId).filter((o): o is string => Boolean(o))))];
    const timetables = await this.timetables.currentFor(tenantId, offeringIds);

    for (const [position, c] of ordered.entries()) {
      const tier = tierOf(c);
      const taken = (offeringId: string | null) => {
        if (!offeringId || !remaining.has(offeringId)) return;
        remaining.set(offeringId, remaining.get(offeringId)! - 1);
      };
      const fixed = c.items.filter((i) => i.choiceSlot === null);
      for (const f of fixed) {
        if (f.moduleOfferingId && remaining.has(f.moduleOfferingId) && remaining.get(f.moduleOfferingId)! <= 0) {
          const o = overflow.get(f.moduleOfferingId) ?? { moduleCode: f.moduleCode, over: 0 };
          o.over += 1;
          overflow.set(f.moduleOfferingId, o);
        }
        taken(f.moduleOfferingId);
        results.push({ proposalId: c.proposalId, orderPosition: position + 1, tier, choiceSlot: null, outcomeCode: 'fixed', allocatedItemId: f.proposalItemId, moduleCode: f.moduleCode, reason: null });
      }
      const policy = await this.selection.clashPolicyFor(tenantId, c.programmeId, c.enrolmentId);
      const chosen: ProposalItemDto[] = [...fixed];
      let unfilled = 0;
      for (const slot of [...new Set(c.items.filter((i) => i.choiceSlot !== null).map((i) => i.choiceSlot!))].sort((a, b) => a - b)) {
        const options = c.items.filter((i) => i.choiceSlot === slot).sort((a, b) => (a.preferenceRank ?? 1) - (b.preferenceRank ?? 1));
        let pick: ProposalItemDto | null = null;
        let lastReason = 'no alternative had a place';
        for (const o of options) {
          if (o.validationMessages.some((m) => m.message.startsWith('Alternative cannot be taken'))) { lastReason = `${o.moduleCode} cannot be taken`; continue; }
          if (o.moduleOfferingId && remaining.has(o.moduleOfferingId) && remaining.get(o.moduleOfferingId)! <= 0) { lastReason = `${o.moduleCode} is full`; continue; }
          const blocker = await this.#blocker(tenantId, o, chosen, policy, timetables, options[0]!.creditValue ?? 0);
          if (blocker) { lastReason = blocker; continue; }
          pick = o;
          break;
        }
        if (pick) {
          taken(pick.moduleOfferingId);
          chosen.push(pick);
          results.push({ proposalId: c.proposalId, orderPosition: position + 1, tier, choiceSlot: slot, outcomeCode: 'allocated', allocatedItemId: pick.proposalItemId, moduleCode: pick.moduleCode, reason: pick.preferenceRank && pick.preferenceRank > 1 ? `Choice ${pick.preferenceRank}` : 'First choice' });
        } else {
          unfilled += 1;
          results.push({ proposalId: c.proposalId, orderPosition: position + 1, tier, choiceSlot: slot, outcomeCode: 'unallocated', allocatedItemId: null, moduleCode: null, reason: lastReason });
        }
      }
      if (unfilled === 0) fully += 1; else partly += 1;
    }

    const summary = { proposals: candidates.length, fullyAllocated: fully, partlyAllocated: partly, compulsoryOverflow: [...overflow.values()] };
    const run = await withTenantContext(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(moduleAllocationRuns).values({
        tenantId: tenantId as Uuid, windowId: windowId as Uuid, kindCode: kind, statusCode: 'previewed', algorithmVersion: ALGORITHM_VERSION,
        priorityOrder, inputsHash, summary, createdBy: actorId,
      }).returning();
      if (results.length > 0) {
        await tx.insert(moduleAllocationResults).values(results.map((x) => ({
          tenantId: tenantId as Uuid, runId: r!.id, proposalId: x.proposalId as Uuid, choiceSlot: x.choiceSlot, allocatedItemId: (x.allocatedItemId ?? null) as Uuid | null,
          outcomeCode: x.outcomeCode, orderPosition: x.orderPosition, tier: x.tier, reason: x.moduleCode && x.reason ? `${x.moduleCode}: ${x.reason}` : x.reason,
        })));
      }
      return r!;
    });
    return this.getRun(tenantId, run.id, { withResults: true });
  }

  /**
   * Submits a preview for approval, starting its governed review. Only one
   * run per window may await a decision: reject it before submitting another.
   */
  async submit(tenantId: string, runId: string, actorId: string): Promise<AllocationRunDto> {
    const run = await this.#run(tenantId, runId);
    if (run.statusCode !== 'previewed') throw new ConflictError(`This run is ${run.statusCode}; only a preview can be submitted`);
    const [pending] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: moduleAllocationRuns.id }).from(moduleAllocationRuns).where(and(
      eq(moduleAllocationRuns.tenantId, tenantId as Uuid), eq(moduleAllocationRuns.windowId, run.windowId), eq(moduleAllocationRuns.statusCode, 'submitted'),
    )).limit(1));
    if (pending) throw new ConflictError('Another run for this window is awaiting approval; it must be decided first');

    const started = await this.#review().start(tenantId, {
      workflowDefinitionVersionId: await this.#activeVersionId(tenantId),
      subjectEntityId: run.id,
      startedBy: actorId,
      context: { allocationRunId: run.id, windowId: run.windowId, createdBy: run.createdBy, submittedBy: actorId, summary: run.summary },
    });
    await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleAllocationRuns)
      .set({ statusCode: 'submitted', submittedBy: actorId, workflowInstanceId: started.workflowInstanceId })
      .where(eq(moduleAllocationRuns.id, run.id)));
    return this.getRun(tenantId, runId);
  }

  /**
   * A second person approves (and so applies) or rejects a submitted run,
   * through its governed review. On Temporal the decision may still be
   * applying when this returns ('pending').
   */
  async decide(tenantId: string, runId: string, decision: 'approved' | 'rejected', actorId: string): Promise<
    AllocationRunDto & ({ decisionStatus: 'applied' } | { decisionStatus: 'pending'; commandId: string })
  > {
    const run = await this.#run(tenantId, runId);
    if (run.statusCode !== 'submitted') throw new ConflictError(`This run is ${run.statusCode}; only a submitted run can be decided`);
    if (run.submittedBy === actorId || run.createdBy === actorId) throw new ForbiddenError('The person who ran or submitted an allocation cannot approve it');
    if (!run.workflowInstanceId) throw new ConflictError('This run has no approval review; submit it again');

    const [instance] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(workflowInstances).where(and(
      eq(workflowInstances.tenantId, tenantId as Uuid), eq(workflowInstances.id, run.workflowInstanceId!),
      eq(workflowInstances.workflowCode, ALLOCATION_REVIEW_WORKFLOW_CODE),
    )).limit(1));
    if (!instance) throw new NotFoundError('WorkflowInstance', run.workflowInstanceId);
    if (instance.statusCode !== 'running') throw new ConflictError(`This run's approval is ${instance.statusCode}`);
    const [task] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: workflowTasks.id }).from(workflowTasks).where(and(
      eq(workflowTasks.tenantId, tenantId as Uuid), eq(workflowTasks.workflowInstanceId, instance.id), eq(workflowTasks.stepKey, ALLOCATION_DECISION_STEP_KEY),
    )).limit(1));

    const result = await this.#review().decide(tenantId, {
      instance, legacyTaskId: task?.id ?? null, decisionCode: decision, actorId,
      metadata: { allocationRunId: run.id },
      effect: async (input) => {
        await this.#applyDecision(tenantId, run.id, decision, input.actorId);
        return { allocationRunId: run.id };
      },
    });
    const current = await this.getRun(tenantId, runId, { withResults: true });
    return result.status === 'pending'
      ? { ...current, decisionStatus: 'pending', commandId: result.commandId }
      : { ...current, decisionStatus: 'applied' };
  }

  /**
   * Applies a decision to a run. Safe to repeat for one decision, as a
   * retried Temporal activity does: a rejected run stays rejected, and an
   * approval interrupted part way through resumes with the proposals it had
   * not yet confirmed or returned. Throws ConflictError, which keeps the
   * review open, when the decider ran or submitted the run, or when its
   * inputs have changed.
   */
  async #applyDecision(tenantId: string, runId: string, decision: 'approved' | 'rejected', actorId: string): Promise<void> {
    const run = await this.#run(tenantId, runId);
    if (run.submittedBy === actorId || run.createdBy === actorId) throw new ConflictError('The person who ran or submitted an allocation cannot approve it');
    if (decision === 'rejected') {
      if (run.statusCode === 'rejected') return;
      if (run.statusCode !== 'submitted') throw new ConflictError(`This run is ${run.statusCode}; only a submitted run can be rejected`);
      await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleAllocationRuns).set({ statusCode: 'rejected', approvedBy: actorId }).where(eq(moduleAllocationRuns.id, run.id)));
      return;
    }

    const window = await this.windows.getWindow(tenantId, run.windowId);
    const results = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleAllocationResults)
      .where(and(eq(moduleAllocationResults.tenantId, tenantId as Uuid), eq(moduleAllocationResults.runId, run.id))));
    let candidates: Candidate[];
    let appliedAt: Date;
    if (run.statusCode === 'applied') {
      // A retry: carry on with the proposals this run covers.
      appliedAt = run.appliedAt ?? clockNow();
      candidates = await this.#candidatesFromResults(tenantId, results);
    } else {
      if (run.statusCode !== 'submitted') throw new ConflictError(`This run is ${run.statusCode}; only a submitted run can be approved`);
      candidates = await this.#candidates(tenantId, window, run.kindCode as 'main' | 'top-up');
      const capacity = await this.#remainingCapacity(tenantId, candidates);
      if (this.#inputsHash(candidates, capacity) !== run.inputsHash) {
        throw new ConflictError('Selections or places have changed since this run was previewed; preview again');
      }
      appliedAt = clockNow();
      // Mark applied first, so the proposals' effective choices read this run's results.
      await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleAllocationRuns)
        .set({ statusCode: 'applied', approvedBy: actorId, appliedAt }).where(eq(moduleAllocationRuns.id, run.id)));
    }

    const holdUntil = window.resubmissionClosesAt ?? window.closesAt;
    const offerings = await this.#offeringsWithPlaces(tenantId, candidates);
    for (const c of candidates) {
      const proposal = await this.selection.getProposal(c.proposalId, tenantId);
      if (!proposal || proposal.statusCode === 'confirmed') continue;
      if (proposal.statusCode === 'returned' && proposal.decisionAuthorityCode === 'allocation' && proposal.decidedAt && proposal.decidedAt >= appliedAt) continue;
      const mine = results.filter((r) => r.proposalId === c.proposalId);
      const unfilled = mine.filter((r) => r.outcomeCode === 'unallocated');
      if (unfilled.length === 0) {
        await this.selection.confirmAfterAllocation(tenantId, c.proposalId, actorId);
      } else {
        const held = mine.filter((r) => r.allocatedItemId && r.outcomeCode !== 'unallocated').map((r) => r.allocatedItemId!);
        const reason = `Allocation could not fill ${unfilled.length} choice${unfilled.length > 1 ? 's' : ''} (${unfilled.map((u) => `choice ${u.choiceSlot}: ${u.reason}`).join('; ')}). `
          + `Your other places are held until ${holdUntil.toISOString().slice(0, 10)}. ${offerings.length > 0 ? `Offerings with places: ${offerings.join(', ')}.` : ''}`;
        await this.selection.returnAfterAllocation(tenantId, c.proposalId, reason.trim(), held, holdUntil);
      }
    }
    await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleAllocationRuns).set({ statusCode: 'superseded' }).where(and(
      eq(moduleAllocationRuns.tenantId, tenantId as Uuid), eq(moduleAllocationRuns.windowId, run.windowId), eq(moduleAllocationRuns.statusCode, 'previewed'),
    )));
    if (this.onApplied) await this.onApplied(tenantId, window.academicPeriodId).catch(() => undefined);
  }

  async listRuns(tenantId: string, windowId: string): Promise<AllocationRunDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleAllocationRuns)
      .where(and(eq(moduleAllocationRuns.tenantId, tenantId as Uuid), eq(moduleAllocationRuns.windowId, windowId as Uuid))).orderBy(asc(moduleAllocationRuns.createdAt)));
    return rows.map((r) => runDto(r));
  }

  async getRun(tenantId: string, runId: string, opts: { withResults?: boolean } = {}): Promise<AllocationRunDto> {
    const run = await this.#run(tenantId, runId);
    if (!opts.withResults) return runDto(run);
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ r: moduleAllocationResults, enrolmentId: moduleSelectionProposals.enrolmentId })
      .from(moduleAllocationResults)
      .innerJoin(moduleSelectionProposals, and(eq(moduleSelectionProposals.id, moduleAllocationResults.proposalId), isNull(moduleSelectionProposals.recordedUntil)))
      .where(and(eq(moduleAllocationResults.tenantId, tenantId as Uuid), eq(moduleAllocationResults.runId, run.id)))
      .orderBy(asc(moduleAllocationResults.orderPosition), asc(moduleAllocationResults.choiceSlot)));
    return {
      ...runDto(run),
      results: rows.map(({ r, enrolmentId }) => ({
        proposalId: r.proposalId, enrolmentId, orderPosition: r.orderPosition, tier: r.tier, choiceSlot: r.choiceSlot,
        outcomeCode: r.outcomeCode as AllocationResultDto['outcomeCode'], allocatedItemId: r.allocatedItemId,
        moduleCode: r.reason?.split(':')[0] ?? null, reason: r.reason,
      })),
    };
  }

  /** A student's own outcome and order position in the latest applied run (D-30: on request). */
  async outcomeFor(tenantId: string, proposalId: string): Promise<{ allocationRunId: string; orderPosition: number; results: AllocationResultDto[] } | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ r: moduleAllocationResults, run: moduleAllocationRuns }).from(moduleAllocationResults)
      .innerJoin(moduleAllocationRuns, eq(moduleAllocationRuns.id, moduleAllocationResults.runId))
      .where(and(eq(moduleAllocationResults.tenantId, tenantId as Uuid), eq(moduleAllocationResults.proposalId, proposalId as Uuid), eq(moduleAllocationRuns.statusCode, 'applied'))));
    if (rows.length === 0) return null;
    const latest = rows.reduce((a, b) => ((b.run.appliedAt?.getTime() ?? 0) > (a.run.appliedAt?.getTime() ?? 0) ? b : a)).run;
    const mine = rows.filter((x) => x.run.id === latest.id).map((x) => x.r);
    return {
      allocationRunId: latest.id, orderPosition: mine[0]!.orderPosition,
      results: mine.map((r) => ({ proposalId, enrolmentId: '', orderPosition: r.orderPosition, tier: r.tier, choiceSlot: r.choiceSlot, outcomeCode: r.outcomeCode as AllocationResultDto['outcomeCode'], allocatedItemId: r.allocatedItemId, moduleCode: r.reason?.split(':')[0] ?? null, reason: r.reason })),
    };
  }

  async #run(tenantId: string, runId: string): Promise<ModuleAllocationRun> {
    const [run] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleAllocationRuns)
      .where(and(eq(moduleAllocationRuns.tenantId, tenantId as Uuid), eq(moduleAllocationRuns.id, runId as Uuid))).limit(1));
    if (!run) throw new NotFoundError('ModuleAllocationRun', runId);
    return run;
  }

  /** The proposals a run's results cover, for resuming an interrupted application. */
  async #candidatesFromResults(tenantId: string, results: Array<{ proposalId: string }>): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const proposalId of [...new Set(results.map((r) => r.proposalId))]) {
      const p = await this.selection.getProposal(proposalId, tenantId);
      if (!p) continue;
      out.push({ proposalId, enrolmentId: p.enrolmentId, programmeId: null, fheqLevel: p.fheqLevel, items: await this.selection.itemsFor(tenantId, proposalId) });
    }
    return out;
  }

  async #activeVersionId(tenantId: string): Promise<string> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ versionId: workflowDefinitionVersions.id })
      .from(workflowDefinitions)
      .innerJoin(workflowDefinitionVersions, and(
        eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
        eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
      ))
      .where(and(
        eq(workflowDefinitions.definitionCode, ALLOCATION_REVIEW_WORKFLOW_CODE),
        eq(workflowDefinitions.statusCode, 'active'), eq(workflowDefinitionVersions.statusCode, 'active'),
      ))
      .limit(1));
    if (!row) throw new NotFoundError('WorkflowDefinition', ALLOCATION_REVIEW_WORKFLOW_CODE);
    return row.versionId;
  }

  async #priority(tenantId: string): Promise<string[]> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const alloc = ((row?.configuration?.['moduleSelection'] ?? {}) as Record<string, unknown>)['allocation'] as Record<string, unknown> | undefined;
    const p = alloc?.['priority'];
    return Array.isArray(p) && p.every((x) => typeof x === 'string') ? [...(p), 'random'] : ['stage-descending', 'random'];
  }

  /**
   * The proposals the run covers: those awaiting allocation that this window
   * applies to (main), or those a run returned with an unfilled slot (top-up).
   */
  async #candidates(tenantId: string, window: { id: string; academicPeriodId: string; programmeId: string | null; fheqLevel: number | null }, kind: 'main' | 'top-up'): Promise<Candidate[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ p: moduleSelectionProposals, programmeId: enrolments.programmeId })
      .from(moduleSelectionProposals)
      .innerJoin(enrolments, and(eq(enrolments.id, moduleSelectionProposals.enrolmentId), isNull(enrolments.recordedUntil)))
      .where(and(
        eq(moduleSelectionProposals.tenantId, tenantId as Uuid), isNull(moduleSelectionProposals.recordedUntil),
        eq(moduleSelectionProposals.academicPeriodId, window.academicPeriodId as Uuid),
        kind === 'main' ? eq(moduleSelectionProposals.statusCode, 'awaiting-allocation') : and(eq(moduleSelectionProposals.statusCode, 'returned'), eq(moduleSelectionProposals.decisionAuthorityCode, 'allocation')),
      ))
      .orderBy(asc(moduleSelectionProposals.id)));
    const out: Candidate[] = [];
    for (const { p, programmeId } of rows) {
      const applies = await this.windows.resolve(tenantId, { academicPeriodId: p.academicPeriodId, programmeId, fheqLevel: p.fheqLevel });
      if (applies?.id !== window.id) continue;
      out.push({ proposalId: p.id, enrolmentId: p.enrolmentId, programmeId, fheqLevel: p.fheqLevel, items: await this.selection.itemsFor(tenantId, p.id) });
    }
    return out;
  }

  /** Capacity left per offering: capacity minus registrations and places held for proposals the run does not cover. */
  async #remainingCapacity(tenantId: string, candidates: Candidate[]): Promise<Map<string, number>> {
    const ids = [...new Set(candidates.flatMap((c) => c.items.map((i) => i.moduleOfferingId).filter((o): o is string => Boolean(o))))];
    const map = new Map<string, number>();
    if (ids.length === 0) return map;
    const covered = new Set(candidates.map((c) => c.proposalId));
    const [offerings, regs] = await withTenantContext(this.db, tenantId, async (tx) => [
      await tx.select({ id: moduleOfferings.id, capacity: moduleOfferings.capacity }).from(moduleOfferings).where(and(eq(moduleOfferings.tenantId, tenantId as Uuid), inArray(moduleOfferings.id, ids as Uuid[]))),
      await tx.select({ offeringId: moduleRegistrations.moduleOfferingId }).from(moduleRegistrations).where(and(
        eq(moduleRegistrations.tenantId, tenantId as Uuid), inArray(moduleRegistrations.moduleOfferingId, ids as Uuid[]),
        eq(moduleRegistrations.statusCode, 'registered'), isNull(moduleRegistrations.recordedUntil),
      )),
    ] as const);
    const held = new Map<string, number>();
    for (const id of ids) {
      // Held places of proposals this run re-allocates (top-up) are theirs, not someone else's.
      const all = await this.selection.heldPlaces(tenantId, [id]);
      let mineHeld = 0;
      for (const c of candidates) mineHeld += c.items.filter((i) => i.moduleOfferingId === id && i.heldUntil && i.heldUntil > clockNow() && covered.has(c.proposalId)).length;
      held.set(id, (all.get(id) ?? 0) - mineHeld);
    }
    for (const o of offerings) {
      if (o.capacity === null) continue;
      map.set(o.id, o.capacity - regs.filter((r) => r.offeringId === o.id).length - (held.get(o.id) ?? 0));
    }
    return map;
  }

  #inputsHash(candidates: Candidate[], capacity: Map<string, number>): string {
    const canonical = {
      proposals: candidates.map((c) => ({
        id: c.proposalId, level: c.fheqLevel,
        items: c.items.map((i) => [i.proposalItemId, i.moduleOfferingId, i.choiceSlot, i.preferenceRank, i.heldUntil?.toISOString() ?? null]).sort(),
      })).sort((a, b) => a.id.localeCompare(b.id)),
      capacity: [...capacity.entries()].sort(),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /** Why an alternative cannot join what is already chosen: a blocking clash, an exclusion, or more credit than the first-choice set. */
  async #blocker(
    tenantId: string,
    option: ProposalItemDto,
    chosen: ProposalItemDto[],
    policy: ClashPolicy,
    timetables: Awaited<ReturnType<TimetableService['currentFor']>>,
    slotFirstCredit: number,
  ): Promise<string | null> {
    if (chosen.some((c) => c.moduleId === option.moduleId)) return `${option.moduleCode} is already chosen`;
    for (const c of chosen) {
      if (await this.selection.excludes(tenantId, option.moduleId, c.moduleId)) return `${option.moduleCode} cannot be taken with ${c.moduleCode}`;
      if (policy.policy === 'blocking' && option.moduleOfferingId && c.moduleOfferingId) {
        const a = timetables.get(option.moduleOfferingId);
        const b = timetables.get(c.moduleOfferingId);
        if (a && b && clashBetween(a, b, policy)) return `${option.moduleCode} clashes with ${c.moduleCode}`;
      }
    }
    // The first-choice set passed every credit rule; an alternative carrying more credit than its slot's first choice could break one.
    if ((option.creditValue ?? 0) > slotFirstCredit) return `${option.moduleCode} carries more credit than the first choice it replaces`;
    return null;
  }

  async #offeringsWithPlaces(tenantId: string, candidates: Candidate[]): Promise<string[]> {
    const capacity = await this.#remainingCapacity(tenantId, candidates);
    const ids = [...capacity.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    if (ids.length === 0) return [];
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ code: modules.code }).from(moduleOfferings)
      .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
      .where(and(eq(moduleOfferings.tenantId, tenantId as Uuid), inArray(moduleOfferings.id, ids as Uuid[]))));
    return rows.map((r) => r.code).sort();
  }
}

function runDto(r: ModuleAllocationRun): AllocationRunDto {
  return {
    allocationRunId: r.id, windowId: r.windowId, kindCode: r.kindCode as 'main' | 'top-up', statusCode: r.statusCode, algorithmVersion: r.algorithmVersion,
    priorityOrder: r.priorityOrder, inputsHash: r.inputsHash, summary: (r.summary ?? { proposals: 0, fullyAllocated: 0, partlyAllocated: 0, compulsoryOverflow: [] }) as AllocationRunDto['summary'],
    createdBy: r.createdBy, createdAt: r.createdAt, submittedBy: r.submittedBy, approvedBy: r.approvedBy, appliedAt: r.appliedAt,
    workflowInstanceId: r.workflowInstanceId,
  };
}
