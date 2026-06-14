import { and, eq, isNull, or } from 'drizzle-orm';
import {
  workflowTriggerRules,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';

import type { CreateEnrolmentInput, EnrolmentDto, EnrolmentStatusCode } from '../enrolment/service.js';
import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';

export type EnrolmentDownstreamTriggerType = 'ucas-confirmation' | 'slc-confirmation' | 'ukvi-cas';
export type TriggerRuleMode = 'legacy' | 'configured';
export type EnrolmentTriggerEventType = 'enrolment.created' | 'enrolment.status-transition';

export interface EnrolmentTriggerDecision {
  triggerTypeCode: EnrolmentDownstreamTriggerType;
  sourceReference?: string;
  payloadSummary: Record<string, unknown>;
  evidence: {
    mode: TriggerRuleMode;
    ruleKey: string;
    ruleSource: 'legacy-code' | 'workflow-trigger-rule';
    conditionExpression?: string;
  };
}

export interface EnrolmentStatusTransitionTriggerContext {
  current: EnrolmentDto;
  newStatus: EnrolmentStatusCode;
}

export interface ConfiguredRule {
  triggerKey: string;
  eventType: string;
  targetWorkflowCode: string;
  conditionExpression: string | null;
  configuration: Record<string, unknown>;
  active: boolean;
}

const TRIGGER_MODE_FLAG_KEY = 'enrolment.downstream-triggers.configured-mode';
const SUPPORTED_TRIGGER_TYPES = new Set<EnrolmentDownstreamTriggerType>([
  'ucas-confirmation',
  'slc-confirmation',
  'ukvi-cas',
]);

export class TriggerRuleEvaluator {
  constructor(
    private readonly db?: Db,
    private readonly featureFlags?: FeatureFlagService,
  ) {}

  async evaluateEnrolmentCreation(
    tenantId: string,
    input: CreateEnrolmentInput,
  ): Promise<EnrolmentTriggerDecision[]> {
    const mode = await this.#getMode(tenantId);
    if (mode === 'legacy') return evaluateLegacyEnrolmentCreationTriggers(input);

    const rules = await this.#listConfiguredRules(tenantId, 'enrolment.created');
    return evaluateConfiguredEnrolmentTriggers('enrolment.created', input, rules);
  }

  async evaluateEnrolmentStatusTransition(
    tenantId: string,
    input: EnrolmentStatusTransitionTriggerContext,
  ): Promise<EnrolmentTriggerDecision[]> {
    const mode = await this.#getMode(tenantId);
    if (mode === 'legacy') return evaluateLegacyEnrolmentStatusTransitionTriggers(input);

    const rules = await this.#listConfiguredRules(tenantId, 'enrolment.status-transition');
    return evaluateConfiguredEnrolmentTriggers('enrolment.status-transition', input, rules);
  }

  async #getMode(tenantId: string): Promise<TriggerRuleMode> {
    if (!this.featureFlags) return 'legacy';
    try {
      const flag = await this.featureFlags.getFlagByKey(TRIGGER_MODE_FLAG_KEY);
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, { tenantId });
      return result.value === true || result.variantKey === 'on' ? 'configured' : 'legacy';
    } catch {
      return 'legacy';
    }
  }

  async #listConfiguredRules(tenantId: string, eventType: EnrolmentTriggerEventType): Promise<ConfiguredRule[]> {
    if (!this.db) return [];
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(workflowTriggerRules).where(and(
        eq(workflowTriggerRules.eventType, eventType),
        eq(workflowTriggerRules.active, true),
        or(isNull(workflowTriggerRules.tenantId), eq(workflowTriggerRules.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`)),
      )),
    );
    return rows.map((row) => ({
      triggerKey: row.triggerKey,
      eventType: row.eventType,
      targetWorkflowCode: row.targetWorkflowCode,
      conditionExpression: row.conditionExpression,
      configuration: row.configuration,
      active: row.active,
    }));
  }
}

export function evaluateLegacyEnrolmentCreationTriggers(input: CreateEnrolmentInput): EnrolmentTriggerDecision[] {
  const decisions: EnrolmentTriggerDecision[] = [];
  if (input.ucasPersonalId) {
    decisions.push(triggerDecision('legacy', 'legacy.ucas-confirmation-on-ucas-id', 'ucas-confirmation', {
      sourceReference: input.ucasPersonalId,
      payloadSummary: {
        personId: input.personId,
        academicYear: input.academicYearOfEntry,
        sourceReference: input.ucasPersonalId,
      },
    }));
  }
  if (input.fundingSourceCode === 'slc' || input.slcReference) {
    decisions.push(triggerDecision('legacy', 'legacy.slc-confirmation-on-slc-funding-or-reference', 'slc-confirmation', {
      ...(input.slcReference ? { sourceReference: input.slcReference } : {}),
      payloadSummary: {
        personId: input.personId,
        academicYear: input.academicYearOfEntry,
        sourceReference: input.slcReference,
      },
    }));
  }
  if (input.ukviCasRequired) {
    decisions.push(triggerDecision('legacy', 'legacy.ukvi-cas-on-cas-required', 'ukvi-cas', {
      payloadSummary: {
        personId: input.personId,
        academicYear: input.academicYearOfEntry,
      },
    }));
  }
  return decisions;
}

export function evaluateLegacyEnrolmentStatusTransitionTriggers(
  input: EnrolmentStatusTransitionTriggerContext,
): EnrolmentTriggerDecision[] {
  if (!input.current.slcReference || !['withdrawn', 'intermitting'].includes(input.newStatus)) return [];
  return [
    triggerDecision('legacy', 'legacy.slc-status-change-on-withdrawal-or-intermission', 'slc-confirmation', {
      sourceReference: input.current.slcReference,
      payloadSummary: {
        slcReference: input.current.slcReference,
        notificationType: input.newStatus,
      },
    }),
  ];
}

export function evaluateConfiguredEnrolmentTriggers(
  eventType: EnrolmentTriggerEventType,
  context: CreateEnrolmentInput | EnrolmentStatusTransitionTriggerContext,
  rules: ConfiguredRule[],
): EnrolmentTriggerDecision[] {
  const decisions: EnrolmentTriggerDecision[] = [];
  for (const rule of rules) {
    if (rule.eventType !== eventType || !rule.active) continue;
    if (!SUPPORTED_TRIGGER_TYPES.has(rule.targetWorkflowCode as EnrolmentDownstreamTriggerType)) continue;
    if (!matchesCondition(rule.conditionExpression, context)) continue;

    const triggerTypeCode = rule.targetWorkflowCode as EnrolmentDownstreamTriggerType;
    const sourceReference = sourceReferenceForRule(triggerTypeCode, context, rule.configuration);
    const payloadSummary = payloadSummaryForRule(triggerTypeCode, eventType, context, rule.configuration, sourceReference);
    decisions.push(triggerDecision('configured', rule.triggerKey, triggerTypeCode, {
      ...(sourceReference ? { sourceReference } : {}),
      payloadSummary,
      ...(rule.conditionExpression ? { conditionExpression: rule.conditionExpression } : {}),
    }));
  }
  return decisions;
}

function matchesCondition(
  conditionExpression: string | null,
  context: CreateEnrolmentInput | EnrolmentStatusTransitionTriggerContext,
): boolean {
  switch (conditionExpression) {
    case null:
    case '':
    case 'always':
      return true;
    case 'ucasPersonalId.present':
      return 'ucasPersonalId' in context && Boolean(context.ucasPersonalId);
    case 'slcFundingOrReference.present':
      return 'fundingSourceCode' in context && (context.fundingSourceCode === 'slc' || Boolean(context.slcReference));
    case 'ukviCasRequired.true':
      return 'ukviCasRequired' in context && context.ukviCasRequired === true;
    case 'slcReference.present-and-status.withdrawn-or-intermitting':
      return 'current' in context
        && Boolean(context.current.slcReference)
        && ['withdrawn', 'intermitting'].includes(context.newStatus);
    default:
      return false;
  }
}

function sourceReferenceForRule(
  triggerTypeCode: EnrolmentDownstreamTriggerType,
  context: CreateEnrolmentInput | EnrolmentStatusTransitionTriggerContext,
  configuration: Record<string, unknown>,
): string | undefined {
  const configured = typeof configuration['sourceReference'] === 'string'
    ? configuration['sourceReference']
    : undefined;
  if (configured) return configured;

  if ('current' in context) {
    return triggerTypeCode === 'slc-confirmation' ? context.current.slcReference ?? undefined : undefined;
  }
  if (triggerTypeCode === 'ucas-confirmation') return context.ucasPersonalId;
  if (triggerTypeCode === 'slc-confirmation') return context.slcReference;
  return undefined;
}

function payloadSummaryForRule(
  triggerTypeCode: EnrolmentDownstreamTriggerType,
  eventType: EnrolmentTriggerEventType,
  context: CreateEnrolmentInput | EnrolmentStatusTransitionTriggerContext,
  configuration: Record<string, unknown>,
  sourceReference: string | undefined,
): Record<string, unknown> {
  const override = isRecord(configuration['payloadSummaryOverrides'])
    ? configuration['payloadSummaryOverrides']
    : {};
  if ('current' in context) {
    return {
      ...(triggerTypeCode === 'slc-confirmation' ? { slcReference: context.current.slcReference } : {}),
      notificationType: context.newStatus,
      ...override,
    };
  }
  return {
    personId: context.personId,
    academicYear: context.academicYearOfEntry,
    sourceReference,
    eventType,
    ...override,
  };
}

function triggerDecision(
  mode: TriggerRuleMode,
  ruleKey: string,
  triggerTypeCode: EnrolmentDownstreamTriggerType,
  input: {
    sourceReference?: string;
    payloadSummary: Record<string, unknown>;
    conditionExpression?: string;
  },
): EnrolmentTriggerDecision {
  const evidence: EnrolmentTriggerDecision['evidence'] = {
    mode,
    ruleKey,
    ruleSource: mode === 'legacy' ? 'legacy-code' : 'workflow-trigger-rule',
    ...(input.conditionExpression ? { conditionExpression: input.conditionExpression } : {}),
  };
  return {
    triggerTypeCode,
    ...(input.sourceReference ? { sourceReference: input.sourceReference } : {}),
    payloadSummary: {
      ...input.payloadSummary,
      triggerRule: evidence,
    },
    evidence,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
