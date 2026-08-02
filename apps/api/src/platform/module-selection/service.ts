import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
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
  programmeRuleSets,
  workflowDefinitions,
  workflowDefinitionVersions,
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
import type { ModuleRegistrationService } from '../registration/service.js';
import type { RulesEngine } from '../rules-engine/engine.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const APPROVAL_WORKFLOW_CODE = 'module-selection-approval';
const APPROVAL_DECISION_STEP_KEY = 'approve-or-reject-selection';
const APPROVAL_GATEWAY_KEY = 'G01';

export type ProposalStatusCode =
  | 'draft' | 'submitted' | 'validated' | 'approved'
  | 'returned' | 'waitlisted' | 'rejected' | 'confirmed';

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
  items: ProposalItemDto[];
}

interface CurrentEnrolment {
  enrolmentId: string;
  personId: string;
  programmeId: string | null;
  modeOfStudyCode: string;
}

export interface CurriculumBindingDto {
  enrolmentCurriculumBindingId: string;
  enrolmentId: string;
  programmeRouteId: string | null;
  programmeRuleSetId: string;
  decisionAuthorityCode: string;
  decisionReason: string | null;
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
  ) {}

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
        statusCode:         'draft',
        validFrom:          now,
        validTo:            null,
        recordedAt:         now,
        recordedUntil:      null,
      });
    });

    await this.#populateCompulsoryItems(tenantId, proposalId, programmeRuleSetId, input.academicPeriodId, input.fheqLevel);

    return proposalId;
  }

  async addItem(
    tenantId: string,
    proposalId: string,
    input: AddProposalItemInput,
  ): Promise<string> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    this.#ensureEditable(proposal.statusCode);

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
  async submitProposal(tenantId: string, proposalId: string, actorId: string): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (proposal.statusCode !== 'draft' && proposal.statusCode !== 'returned') {
      throw new ValidationError(`Cannot submit a proposal in status '${proposal.statusCode}'`);
    }

    const enrolment = await this.#getCurrentEnrolment(proposal.enrolmentId, tenantId);
    const items = await this.#listItems(tenantId, proposalId);
    if (items.length === 0) {
      throw new ValidationError('Cannot submit a proposal with no module choices');
    }

    const now = clockNow();
    await this.#transitionProposal(proposal, tenantId, { statusCode: 'submitted', submittedAt: now }, now);

    const validation = await this.#validateSelection(tenantId, proposal, enrolment, items);
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
    return this.#confirmProposal(tenantId, proposalId, actorId);
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
  ): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    if (proposal.statusCode !== 'waitlisted' && proposal.statusCode !== 'submitted') {
      throw new ValidationError(`Cannot decide a proposal in status '${proposal.statusCode}'`);
    }

    if (proposal.workflowInstanceId) {
      await this.workflowBridge.recordWorkflowDecision({
        tenantId,
        workflowInstanceId: proposal.workflowInstanceId,
        gatewayKey: APPROVAL_GATEWAY_KEY,
        decisionCode,
        conditionSummary: reason,
        outcomeStepKey: 'proposal-closed',
        actorId,
        metadata: { moduleSelectionProposalId: proposalId },
      });
      const task = await this.#findApprovalTask(tenantId, proposal.workflowInstanceId);
      if (task) {
        await this.workflowBridge.completeWorkflowTask({
          tenantId, workflowTaskId: task.id, completedBy: actorId,
          payload: { decisionCode, reason },
        });
      }
      await this.workflowBridge.completeWorkflowInstance({
        tenantId, workflowInstanceId: proposal.workflowInstanceId, actorId,
        statusCode: 'completed', metadata: { decisionCode },
      });
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
    };
  }

  /** Creates or overrides the route/rule-set binding for an enrolment (BP-03-002 main flow / A5). */
  async setCurriculumBinding(
    tenantId: string,
    enrolmentId: string,
    input: {
      programmeRouteId?: string;
      programmeRuleSetId: string;
      decisionAuthorityCode: 'automatic' | 'registry-administrator' | 'academic-approver';
      decisionReason?: string;
    },
  ): Promise<string> {
    const now = clockNow();
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: enrolmentCurriculumBindings.id }).from(enrolmentCurriculumBindings).where(
        and(
          eq(enrolmentCurriculumBindings.enrolmentId, enrolmentId as Uuid),
          eq(enrolmentCurriculumBindings.tenantId, tenantId as Uuid),
          isNull(enrolmentCurriculumBindings.recordedUntil),
        ),
      ).limit(1),
    );

    if (existing[0]) {
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.update(enrolmentCurriculumBindings).set({ recordedUntil: now }).where(
          and(
            eq(enrolmentCurriculumBindings.id, existing[0]!.id as Uuid),
            eq(enrolmentCurriculumBindings.tenantId, tenantId as Uuid),
            isNull(enrolmentCurriculumBindings.recordedUntil),
          ),
        );
      });
    }

    const bindingId = existing[0]?.id ?? randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(enrolmentCurriculumBindings).values({
        versionId:             randomUUID(),
        id:                    bindingId as Uuid,
        tenantId:              tenantId as Uuid,
        enrolmentId:           enrolmentId as Uuid,
        programmeRouteId:      (input.programmeRouteId ?? null) as Uuid | null,
        programmeRuleSetId:    input.programmeRuleSetId as Uuid,
        decisionAuthorityCode: input.decisionAuthorityCode,
        decisionReason:        input.decisionReason ?? null,
        validFrom:             now,
        validTo:               null,
        recordedAt:            now,
        recordedUntil:         null,
      });
    });
    return bindingId;
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
    input: { moduleId: string; isDefault?: boolean; isNonCondonable?: boolean },
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

    // Capacity per offering
    for (const item of items) {
      if (!item.moduleOfferingId) continue;
      const available = await this.#hasCapacity(tenantId, item.moduleOfferingId);
      if (!available) {
        capacityConflict = true;
        pushItemMessage(item.proposalItemId, {
          ruleTypeCode: 'capacity', severity: 'warning',
          message: `Module offering for ${item.moduleCode} has reached capacity — routed for allocation`,
        });
      }
    }

    // Diet group bounds
    const groupMessages = await this.#checkGroups(tenantId, proposal.programmeRuleSetId, items);
    for (const [itemId, msgs] of groupMessages) {
      for (const m of msgs) pushItemMessage(itemId, m);
    }

    // Credit load requirement (mode-of-study aware)
    const totalCredits = items.reduce((sum, i) => sum + (i.creditValue ?? 0), 0);
    const creditLoad = await this.rules.getCreditLoadRequirement(
      { tenantId, programmeId: enrolment.programmeId ?? '' }, enrolment.modeOfStudyCode,
    );
    if (creditLoad) {
      if (creditLoad.maxCredits !== null && totalCredits > creditLoad.maxCredits) {
        errors.push({
          ruleTypeCode: 'credit-load-requirement', severity: 'error',
          message: `Total selected credits (${totalCredits}) exceed the maximum of ${creditLoad.maxCredits} for ${enrolment.modeOfStudyCode} study`,
        });
      }
      if (creditLoad.minCredits !== null && totalCredits < creditLoad.minCredits) {
        errors.push({
          ruleTypeCode: 'credit-load-requirement', severity: 'error',
          message: `Total selected credits (${totalCredits}) are below the minimum of ${creditLoad.minCredits} for ${enrolment.modeOfStudyCode} study`,
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
      const minAtLevel = await this.rules.getLevelCreditRequirement({ tenantId, programmeId: enrolment.programmeId ?? '' }, modalLevel);
      if (minAtLevel !== null && (levelCounts.get(modalLevel) ?? 0) < minAtLevel) {
        errors.push({
          ruleTypeCode: 'level-credit-requirement', severity: 'error',
          message: `Only ${levelCounts.get(modalLevel)} credits at level ${modalLevel} selected; a minimum of ${minAtLevel} is required`,
        });
      }

      const adjacentLimit = await this.rules.getAdjacentLevelCreditLimit({ tenantId, programmeId: enrolment.programmeId ?? '' });
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

  async #hasCapacity(tenantId: string, moduleOfferingId: string): Promise<boolean> {
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
    return registeredRows.length < capacity;
  }

  async #checkGroups(
    tenantId: string,
    programmeRuleSetId: string,
    items: ProposalItemDto[],
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
      if (selectedInGroup.length === 0 && group.groupTypeCode !== 'compulsory') continue;

      const selectedCredits = selectedInGroup.reduce((sum, i) => sum + (i.creditValue ?? 0), 0);

      const flagAll = (msg: ValidationMessage) => {
        for (const item of selectedInGroup.length > 0 ? selectedInGroup : items) {
          const list = result.get(item.proposalItemId) ?? [];
          list.push(msg);
          result.set(item.proposalItemId, list);
        }
      };

      if (group.minModules !== null && selectedInGroup.length < (group.minModules ?? 0)) {
        flagAll({
          ruleTypeCode: 'module-group', severity: 'error',
          message: `Group '${group.title}' requires at least ${group.minModules} module(s); ${selectedInGroup.length} selected`,
        });
      }
      if (group.maxModules !== null && selectedInGroup.length > (group.maxModules ?? Infinity)) {
        flagAll({
          ruleTypeCode: 'module-group', severity: 'error',
          message: `Group '${group.title}' allows at most ${group.maxModules} module(s); ${selectedInGroup.length} selected`,
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

  async #confirmProposal(tenantId: string, proposalId: string, actorId: string): Promise<ProposalDto> {
    const proposal = await this.#getCurrentProposalRow(proposalId, tenantId);
    const items = await this.#listItems(tenantId, proposalId);

    for (const item of items) {
      if (!item.moduleOfferingId) continue;
      // Capacity was already assessed during #validateSelection (and, for a
      // waitlisted proposal, explicitly authorised by an approver's decision) —
      // re-checking it here would race against that decision. Duplicate,
      // prerequisite/co-requisite/exclusion and credit-limit checks still apply.
      await this.moduleRegistrations.createRegistration(
        tenantId,
        { enrolmentId: proposal.enrolmentId, moduleOfferingId: item.moduleOfferingId, skipCapacityCheck: true },
        actorId,
      );
    }

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

  async #populateCompulsoryItems(
    tenantId: string,
    proposalId: string,
    programmeRuleSetId: string,
    academicPeriodId: string,
    fheqLevel: number,
  ): Promise<void> {
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

  // ── Approval workflow ────────────────────────────────────────────────────────

  async #startApprovalWorkflow(
    tenantId: string,
    proposal: typeof moduleSelectionProposals.$inferSelect,
    actorId: string,
    reason: string,
  ): Promise<string> {
    const workflowDefinitionVersionId = await this.#getActiveVersionId(tenantId, APPROVAL_WORKFLOW_CODE);
    const instance = await this.workflowBridge.startWorkflowInstance({
      tenantId,
      workflowDefinitionVersionId,
      workflowCode: APPROVAL_WORKFLOW_CODE,
      subjectEntityType: 'module_selection_proposal',
      subjectEntityId: proposal.id,
      startedBy: actorId,
      context: { moduleSelectionProposalId: proposal.id, reason },
    });

    await this.workflowBridge.assignWorkflowTask({
      tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      stepKey: APPROVAL_DECISION_STEP_KEY,
      assigneeRoleCode: 'programme-approver',
      payload: { moduleSelectionProposalId: proposal.id, reason },
    });

    return instance.workflowInstanceId;
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
      sourceCode: row.item.sourceCode,
      validationStateCode: row.item.validationStateCode,
      validationMessages: (row.item.validationMessages ?? []) as ValidationMessage[],
    }));
  }

  async #getCurrentEnrolment(enrolmentId: string, tenantId: string): Promise<CurrentEnrolment> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        enrolmentId: enrolments.id,
        personId: enrolments.personId,
        programmeId: enrolments.programmeId,
        modeOfStudyCode: enrolments.modeOfStudyCode,
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
    items,
  };
}
