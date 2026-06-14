import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  workflowDefinitions,
  workflowDefinitionVersions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

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
    return rows.map(versionToDto);
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
    return versionToDto(rows[0].version);
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

function versionToDto(row: typeof workflowDefinitionVersions.$inferSelect): WorkflowDefinitionVersionDto {
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
  };
}
