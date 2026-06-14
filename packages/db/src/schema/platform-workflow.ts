import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

export const deploymentEnvironments = pgTable('deployment_environment', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  environmentCode:         text('environment_code').notNull().unique(),
  displayName:             text('display_name').notNull(),
  environmentTypeCode:     text('environment_type_code').notNull(),
  productionLike:          boolean('production_like').notNull().default(false),
  liveIntegrationsAllowed: boolean('live_integrations_allowed').notNull().default(false),
  configuration:           jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  active:                  boolean('active').notNull().default(true),
  createdAt:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const environmentConfigurations = pgTable('environment_configuration', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  environmentId:      uuid('environment_id').notNull().references(() => deploymentEnvironments.id),
  configurationKey:   text('configuration_key').notNull(),
  configurationValue: jsonb('configuration_value').notNull().$type<Record<string, unknown>>().default({}),
  secretRef:          text('secret_ref'),
  activeFrom:         timestamp('active_from', { withTimezone: true }).notNull().defaultNow(),
  activeTo:           timestamp('active_to', { withTimezone: true }),
  createdBy:          text('created_by').notNull().default('system'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const environmentPromotionRecords = pgTable('environment_promotion_record', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  sourceEnvironmentId: uuid('source_environment_id').notNull().references(() => deploymentEnvironments.id),
  targetEnvironmentId: uuid('target_environment_id').notNull().references(() => deploymentEnvironments.id),
  artefactTypeCode:    text('artefact_type_code').notNull(),
  artefactReference:   text('artefact_reference').notNull(),
  statusCode:          text('status_code').notNull(),
  requestedBy:         text('requested_by').notNull(),
  approvedBy:          text('approved_by'),
  promotedAt:          timestamp('promoted_at', { withTimezone: true }),
  metadata:            jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowDefinitions = pgTable('workflow_definition', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').references(() => tenants.id),
  definitionCode:       text('definition_code').notNull(),
  displayName:          text('display_name').notNull(),
  ownerModuleCode:      text('owner_module_code').notNull(),
  statusCode:           text('status_code').notNull().default('draft'),
  currentVersionNumber: integer('current_version_number'),
  description:          text('description'),
  createdBy:            text('created_by').notNull().default('system'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowDefinitionVersions = pgTable('workflow_definition_version', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  workflowDefinitionId: uuid('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  versionNumber:        integer('version_number').notNull(),
  statusCode:           text('status_code').notNull().default('draft'),
  definitionJson:       jsonb('definition_json').notNull().$type<Record<string, unknown>>().default({}),
  bpmnSourceId:         text('bpmn_source_id'),
  effectiveFrom:        timestamp('effective_from', { withTimezone: true }),
  effectiveTo:          timestamp('effective_to', { withTimezone: true }),
  createdBy:            text('created_by').notNull().default('system'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowSteps = pgTable('workflow_step', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').notNull().references(() => workflowDefinitionVersions.id),
  stepKey:                     text('step_key').notNull(),
  stepTypeCode:                text('step_type_code').notNull(),
  displayName:                 text('display_name').notNull(),
  ownerRoleCode:               text('owner_role_code'),
  sortOrder:                   integer('sort_order').notNull().default(0),
  configuration:               jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowTransitions = pgTable('workflow_transition', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').notNull().references(() => workflowDefinitionVersions.id),
  transitionKey:               text('transition_key').notNull(),
  fromStepKey:                 text('from_step_key'),
  toStepKey:                   text('to_step_key').notNull(),
  conditionExpression:         text('condition_expression'),
  sortOrder:                   integer('sort_order').notNull().default(0),
  configuration:               jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowDecisionGateways = pgTable('workflow_decision_gateway', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').notNull().references(() => workflowDefinitionVersions.id),
  gatewayKey:                  text('gateway_key').notNull(),
  displayName:                 text('display_name').notNull(),
  decisionTypeCode:            text('decision_type_code').notNull(),
  sourceReference:             text('source_reference'),
  configuration:               jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowAssignmentRules = pgTable('workflow_assignment_rule', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  tenantId:                    uuid('tenant_id').references(() => tenants.id),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').notNull().references(() => workflowDefinitionVersions.id),
  stepKey:                     text('step_key').notNull(),
  ruleKey:                     text('rule_key').notNull(),
  priority:                    integer('priority').notNull().default(100),
  roleCode:                    text('role_code'),
  organisationalUnitCode:      text('organisational_unit_code'),
  programmeId:                 uuid('programme_id'),
  sourceSystemCode:            text('source_system_code'),
  assigneeRoleCode:            text('assignee_role_code'),
  assigneeExpression:          text('assignee_expression'),
  configuration:               jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  active:                      boolean('active').notNull().default(true),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowTriggerRules = pgTable('workflow_trigger_rule', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  tenantId:                    uuid('tenant_id').references(() => tenants.id),
  environmentId:               uuid('environment_id').references(() => deploymentEnvironments.id),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').references(() => workflowDefinitionVersions.id),
  triggerKey:                  text('trigger_key').notNull(),
  eventType:                   text('event_type').notNull(),
  targetWorkflowCode:          text('target_workflow_code').notNull(),
  conditionExpression:         text('condition_expression'),
  configuration:               jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  active:                      boolean('active').notNull().default(true),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowInstances = pgTable('workflow_instance', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  tenantId:                    uuid('tenant_id').notNull().references(() => tenants.id),
  environmentId:               uuid('environment_id').references(() => deploymentEnvironments.id),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').notNull().references(() => workflowDefinitionVersions.id),
  workflowCode:                text('workflow_code').notNull(),
  subjectEntityType:           text('subject_entity_type').notNull(),
  subjectEntityId:             uuid('subject_entity_id'),
  statusCode:                  text('status_code').notNull().default('pending'),
  correlationId:               uuid('correlation_id'),
  startedBy:                   text('started_by').notNull().default('system'),
  startedAt:                   timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:                 timestamp('completed_at', { withTimezone: true }),
  context:                     jsonb('context').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowTasks = pgTable('workflow_task', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  workflowInstanceId: uuid('workflow_instance_id').notNull().references(() => workflowInstances.id),
  stepKey:            text('step_key').notNull(),
  taskTypeCode:       text('task_type_code').notNull().default('human-task'),
  statusCode:         text('status_code').notNull().default('pending'),
  assigneeActorId:    text('assignee_actor_id'),
  assigneeRoleCode:   text('assignee_role_code'),
  dueAt:              timestamp('due_at', { withTimezone: true }),
  completedBy:        text('completed_by'),
  completedAt:        timestamp('completed_at', { withTimezone: true }),
  payload:            jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowDecisionAudits = pgTable('workflow_decision_audit', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  workflowInstanceId: uuid('workflow_instance_id').notNull().references(() => workflowInstances.id),
  gatewayKey:         text('gateway_key').notNull(),
  decisionCode:       text('decision_code').notNull(),
  conditionSummary:   text('condition_summary'),
  inputHash:          text('input_hash'),
  outcomeStepKey:     text('outcome_step_key'),
  actorId:            text('actor_id').notNull().default('system'),
  metadata:           jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
  decidedAt:          timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlags = pgTable('feature_flag', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  flagKey:             text('flag_key').notNull().unique(),
  displayName:         text('display_name').notNull(),
  description:         text('description'),
  ownerModuleCode:     text('owner_module_code').notNull(),
  statusCode:          text('status_code').notNull().default('draft'),
  valueTypeCode:       text('value_type_code').notNull().default('boolean'),
  defaultVariantKey:   text('default_variant_key').notNull().default('off'),
  createdBy:           text('created_by').notNull().default('system'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Governance metadata added in migration 0017
  flagClassCode:       text('flag_class_code').notNull().default('release'),
  riskClassCode:       text('risk_class_code').notNull().default('low'),
  ownerContact:        text('owner_contact'),
  reviewDate:          text('review_date'),
  retirementCondition: text('retirement_condition'),
  allowedScopeCodes:   text('allowed_scope_codes').array().notNull().default(['global', 'tenant', 'environment']),
  nonBypassable:       boolean('non_bypassable').notNull().default(false),
});

export const featureFlagVariants = pgTable('feature_flag_variant', {
  id:          uuid('id').primaryKey().defaultRandom(),
  flagId:      uuid('flag_id').notNull().references(() => featureFlags.id),
  variantKey:  text('variant_key').notNull(),
  displayName: text('display_name').notNull(),
  value:       jsonb('value').notNull(),
  sortOrder:   integer('sort_order').notNull().default(0),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlagAssignments = pgTable('feature_flag_assignment', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  tenantId:                    uuid('tenant_id').references(() => tenants.id),
  environmentId:               uuid('environment_id').references(() => deploymentEnvironments.id),
  flagId:                      uuid('flag_id').notNull().references(() => featureFlags.id),
  variantId:                   uuid('variant_id').references(() => featureFlagVariants.id),
  workflowDefinitionVersionId: uuid('workflow_definition_version_id').references(() => workflowDefinitionVersions.id),
  roleCode:                    text('role_code'),
  cohortCode:                  text('cohort_code'),
  programmeId:                 uuid('programme_id'),
  academicYear:                text('academic_year'),
  sourceSystemCode:            text('source_system_code'),
  priority:                    integer('priority').notNull().default(100),
  statusCode:                  text('status_code').notNull().default('active'),
  ruleExpression:              text('rule_expression'),
  configuration:               jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  activeFrom:                  timestamp('active_from', { withTimezone: true }).notNull().defaultNow(),
  activeTo:                    timestamp('active_to', { withTimezone: true }),
  createdBy:                   text('created_by').notNull().default('system'),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const featureFlagEvaluationLogs = pgTable('feature_flag_evaluation_log', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').references(() => tenants.id),
  environmentId:       uuid('environment_id').references(() => deploymentEnvironments.id),
  flagId:              uuid('flag_id').notNull().references(() => featureFlags.id),
  assignmentId:        uuid('assignment_id').references(() => featureFlagAssignments.id),
  evaluatedVariantKey: text('evaluated_variant_key').notNull(),
  subjectType:         text('subject_type'),
  subjectId:           uuid('subject_id'),
  reasonCode:          text('reason_code').notNull(),
  evaluationContext:   jsonb('evaluation_context').notNull().$type<Record<string, unknown>>().default({}),
  evaluatedAt:         timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DeploymentEnvironment = typeof deploymentEnvironments.$inferSelect;
export type EnvironmentConfiguration = typeof environmentConfigurations.$inferSelect;
export type EnvironmentPromotionRecord = typeof environmentPromotionRecords.$inferSelect;
export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type WorkflowDefinitionVersion = typeof workflowDefinitionVersions.$inferSelect;
export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type WorkflowTransition = typeof workflowTransitions.$inferSelect;
export type WorkflowDecisionGateway = typeof workflowDecisionGateways.$inferSelect;
export type WorkflowAssignmentRule = typeof workflowAssignmentRules.$inferSelect;
export type WorkflowTriggerRule = typeof workflowTriggerRules.$inferSelect;
export type WorkflowInstance = typeof workflowInstances.$inferSelect;
export type WorkflowTask = typeof workflowTasks.$inferSelect;
export type WorkflowDecisionAudit = typeof workflowDecisionAudits.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type FeatureFlagVariant = typeof featureFlagVariants.$inferSelect;
export type FeatureFlagAssignment = typeof featureFlagAssignments.$inferSelect;
export type FeatureFlagEvaluationLog = typeof featureFlagEvaluationLogs.$inferSelect;
