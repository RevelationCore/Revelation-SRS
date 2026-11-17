import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  enrolmentCurriculumBindings,
  enrolments,
  moduleGroupMembers,
  moduleGroups,
  moduleOfferings,
  moduleRegistrations as moduleRegistrationRows,
  moduleRelationships,
  modules,
  moduleSelectionProposalItems,
  moduleSelectionProposals,
  programmeRoutes,
  programmeRuleSets,
  reassessmentPlans,
  moduleAllocationResults,
  moduleAllocationRuns,
  workflowDefinitions,
  workflowDefinitionVersions,
  academicPeriods,
  workflowInstances,
  workflowTasks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  ConflictError,
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type {
  EnrolmentModuleSelectionProposalDecidedV1Payload,
  EnrolmentModuleSelectionProposalSubmittedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { WorkflowBridgeService } from '../platform-controls/workflow-bridge-service.js';
import { GovernedReview, deterministicUuid } from '../platform-controls/governed-review.js';
import type { ReviewActivitiesService } from '../platform-controls/review-activities.js';
import type { ReviewExecutionService } from '../platform-controls/review-execution-service.js';
import { approvedExemptionsFor } from '../curriculum/academic-exception-service.js';
import type { ModuleRegistrationService } from '../registration/service.js';
import type { RulesEngine } from '../rules-engine/engine.js';
import type { SelectionWindowService } from './window-service.js';
import { type JointHonoursRule, evaluateJointHonours } from './joint-honours.js';
import type { TimetableService } from '../timetabling/timetable-service.js';
import { DEFAULT_CLASH_POLICY, clashBetween, clashPolicyFrom, describeClash } from '../timetabling/clash-detector.js';
import { DEFAULT_REPEAT_RULE, type RepeatRule, failedModuleIds, groupMembership, repeatRequirements, repeatRuleFrom } from './repeat-requirements.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const APPROVAL_WORKFLOW_CODE = 'module-selection-approval';
const APPROVAL_DECISION_STEP_KEY = 'approve-or-reject-selection';
const APPROVAL_GATEWAY_KEY = 'G01';

export type ProposalStatusCode =
  | 'draft' | 'submitted' | 'validated' | 'approved'
  | 'returned' | 'waitlisted' | 'rejected' | 'confirmed' | 'awaiting-allocation';

export interface CreateProposalInput {
  enrolmentId: string;
  academicPeriodId: string;
  fheqLevel: number;
}

export interface AddProposalItemInput {
  moduleId: string;
  moduleOfferingId?: string;
  preferenceRank?: number;
  sourceCode?: 'student-choice' | 'staff-assisted';
  /** Items sharing a slot are ranked alternatives for one place (D-30). */
  choiceSlot?: number;
  /** A repeat plan this item satisfies as a replacement module (D-28). */
  replacesReassessmentPlanId?: string;
}

export interface LateSubmission {
  reasonCode: string;
  note: string;
}

export interface ValidationMessage {
  ruleTypeCode: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ProposalItemDto {
  proposalItemId: string;
  moduleId: string;
  moduleCode: string;
  moduleTitle: string;
  creditValue: number | null;
  fheqLevel: number | null;
  moduleOfferingId: string | null;
  preferenceRank: number | null;
  choiceSlot: number | null;
  reassessmentPlanId: string | null;
  isReplacement: boolean;
  heldUntil: Date | null;
  sourceCode: string;
  validationStateCode: string;
  validationMessages: ValidationMessage[];
}

export interface ProposalDto {
  moduleSelectionProposalId: string;
  enrolmentId: string;
  academicPeriodId: string;
  programmeRuleSetId: string;
  statusCode: string;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionAuthorityCode: string | null;
  decisionReason: string | null;
  workflowInstanceId: string | null;
  fheqLevel: number | null;
  lateSubmissionReasonCode: string | null;
  lateSubmittedBy: string | null;
  items: ProposalItemDto[];
}

interface CurrentEnrolment {
  enrolmentId: string;
  personId: string;
  programmeId: string | null;
  modeOfStudyCode: string;
  studyIntensityPercent: number | null;
}

export interface CurriculumBindingDto {
  enrolmentCurriculumBindingId: string;
  enrolmentId: string;
  programmeRouteId: string | null;
  programmeRuleSetId: string;
  decisionAuthorityCode: string;
  decisionReason: string | null;
  changeReasonCode: string | null;
}

export interface CreateModuleGroupInput {
  programmeRuleSetId: string;
  fheqLevel?: number;
  groupCode: string;
  title: string;
  groupTypeCode: 'compulsory' | 'optional-pool' | 'elective-pool';
  minModules?: number;
  maxModules?: number;
  minCredits?: number;
  maxCredits?: number;
  minFheqLevel?: number;
  maxFheqLevel?: number;
}

export interface ModuleGroupMemberDto {
  moduleGroupMemberId: string;
  moduleId: string;
  moduleCode: string;
  moduleTitle: string;
  isDefault: boolean;
  isNonCondonable: boolean;
}

export interface ModuleGroupDto {
  moduleGroupId: string;
  programmeRuleSetId: string;
  fheqLevel: number | null;
  groupCode: string;
  title: string;
  groupTypeCode: string;
  minModules: number | null;
  maxModules: number | null;
  minCredits: number | null;
  maxCredits: number | null;
  minFheqLevel: number | null;
  maxFheqLevel: number | null;
  members: ModuleGroupMemberDto[];
}

/**
 * Validates and confirms module selection proposals against a programme's
 * diet groups and configured credit/level rules, per BP-03-003/BP-03-004.
 *
 * See docs/architecture/module-selection-rules.md.
 */
export class ModuleSelectionService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly rules: RulesEngine,
    private readonly workflowBridge: WorkflowBridgeService,
    private readonly moduleRegistrations: ModuleRegistrationService,
    private readonly windows: SelectionWindowService,
    private readonly timetables: TimetableService,
    private readonly reviewExecution?: ReviewExecutionService,
  ) {}

  readonly #approvalReview = (): GovernedReview => new GovernedReview(this.workflowBridge, this.reviewExecution, {
    workflowCode: APPROVAL_WORKFLOW_CODE,
    stepKey: APPROVAL_DECISION_STEP_KEY,
    gatewayKey: APPROVAL_GATEWAY_KEY,
    outcomeStepKey: 'proposal-closed',
    assigneeRoleCode: 'programme-approver',
    subjectEntityType: 'module_selection_proposal',
    effectDecisionCodes: ['approved', 'rejected', 'returned'],
  });

  /** On Temporal-run approvals the worker applies the decision to the proposal before the review closes. */
  registerWorkflowEffects(activities: ReviewActivitiesService): void {
    this.#approvalReview().register(activities, async (input) => {
      const proposalId = input.context['moduleSelectionProposalId'] as string;
      await this.#applyProposalDecision(
        input.tenantId, proposalId, input.decisionCode as 'approved' | 'rejected' | 'returned', input.actorId, input.reason ?? '',
      );
      return { moduleSelectionProposalId: proposalId };
    });
  }

  // ── Proposal lifecycle ───────────────────────────────────────────────────────

  async createProposal(
    tenantId: string,
    input: CreateProposalInput,
    actorId: string,
  ): Promise<string> {
    const enrolment = await this.#getCurrentEnrolment(input.enrolmentId, tenantId);
    const programmeRuleSetId = await this.#resolveCurriculumBinding(tenantId, enrolment, actorId);

    const proposalId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moduleSelectionProposals).values({
        versionId:          randomUUID(),
        id:                 proposalId,
        tenantId:           tenantId as Uuid,
        enrolmentId:        input.enrolmentId as Uuid,
        academicPeriodId:   input.academicPeriodId as Uuid,
        programmeRuleSetId: programmeRuleSetId as Uuid,
        fheqLevel:          input.fheqLevel,
        statusCode:         'draft',
        validFrom:          now,
        validTo:            null,
        recordedAt:         now,
        recordedUntil:      null,
      });
    });

    await this.#populateCompulsoryItems(tenantId, proposalId, programmeRuleSetId, input.academicPeriodId, input.fheqLevel, input.enrolmentId);
    await this.#populateRepeatItems(tenantId, proposalId, enrolment, input.academicPeriodId);

    return proposalId;
  }

  async addItem(
    tenantId: string,
    proposalId: string,
    input: AddProposalItemInput,
  ): Promise<string> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    this.#ensureEditable(proposal.statusCode);
    if (input.replacesReassessmentPlanId) {
      const [plan] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: reassessmentPlans.id }).from(reassessmentPlans).where(and(
        eq(reassessmentPlans.tenantId, tenantId as Uuid), eq(reassessmentPlans.id, input.replacesReassessmentPlanId as Uuid),
        eq(reassessmentPlans.enrolmentId, proposal.enrolmentId as Uuid),
      )).limit(1));
      if (!plan) throw new NotFoundError('ReassessmentPlan', input.replacesReassessmentPlanId);
    }

    const itemId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moduleSelectionProposalItems).values({
        id:                  itemId,
        tenantId:            tenantId as Uuid,
        proposalId:          proposalId as Uuid,
        moduleId:            input.moduleId as Uuid,
        moduleOfferingId:    input.moduleOfferingId ? (input.moduleOfferingId as Uuid) : null,
        preferenceRank:      input.preferenceRank ?? null,
        choiceSlot:          input.choiceSlot ?? null,
        reassessmentPlanId:  (input.replacesReassessmentPlanId ?? null) as Uuid | null,
        isReplacement:       Boolean(input.replacesReassessmentPlanId),
        sourceCode:          input.sourceCode ?? 'student-choice',
        validationStateCode: 'pending',
        createdAt:           now,
        updatedAt:           now,
      });
    });
    return itemId;
  }

  async removeItem(tenantId: string, proposalId: string, proposalItemId: string): Promise<void> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    this.#ensureEditable(proposal.statusCode);

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.delete(moduleSelectionProposalItems).where(
        and(
          eq(moduleSelectionProposalItems.id, proposalItemId as Uuid),
          eq(moduleSelectionProposalItems.proposalId, proposalId as Uuid),
          eq(moduleSelectionProposalItems.tenantId, tenantId as Uuid),
        ),
      );
    });
  }

  async getProposal(proposalId: string, tenantId: string): Promise<ProposalDto | null> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId).catch(() => null);
    if (!proposal) return null;
    const items = await this.#listItems(tenantId, proposalId);
    return proposalToDto(proposal, items);
  }

  async listProposals(
    tenantId: string,
    opts: { enrolmentId?: string; statusCode?: string } = {},
  ): Promise<ProposalDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleSelectionProposals).where(
        and(
          eq(moduleSelectionProposals.tenantId, tenantId as Uuid),
          isNull(moduleSelectionProposals.recordedUntil),
          ...(opts.enrolmentId ? [eq(moduleSelectionProposals.enrolmentId, opts.enrolmentId as Uuid)] : []),
          ...(opts.statusCode ? [eq(moduleSelectionProposals.statusCode, opts.statusCode)] : []),
        ),
      ),
    );
    const results: ProposalDto[] = [];
    for (const row of rows) {
      const items = await this.#listItems(tenantId, row.id);
      results.push(proposalToDto(row, items));
    }
    return results;
  }

  /**
   * Submits a proposal for validation. Fully valid proposals with capacity
   * available are confirmed automatically (BP-03-004 A4). A capacity conflict
   * alone routes to a programme approver via the workflow bridge (A5). Any
   * rule failure returns the proposal to the student with itemised reasons (E2).
   */
  async submitProposal(tenantId: string, proposalId: string, actorId: string, late?: LateSubmission): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (proposal.statusCode !== 'draft' && proposal.statusCode !== 'returned') {
      throw new ValidationError(`Cannot submit a proposal in status '${proposal.statusCode}'`);
    }

    const enrolment = await this.#getCurrentEnrolment(proposal.enrolmentId, tenantId);

    // Selection window (D-29): checked at submission; a returned proposal may be resubmitted until resubmission closes.
    const windowCheck = await this.windows.check(tenantId, {
      academicPeriodId: proposal.academicPeriodId, programmeId: enrolment.programmeId, fheqLevel: proposal.fheqLevel,
    }, { resubmission: proposal.statusCode === 'returned' });
    if (!windowCheck.open && !late) {
      throw new ValidationError(windowCheck.message ?? 'Module selection is closed', [{ field: 'proposalId', message: 'Staff may submit late with a reason' }]);
    }
    const lateFields = !windowCheck.open && late
      ? { lateSubmissionReasonCode: late.reasonCode, lateSubmissionNote: late.note, lateSubmittedBy: actorId }
      : {};
    const items = await this.#listItems(tenantId, proposalId);
    if (items.length === 0) {
      throw new ValidationError('Cannot submit a proposal with no module choices');
    }

    const now = clockNow();
    // Ranked allocation (D-30): inside an open ranked window whose main allocation has not run, a valid
    // selection waits for allocation instead of taking places first come. A resubmission after allocation,
    // or a late submission, is first come against the remaining places.
    const returnedByAllocation = proposal.statusCode === 'returned' && proposal.decisionAuthorityCode === 'allocation';
    const ranked = windowCheck.open && windowCheck.window?.allocationModeCode === 'ranked' && !returnedByAllocation
      && !(await this.#allocationApplied(tenantId, windowCheck.window.id));
    await this.#transitionProposal(proposal, tenantId, { statusCode: 'submitted', submittedAt: now, ...lateFields }, now);

    // Validate the set made of fixed items and each slot's first (or allocated) choice; alternatives are checked on their own.
    const effective = await this.#effectiveItems(tenantId, proposalId, items);
    const validation = await this.#validateSelection(tenantId, proposal, enrolment, effective);
    for (const [itemId, ms] of await this.#checkAlternatives(tenantId, proposal.enrolmentId, items, effective)) validation.itemMessages.set(itemId, ms);
    await this.#persistItemValidation(tenantId, validation.itemMessages);

    if (this.eventBus.isConnected()) {
      const payload: EnrolmentModuleSelectionProposalSubmittedV1Payload = {
        enrolmentId: proposal.enrolmentId,
        moduleSelectionProposalId: proposalId,
        academicPeriodId: proposal.academicPeriodId,
        statusCode: 'submitted',
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENROLMENT_MODULE_SELECTION_PROPOSAL_SUBMITTED, '1.0.0', tenantId, actorId, 'personal', payload,
      );
    }

    const updated = await this.#getCurrentProposalRow(proposalId, tenantId);

    if (validation.errors.length > 0) {
      await this.#transitionProposal(updated, tenantId, {
        statusCode: 'returned',
        decisionAuthorityCode: 'automatic',
        decisionReason: validation.errors.map((m) => m.message).join('; '),
        decidedAt: clockNow(),
      }, clockNow());
      return (await this.getProposal(proposalId, tenantId))!;
    }

    if (ranked) {
      await this.#transitionProposal(updated, tenantId, { statusCode: 'awaiting-allocation' }, clockNow());
      return (await this.getProposal(proposalId, tenantId))!;
    }

    if (validation.capacityConflict) {
      const workflowInstanceId = await this.#startApprovalWorkflow(tenantId, updated, actorId, 'Capacity oversubscribed — awaiting approver allocation decision');
      await this.#transitionProposal(updated, tenantId, {
        statusCode: 'waitlisted',
        workflowInstanceId,
      }, clockNow());
      return (await this.getProposal(proposalId, tenantId))!;
    }

    // Fully valid: confirm automatically (A4).
    const validated = await this.#getCurrentProposalRow(proposalId, tenantId);
    await this.#transitionProposal(validated, tenantId, {
      statusCode: 'validated',
      decisionAuthorityCode: 'automatic',
      decidedAt: clockNow(),
    }, clockNow());
    try {
      return await this.#confirmProposal(tenantId, proposalId, actorId, { enforceCapacity: true });
    } catch (err) {
      // The last place went to a concurrent confirmation: route for allocation instead.
      if (!(err instanceof ConflictError) || !/capacity/.test(err.message)) throw err;
      const current = await this.#getCurrentProposalRow(proposalId, tenantId);
      const workflowInstanceId = await this.#startApprovalWorkflow(tenantId, current, actorId, 'Capacity reached while confirming — awaiting approver allocation decision');
      await this.#transitionProposal(current, tenantId, { statusCode: 'waitlisted', workflowInstanceId }, clockNow());
      return (await this.getProposal(proposalId, tenantId))!;
    }
  }

  /**
   * Validates a proposal without changing it (D-25; BP-03-003 step 4), so a
   * student sees rule failures, clashes and warnings while still choosing.
   */
  async previewValidation(tenantId: string, proposalId: string): Promise<{ valid: boolean; capacityConflict: boolean; messages: Array<ValidationMessage & { proposalItemId: string | null }> }> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    const enrolment = await this.#getCurrentEnrolment(proposal.enrolmentId, tenantId);
    const items = await this.#listItems(tenantId, proposalId);
    const effective = await this.#effectiveItems(tenantId, proposalId, items);
    const v = await this.#validateSelection(tenantId, proposal, enrolment, effective);
    for (const [itemId, ms] of await this.#checkAlternatives(tenantId, proposal.enrolmentId, items, effective)) v.itemMessages.set(itemId, ms);
    const itemLevel = [...v.itemMessages.entries()].flatMap(([proposalItemId, ms]) => ms.map((m) => ({ ...m, proposalItemId })));
    const seen = new Set(itemLevel.map((m) => m.message));
    const overall = v.errors.filter((e) => !seen.has(e.message)).map((m) => ({ ...m, proposalItemId: null }));
    return { valid: v.errors.length === 0, capacityConflict: v.capacityConflict, messages: [...overall, ...itemLevel] };
  }

  /**
   * Records a human decision on a waitlisted or returned proposal
   * (BP-03-004 A5/A5b). Completes the associated workflow task/instance when
   * one exists.
   */
  async decideProposal(
    tenantId: string,
    proposalId: string,
    decisionCode: 'approved' | 'rejected' | 'returned',
    actorId: string,
    reason: string,
  ): Promise<ProposalDto & { decisionStatus: 'applied' } | ProposalDto & { decisionStatus: 'pending'; commandId: string }> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (proposal.statusCode !== 'waitlisted' && proposal.statusCode !== 'submitted') {
      throw new ValidationError(`Cannot decide a proposal in status '${proposal.statusCode}'`);
    }

    if (!proposal.workflowInstanceId) {
      const decided = await this.#applyProposalDecision(tenantId, proposalId, decisionCode, actorId, reason);
      return { ...decided, decisionStatus: 'applied' };
    }

    const instance = await this.#getApprovalInstance(tenantId, proposal.workflowInstanceId);
    if (instance.statusCode !== 'running') {
      throw new ValidationError(`Cannot decide a proposal whose approval is '${instance.statusCode}'`);
    }
    const task = await this.#findApprovalTask(tenantId, proposal.workflowInstanceId);
    const result = await this.#approvalReview().decide(tenantId, {
      instance, legacyTaskId: task?.id ?? null, decisionCode, actorId, reason,
      metadata: { moduleSelectionProposalId: proposalId },
      effect: async (input) => {
        await this.#applyProposalDecision(tenantId, proposalId, decisionCode, input.actorId, reason);
        return { moduleSelectionProposalId: proposalId };
      },
    });
    const current = (await this.getProposal(proposalId, tenantId))!;
    return result.status === 'pending'
      ? { ...current, decisionStatus: 'pending', commandId: result.commandId }
      : { ...current, decisionStatus: 'applied' };
  }

  /**
   * Applies a human decision to a proposal (BP-03-004 A5/A5b). Safe to
   * repeat: a proposal already in the decided state is left as it is, and an
   * approval interrupted before confirmation resumes at confirmation.
   */
  async #applyProposalDecision(
    tenantId: string,
    proposalId: string,
    decisionCode: 'approved' | 'rejected' | 'returned',
    actorId: string,
    reason: string,
  ): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (decisionCode === 'approved' && proposal.statusCode === 'confirmed') return (await this.getProposal(proposalId, tenantId))!;
    if (decisionCode === 'approved' && proposal.statusCode === 'approved') return this.#confirmProposal(tenantId, proposalId, actorId);
    if (decisionCode !== 'approved' && proposal.statusCode === decisionCode) return (await this.getProposal(proposalId, tenantId))!;
    if (proposal.statusCode !== 'waitlisted' && proposal.statusCode !== 'submitted') {
      throw new ValidationError(`Cannot decide a proposal in status '${proposal.statusCode}'`);
    }

    if (this.eventBus.isConnected()) {
      const payload: EnrolmentModuleSelectionProposalDecidedV1Payload = {
        enrolmentId: proposal.enrolmentId,
        moduleSelectionProposalId: proposalId,
        statusCode: decisionCode,
        decisionAuthorityCode: 'registry-administrator',
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENROLMENT_MODULE_SELECTION_PROPOSAL_DECIDED, '1.0.0', tenantId, actorId, 'personal', payload,
      );
    }

    if (decisionCode === 'approved') {
      await this.#transitionProposal(proposal, tenantId, {
        statusCode: 'approved',
        decisionAuthorityCode: 'registry-administrator',
        decisionReason: reason,
        decidedAt: clockNow(),
      }, clockNow());
      return this.#confirmProposal(tenantId, proposalId, actorId);
    }

    await this.#transitionProposal(proposal, tenantId, {
      statusCode: decisionCode,
      decisionAuthorityCode: 'registry-administrator',
      decisionReason: reason,
      decidedAt: clockNow(),
    }, clockNow());
    return (await this.getProposal(proposalId, tenantId))!;
  }

  async #getApprovalInstance(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.id, workflowInstanceId as Uuid),
        eq(workflowInstances.tenantId, tenantId as Uuid),
        eq(workflowInstances.workflowCode, APPROVAL_WORKFLOW_CODE),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowInstance', workflowInstanceId);
    return rows[0];
  }

  // ── Curriculum binding administration ────────────────────────────────────────

  async getCurriculumBinding(tenantId: string, enrolmentId: string): Promise<CurriculumBindingDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(enrolmentCurriculumBindings).where(
        and(
          eq(enrolmentCurriculumBindings.enrolmentId, enrolmentId as Uuid),
          eq(enrolmentCurriculumBindings.tenantId, tenantId as Uuid),
          isNull(enrolmentCurriculumBindings.recordedUntil),
        ),
      ).limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      enrolmentCurriculumBindingId: row.id,
      enrolmentId: row.enrolmentId,
      programmeRouteId: row.programmeRouteId,
      programmeRuleSetId: row.programmeRuleSetId,
      decisionAuthorityCode: row.decisionAuthorityCode,
      decisionReason: row.decisionReason,
      changeReasonCode: row.changeReasonCode,
    };
  }

  /** Creates or overrides the route/rule-set binding for an enrolment (BP-03-002 main flow / A5). */
  async setCurriculumBinding(
    tenantId: string,
    enrolmentId: string,
    input: {
      programmeRouteId?: string | null;
      programmeRuleSetId: string;
      decisionAuthorityCode: 'automatic' | 'registry-administrator' | 'academic-approver';
      decisionReason?: string;
      changeReasonCode?: string;
      validFrom?: Date;
    },
  ): Promise<string> {
    const now = clockNow();
    // One transaction: an enrolment is never left without a current binding (D-11).
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [existing] = await tx.select({ id: enrolmentCurriculumBindings.id }).from(enrolmentCurriculumBindings).where(and(
        eq(enrolmentCurriculumBindings.enrolmentId, enrolmentId as Uuid),
        eq(enrolmentCurriculumBindings.tenantId, tenantId as Uuid),
        isNull(enrolmentCurriculumBindings.recordedUntil),
      )).limit(1);
      if (existing) {
        await tx.update(enrolmentCurriculumBindings).set({ recordedUntil: now }).where(and(
          eq(enrolmentCurriculumBindings.id, existing.id as Uuid),
          eq(enrolmentCurriculumBindings.tenantId, tenantId as Uuid),
          isNull(enrolmentCurriculumBindings.recordedUntil),
        ));
      }
      const bindingId = existing?.id ?? randomUUID();
      await tx.insert(enrolmentCurriculumBindings).values({
        versionId:             randomUUID(),
        id:                    bindingId as Uuid,
        tenantId:              tenantId as Uuid,
        enrolmentId:           enrolmentId as Uuid,
        programmeRouteId:      (input.programmeRouteId ?? null) as Uuid | null,
        programmeRuleSetId:    input.programmeRuleSetId as Uuid,
        decisionAuthorityCode: input.decisionAuthorityCode,
        decisionReason:        input.decisionReason ?? null,
        changeReasonCode:      input.changeReasonCode ?? null,
        validFrom:             input.validFrom ?? now,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
      return bindingId;
    });
  }

  // ── Programme rule set administration ────────────────────────────────────────
  // programme_rule_set existed only as an empty, named placeholder prior to this
  // feature (see docs/architecture/module-selection-rules.md); this is its first
  // CRUD surface, kept alongside the module-diet/proposal API that gives it content.

  async createProgrammeRuleSet(tenantId: string, input: {
    programmeId: string;
    programmeRouteId?: string;
    entryAcademicYear?: string;
    ruleSetCode: string;
    description?: string;
  }): Promise<string> {
    const ruleSetId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(programmeRuleSets).values({
        versionId:          randomUUID(),
        id:                 ruleSetId,
        tenantId:           tenantId as Uuid,
        programmeId:        input.programmeId as Uuid,
        programmeRouteId:   (input.programmeRouteId ?? null) as Uuid | null,
        entryAcademicYear:  input.entryAcademicYear ?? null,
        ruleSetCode:        input.ruleSetCode,
        description:        input.description ?? null,
        validFrom:          now,
        validTo:            null,
        recordedAt:         now,
        recordedUntil:      null,
      });
    });
    return ruleSetId;
  }

  async listProgrammeRuleSets(tenantId: string, programmeId: string): Promise<Array<{
    programmeRuleSetId: string;
    programmeId: string;
    programmeRouteId: string | null;
    entryAcademicYear: string | null;
    ruleSetCode: string;
    description: string | null;
  }>> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(programmeRuleSets).where(
        and(
          eq(programmeRuleSets.programmeId, programmeId as Uuid),
          eq(programmeRuleSets.tenantId, tenantId as Uuid),
          isNull(programmeRuleSets.recordedUntil),
        ),
      ),
    );
    return rows.map((r) => ({
      programmeRuleSetId: r.id,
      programmeId: r.programmeId,
      programmeRouteId: r.programmeRouteId,
      entryAcademicYear: r.entryAcademicYear,
      ruleSetCode: r.ruleSetCode,
      description: r.description,
    }));
  }

  // ── Module diet group administration ─────────────────────────────────────────

  async createModuleGroup(tenantId: string, input: CreateModuleGroupInput): Promise<string> {
    const groupId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moduleGroups).values({
        versionId:           randomUUID(),
        id:                  groupId,
        tenantId:            tenantId as Uuid,
        programmeRuleSetId:  input.programmeRuleSetId as Uuid,
        fheqLevel:           input.fheqLevel ?? null,
        groupCode:           input.groupCode,
        title:               input.title,
        groupTypeCode:       input.groupTypeCode,
        minModules:          input.minModules ?? null,
        maxModules:          input.maxModules ?? null,
        minCredits:          input.minCredits ?? null,
        maxCredits:          input.maxCredits ?? null,
        minFheqLevel:        input.minFheqLevel ?? null,
        maxFheqLevel:        input.maxFheqLevel ?? null,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });
    });
    return groupId;
  }

  async addModuleGroupMember(
    tenantId: string,
    moduleGroupId: string,
    input: { moduleId: string; isDefault?: boolean; isNonCondonable?: boolean; countsTowardsSubjectAreaCode?: string },
  ): Promise<string> {
    const memberId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(moduleGroupMembers).values({
        versionId:        randomUUID(),
        id:               memberId,
        tenantId:         tenantId as Uuid,
        moduleGroupId:    moduleGroupId as Uuid,
        moduleId:         input.moduleId as Uuid,
        isDefault:        input.isDefault ?? false,
        isNonCondonable:  input.isNonCondonable ?? false,
        countsTowardsSubjectAreaCode: input.countsTowardsSubjectAreaCode ?? null,
        validFrom:        now,
        validTo:          null,
        recordedAt:       now,
        recordedUntil:    null,
      });
    });
    return memberId;
  }

  async listModuleGroups(tenantId: string, programmeRuleSetId: string): Promise<ModuleGroupDto[]> {
    const groups = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleGroups).where(
        and(
          eq(moduleGroups.programmeRuleSetId, programmeRuleSetId as Uuid),
          eq(moduleGroups.tenantId, tenantId as Uuid),
          isNull(moduleGroups.recordedUntil),
        ),
      ),
    );

    const result: ModuleGroupDto[] = [];
    for (const group of groups) {
      const members = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select({
          member: moduleGroupMembers,
          moduleCode: modules.code,
          moduleTitle: modules.title,
        })
          .from(moduleGroupMembers)
          .innerJoin(modules, eq(moduleGroupMembers.moduleId, modules.id))
          .where(
            and(
              eq(moduleGroupMembers.moduleGroupId, group.id as Uuid),
              eq(moduleGroupMembers.tenantId, tenantId as Uuid),
              isNull(moduleGroupMembers.recordedUntil),
              isNull(modules.recordedUntil),
            ),
          ),
      );
      result.push({
        moduleGroupId: group.id,
        programmeRuleSetId: group.programmeRuleSetId,
        fheqLevel: group.fheqLevel,
        groupCode: group.groupCode,
        title: group.title,
        groupTypeCode: group.groupTypeCode,
        minModules: group.minModules,
        maxModules: group.maxModules,
        minCredits: group.minCredits,
        maxCredits: group.maxCredits,
        minFheqLevel: group.minFheqLevel,
        maxFheqLevel: group.maxFheqLevel,
        members: members.map((m) => ({
          moduleGroupMemberId: m.member.id,
          moduleId: m.member.moduleId,
          moduleCode: m.moduleCode,
          moduleTitle: m.moduleTitle,
          isDefault: m.member.isDefault,
          isNonCondonable: m.member.isNonCondonable,
        })),
      });
    }
    return result;
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  async #validateSelection(
    tenantId: string,
    proposal: typeof moduleSelectionProposals.$inferSelect,
    enrolment: CurrentEnrolment,
    items: ProposalItemDto[],
  ): Promise<{
    errors: ValidationMessage[];
    capacityConflict: boolean;
    itemMessages: Map<string, ValidationMessage[]>;
  }> {
    const itemMessages = new Map<string, ValidationMessage[]>();
    const errors: ValidationMessage[] = [];
    let capacityConflict = false;

    const pushItemMessage = (proposalItemId: string, msg: ValidationMessage) => {
      const list = itemMessages.get(proposalItemId) ?? [];
      list.push(msg);
      itemMessages.set(proposalItemId, list);
      if (msg.severity === 'error') errors.push(msg);
    };

    // Duplicate module check
    const seenModules = new Set<string>();
    for (const item of items) {
      if (seenModules.has(item.moduleId)) {
        pushItemMessage(item.proposalItemId, {
          ruleTypeCode: 'duplicate-module', severity: 'error',
          message: `Module ${item.moduleCode} is selected more than once in this proposal`,
        });
      }
      seenModules.add(item.moduleId);
    }

    // Prerequisite / co-requisite / exclusion (reuses catalogue relationships)
    for (const item of items) {
      const relMessages = await this.#checkRelationships(tenantId, proposal.enrolmentId, item, items);
      for (const m of relMessages) pushItemMessage(item.proposalItemId, m);
    }

    // Capacity per offering. A place held for this proposal by allocation is its own (D-30).
    const nowForHolds = clockNow();
    for (const item of items) {
      if (!item.moduleOfferingId) continue;
      if (item.heldUntil && item.heldUntil > nowForHolds) continue;
      const available = await this.#hasCapacity(tenantId, item.moduleOfferingId, proposal.id);
      if (!available) {
        capacityConflict = true;
        pushItemMessage(item.proposalItemId, {
          ruleTypeCode: 'capacity', severity: 'warning',
          message: `Module offering for ${item.moduleCode} has reached capacity — routed for allocation`,
        });
      }
    }

    // Approved exemptions count as taken for diet groups and the minimum credit load (BPR-D05).
    const exemptions = await approvedExemptionsFor(this.db, tenantId, enrolment.enrolmentId, await this.#academicYear(tenantId, proposal.academicPeriodId));
    const exemptCredits = exemptions.reduce((sum, e) => sum + e.creditValue, 0);

    // Diet group bounds
    const groupMessages = await this.#checkGroups(tenantId, proposal.programmeRuleSetId, items, exemptions);
    for (const [itemId, msgs] of groupMessages) {
      for (const m of msgs) pushItemMessage(itemId, m);
    }

    // Joint-honours balance (D-27): only when a rule is configured for the programme or route.
    const jhCtx = { tenantId, programmeId: enrolment.programmeId ?? '' };
    const routeCode = await this.#routeCode(tenantId, proposal.programmeRuleSetId);
    const { value: jhValue } = await this.rules.resolveForEnrolment(jhCtx, 'joint-honours-balance', enrolment.enrolmentId,
      () => this.rules.getOptionalRule<Record<string, unknown>>(jhCtx, 'joint-honours-balance', [...(routeCode ? [`route:${routeCode}`] : []), 'default']));
    if (jhValue) {
      const balance = await evaluateJointHonours(this.db, tenantId, {
        rule: jhValue as unknown as JointHonoursRule, enrolmentId: enrolment.enrolmentId, academicPeriodId: proposal.academicPeriodId,
        programmeRuleSetId: proposal.programmeRuleSetId, items, exemptions,
      });
      for (const m of balance) {
        const item = m.moduleId ? items.find((i) => i.moduleId === m.moduleId) : undefined;
        const msg = { ruleTypeCode: m.ruleTypeCode, severity: m.severity, message: m.message };
        if (item) pushItemMessage(item.proposalItemId, msg);
        else if (m.severity === 'error') errors.push(msg);
      }
    }

    const ruleCtx = { tenantId, programmeId: enrolment.programmeId ?? '' };

    // Timetable clashes (D-25): advisory warnings or blocking errors, by policy.
    for (const m of await this.#checkClashes(tenantId, proposal, enrolment, items, ruleCtx)) {
      pushItemMessage(m.proposalItemId, { ruleTypeCode: 'timetable-clash-policy', severity: m.severity, message: m.message });
    }

    // Repeat-module requirement (D-28): what the board requires the student to repeat.
    const repeat = await this.#checkRepeats(tenantId, proposal, enrolment, items, ruleCtx);
    for (const [itemId, msgs] of repeat.itemMessages) for (const m of msgs) pushItemMessage(itemId, m);
    errors.push(...repeat.errors);

    // Credit load requirement (mode-of-study aware). Repeat credit is left out when the rule says it does not count.
    const totalCredits = items.reduce((sum, i) => sum + (i.creditValue ?? 0), 0) - repeat.excludedCredits;
    // Each enrolment-scoped rule honours the student's approved rule exceptions.
    const { value: creditLoadValue } = await this.rules.resolveForEnrolment(ruleCtx, 'credit-load-requirement', enrolment.enrolmentId,
      () => this.rules.getCreditLoadRequirement(ruleCtx, enrolment.modeOfStudyCode, enrolment.studyIntensityPercent));
    const creditLoad = creditLoadValue
      ? { minCredits: (creditLoadValue.minCredits as number | null | undefined) ?? null, maxCredits: (creditLoadValue.maxCredits as number | null | undefined) ?? null }
      : null;
    if (creditLoad) {
      if (creditLoad.maxCredits !== null && totalCredits > creditLoad.maxCredits) {
        errors.push({
          ruleTypeCode: 'credit-load-requirement', severity: 'error',
          message: `Total selected credits (${totalCredits}) exceed the maximum of ${creditLoad.maxCredits} for ${enrolment.modeOfStudyCode} study`,
        });
      }
      if (creditLoad.minCredits !== null && totalCredits + exemptCredits < creditLoad.minCredits) {
        errors.push({
          ruleTypeCode: 'credit-load-requirement', severity: 'error',
          message: `Total selected credits (${totalCredits}${exemptCredits ? ` plus ${exemptCredits} exempt` : ''}) are below the minimum of ${creditLoad.minCredits} for ${enrolment.modeOfStudyCode} study`,
        });
      }
    }

    // Maximum credits per period (D-23): the proposal plus what is already registered in the period.
    const { value: maxValue, exception: maxException } = await this.rules.resolveForEnrolment(ruleCtx, 'max-credits-per-period', enrolment.enrolmentId, async () => {
      const max = await this.rules.getMaxCreditsPerPeriod(ruleCtx);
      return max === null ? null : { maxCredits: max };
    });
    const maxPerPeriod = (maxValue?.maxCredits as number | null | undefined) ?? null;
    if (maxPerPeriod !== null) {
      const alreadyRegistered = await this.moduleRegistrations.registeredCreditsForPeriod(tenantId, enrolment.enrolmentId, proposal.academicPeriodId);
      if (alreadyRegistered + totalCredits > maxPerPeriod) {
        errors.push({
          ruleTypeCode: 'max-credits-per-period', severity: 'error',
          message: `Selected credits (${totalCredits}${alreadyRegistered ? ` plus ${alreadyRegistered} already registered` : ''}) exceed the period maximum of ${maxPerPeriod}${maxException ? ' (as varied for this student)' : ''}`,
        });
      }
    }

    // Level credit requirement — minimum credits at the modal (most common) level in the selection
    const levelCounts = new Map<number, number>();
    for (const item of items) {
      if (item.fheqLevel === null) continue;
      levelCounts.set(item.fheqLevel, (levelCounts.get(item.fheqLevel) ?? 0) + (item.creditValue ?? 0));
    }
    if (levelCounts.size > 0) {
      const [modalLevel] = [...levelCounts.entries()].sort((a, b) => b[1] - a[1])[0]!;
      const { value: levelRule } = await this.rules.resolveForEnrolment(ruleCtx, 'level-credit-requirement', enrolment.enrolmentId, async () => {
        const min = await this.rules.getLevelCreditRequirement(ruleCtx, modalLevel);
        return min === null ? null : { minCreditsAtLevel: min };
      });
      const minAtLevel = (levelRule?.minCreditsAtLevel as number | null | undefined) ?? null;
      if (minAtLevel !== null && (levelCounts.get(modalLevel) ?? 0) < minAtLevel) {
        errors.push({
          ruleTypeCode: 'level-credit-requirement', severity: 'error',
          message: `Only ${levelCounts.get(modalLevel)} credits at level ${modalLevel} selected; a minimum of ${minAtLevel} is required`,
        });
      }

      const { value: adjacentRule } = await this.rules.resolveForEnrolment(ruleCtx, 'adjacent-level-credit-limit', enrolment.enrolmentId, async () => {
        const max = await this.rules.getAdjacentLevelCreditLimit(ruleCtx);
        return max === null ? null : { maxCredits: max };
      });
      const adjacentLimit = (adjacentRule?.maxCredits as number | null | undefined) ?? null;
      if (adjacentLimit !== null) {
        const adjacentCredits = [...levelCounts.entries()]
          .filter(([level]) => level !== modalLevel)
          .reduce((sum, [, credits]) => sum + credits, 0);
        if (adjacentCredits > adjacentLimit) {
          errors.push({
            ruleTypeCode: 'adjacent-level-credit-limit', severity: 'error',
            message: `${adjacentCredits} credits selected outside level ${modalLevel} exceed the trailing limit of ${adjacentLimit}`,
          });
        }
      }
    }

    return { errors, capacityConflict, itemMessages };
  }

  async #checkRelationships(
    tenantId: string,
    enrolmentId: string,
    item: ProposalItemDto,
    siblingItems: ProposalItemDto[],
  ): Promise<ValidationMessage[]> {
    const messages: ValidationMessage[] = [];
    const relationships = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleRelationships).where(
        and(
          eq(moduleRelationships.moduleId, item.moduleId as Uuid),
          eq(moduleRelationships.tenantId, tenantId as Uuid),
          isNull(moduleRelationships.recordedUntil),
        ),
      ),
    );

    for (const relationship of relationships) {
      const relatedModule = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select({ code: modules.code }).from(modules).where(
          and(eq(modules.id, relationship.relatedModuleId as Uuid), isNull(modules.recordedUntil)),
        ).limit(1),
      );
      const relatedCode = relatedModule[0]?.code ?? relationship.relatedModuleId;

      if (relationship.relationshipTypeCode === 'prerequisite') {
        const has = await this.#hasRegistration(tenantId, enrolmentId, relationship.relatedModuleId, ['completed']);
        if (!has) {
          messages.push({
            ruleTypeCode: 'prerequisite', severity: 'error',
            message: `Prerequisite module ${relatedCode} has not been completed`,
          });
        }
      }
      if (relationship.relationshipTypeCode === 'exclusion') {
        const has = await this.#hasRegistration(tenantId, enrolmentId, relationship.relatedModuleId, ['registered', 'completed']);
        if (has) {
          messages.push({
            ruleTypeCode: 'exclusion', severity: 'error',
            message: `Excluded module ${relatedCode} is already registered or completed`,
          });
        }
      }
      if (relationship.relationshipTypeCode === 'co-requisite') {
        const satisfiedBySibling = siblingItems.some((sibling) => sibling.moduleId === relationship.relatedModuleId);
        const satisfiedByExisting = satisfiedBySibling
          ? true
          : await this.#hasRegistration(tenantId, enrolmentId, relationship.relatedModuleId, ['registered', 'completed']);
        if (!satisfiedByExisting) {
          messages.push({
            ruleTypeCode: 'co-requisite', severity: 'error',
            message: `Co-requisite module ${relatedCode} must also be selected in this proposal`,
          });
        }
      }
    }
    return messages;
  }

  async #hasRegistration(
    tenantId: string,
    enrolmentId: string,
    relatedModuleId: string,
    statuses: string[],
  ): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: moduleRegistrationRows.id })
        .from(moduleRegistrationRows)
        .innerJoin(moduleOfferings, eq(moduleRegistrationRows.moduleOfferingId, moduleOfferings.id))
        .where(
          and(
            eq(moduleRegistrationRows.enrolmentId, enrolmentId as Uuid),
            eq(moduleRegistrationRows.tenantId, tenantId as Uuid),
            eq(moduleOfferings.tenantId, tenantId as Uuid),
            eq(moduleOfferings.moduleId, relatedModuleId as Uuid),
            inArray(moduleRegistrationRows.statusCode, statuses),
            isNull(moduleRegistrationRows.recordedUntil),
          ),
        ).limit(1),
    );
    return rows.length > 0;
  }

  async #hasCapacity(tenantId: string, moduleOfferingId: string, exceptProposalId?: string): Promise<boolean> {
    const offeringRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ capacity: moduleOfferings.capacity }).from(moduleOfferings).where(
        and(eq(moduleOfferings.id, moduleOfferingId as Uuid), eq(moduleOfferings.tenantId, tenantId as Uuid)),
      ).limit(1),
    );
    const capacity = offeringRows[0]?.capacity ?? null;
    if (capacity === null) return true;

    const registeredRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: moduleRegistrationRows.id }).from(moduleRegistrationRows).where(
        and(
          eq(moduleRegistrationRows.moduleOfferingId, moduleOfferingId as Uuid),
          eq(moduleRegistrationRows.tenantId, tenantId as Uuid),
          eq(moduleRegistrationRows.statusCode, 'registered'),
          isNull(moduleRegistrationRows.recordedUntil),
        ),
      ),
    );
    // Places held by allocation for other returned proposals count as taken until resubmission closes (D-30).
    const held = await this.heldPlaces(tenantId, [moduleOfferingId], exceptProposalId);
    return registeredRows.length + (held.get(moduleOfferingId) ?? 0) < capacity;
  }

  /** Places held by allocation for returned proposals, per offering (D-30). */
  async heldPlaces(tenantId: string, offeringIds: string[], exceptProposalId?: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (offeringIds.length === 0) return map;
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ offeringId: moduleSelectionProposalItems.moduleOfferingId, proposalId: moduleSelectionProposalItems.proposalId })
      .from(moduleSelectionProposalItems).where(and(
        eq(moduleSelectionProposalItems.tenantId, tenantId as Uuid), inArray(moduleSelectionProposalItems.moduleOfferingId, offeringIds as Uuid[]),
        sql`${moduleSelectionProposalItems.heldUntil} > ${clockNow()}`,
      )));
    for (const r of rows) {
      if (!r.offeringId || r.proposalId === exceptProposalId) continue;
      map.set(r.offeringId, (map.get(r.offeringId) ?? 0) + 1);
    }
    return map;
  }

  // ── Ranked choices and allocation (D-30) ────────────────────────────────────

  /**
   * The items that would be registered: fixed items, and for each choice
   * slot the alternative allocated by the latest applied run, else the
   * first-ranked one.
   */
  async #effectiveItems(tenantId: string, proposalId: string, items: ProposalItemDto[]): Promise<ProposalItemDto[]> {
    if (!items.some((i) => i.choiceSlot !== null)) return items;
    const allocated = await this.#allocatedChoices(tenantId, proposalId);
    const fixed = items.filter((i) => i.choiceSlot === null);
    const slots = [...new Set(items.filter((i) => i.choiceSlot !== null).map((i) => i.choiceSlot!))].sort((a, b) => a - b);
    const chosen: ProposalItemDto[] = [];
    for (const slot of slots) {
      const options = items.filter((i) => i.choiceSlot === slot).sort((a, b) => (a.preferenceRank ?? 1) - (b.preferenceRank ?? 1));
      const pick = allocated.has(slot) ? options.find((o) => o.proposalItemId === allocated.get(slot)) : options[0];
      if (pick) chosen.push(pick);
    }
    return [...fixed, ...chosen];
  }

  async #allocatedChoices(tenantId: string, proposalId: string): Promise<Map<number, string>> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ slot: moduleAllocationResults.choiceSlot, itemId: moduleAllocationResults.allocatedItemId, appliedAt: moduleAllocationRuns.appliedAt })
      .from(moduleAllocationResults)
      .innerJoin(moduleAllocationRuns, eq(moduleAllocationRuns.id, moduleAllocationResults.runId))
      .where(and(eq(moduleAllocationResults.tenantId, tenantId as Uuid), eq(moduleAllocationResults.proposalId, proposalId as Uuid), eq(moduleAllocationRuns.statusCode, 'applied'))));
    const map = new Map<number, string>();
    for (const r of rows.sort((a, b) => (a.appliedAt?.getTime() ?? 0) - (b.appliedAt?.getTime() ?? 0))) {
      if (r.slot !== null && r.itemId) map.set(r.slot, r.itemId);
    }
    return map;
  }

  /** Each alternative is checked on its own; one that cannot be taken is flagged and will be skipped. */
  async #checkAlternatives(tenantId: string, enrolmentId: string, items: ProposalItemDto[], effective: ProposalItemDto[]): Promise<Map<string, ValidationMessage[]>> {
    const out = new Map<string, ValidationMessage[]>();
    const chosen = new Set(effective.map((i) => i.proposalItemId));
    for (const alt of items.filter((i) => i.choiceSlot !== null && !chosen.has(i.proposalItemId))) {
      const siblings = [...effective.filter((e) => e.choiceSlot !== alt.choiceSlot), alt];
      const problems = await this.#checkRelationships(tenantId, enrolmentId, alt, siblings);
      out.set(alt.proposalItemId, problems.map((p) => ({ ...p, severity: 'warning' as const, message: `Alternative cannot be taken and will be skipped: ${p.message}` })));
    }
    return out;
  }

  async #allocationApplied(tenantId: string, windowId: string): Promise<boolean> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: moduleAllocationRuns.id }).from(moduleAllocationRuns).where(and(
      eq(moduleAllocationRuns.tenantId, tenantId as Uuid), eq(moduleAllocationRuns.windowId, windowId as Uuid),
      eq(moduleAllocationRuns.kindCode, 'main'), eq(moduleAllocationRuns.statusCode, 'applied'),
    )).limit(1));
    return Boolean(row);
  }

  /** Confirms a proposal whose every slot an applied allocation filled (D-30). */
  async confirmAfterAllocation(tenantId: string, proposalId: string, actorId: string): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (proposal.statusCode !== 'awaiting-allocation' && proposal.statusCode !== 'returned') {
      throw new ConflictError(`Proposal is ${proposal.statusCode}, not awaiting allocation`);
    }
    await this.#transitionProposal(proposal, tenantId, { statusCode: 'validated', decisionAuthorityCode: 'allocation', decisionReason: 'Allocated', decidedAt: clockNow() }, clockNow());
    return this.#confirmProposal(tenantId, proposalId, actorId);
  }

  /**
   * Returns a proposal an allocation could not fill (D-30), holding the
   * places it did get until resubmission closes.
   */
  async returnAfterAllocation(tenantId: string, proposalId: string, reason: string, heldItemIds: string[], holdUntil: Date): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (heldItemIds.length > 0) {
      await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleSelectionProposalItems).set({ heldUntil: holdUntil })
        .where(and(eq(moduleSelectionProposalItems.tenantId, tenantId as Uuid), inArray(moduleSelectionProposalItems.id, heldItemIds as Uuid[]))));
    }
    await this.#transitionProposal(proposal, tenantId, { statusCode: 'returned', decisionAuthorityCode: 'allocation', decisionReason: reason, decidedAt: clockNow() }, clockNow());
    return (await this.getProposal(proposalId, tenantId))!;
  }

  /** Exclusion relationships between two modules, either way round. */
  async excludes(tenantId: string, moduleA: string, moduleB: string): Promise<boolean> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: moduleRelationships.id }).from(moduleRelationships).where(and(
      eq(moduleRelationships.tenantId, tenantId as Uuid), eq(moduleRelationships.relationshipTypeCode, 'exclusion'), isNull(moduleRelationships.recordedUntil),
      sql`((${moduleRelationships.moduleId} = ${moduleA} AND ${moduleRelationships.relatedModuleId} = ${moduleB}) OR (${moduleRelationships.moduleId} = ${moduleB} AND ${moduleRelationships.relatedModuleId} = ${moduleA}))`,
    )).limit(1));
    return rows.length > 0;
  }

  /** The proposal's items, for allocation. */
  async itemsFor(tenantId: string, proposalId: string): Promise<ProposalItemDto[]> {
    return this.#listItems(tenantId, proposalId);
  }

  /** The clash policy in force for a student (D-25), for allocation. */
  async clashPolicyFor(tenantId: string, programmeId: string | null, enrolmentId: string) {
    const ruleCtx = { tenantId, programmeId: programmeId ?? '' };
    const { value, exception } = await this.rules.resolveForEnrolment(ruleCtx, 'timetable-clash-policy', enrolmentId,
      async () => (await this.rules.getOptionalRule<Record<string, unknown>>(ruleCtx, 'timetable-clash-policy', ['default'])) ?? { ...DEFAULT_CLASH_POLICY });
    return clashPolicyFrom(exception?.exceptionTypeCode === 'waiver' ? { ...DEFAULT_CLASH_POLICY, policy: 'advisory' } : value);
  }

  async #checkGroups(
    tenantId: string,
    programmeRuleSetId: string,
    items: ProposalItemDto[],
    exemptions: Array<{ moduleId: string; creditValue: number }> = [],
  ): Promise<Map<string, ValidationMessage[]>> {
    const result = new Map<string, ValidationMessage[]>();
    const groups = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleGroups).where(
        and(
          eq(moduleGroups.programmeRuleSetId, programmeRuleSetId as Uuid),
          eq(moduleGroups.tenantId, tenantId as Uuid),
          isNull(moduleGroups.recordedUntil),
        ),
      ),
    );
    if (groups.length === 0) return result;

    for (const group of groups) {
      const members = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select().from(moduleGroupMembers).where(
          and(
            eq(moduleGroupMembers.moduleGroupId, group.id as Uuid),
            eq(moduleGroupMembers.tenantId, tenantId as Uuid),
            isNull(moduleGroupMembers.recordedUntil),
          ),
        ),
      );
      const memberModuleIds = new Set(members.map((m) => m.moduleId));
      const selectedInGroup = items.filter((i) => memberModuleIds.has(i.moduleId));
      // Exempt modules in the group count as taken.
      const exemptInGroup = exemptions.filter((e) => memberModuleIds.has(e.moduleId) && !selectedInGroup.some((i) => i.moduleId === e.moduleId));
      if (selectedInGroup.length === 0 && exemptInGroup.length === 0 && group.groupTypeCode !== 'compulsory') continue;

      const selectedCredits = selectedInGroup.reduce((sum, i) => sum + (i.creditValue ?? 0), 0)
        + exemptInGroup.reduce((sum, e) => sum + e.creditValue, 0);
      const takenCount = selectedInGroup.length + exemptInGroup.length;

      const flagAll = (msg: ValidationMessage) => {
        for (const item of selectedInGroup.length > 0 ? selectedInGroup : items) {
          const list = result.get(item.proposalItemId) ?? [];
          list.push(msg);
          result.set(item.proposalItemId, list);
        }
      };

      if (group.minModules !== null && takenCount < (group.minModules ?? 0)) {
        flagAll({
          ruleTypeCode: 'module-group', severity: 'error',
          message: `Group '${group.title}' requires at least ${group.minModules} module(s); ${takenCount} selected or exempt`,
        });
      }
      if (group.maxModules !== null && takenCount > (group.maxModules ?? Infinity)) {
        flagAll({
          ruleTypeCode: 'module-group', severity: 'error',
          message: `Group '${group.title}' allows at most ${group.maxModules} module(s); ${takenCount} selected or exempt`,
        });
      }
      if (group.minCredits !== null && selectedCredits < (group.minCredits ?? 0)) {
        flagAll({
          ruleTypeCode: 'module-group', severity: 'error',
          message: `Group '${group.title}' requires at least ${group.minCredits} credits; ${selectedCredits} selected`,
        });
      }
      if (group.maxCredits !== null && selectedCredits > (group.maxCredits ?? Infinity)) {
        flagAll({
          ruleTypeCode: 'module-group', severity: 'error',
          message: `Group '${group.title}' allows at most ${group.maxCredits} credits; ${selectedCredits} selected`,
        });
      }
    }
    return result;
  }

  async #persistItemValidation(tenantId: string, itemMessages: Map<string, ValidationMessage[]>): Promise<void> {
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      for (const [proposalItemId, messages] of itemMessages) {
        const hasError = messages.some((m) => m.severity === 'error');
        await tx.update(moduleSelectionProposalItems).set({
          validationStateCode: hasError ? 'failed' : 'passed',
          validationMessages: messages,
          updatedAt: now,
        }).where(
          and(
            eq(moduleSelectionProposalItems.id, proposalItemId as Uuid),
            eq(moduleSelectionProposalItems.tenantId, tenantId as Uuid),
          ),
        );
      }
    });
  }

  // ── Confirmation ─────────────────────────────────────────────────────────────

  async #confirmProposal(tenantId: string, proposalId: string, actorId: string, opts: { enforceCapacity?: boolean } = {}): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    // Only fixed items and each slot's chosen alternative become registrations (D-30).
    const items = await this.#effectiveItems(tenantId, proposalId, await this.#listItems(tenantId, proposalId));

    // All or nothing (D-23): validation already applied every rule, and an
    // approver's decision authorised any capacity conflict, so nothing is
    // re-checked except capacity on an automatic first-come confirmation.
    // Registration ids derive from the items, so a retried confirmation finds
    // the registrations it already created.
    await this.moduleRegistrations.confirmSelection(tenantId, {
      enrolmentId: proposal.enrolmentId,
      enforceCapacity: opts.enforceCapacity ?? false,
      items: items.filter((i) => i.moduleOfferingId).map((i) => ({
        moduleOfferingId: i.moduleOfferingId!,
        moduleRegistrationId: deterministicUuid(`module-selection-registration:${proposalId}:${i.proposalItemId}`),
      })),
    }, actorId);

    // A repeat plan records the registration that repeats it (D-28), so its mark cap can follow the new attempt.
    const enrolment = await this.#getCurrentEnrolment(proposal.enrolmentId, tenantId);
    const rule = await this.#repeatRule({ tenantId, programmeId: enrolment.programmeId ?? '' }, enrolment.enrolmentId);
    const required = rule ? await repeatRequirements(this.db, tenantId, enrolment.enrolmentId, proposal.academicPeriodId, rule) : [];
    const linked = new Set<string>();
    for (const req of required) {
      if (linked.has(req.planId)) continue;
      const item = items.find((i) => i.moduleOfferingId && (i.moduleId === req.moduleId || (i.isReplacement && i.reassessmentPlanId === req.planId)));
      if (!item) continue;
      linked.add(req.planId);
      await withTenantContext(this.db, tenantId, (tx) => tx.update(reassessmentPlans)
        .set({ repeatModuleRegistrationId: deterministicUuid(`module-selection-registration:${proposalId}:${item.proposalItemId}`) as Uuid })
        .where(and(eq(reassessmentPlans.tenantId, tenantId as Uuid), eq(reassessmentPlans.id, req.planId as Uuid), isNull(reassessmentPlans.repeatModuleRegistrationId))));
    }

    await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleSelectionProposalItems).set({ heldUntil: null })
      .where(and(eq(moduleSelectionProposalItems.tenantId, tenantId as Uuid), eq(moduleSelectionProposalItems.proposalId, proposalId as Uuid))));
    await this.#transitionProposal(proposal, tenantId, {
      statusCode: 'confirmed',
      decidedAt: clockNow(),
    }, clockNow());

    return (await this.getProposal(proposalId, tenantId))!;
  }

  // ── Curriculum binding ───────────────────────────────────────────────────────

  async #resolveCurriculumBinding(tenantId: string, enrolment: CurrentEnrolment, actorId: string): Promise<string> {
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(enrolmentCurriculumBindings).where(
        and(
          eq(enrolmentCurriculumBindings.enrolmentId, enrolment.enrolmentId as Uuid),
          eq(enrolmentCurriculumBindings.tenantId, tenantId as Uuid),
          isNull(enrolmentCurriculumBindings.recordedUntil),
        ),
      ).limit(1),
    );
    if (existing[0]) return existing[0].programmeRuleSetId;

    if (!enrolment.programmeId) {
      throw new ValidationError('Enrolment has no programme; cannot resolve a curriculum rule-set binding');
    }

    const ruleSetRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(programmeRuleSets).where(
        and(
          eq(programmeRuleSets.programmeId, enrolment.programmeId as Uuid),
          eq(programmeRuleSets.tenantId, tenantId as Uuid),
          isNull(programmeRuleSets.recordedUntil),
        ),
      ),
    );
    if (ruleSetRows.length === 0) {
      throw new ValidationError('No programme rule set is configured for this enrolment\'s programme');
    }
    // Prefer a tenant/programme-wide default (no route, no entry-year); fall back to the first match.
    const defaultRuleSet = ruleSetRows.find((r) => !r.programmeRouteId && !r.entryAcademicYear) ?? ruleSetRows[0]!;

    const bindingId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(enrolmentCurriculumBindings).values({
        versionId:              randomUUID(),
        id:                     bindingId,
        tenantId:               tenantId as Uuid,
        enrolmentId:            enrolment.enrolmentId as Uuid,
        programmeRouteId:       defaultRuleSet.programmeRouteId as Uuid | null,
        programmeRuleSetId:     defaultRuleSet.id as Uuid,
        decisionAuthorityCode:  'automatic',
        decisionReason:         'Automatically bound to the default programme rule set at first module selection proposal',
        validFrom:              now,
        validTo:                null,
        recordedAt:             now,
        recordedUntil:          null,
      });
    });
    void actorId;
    return defaultRuleSet.id;
  }

  async #academicYear(tenantId: string, academicPeriodId: string): Promise<string | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ year: academicPeriods.academicYear }).from(academicPeriods)
      .where(and(eq(academicPeriods.id, academicPeriodId as Uuid), eq(academicPeriods.tenantId, tenantId as Uuid))).limit(1));
    return rows[0]?.year ?? null;
  }

  async #populateCompulsoryItems(
    tenantId: string,
    proposalId: string,
    programmeRuleSetId: string,
    academicPeriodId: string,
    fheqLevel: number,
    enrolmentId: string,
  ): Promise<void> {
    // A compulsory module the student is exempt from (approved recognised credit) is not added.
    const exempt = new Set((await approvedExemptionsFor(this.db, tenantId, enrolmentId, await this.#academicYear(tenantId, academicPeriodId)))
      .map((e) => e.moduleId));
    const groups = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleGroups).where(
        and(
          eq(moduleGroups.programmeRuleSetId, programmeRuleSetId as Uuid),
          eq(moduleGroups.tenantId, tenantId as Uuid),
          eq(moduleGroups.groupTypeCode, 'compulsory'),
          isNull(moduleGroups.recordedUntil),
        ),
      ),
    );
    const applicableGroups = groups.filter((g) => g.fheqLevel === null || g.fheqLevel === fheqLevel);
    if (applicableGroups.length === 0) return;

    const now = clockNow();
    for (const group of applicableGroups) {
      const members = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select().from(moduleGroupMembers).where(
          and(
            eq(moduleGroupMembers.moduleGroupId, group.id as Uuid),
            eq(moduleGroupMembers.tenantId, tenantId as Uuid),
            eq(moduleGroupMembers.isDefault, true),
            isNull(moduleGroupMembers.recordedUntil),
          ),
        ),
      );

      for (const member of members) {
        if (exempt.has(member.moduleId)) continue;
        const offeringRows = await withTenantContext(this.db, tenantId, async (tx) =>
          tx.select({ id: moduleOfferings.id }).from(moduleOfferings).where(
            and(
              eq(moduleOfferings.moduleId, member.moduleId as Uuid),
              eq(moduleOfferings.academicPeriodId, academicPeriodId as Uuid),
              eq(moduleOfferings.tenantId, tenantId as Uuid),
            ),
          ).limit(1),
        );

        await withTenantContext(this.db, tenantId, async (tx) => {
          await tx.insert(moduleSelectionProposalItems).values({
            id:                  randomUUID(),
            tenantId:            tenantId as Uuid,
            proposalId:          proposalId as Uuid,
            moduleId:            member.moduleId as Uuid,
            moduleOfferingId:    (offeringRows[0]?.id ?? null) as Uuid | null,
            preferenceRank:      null,
            sourceCode:          'compulsory-auto',
            validationStateCode: 'pending',
            createdAt:           now,
            updatedAt:           now,
          });
        });
      }
    }
  }

  /**
   * Clashes between the proposal's offerings, and with the student's current
   * registrations in overlapping periods (D-25). An offering with no
   * published timetable gets a warning, never an error. A waiver of the
   * policy turns blocking clashes into warnings (D-33).
   */
  async #checkClashes(
    tenantId: string,
    proposal: typeof moduleSelectionProposals.$inferSelect,
    enrolment: CurrentEnrolment,
    items: ProposalItemDto[],
    ruleCtx: { tenantId: string; programmeId: string },
  ): Promise<Array<{ proposalItemId: string; severity: 'error' | 'warning'; message: string }>> {
    const withOffering = items.filter((i) => i.moduleOfferingId);
    if (withOffering.length === 0) return [];
    const { value, exception } = await this.rules.resolveForEnrolment(ruleCtx, 'timetable-clash-policy', enrolment.enrolmentId,
      async () => (await this.rules.getOptionalRule<Record<string, unknown>>(ruleCtx, 'timetable-clash-policy', ['default'])) ?? { ...DEFAULT_CLASH_POLICY });
    const policy = clashPolicyFrom(exception?.exceptionTypeCode === 'waiver' ? { ...DEFAULT_CLASH_POLICY, policy: 'advisory' } : value);
    const severity: 'error' | 'warning' = policy.policy === 'blocking' ? 'error' : 'warning';

    const [period] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(academicPeriods)
      .where(and(eq(academicPeriods.tenantId, tenantId as Uuid), eq(academicPeriods.id, proposal.academicPeriodId as Uuid))).limit(1));
    const existing = !period ? [] : await withTenantContext(this.db, tenantId, (tx) => tx.select({ offeringId: moduleOfferings.id, code: modules.code })
      .from(moduleRegistrationRows)
      .innerJoin(moduleOfferings, eq(moduleOfferings.id, moduleRegistrationRows.moduleOfferingId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, moduleOfferings.academicPeriodId))
      .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
      .where(and(
        eq(moduleRegistrationRows.tenantId, tenantId as Uuid), eq(moduleRegistrationRows.enrolmentId, enrolment.enrolmentId as Uuid),
        eq(moduleRegistrationRows.statusCode, 'registered'), isNull(moduleRegistrationRows.recordedUntil),
        sql`${academicPeriods.startDate} <= ${period.endDate}`, sql`${academicPeriods.endDate} >= ${period.startDate}`,
      )));
    const proposed = new Set(withOffering.map((i) => i.moduleOfferingId!));
    const registered = existing.filter((e) => !proposed.has(e.offeringId));
    const timetables = await this.timetables.currentFor(tenantId, [...proposed, ...registered.map((r) => r.offeringId)]);

    const out: Array<{ proposalItemId: string; severity: 'error' | 'warning'; message: string }> = [];
    for (const item of withOffering) {
      if (!timetables.has(item.moduleOfferingId!)) out.push({ proposalItemId: item.proposalItemId, severity: 'warning', message: `The timetable for ${item.moduleCode} is not yet published, so clashes cannot be checked` });
    }
    for (const [n, a] of withOffering.entries()) {
      const ta = timetables.get(a.moduleOfferingId!);
      if (!ta) continue;
      for (const b of withOffering.slice(n + 1)) {
        const tb = timetables.get(b.moduleOfferingId!);
        if (!tb || a.moduleOfferingId === b.moduleOfferingId) continue;
        const clash = clashBetween(ta, tb, policy);
        if (!clash) continue;
        const message = describeClash(clash, a.moduleCode, b.moduleCode);
        out.push({ proposalItemId: a.proposalItemId, severity, message }, { proposalItemId: b.proposalItemId, severity, message });
      }
      for (const r of registered) {
        const tr = timetables.get(r.offeringId);
        const clash = tr ? clashBetween(ta, tr, policy) : null;
        if (clash) out.push({ proposalItemId: a.proposalItemId, severity, message: `${describeClash(clash, a.moduleCode, r.code)}, which you are already registered for` });
      }
    }
    return out;
  }

  async #routeCode(tenantId: string, programmeRuleSetId: string): Promise<string | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ routeCode: programmeRoutes.routeCode }).from(programmeRuleSets)
      .innerJoin(programmeRoutes, and(eq(programmeRoutes.id, programmeRuleSets.programmeRouteId), isNull(programmeRoutes.recordedUntil)))
      .where(and(eq(programmeRuleSets.tenantId, tenantId as Uuid), eq(programmeRuleSets.id, programmeRuleSetId as Uuid), isNull(programmeRuleSets.recordedUntil))).limit(1));
    return row?.routeCode ?? null;
  }

  async #repeatRule(ruleCtx: { tenantId: string; programmeId: string }, enrolmentId: string): Promise<RepeatRule | null> {
    // Applies even when unconfigured (the board's decision is the authority); a waiver releases the student (D-33).
    const { value, exception } = await this.rules.resolveForEnrolment(ruleCtx, 'repeat-module-requirement', enrolmentId,
      async () => (await this.rules.getOptionalRule<Record<string, unknown>>(ruleCtx, 'repeat-module-requirement', ['default'])) ?? { ...DEFAULT_REPEAT_RULE });
    if (exception?.exceptionTypeCode === 'waiver') return null;
    return repeatRuleFrom(value);
  }

  /** Adds the modules the board requires the student to repeat (D-28), with source 'repeat-required'. */
  async #populateRepeatItems(tenantId: string, proposalId: string, enrolment: CurrentEnrolment, academicPeriodId: string): Promise<void> {
    const rule = await this.#repeatRule({ tenantId, programmeId: enrolment.programmeId ?? '' }, enrolment.enrolmentId);
    if (!rule) return;
    const required = await repeatRequirements(this.db, tenantId, enrolment.enrolmentId, academicPeriodId, rule);
    const existing = await this.#listItems(tenantId, proposalId);
    const now = clockNow();
    for (const req of required) {
      if (existing.some((i) => i.moduleId === req.moduleId)) continue;
      const [offering] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: moduleOfferings.id }).from(moduleOfferings).where(and(
        eq(moduleOfferings.tenantId, tenantId as Uuid), eq(moduleOfferings.moduleId, req.moduleId as Uuid), eq(moduleOfferings.academicPeriodId, academicPeriodId as Uuid),
      )).limit(1));
      await withTenantContext(this.db, tenantId, (tx) => tx.insert(moduleSelectionProposalItems).values({
        id: randomUUID(), tenantId: tenantId as Uuid, proposalId: proposalId as Uuid, moduleId: req.moduleId as Uuid,
        moduleOfferingId: (offering?.id ?? null) as Uuid | null, sourceCode: 'repeat-required',
        reassessmentPlanId: req.planId as Uuid, validationStateCode: 'pending', createdAt: now, updatedAt: now,
      }));
      existing.push({ moduleId: req.moduleId } as ProposalItemDto);
    }
  }

  /**
   * Each required repeat is met by the same module or an allowed replacement
   * (D-28); total repeat credit stays within the cap. Returns the repeat
   * credit to leave out of the credit load when the rule says so.
   */
  async #checkRepeats(
    tenantId: string,
    proposal: typeof moduleSelectionProposals.$inferSelect,
    enrolment: CurrentEnrolment,
    items: ProposalItemDto[],
    ruleCtx: { tenantId: string; programmeId: string },
  ): Promise<{ errors: ValidationMessage[]; itemMessages: Map<string, ValidationMessage[]>; excludedCredits: number }> {
    const errors: ValidationMessage[] = [];
    const itemMessages = new Map<string, ValidationMessage[]>();
    const flag = (itemId: string, m: ValidationMessage) => { const l = itemMessages.get(itemId) ?? []; l.push(m); itemMessages.set(itemId, l); };
    const rule = await this.#repeatRule(ruleCtx, enrolment.enrolmentId);
    if (!rule) return { errors, itemMessages, excludedCredits: 0 };
    const required = await repeatRequirements(this.db, tenantId, enrolment.enrolmentId, proposal.academicPeriodId, rule);
    const replacements = items.filter((i) => i.isReplacement);
    if (required.length === 0) {
      for (const r of replacements) flag(r.proposalItemId, { ruleTypeCode: 'repeat-module-requirement', severity: 'error', message: `${r.moduleCode} is marked as a replacement, but no repeat is required` });
      return { errors, itemMessages, excludedCredits: 0 };
    }
    const membership = await groupMembership(this.db, tenantId, proposal.programmeRuleSetId);
    const failed = await failedModuleIds(this.db, tenantId, enrolment.enrolmentId);
    const used = new Set<string>();
    let repeatCredits = 0;

    for (const req of required) {
      const same = items.find((i) => i.moduleId === req.moduleId && !used.has(i.proposalItemId));
      if (same) { used.add(same.proposalItemId); repeatCredits += same.creditValue ?? 0; continue; }
      const replacement = replacements.find((i) => i.reassessmentPlanId === req.planId && !used.has(i.proposalItemId));
      if (!replacement) {
        errors.push({ ruleTypeCode: 'repeat-module-requirement', severity: 'error', message: `The exam board requires ${req.moduleCode} to be repeated; include it${rule.allowReplacement === 'never' ? '' : ' or an allowed replacement'}` });
        continue;
      }
      used.add(replacement.proposalItemId);
      const problem = this.#replacementProblem(rule, req, replacement, membership, failed);
      if (problem) flag(replacement.proposalItemId, { ruleTypeCode: 'repeat-module-requirement', severity: 'error', message: problem });
      repeatCredits += replacement.creditValue ?? 0;
    }
    for (const r of replacements.filter((i) => !used.has(i.proposalItemId))) {
      flag(r.proposalItemId, { ruleTypeCode: 'repeat-module-requirement', severity: 'error', message: `${r.moduleCode} replaces a repeat that is already met or not required` });
    }
    if (rule.maxRepeatCredits !== null && repeatCredits > rule.maxRepeatCredits) {
      errors.push({ ruleTypeCode: 'repeat-module-requirement', severity: 'error', message: `${repeatCredits} credits of repeated modules exceed the limit of ${rule.maxRepeatCredits}` });
    }
    return { errors, itemMessages, excludedCredits: rule.countTowardsCreditLoad ? 0 : repeatCredits };
  }

  #replacementProblem(
    rule: RepeatRule,
    req: { moduleId: string; moduleCode: string; creditValue: number },
    item: ProposalItemDto,
    membership: Map<string, Array<{ groupId: string; groupTypeCode: string; isNonCondonable: boolean }>>,
    failed: Set<string>,
  ): string | null {
    if (rule.allowReplacement === 'never') return `${req.moduleCode} must be repeated itself; a replacement is not allowed`;
    const failedGroups = membership.get(req.moduleId) ?? [];
    if (failedGroups.some((g) => g.isNonCondonable)) return `${req.moduleCode} must be passed outright and cannot be replaced`;
    if (failedGroups.some((g) => g.groupTypeCode === 'compulsory')) return `${req.moduleCode} is compulsory and cannot be replaced`;
    if (rule.allowReplacement === 'optional-only') {
      const replacementGroups = new Set((membership.get(item.moduleId) ?? []).map((g) => g.groupId));
      if (!failedGroups.some((g) => replacementGroups.has(g.groupId))) return `${item.moduleCode} is not in the same optional group as ${req.moduleCode}`;
    }
    if ((item.creditValue ?? 0) < req.creditValue) return `${item.moduleCode} carries fewer credits than ${req.moduleCode} (${item.creditValue ?? 0} < ${req.creditValue})`;
    if (failed.has(item.moduleId)) return `${item.moduleCode} has already been failed and cannot be a replacement`;
    return null;
  }

  // ── Approval workflow ────────────────────────────────────────────────────────

  async #startApprovalWorkflow(
    tenantId: string,
    proposal: typeof moduleSelectionProposals.$inferSelect,
    actorId: string,
    reason: string,
  ): Promise<string> {
    const workflowDefinitionVersionId = await this.#getActiveVersionId(tenantId, APPROVAL_WORKFLOW_CODE);
    const started = await this.#approvalReview().start(tenantId, {
      workflowDefinitionVersionId,
      subjectEntityId: proposal.id,
      startedBy: actorId,
      context: { moduleSelectionProposalId: proposal.id, reason },
    });
    return started.workflowInstanceId;
  }

  async #findApprovalTask(tenantId: string, workflowInstanceId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(
        and(
          eq(workflowTasks.workflowInstanceId, workflowInstanceId as Uuid),
          eq(workflowTasks.tenantId, tenantId as Uuid),
          eq(workflowTasks.stepKey, APPROVAL_DECISION_STEP_KEY),
        ),
      ).limit(1),
    );
    return rows[0] ?? null;
  }

  async #getActiveVersionId(tenantId: string, definitionCode: string): Promise<string> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ versionId: workflowDefinitionVersions.id })
        .from(workflowDefinitions)
        .innerJoin(
          workflowDefinitionVersions,
          and(
            eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id),
            eq(workflowDefinitionVersions.versionNumber, workflowDefinitions.currentVersionNumber),
          ),
        )
        .where(and(
          eq(workflowDefinitions.definitionCode, definitionCode),
          eq(workflowDefinitions.statusCode, 'active'),
          eq(workflowDefinitionVersions.statusCode, 'active'),
        ))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinition', definitionCode);
    return rows[0].versionId;
  }

  // ── Shared row/state helpers ─────────────────────────────────────────────────

  #ensureEditable(statusCode: string): void {
    if (statusCode !== 'draft' && statusCode !== 'returned') {
      throw new ConflictError(`Cannot modify a proposal in status '${statusCode}'`);
    }
  }

  async #getCurrentProposalRow(proposalId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(moduleSelectionProposals).where(
        and(
          eq(moduleSelectionProposals.id, proposalId as Uuid),
          eq(moduleSelectionProposals.tenantId, tenantId as Uuid),
          isNull(moduleSelectionProposals.recordedUntil),
        ),
      ).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('ModuleSelectionProposal', proposalId);
    return rows[0];
  }

  async #transitionProposal(
    current: typeof moduleSelectionProposals.$inferSelect,
    tenantId: string,
    patch: Partial<{
      statusCode: ProposalStatusCode;
      submittedAt: Date;
      decidedAt: Date;
      decisionAuthorityCode: string;
      decisionReason: string;
      workflowInstanceId: string;
      lateSubmissionReasonCode: string;
      lateSubmissionNote: string;
      lateSubmittedBy: string;
    }>,
    validFrom: Date,
  ): Promise<void> {
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(moduleSelectionProposals).set({ recordedUntil: now }).where(
        and(
          eq(moduleSelectionProposals.id, current.id as Uuid),
          eq(moduleSelectionProposals.tenantId, tenantId as Uuid),
          isNull(moduleSelectionProposals.recordedUntil),
        ),
      );

      await tx.insert(moduleSelectionProposals).values({
        versionId:              randomUUID(),
        id:                     current.id as Uuid,
        tenantId:               tenantId as Uuid,
        enrolmentId:            current.enrolmentId as Uuid,
        academicPeriodId:       current.academicPeriodId as Uuid,
        programmeRuleSetId:     current.programmeRuleSetId as Uuid,
        statusCode:             patch.statusCode ?? current.statusCode,
        submittedAt:            patch.submittedAt ?? current.submittedAt,
        decidedAt:              patch.decidedAt ?? current.decidedAt,
        decisionAuthorityCode:  patch.decisionAuthorityCode ?? current.decisionAuthorityCode,
        decisionReason:         patch.decisionReason ?? current.decisionReason,
        workflowInstanceId:     (patch.workflowInstanceId ?? current.workflowInstanceId) as Uuid | null,
        fheqLevel:              current.fheqLevel,
        lateSubmissionReasonCode: patch.lateSubmissionReasonCode ?? current.lateSubmissionReasonCode,
        lateSubmissionNote:     patch.lateSubmissionNote ?? current.lateSubmissionNote,
        lateSubmittedBy:        patch.lateSubmittedBy ?? current.lateSubmittedBy,
        validFrom,
        validTo:                null,
        recordedAt:             now,
        recordedUntil:          null,
      });
    });
  }

  async #listItems(tenantId: string, proposalId: string): Promise<ProposalItemDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        item: moduleSelectionProposalItems,
        moduleCode: modules.code,
        moduleTitle: modules.title,
        creditValue: modules.creditValue,
        fheqLevel: modules.fheqLevel,
      })
        .from(moduleSelectionProposalItems)
        .innerJoin(modules, eq(moduleSelectionProposalItems.moduleId, modules.id))
        .where(
          and(
            eq(moduleSelectionProposalItems.proposalId, proposalId as Uuid),
            eq(moduleSelectionProposalItems.tenantId, tenantId as Uuid),
            eq(modules.tenantId, tenantId as Uuid),
            isNull(modules.recordedUntil),
          ),
        ),
    );
    return rows.map((row) => ({
      proposalItemId: row.item.id,
      moduleId: row.item.moduleId,
      moduleCode: row.moduleCode,
      moduleTitle: row.moduleTitle,
      creditValue: row.creditValue ?? null,
      fheqLevel: row.fheqLevel ?? null,
      moduleOfferingId: row.item.moduleOfferingId,
      preferenceRank: row.item.preferenceRank,
      choiceSlot: row.item.choiceSlot,
      reassessmentPlanId: row.item.reassessmentPlanId,
      isReplacement: row.item.isReplacement,
      heldUntil: row.item.heldUntil,
      sourceCode: row.item.sourceCode,
      validationStateCode: row.item.validationStateCode,
      validationMessages: (row.item.validationMessages ?? []),
    }));
  }

  async #getCurrentEnrolment(enrolmentId: string, tenantId: string): Promise<CurrentEnrolment> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        enrolmentId: enrolments.id,
        personId: enrolments.personId,
        programmeId: enrolments.programmeId,
        modeOfStudyCode: enrolments.modeOfStudyCode,
        studyIntensityPercent: enrolments.studyIntensityPercent,
      }).from(enrolments).where(
        and(
          eq(enrolments.id, enrolmentId as Uuid),
          eq(enrolments.tenantId, tenantId as Uuid),
          isNull(enrolments.recordedUntil),
        ),
      ).limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Enrolment', enrolmentId);
    return row;
  }
}

function proposalToDto(
  row: typeof moduleSelectionProposals.$inferSelect,
  items: ProposalItemDto[],
): ProposalDto {
  return {
    moduleSelectionProposalId: row.id,
    enrolmentId: row.enrolmentId,
    academicPeriodId: row.academicPeriodId,
    programmeRuleSetId: row.programmeRuleSetId,
    statusCode: row.statusCode,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    decisionAuthorityCode: row.decisionAuthorityCode,
    decisionReason: row.decisionReason,
    workflowInstanceId: row.workflowInstanceId,
    fheqLevel: row.fheqLevel,
    lateSubmissionReasonCode: row.lateSubmissionReasonCode,
    lateSubmittedBy: row.lateSubmittedBy,
    items,
  };
}
