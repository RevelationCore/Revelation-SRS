import { and, desc, eq } from 'drizzle-orm';
import {
  workflowInstances,
  workflowTasks,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

export interface WorkflowInstanceDto {
  workflowInstanceId: string;
  environmentId: string | null;
  workflowDefinitionVersionId: string;
  workflowCode: string;
  subjectEntityType: string;
  subjectEntityId: string | null;
  statusCode: string;
  correlationId: string | null;
  startedBy: string;
  startedAt: Date;
  completedAt: Date | null;
  context: Record<string, unknown>;
  createdAt: Date;
}

export interface WorkflowTaskDto {
  workflowTaskId: string;
  workflowInstanceId: string;
  stepKey: string;
  taskTypeCode: string;
  statusCode: string;
  assigneeActorId: string | null;
  assigneeRoleCode: string | null;
  dueAt: Date | null;
  completedBy: string | null;
  completedAt: Date | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkflowInstanceService {
  constructor(private readonly db: Db) {}

  async listInstances(
    tenantId: string,
    opts: { statusCode?: string; subjectEntityType?: string; subjectEntityId?: string } = {},
  ): Promise<WorkflowInstanceDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ...(opts.statusCode ? [eq(workflowInstances.statusCode, opts.statusCode)] : []),
        ...(opts.subjectEntityType ? [eq(workflowInstances.subjectEntityType, opts.subjectEntityType)] : []),
        ...(opts.subjectEntityId ? [eq(workflowInstances.subjectEntityId, opts.subjectEntityId as `${string}-${string}-${string}-${string}-${string}`)] : []),
      )).orderBy(desc(workflowInstances.startedAt)),
    );
    return rows.map(instanceToDto);
  }

  async getInstance(workflowInstanceId: string, tenantId: string): Promise<WorkflowInstanceDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowInstances).where(and(
        eq(workflowInstances.id, workflowInstanceId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowInstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowInstance', workflowInstanceId);
    return instanceToDto(rows[0]);
  }
}

export class WorkflowTaskService {
  constructor(private readonly db: Db) {}

  async listTasks(
    tenantId: string,
    opts: { statusCode?: string; assigneeRoleCode?: string; workflowInstanceId?: string } = {},
  ): Promise<WorkflowTaskDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ...(opts.statusCode ? [eq(workflowTasks.statusCode, opts.statusCode)] : []),
        ...(opts.assigneeRoleCode ? [eq(workflowTasks.assigneeRoleCode, opts.assigneeRoleCode)] : []),
        ...(opts.workflowInstanceId ? [eq(workflowTasks.workflowInstanceId, opts.workflowInstanceId as `${string}-${string}-${string}-${string}-${string}`)] : []),
      )).orderBy(desc(workflowTasks.createdAt)),
    );
    return rows.map(taskToDto);
  }

  async getTask(workflowTaskId: string, tenantId: string): Promise<WorkflowTaskDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTasks).where(and(
        eq(workflowTasks.id, workflowTaskId as `${string}-${string}-${string}-${string}-${string}`),
        eq(workflowTasks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowTask', workflowTaskId);
    return taskToDto(rows[0]);
  }
}

function instanceToDto(row: typeof workflowInstances.$inferSelect): WorkflowInstanceDto {
  return {
    workflowInstanceId: row.id,
    environmentId: row.environmentId,
    workflowDefinitionVersionId: row.workflowDefinitionVersionId,
    workflowCode: row.workflowCode,
    subjectEntityType: row.subjectEntityType,
    subjectEntityId: row.subjectEntityId,
    statusCode: row.statusCode,
    correlationId: row.correlationId,
    startedBy: row.startedBy,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    context: row.context,
    createdAt: row.createdAt,
  };
}

function taskToDto(row: typeof workflowTasks.$inferSelect): WorkflowTaskDto {
  return {
    workflowTaskId: row.id,
    workflowInstanceId: row.workflowInstanceId,
    stepKey: row.stepKey,
    taskTypeCode: row.taskTypeCode,
    statusCode: row.statusCode,
    assigneeActorId: row.assigneeActorId,
    assigneeRoleCode: row.assigneeRoleCode,
    dueAt: row.dueAt,
    completedBy: row.completedBy,
    completedAt: row.completedAt,
    payload: row.payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
