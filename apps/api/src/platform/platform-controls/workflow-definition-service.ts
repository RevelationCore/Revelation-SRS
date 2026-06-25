import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  workflowDefinitions,
  workflowDefinitionVersions,
  workflowSteps,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

export interface WorkflowStepDto {
  stepKey:       string;
  stepTypeCode:  string;
  displayName:   string;
  ownerRoleCode: string | null;
  sortOrder:     number;
}

export interface WorkflowDefinitionDto {
  workflowDefinitionId: string;
  tenantId: string | null;
  definitionCode: string;
  displayName: string;
  ownerModuleCode: string;
  statusCode: string;
  currentVersionNumber: number | null;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowDefinitionVersionDto {
  workflowDefinitionVersionId: string;
  workflowDefinitionId: string;
  versionNumber: number;
  statusCode: string;
  definitionJson: Record<string, unknown>;
  bpmnSourceId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdBy: string;
  createdAt: Date;
  steps: WorkflowStepDto[];
}

export interface CreateWorkflowDefinitionInput {
  definitionCode:   string;
  displayName:      string;
  description?:     string;
  ownerModuleCode?: string;
}

export interface UpdateWorkflowDefinitionInput {
  statusCode?:  string;
  displayName?: string;
  description?: string;
}

export class WorkflowDefinitionService {
  constructor(private readonly db: Db) {}

  async listDefinitions(tenantId: string, opts: { statusCode?: string } = {}): Promise<WorkflowDefinitionDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowDefinitions).where(and(
        or(isNull(workflowDefinitions.tenantId), eq(workflowDefinitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
        ...(opts.statusCode ? [eq(workflowDefinitions.statusCode, opts.statusCode)] : []),
      )).orderBy(asc(workflowDefinitions.definitionCode)),
    );
    return rows.map(definitionToDto);
  }

  async getDefinition(workflowDefinitionId: string, tenantId: string): Promise<WorkflowDefinitionDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowDefinitions).where(and(
        eq(workflowDefinitions.id, workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`),
        or(isNull(workflowDefinitions.tenantId), eq(workflowDefinitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinition', workflowDefinitionId);
    return definitionToDto(rows[0]);
  }

  async listVersions(workflowDefinitionId: string, tenantId: string): Promise<WorkflowDefinitionVersionDto[]> {
    await this.getDefinition(workflowDefinitionId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowDefinitionVersions).where(
        eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`),
      ).orderBy(asc(workflowDefinitionVersions.versionNumber)),
    );
    if (rows.length === 0) return [];
    const stepRows = await this.db
      .select()
      .from(workflowSteps)
      .where(inArray(workflowSteps.workflowDefinitionVersionId, rows.map((r) => r.id)))
      .orderBy(asc(workflowSteps.sortOrder));
    return rows.map((r) => versionToDto(r, stepRows.filter((s) => s.workflowDefinitionVersionId === r.id)));
  }

  async getVersion(workflowDefinitionVersionId: string, tenantId: string): Promise<WorkflowDefinitionVersionDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({
        version: workflowDefinitionVersions,
      }).from(workflowDefinitionVersions)
        .innerJoin(workflowDefinitions, eq(workflowDefinitionVersions.workflowDefinitionId, workflowDefinitions.id))
        .where(and(
          eq(workflowDefinitionVersions.id, workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`),
          or(isNull(workflowDefinitions.tenantId), eq(workflowDefinitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
        ))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('WorkflowDefinitionVersion', workflowDefinitionVersionId);
    const stepRows = await this.db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowDefinitionVersionId, workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}`))
      .orderBy(asc(workflowSteps.sortOrder));
    return versionToDto(rows[0].version, stepRows);
  }

  async createDefinition(
    tenantId: string,
    input: CreateWorkflowDefinitionInput,
    actorId: string,
  ): Promise<string> {
    const id  = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(workflowDefinitions).values({
        id,
        tenantId:       tenantId as `${string}-${string}-${string}-${string}-${string}`,
        definitionCode: input.definitionCode,
        displayName:    input.displayName,
        description:    input.description ?? null,
        ownerModuleCode: input.ownerModuleCode ?? 'custom',
        statusCode:     'active',
        createdBy:      actorId,
        createdAt:      now,
        updatedAt:      now,
      }),
    );
    return id;
  }

  async updateDefinition(
    workflowDefinitionId: string,
    tenantId: string,
    input: UpdateWorkflowDefinitionInput,
  ): Promise<void> {
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(and(
          eq(workflowDefinitions.id, workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`),
          or(isNull(workflowDefinitions.tenantId), eq(workflowDefinitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
        ))
        .limit(1),
    );
    if (!existing[0]) throw new NotFoundError('WorkflowDefinition', workflowDefinitionId);
    await withTenantContext(this.db, tenantId, async (tx) =>
      tx.update(workflowDefinitions)
        .set({
          ...(input.statusCode  !== undefined ? { statusCode:  input.statusCode }  : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: clockNow(),
        })
        .where(eq(workflowDefinitions.id, workflowDefinitionId as `${string}-${string}-${string}-${string}-${string}`)),
    );
  }
}

function definitionToDto(row: typeof workflowDefinitions.$inferSelect): WorkflowDefinitionDto {
  return {
    workflowDefinitionId: row.id,
    tenantId: row.tenantId,
    definitionCode: row.definitionCode,
    displayName: row.displayName,
    ownerModuleCode: row.ownerModuleCode,
    statusCode: row.statusCode,
    currentVersionNumber: row.currentVersionNumber,
    description: row.description,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function versionToDto(
  row: typeof workflowDefinitionVersions.$inferSelect,
  steps: typeof workflowSteps.$inferSelect[],
): WorkflowDefinitionVersionDto {
  return {
    workflowDefinitionVersionId: row.id,
    workflowDefinitionId: row.workflowDefinitionId,
    versionNumber: row.versionNumber,
    statusCode: row.statusCode,
    definitionJson: row.definitionJson,
    bpmnSourceId: row.bpmnSourceId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    steps: steps.map((s) => ({
      stepKey:       s.stepKey,
      stepTypeCode:  s.stepTypeCode,
      displayName:   s.displayName,
      ownerRoleCode: s.ownerRoleCode ?? null,
      sortOrder:     s.sortOrder,
    })),
  };
}
