import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  workflowAssignmentRules,
  workflowTasks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { ForbiddenError, NotFoundError, type Role, ROLES, ValidationError, hasPermission } from '@revelation-srs/domain';

export interface WorkflowAssignmentRuleDto {
  workflowAssignmentRuleId: string;
  tenantId: string | null;
  workflowDefinitionVersionId: string;
  stepKey: string;
  ruleKey: string;
  priority: number;
  roleCode: string | null;
  organisationalUnitCode: string | null;
  programmeId: string | null;
  sourceSystemCode: string | null;
  assigneeRoleCode: string | null;
  assigneeExpression: string | null;
  configuration: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
}

export interface CreateWorkflowAssignmentRuleInput {
  workflowDefinitionVersionId: string;
  stepKey: string;
  ruleKey: string;
  priority?: number;
  roleCode?: string;
  organisationalUnitCode?: string;
  programmeId?: string;
  sourceSystemCode?: string;
  assigneeRoleCode?: string;
  assigneeExpression?: string;
  configuration?: Record<string, unknown>;
  active?: boolean;
}

export interface WorkflowAssignmentContext {
  workflowDefinitionVersionId: string;
  stepKey: string;
  roleCodes?: string[];
  organisationalUnitCode?: string;
  programmeId?: string;
  sourceSystemCode?: string;
}

export interface WorkflowAssignmentResolution {
  assigneeRoleCode?: string;
  assigneeExpression?: string;
  ruleKey?: string;
  ruleId?: string;
  reasonCode: 'assignment-rule-match' | 'explicit-assignee' | 'unassigned';
}

export interface WorkflowTaskCompletionActor {
  actorId: string;
  roles: Role[];
}

type RuleRow = typeof workflowAssignmentRules.$inferSelect;
type TaskRow = typeof workflowTasks.$inferSelect;

export class WorkflowResponsibilityService {
  constructor(private readonly db: Db) {}

  async listAssignmentRules(
    tenantId: string,
    opts: { workflowDefinitionVersionId?: string; stepKey?: string } = {},
  ): Promise<WorkflowAssignmentRuleDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowAssignmentRules).where(and(
        or(isNull(workflowAssignmentRules.tenantId), eq(workflowAssignmentRules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
        ...(opts.workflowDefinitionVersionId
          ? [eq(workflowAssignmentRules.workflowDefinitionVersionId, opts.workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`)]
          : []),
        ...(opts.stepKey ? [eq(workflowAssignmentRules.stepKey, opts.stepKey)] : []),
      )).orderBy(asc(workflowAssignmentRules.priority), asc(workflowAssignmentRules.createdAt)),
    );
    return rows.map(ruleToDto);
  }

  async createAssignmentRule(
    tenantId: string,
    input: CreateWorkflowAssignmentRuleInput,
  ): Promise<string> {
    validateRole(input.roleCode, 'roleCode');
    validateRole(input.assigneeRoleCode, 'assigneeRoleCode');
    if (!input.assigneeRoleCode && !input.assigneeExpression) {
      throw new ValidationError('Workflow assignment rule must define an assignee role or expression');
    }

    const ruleId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(workflowAssignmentRules).values({
        id: ruleId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        workflowDefinitionVersionId: input.workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`,
        stepKey: input.stepKey,
        ruleKey: input.ruleKey,
        priority: input.priority ?? 100,
        roleCode: input.roleCode ?? null,
        organisationalUnitCode: input.organisationalUnitCode ?? null,
        programmeId: input.programmeId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        sourceSystemCode: input.sourceSystemCode ?? null,
        assigneeRoleCode: input.assigneeRoleCode ?? null,
        assigneeExpression: input.assigneeExpression ?? null,
        configuration: input.configuration ?? {},
        active: input.active ?? true,
      });
    });
    return ruleId;
  }

  async resolveTaskAssignment(
    tenantId: string,
    context: WorkflowAssignmentContext,
    explicit: { assigneeRoleCode?: string; assigneeActorId?: string } = {},
  ): Promise<WorkflowAssignmentResolution> {
    validateRole(explicit.assigneeRoleCode, 'assigneeRoleCode');
    const rules = await this.listAssignmentRules(tenantId, {
      workflowDefinitionVersionId: context.workflowDefinitionVersionId,
      stepKey: context.stepKey,
    });
    const match = selectWorkflowAssignmentRule(rules, context);
    if (match) {
      return {
        ...(match.assigneeRoleCode ? { assigneeRoleCode: match.assigneeRoleCode } : {}),
        ...(match.assigneeExpression ? { assigneeExpression: match.assigneeExpression } : {}),
        ruleKey: match.ruleKey,
        ruleId: match.workflowAssignmentRuleId,
        reasonCode: 'assignment-rule-match',
      };
    }

    if (explicit.assigneeActorId || explicit.assigneeRoleCode) {
      return {
        ...(explicit.assigneeRoleCode ? { assigneeRoleCode: explicit.assigneeRoleCode } : {}),
        reasonCode: 'explicit-assignee',
      };
    }
    return { reasonCode: 'unassigned' };
  }

  async assertCanCompleteTask(
    tenantId: string,
    workflowTaskId: string,
    actor: WorkflowTaskCompletionActor,
  ): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.id, workflowTaskId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowTasks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowTask', workflowTaskId);
    assertActorCanCompleteWorkflowTask(rows[0], actor);
  }
}

export function selectWorkflowAssignmentRule(
  rules: WorkflowAssignmentRuleDto[],
  context: WorkflowAssignmentContext,
): WorkflowAssignmentRuleDto | null {
  const matches = rules
    .filter((rule) => rule.active)
    .filter((rule) => rule.workflowDefinitionVersionId === context.workflowDefinitionVersionId)
    .filter((rule) => rule.stepKey === context.stepKey)
    .filter((rule) => scopeMatches(rule.roleCode, context.roleCodes))
    .filter((rule) => scopeMatches(rule.organisationalUnitCode, context.organisationalUnitCode))
    .filter((rule) => scopeMatches(rule.programmeId, context.programmeId))
    .filter((rule) => scopeMatches(rule.sourceSystemCode, context.sourceSystemCode));

  return matches.sort(compareAssignmentRules)[0] ?? null;
}

export function assertActorCanCompleteWorkflowTask(
  task: Pick<TaskRow, 'assigneeActorId' | 'assigneeRoleCode'>,
  actor: WorkflowTaskCompletionActor,
): void {
  if (task.assigneeActorId && task.assigneeActorId !== actor.actorId) {
    throw new ForbiddenError('Workflow task is assigned to a different actor');
  }
  if (task.assigneeRoleCode && !actor.roles.includes(task.assigneeRoleCode as Role)) {
    throw new ForbiddenError(`Workflow task requires role '${task.assigneeRoleCode}'`);
  }
  if (!task.assigneeActorId && !task.assigneeRoleCode && !hasPermission(actor.roles, 'workflow:write')) {
    throw new ForbiddenError('Workflow task is not assigned to one of the actor roles');
  }
}

function compareAssignmentRules(a: WorkflowAssignmentRuleDto, b: WorkflowAssignmentRuleDto): number {
  const priority = a.priority - b.priority;
  if (priority !== 0) return priority;
  const specificity = assignmentSpecificity(b) - assignmentSpecificity(a);
  if (specificity !== 0) return specificity;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return a.workflowAssignmentRuleId.localeCompare(b.workflowAssignmentRuleId);
}

function assignmentSpecificity(rule: WorkflowAssignmentRuleDto): number {
  return [
    rule.roleCode,
    rule.organisationalUnitCode,
    rule.programmeId,
    rule.sourceSystemCode,
  ].filter((value) => value !== null).length;
}

function scopeMatches(ruleValue: string | null, contextValue: string | string[] | undefined): boolean {
  if (ruleValue === null) return true;
  if (Array.isArray(contextValue)) return contextValue.includes(ruleValue);
  return ruleValue === contextValue;
}

function validateRole(roleCode: string | undefined, fieldName: string): void {
  if (!roleCode) return;
  if (!(ROLES as readonly string[]).includes(roleCode)) {
    throw new ValidationError(`Invalid role '${roleCode}' for ${fieldName}`, [
      { field: fieldName, message: `Role '${roleCode}' is not defined in the actor catalogue` },
    ]);
  }
}

function ruleToDto(row: RuleRow): WorkflowAssignmentRuleDto {
  return {
    workflowAssignmentRuleId: row.id,
    tenantId: row.tenantId,
    workflowDefinitionVersionId: row.workflowDefinitionVersionId,
    stepKey: row.stepKey,
    ruleKey: row.ruleKey,
    priority: row.priority,
    roleCode: row.roleCode,
    organisationalUnitCode: row.organisationalUnitCode,
    programmeId: row.programmeId,
    sourceSystemCode: row.sourceSystemCode,
    assigneeRoleCode: row.assigneeRoleCode,
    assigneeExpression: row.assigneeExpression,
    configuration: row.configuration,
    active: row.active,
    createdAt: row.createdAt,
  };
}
