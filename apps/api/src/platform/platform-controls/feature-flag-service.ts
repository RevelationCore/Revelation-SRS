import { randomUUID } from 'node:crypto';

import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  deploymentEnvironments,
  featureFlagAssignments,
  featureFlagVariants,
  featureFlags,
  workflowTriggerRules,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

export interface FeatureFlagVariantInput {
  variantKey: string;
  displayName: string;
  value: unknown;
  sortOrder?: number;
}

export interface CreateFeatureFlagInput {
  flagKey: string;
  displayName: string;
  description?: string;
  ownerModuleCode: string;
  valueTypeCode?: string;
  defaultVariantKey?: string;
  variants?: FeatureFlagVariantInput[];
}

export interface UpdateFeatureFlagInput {
  displayName?: string;
  description?: string | null;
  ownerModuleCode?: string;
  statusCode?: string;
  defaultVariantKey?: string;
}

export interface UpdateGovernanceInput {
  flagClassCode?: string;
  riskClassCode?: string;
  ownerContact?: string | null;
  reviewDate?: string | null;
  retirementCondition?: string | null;
  allowedScopeCodes?: string[];
  nonBypassable?: boolean;
}

export interface FlagImpactDto {
  activeAssignmentCount: number;
  activeTenantsCount: number;
  activeTenantIds: string[];
  referencingTriggerRuleKeys: string[];
  currentDefaultVariantKey: string;
  currentDefaultValue: unknown;
}

export interface CreateFeatureFlagAssignmentInput {
  environmentId?: string;
  environmentCode?: string;
  variantKey?: string;
  workflowDefinitionVersionId?: string;
  roleCode?: string;
  cohortCode?: string;
  programmeId?: string;
  academicYear?: string;
  sourceSystemCode?: string;
  priority?: number;
  ruleExpression?: string;
  configuration?: Record<string, unknown>;
  activeFrom?: Date;
  activeTo?: Date;
}

export interface FeatureFlagDto {
  featureFlagId: string;
  flagKey: string;
  displayName: string;
  description: string | null;
  ownerModuleCode: string;
  statusCode: string;
  valueTypeCode: string;
  defaultVariantKey: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  variants: FeatureFlagVariantDto[];
  // Governance metadata (migration 0017)
  flagClassCode: string;
  riskClassCode: string;
  ownerContact: string | null;
  reviewDate: string | null;
  retirementCondition: string | null;
  allowedScopeCodes: string[];
  nonBypassable: boolean;
}

export interface FeatureFlagVariantDto {
  featureFlagVariantId: string;
  variantKey: string;
  displayName: string;
  value: unknown;
  sortOrder: number;
}

export interface FeatureFlagAssignmentDto {
  featureFlagAssignmentId: string;
  tenantId: string | null;
  environmentId: string | null;
  featureFlagId: string;
  variantId: string | null;
  workflowDefinitionVersionId: string | null;
  roleCode: string | null;
  cohortCode: string | null;
  programmeId: string | null;
  academicYear: string | null;
  sourceSystemCode: string | null;
  priority: number;
  statusCode: string;
  ruleExpression: string | null;
  configuration: Record<string, unknown>;
  activeFrom: Date;
  activeTo: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFlagEvaluationContext {
  tenantId: string;
  environmentId?: string;
  environmentCode?: string;
  roleCode?: string;
  cohortCode?: string;
  programmeId?: string;
  academicYear?: string;
  sourceSystemCode?: string;
  workflowDefinitionVersionId?: string;
}

export interface FeatureFlagEvaluationResult {
  flagKey: string;
  variantKey: string;
  value: unknown;
  reasonCode: 'assignment-match' | 'default';
  assignmentId: string | null;
}

type AssignmentRow = typeof featureFlagAssignments.$inferSelect;

export class FeatureFlagService {
  constructor(private readonly db: Db) {}

  async createFlag(tenantId: string, input: CreateFeatureFlagInput, actorId: string): Promise<string> {
    const variants = input.variants && input.variants.length > 0
      ? input.variants
      : [
          { variantKey: 'off', displayName: 'Off', value: false, sortOrder: 10 },
          { variantKey: 'on', displayName: 'On', value: true, sortOrder: 20 },
        ];
    const defaultVariantKey = input.defaultVariantKey ?? variants[0]!.variantKey;
    if (!variants.some((variant) => variant.variantKey === defaultVariantKey)) {
      throw new ValidationError(`Default variant '${defaultVariantKey}' is not defined`);
    }

    const flagId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(featureFlags).values({
        id: flagId,
        flagKey: input.flagKey,
        displayName: input.displayName,
        description: input.description ?? null,
        ownerModuleCode: input.ownerModuleCode,
        statusCode: 'active',
        valueTypeCode: input.valueTypeCode ?? 'boolean',
        defaultVariantKey,
        createdBy: actorId,
      });

      for (const variant of variants) {
        await tx.insert(featureFlagVariants).values({
          flagId: flagId,
          variantKey: variant.variantKey,
          displayName: variant.displayName,
          value: variant.value,
          sortOrder: variant.sortOrder ?? 0,
        });
      }
    });
    return flagId;
  }

  async listFlags(): Promise<FeatureFlagDto[]> {
    const flags = await this.db.select().from(featureFlags).orderBy(asc(featureFlags.flagKey));
    if (flags.length === 0) return [];
    const variants = await this.db.select().from(featureFlagVariants).where(
      inArray(featureFlagVariants.flagId, flags.map((flag) => flag.id)),
    ).orderBy(asc(featureFlagVariants.sortOrder));
    return flags.map((flag) => flagToDto(flag, variants.filter((variant) => variant.flagId === flag.id)));
  }

  async getFlag(featureFlagId: string): Promise<FeatureFlagDto> {
    const rows = await this.db.select().from(featureFlags).where(
      eq(featureFlags.id, featureFlagId as `${string}-${string}-${string}-${string}-${string}`),
    ).limit(1);
    if (!rows[0]) throw new NotFoundError('FeatureFlag', featureFlagId);
    const variants = await this.db.select().from(featureFlagVariants).where(eq(featureFlagVariants.flagId, rows[0].id));
    return flagToDto(rows[0], variants);
  }

  async getFlagByKey(flagKey: string): Promise<FeatureFlagDto> {
    const rows = await this.db.select().from(featureFlags).where(eq(featureFlags.flagKey, flagKey)).limit(1);
    if (!rows[0]) throw new NotFoundError('FeatureFlag', flagKey);
    const variants = await this.db.select().from(featureFlagVariants).where(eq(featureFlagVariants.flagId, rows[0].id));
    return flagToDto(rows[0], variants);
  }

  async updateFlag(featureFlagId: string, input: UpdateFeatureFlagInput): Promise<void> {
    const current = await this.getFlag(featureFlagId);
    if (input.defaultVariantKey && !current.variants.some((variant) => variant.variantKey === input.defaultVariantKey)) {
      throw new ValidationError(`Default variant '${input.defaultVariantKey}' is not defined`);
    }
    await this.db.update(featureFlags).set({
      displayName: input.displayName ?? current.displayName,
      description: input.description === undefined ? current.description : input.description,
      ownerModuleCode: input.ownerModuleCode ?? current.ownerModuleCode,
      statusCode: input.statusCode ?? current.statusCode,
      defaultVariantKey: input.defaultVariantKey ?? current.defaultVariantKey,
      updatedAt: clockNow(),
    }).where(eq(featureFlags.id, featureFlagId as `${string}-${string}-${string}-${string}-${string}`));
  }

  async retireFlag(featureFlagId: string): Promise<void> {
    await this.updateFlag(featureFlagId, { statusCode: 'retired' });
  }

  async updateGovernance(featureFlagId: string, input: UpdateGovernanceInput): Promise<void> {
    await this.getFlag(featureFlagId);
    await this.db.update(featureFlags).set({
      ...(input.flagClassCode     !== undefined ? { flagClassCode:       input.flagClassCode }     : {}),
      ...(input.riskClassCode     !== undefined ? { riskClassCode:       input.riskClassCode }     : {}),
      ...(input.ownerContact      !== undefined ? { ownerContact:        input.ownerContact }      : {}),
      ...(input.reviewDate        !== undefined ? { reviewDate:          input.reviewDate }        : {}),
      ...(input.retirementCondition !== undefined ? { retirementCondition: input.retirementCondition } : {}),
      ...(input.allowedScopeCodes !== undefined ? { allowedScopeCodes:   input.allowedScopeCodes } : {}),
      ...(input.nonBypassable     !== undefined ? { nonBypassable:       input.nonBypassable }     : {}),
      updatedAt: clockNow(),
    }).where(eq(featureFlags.id, featureFlagId as `${string}-${string}-${string}-${string}-${string}`));
  }

  async getImpact(featureFlagId: string): Promise<FlagImpactDto> {
    const flag = await this.getFlag(featureFlagId);
    const now  = clockNow();

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(featureFlagAssignments)
      .where(and(
        eq(featureFlagAssignments.flagId, featureFlagId as `${string}-${string}-${string}-${string}-${string}`),
        eq(featureFlagAssignments.statusCode, 'active'),
        or(isNull(featureFlagAssignments.activeTo), gt(featureFlagAssignments.activeTo, now)),
      ));

    const tenantRows = await this.db
      .selectDistinct({ tenantId: featureFlagAssignments.tenantId })
      .from(featureFlagAssignments)
      .where(and(
        eq(featureFlagAssignments.flagId, featureFlagId as `${string}-${string}-${string}-${string}-${string}`),
        eq(featureFlagAssignments.statusCode, 'active'),
        isNotNull(featureFlagAssignments.tenantId),
        or(isNull(featureFlagAssignments.activeTo), gt(featureFlagAssignments.activeTo, now)),
      ));

    const triggerRows = await this.db
      .select({ triggerKey: workflowTriggerRules.triggerKey })
      .from(workflowTriggerRules)
      .where(and(
        eq(workflowTriggerRules.active, true),
        sql`${workflowTriggerRules.configuration}::jsonb @> ${JSON.stringify({ flagKey: flag.flagKey })}::jsonb`,
      ));

    const defaultVariant = flag.variants.find((v) => v.variantKey === flag.defaultVariantKey);
    return {
      activeAssignmentCount:      countRow?.count ?? 0,
      activeTenantsCount:         tenantRows.length,
      activeTenantIds:            tenantRows.map((r) => r.tenantId!).filter(Boolean),
      referencingTriggerRuleKeys: triggerRows.map((r) => r.triggerKey),
      currentDefaultVariantKey:   flag.defaultVariantKey,
      currentDefaultValue:        defaultVariant?.value ?? null,
    };
  }

  async createAssignment(
    tenantId: string,
    featureFlagId: string,
    input: CreateFeatureFlagAssignmentInput,
    actorId: string,
  ): Promise<string> {
    const flag = await this.getFlag(featureFlagId);
    const variantKey = input.variantKey ?? flag.defaultVariantKey;
    const variant = flag.variants.find((candidate) => candidate.variantKey === variantKey);
    if (!variant) throw new ValidationError(`Variant '${variantKey}' is not defined`);
    const environmentId = input.environmentId ?? (input.environmentCode
      ? await this.#getEnvironmentIdByCode(input.environmentCode)
      : null);

    const assignmentId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(featureFlagAssignments).values({
        id: assignmentId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        environmentId: environmentId as `${string}-${string}-${string}-${string}-${string}` | null,
        flagId: featureFlagId as `${string}-${string}-${string}-${string}-${string}`,
        variantId: variant.featureFlagVariantId as `${string}-${string}-${string}-${string}-${string}`,
        workflowDefinitionVersionId: input.workflowDefinitionVersionId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        roleCode: input.roleCode ?? null,
        cohortCode: input.cohortCode ?? null,
        programmeId: input.programmeId as `${string}-${string}-${string}-${string}-${string}` | undefined ?? null,
        academicYear: input.academicYear ?? null,
        sourceSystemCode: input.sourceSystemCode ?? null,
        priority: input.priority ?? 100,
        statusCode: 'active',
        ruleExpression: input.ruleExpression ?? null,
        configuration: input.configuration ?? {},
        activeFrom: input.activeFrom ?? clockNow(),
        activeTo: input.activeTo ?? null,
        createdBy: actorId,
      });
    });
    return assignmentId;
  }

  async listAssignments(tenantId: string, featureFlagId: string): Promise<FeatureFlagAssignmentDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(featureFlagAssignments).where(and(
        eq(featureFlagAssignments.flagId, featureFlagId as `${string}-${string}-${string}-${string}-${string}`),
        or(isNull(featureFlagAssignments.tenantId), eq(featureFlagAssignments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
      )).orderBy(asc(featureFlagAssignments.priority), asc(featureFlagAssignments.createdAt)),
    );
    return rows.map(assignmentToDto);
  }

  async evaluatePreview(
    featureFlagId: string,
    context: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagEvaluationResult> {
    const flag = await this.getFlag(featureFlagId);
    const environmentId = context.environmentId ?? (context.environmentCode
      ? await this.#getEnvironmentIdByCode(context.environmentCode)
      : undefined);
    const assignments = await this.listAssignments(context.tenantId, featureFlagId);
    const evaluationContext = environmentId ? { ...context, environmentId } : context;
    const match = selectMatchingAssignment(assignments, evaluationContext);
    if (!match) {
      const variant = flag.variants.find((candidate) => candidate.variantKey === flag.defaultVariantKey);
      return {
        flagKey: flag.flagKey,
        variantKey: flag.defaultVariantKey,
        value: variant?.value ?? null,
        reasonCode: 'default',
        assignmentId: null,
      };
    }

    const variant = flag.variants.find((candidate) => candidate.featureFlagVariantId === match.variantId)
      ?? flag.variants.find((candidate) => candidate.variantKey === flag.defaultVariantKey);
    return {
      flagKey: flag.flagKey,
      variantKey: variant?.variantKey ?? flag.defaultVariantKey,
      value: variant?.value ?? null,
      reasonCode: 'assignment-match',
      assignmentId: match.featureFlagAssignmentId,
    };
  }

  async #getEnvironmentIdByCode(environmentCode: string): Promise<string> {
    const rows = await this.db.select({ id: deploymentEnvironments.id }).from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.environmentCode, environmentCode))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('DeploymentEnvironment', environmentCode);
    return rows[0].id;
  }
}

export function selectMatchingAssignment(
  assignments: FeatureFlagAssignmentDto[],
  context: FeatureFlagEvaluationContext & { environmentId?: string },
): FeatureFlagAssignmentDto | null {
  const now = clockNow();
  const matches = assignments
    .filter((assignment) => assignment.statusCode === 'active')
    .filter((assignment) => assignment.activeFrom <= now && (assignment.activeTo === null || assignment.activeTo > now))
    .filter((assignment) => scopeMatches(assignment.environmentId, context.environmentId))
    .filter((assignment) => scopeMatches(assignment.roleCode, context.roleCode))
    .filter((assignment) => scopeMatches(assignment.cohortCode, context.cohortCode))
    .filter((assignment) => scopeMatches(assignment.programmeId, context.programmeId))
    .filter((assignment) => scopeMatches(assignment.academicYear, context.academicYear))
    .filter((assignment) => scopeMatches(assignment.sourceSystemCode, context.sourceSystemCode))
    .filter((assignment) => scopeMatches(assignment.workflowDefinitionVersionId, context.workflowDefinitionVersionId));

  return matches.sort(compareAssignments)[0] ?? null;
}

function compareAssignments(a: FeatureFlagAssignmentDto, b: FeatureFlagAssignmentDto): number {
  const priority = a.priority - b.priority;
  if (priority !== 0) return priority;
  const specificity = assignmentSpecificity(b) - assignmentSpecificity(a);
  if (specificity !== 0) return specificity;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  if (created !== 0) return created;
  return a.featureFlagAssignmentId.localeCompare(b.featureFlagAssignmentId);
}

function assignmentSpecificity(assignment: FeatureFlagAssignmentDto): number {
  return [
    assignment.environmentId,
    assignment.roleCode,
    assignment.cohortCode,
    assignment.programmeId,
    assignment.academicYear,
    assignment.sourceSystemCode,
    assignment.workflowDefinitionVersionId,
  ].filter((value) => value !== null).length;
}

function scopeMatches(assignmentValue: string | null, contextValue: string | undefined): boolean {
  return assignmentValue === null || assignmentValue === contextValue;
}

function flagToDto(
  row: typeof featureFlags.$inferSelect,
  variants: Array<typeof featureFlagVariants.$inferSelect>,
): FeatureFlagDto {
  return {
    featureFlagId:       row.id,
    flagKey:             row.flagKey,
    displayName:         row.displayName,
    description:         row.description,
    ownerModuleCode:     row.ownerModuleCode,
    statusCode:          row.statusCode,
    valueTypeCode:       row.valueTypeCode,
    defaultVariantKey:   row.defaultVariantKey,
    createdBy:           row.createdBy,
    createdAt:           row.createdAt,
    updatedAt:           row.updatedAt,
    variants:            variants.map(variantToDto),
    flagClassCode:       row.flagClassCode,
    riskClassCode:       row.riskClassCode,
    ownerContact:        row.ownerContact ?? null,
    reviewDate:          row.reviewDate ?? null,
    retirementCondition: row.retirementCondition ?? null,
    allowedScopeCodes:   row.allowedScopeCodes ?? ['global', 'tenant', 'environment'],
    nonBypassable:       row.nonBypassable,
  };
}

function variantToDto(row: typeof featureFlagVariants.$inferSelect): FeatureFlagVariantDto {
  return {
    featureFlagVariantId: row.id,
    variantKey: row.variantKey,
    displayName: row.displayName,
    value: row.value,
    sortOrder: row.sortOrder,
  };
}

function assignmentToDto(row: AssignmentRow): FeatureFlagAssignmentDto {
  return {
    featureFlagAssignmentId: row.id,
    tenantId: row.tenantId,
    environmentId: row.environmentId,
    featureFlagId: row.flagId,
    variantId: row.variantId,
    workflowDefinitionVersionId: row.workflowDefinitionVersionId,
    roleCode: row.roleCode,
    cohortCode: row.cohortCode,
    programmeId: row.programmeId,
    academicYear: row.academicYear,
    sourceSystemCode: row.sourceSystemCode,
    priority: row.priority,
    statusCode: row.statusCode,
    ruleExpression: row.ruleExpression,
    configuration: row.configuration,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
