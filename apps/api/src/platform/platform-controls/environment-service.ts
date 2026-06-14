import { and, desc, eq } from 'drizzle-orm';
import {
  deploymentEnvironments,
  environmentPromotionRecords,
  featureFlags,
  workflowDefinitions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

export interface DeploymentEnvironmentDto {
  deploymentEnvironmentId: string;
  environmentCode: string;
  displayName: string;
  environmentTypeCode: string;
  productionLike: boolean;
  liveIntegrationsAllowed: boolean;
  configuration: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEnvironmentPromotionInput {
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
  artefactTypeCode: string;
  artefactReference: string;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentPromotionRecordDto {
  environmentPromotionRecordId: string;
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
  artefactTypeCode: string;
  artefactReference: string;
  statusCode: string;
  requestedBy: string;
  approvedBy: string | null;
  promotedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface RuntimeDeploymentMetadata {
  environmentCode: string;
  releaseVersion: string;
  imageDigest?: string;
  migrationVersion: string;
}

export interface EnvironmentRuntimeReportDto {
  environment: DeploymentEnvironmentDto;
  releaseVersion: string;
  imageDigest: string | null;
  migrationVersion: string;
  workflowDefinitions: Array<{
    definitionCode: string;
    currentVersionNumber: number | null;
  }>;
  featureFlags: Array<{
    flagKey: string;
    statusCode: string;
    defaultVariantKey: string;
  }>;
}

export class EnvironmentService {
  constructor(
    private readonly db: Db,
    private readonly runtime: RuntimeDeploymentMetadata = {
      environmentCode: 'local',
      releaseVersion: '0.0.0',
      migrationVersion: 'unknown',
    },
  ) {}

  async listEnvironments(opts: { active?: boolean } = {}): Promise<DeploymentEnvironmentDto[]> {
    const rows = await this.db.select().from(deploymentEnvironments).where(and(
      ...(opts.active !== undefined ? [eq(deploymentEnvironments.active, opts.active)] : []),
    )).orderBy(deploymentEnvironments.environmentCode);
    return rows.map(environmentToDto);
  }

  async getEnvironment(deploymentEnvironmentId: string): Promise<DeploymentEnvironmentDto> {
    const rows = await this.db.select().from(deploymentEnvironments).where(
      eq(deploymentEnvironments.id, deploymentEnvironmentId as `${string}-${string}-${string}-${string}-${string}`),
    ).limit(1);
    if (!rows[0]) throw new NotFoundError('DeploymentEnvironment', deploymentEnvironmentId);
    return environmentToDto(rows[0]);
  }

  async getEnvironmentByCode(environmentCode: string): Promise<DeploymentEnvironmentDto> {
    const rows = await this.db.select().from(deploymentEnvironments).where(
      eq(deploymentEnvironments.environmentCode, environmentCode),
    ).limit(1);
    if (!rows[0]) throw new NotFoundError('DeploymentEnvironment', environmentCode);
    return environmentToDto(rows[0]);
  }

  async getRuntimeReport(): Promise<EnvironmentRuntimeReportDto> {
    const environment = await this.getEnvironmentByCode(this.runtime.environmentCode);
    const workflowRows = await this.db.select({
      definitionCode: workflowDefinitions.definitionCode,
      currentVersionNumber: workflowDefinitions.currentVersionNumber,
    }).from(workflowDefinitions).orderBy(workflowDefinitions.definitionCode);
    const flagRows = await this.db.select({
      flagKey: featureFlags.flagKey,
      statusCode: featureFlags.statusCode,
      defaultVariantKey: featureFlags.defaultVariantKey,
    }).from(featureFlags).orderBy(featureFlags.flagKey);

    return {
      environment,
      releaseVersion: this.runtime.releaseVersion,
      imageDigest: this.runtime.imageDigest ?? null,
      migrationVersion: this.runtime.migrationVersion,
      workflowDefinitions: workflowRows,
      featureFlags: flagRows,
    };
  }

  async listPromotionRecords(tenantId: string): Promise<EnvironmentPromotionRecordDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(environmentPromotionRecords).where(
        eq(environmentPromotionRecords.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      ).orderBy(desc(environmentPromotionRecords.createdAt)),
    );
    return rows.map(promotionToDto);
  }

  async createPromotionRecord(
    tenantId: string,
    input: CreateEnvironmentPromotionInput,
    actorId: string,
  ): Promise<string> {
    await this.getEnvironment(input.sourceEnvironmentId);
    await this.getEnvironment(input.targetEnvironmentId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(environmentPromotionRecords).values({
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        sourceEnvironmentId: input.sourceEnvironmentId as `${string}-${string}-${string}-${string}-${string}`,
        targetEnvironmentId: input.targetEnvironmentId as `${string}-${string}-${string}-${string}-${string}`,
        artefactTypeCode: input.artefactTypeCode,
        artefactReference: input.artefactReference,
        statusCode: 'requested',
        requestedBy: actorId,
        metadata: {
          ...(input.metadata ?? {}),
          deployment: {
            environmentCode: this.runtime.environmentCode,
            releaseVersion: this.runtime.releaseVersion,
            imageDigest: this.runtime.imageDigest ?? null,
            migrationVersion: this.runtime.migrationVersion,
          },
        },
      }).returning({ id: environmentPromotionRecords.id }),
    );
    return rows[0]!.id;
  }
}

function environmentToDto(row: typeof deploymentEnvironments.$inferSelect): DeploymentEnvironmentDto {
  return {
    deploymentEnvironmentId: row.id,
    environmentCode: row.environmentCode,
    displayName: row.displayName,
    environmentTypeCode: row.environmentTypeCode,
    productionLike: row.productionLike,
    liveIntegrationsAllowed: row.liveIntegrationsAllowed,
    configuration: row.configuration,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function promotionToDto(row: typeof environmentPromotionRecords.$inferSelect): EnvironmentPromotionRecordDto {
  return {
    environmentPromotionRecordId: row.id,
    sourceEnvironmentId: row.sourceEnvironmentId,
    targetEnvironmentId: row.targetEnvironmentId,
    artefactTypeCode: row.artefactTypeCode,
    artefactReference: row.artefactReference,
    statusCode: row.statusCode,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    promotedAt: row.promotedAt,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}
