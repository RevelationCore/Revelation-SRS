import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowSteps,
  workflowDecisionGateways,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

import type { WorkflowResponsibilityService } from './workflow-responsibility-service.js';

/**
 * Authors generic, single-decision human-task workflows entirely from admin
 * input — no developer-written service code involved. Restricted to
 * definitions with ownerModuleCode 'custom' (the default
 * WorkflowDefinitionService#createDefinition already assigns admin-created
 * definitions), since a step key authored here has no bespoke code path
 * reacting to it: the generic decision endpoint and the Task Inbox are the
 * only things that ever act on it.
 */

export interface WorkflowOutcomeOption {
  code:  string;
  label: string;
}

export interface CreateGenericVersionInput {
  step: {
    displayName:         string;
    description?:        string;
    assigneeRoleCode:    string;
    outcomeOptions:      WorkflowOutcomeOption[];
    dueAfterHours?:      number;
    escalateToRoleCode?: string;
  };
}

export interface GenericVersionResult {
  workflowDefinitionVersionId: string;
  versionNumber:               number;
}

export const GENERIC_START_STEP_KEY = 'start';
export const GENERIC_TASK_STEP_KEY  = 'review-and-decide';
export const GENERIC_END_STEP_KEY   = 'end';
export const GENERIC_GATEWAY_KEY    = 'G01';

export class WorkflowBuilderService {
  constructor(
    private readonly db: Db,
    private readonly responsibilities: WorkflowResponsibilityService,
  ) {}

  async createGenericVersion(
    tenantId: string,
    workflowDefinitionId: string,
    input: CreateGenericVersionInput,
    actorId: string,
  ): Promise<GenericVersionResult> {
    if (input.step.outcomeOptions.length === 0) {
      throw new ValidationError('A workflow step needs at least one outcome option', [
        { field: 'step.outcomeOptions', message: 'At least one outcome option is required' },
      ]);
    }
    if (!input.step.displayName.trim()) {
      throw new ValidationError('A workflow step needs a display name', [
        { field: 'step.displayName', message: 'Display name is required' },
      ]);
    }

    const definition = await this.#requireCustomDefinition(tenantId, workflowDefinitionId);

    const versionId = randomUUID();
    const now = clockNow();
    let versionNumber = 1;

    await withTenantContext(this.db, tenantId, async (tx) => {
      const existingVersions = await tx.select({ versionNumber: workflowDefinitionVersions.versionNumber })
        .from(workflowDefinitionVersions)
        .where(eq(
          workflowDefinitionVersions.workflowDefinitionId,
          workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`,
        ));
      versionNumber = existingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

      await tx.insert(workflowDefinitionVersions).values({
        id: versionId,
        workflowDefinitionId: workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`,
        versionNumber,
        statusCode: 'draft',
        definitionJson: {
          generic: true,
          startEvent: GENERIC_START_STEP_KEY,
          decisionStepKey: GENERIC_TASK_STEP_KEY,
          escalationPolicy: {
            dueAfterHours: input.step.dueAfterHours ?? null,
            escalateToRoleCode: input.step.escalateToRoleCode ?? null,
          },
        },
        createdBy: actorId,
        createdAt: now,
      });

      await tx.insert(workflowSteps).values([
        {
          workflowDefinitionVersionId: versionId,
          stepKey: GENERIC_START_STEP_KEY,
          stepTypeCode: 'start',
          displayName: 'Started',
          sortOrder: 10,
          configuration: {},
        },
        {
          workflowDefinitionVersionId: versionId,
          stepKey: GENERIC_TASK_STEP_KEY,
          stepTypeCode: 'human-task',
          displayName: input.step.displayName,
          ownerRoleCode: input.step.assigneeRoleCode,
          sortOrder: 20,
          configuration: {
            description: input.step.description ?? null,
            outcomeOptions: input.step.outcomeOptions,
            dueAfterHours: input.step.dueAfterHours ?? null,
            escalateToRoleCode: input.step.escalateToRoleCode ?? null,
          },
        },
        {
          workflowDefinitionVersionId: versionId,
          stepKey: GENERIC_END_STEP_KEY,
          stepTypeCode: 'end',
          displayName: 'Closed',
          sortOrder: 30,
          configuration: {},
        },
      ]);

      await tx.insert(workflowDecisionGateways).values({
        workflowDefinitionVersionId: versionId,
        gatewayKey: GENERIC_GATEWAY_KEY,
        displayName: `${input.step.displayName}: decision`,
        decisionTypeCode: 'exclusive',
        configuration: { outcomeOptions: input.step.outcomeOptions },
      });
    });

    await this.responsibilities.createAssignmentRule(tenantId, {
      workflowDefinitionVersionId: versionId,
      stepKey: GENERIC_TASK_STEP_KEY,
      ruleKey: `custom.${definition.definitionCode}.${GENERIC_TASK_STEP_KEY}.default`,
      assigneeRoleCode: input.step.assigneeRoleCode,
    });

    return { workflowDefinitionVersionId: versionId, versionNumber };
  }

  async publishVersion(tenantId: string, workflowDefinitionVersionId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        version:    workflowDefinitionVersions,
        definition: workflowDefinitions,
      }).from(workflowDefinitionVersions)
        .innerJoin(workflowDefinitions, eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id))
        .where(and(
          eq(
            workflowDefinitionVersions.id,
            workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`,
          ),
          eq(workflowDefinitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ))
        .limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('WorkflowDefinitionVersion', workflowDefinitionVersionId);
    if (row.definition.ownerModuleCode !== 'custom') {
      throw new ValidationError('Only admin-authored ("custom") workflow versions can be published here', [
        { field: 'workflowDefinitionVersionId', message: 'This version is owned by a developer-authored module' },
      ]);
    }

    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(workflowDefinitionVersions)
        .set({ statusCode: 'active', effectiveFrom: now })
        .where(eq(
          workflowDefinitionVersions.id,
          workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`,
        ));
      await tx.update(workflowDefinitions)
        .set({ statusCode: 'active', currentVersionNumber: row.version.versionNumber, updatedAt: now })
        .where(eq(workflowDefinitions.id, row.definition.id));
    });
  }

  async #requireCustomDefinition(tenantId: string, workflowDefinitionId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowDefinitions).where(and(
        eq(workflowDefinitions.id, workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowDefinitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    const definition = rows[0];
    if (!definition) throw new NotFoundError('WorkflowDefinition', workflowDefinitionId);
    if (definition.ownerModuleCode !== 'custom') {
      throw new ValidationError(
        'Only admin-authored ("custom") workflow definitions can be configured through the builder',
        [{
          field: 'workflowDefinitionId',
          message: 'This definition is owned by a developer-authored module and cannot be edited here',
        }],
      );
    }
    return definition;
  }
}
