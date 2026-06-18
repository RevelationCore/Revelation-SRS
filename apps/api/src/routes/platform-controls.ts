import { requirePermission } from '@revelation-srs/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { clockNow } from '../platform/clock.js';
import type {
  CreateFeatureFlagAssignmentInput,
  CreateFeatureFlagInput,
  FeatureFlagAssignmentDto,
  FeatureFlagDto,
  FeatureFlagEvaluationContext,
  UpdateFeatureFlagInput,
  UpdateGovernanceInput,
} from '../platform/platform-controls/feature-flag-service.js';
import type { CreateEnvironmentPromotionInput } from '../platform/platform-controls/environment-service.js';
import type {
  CreateWorkflowAssignmentRuleInput,
  WorkflowAssignmentRuleDto,
} from '../platform/platform-controls/workflow-responsibility-service.js';

const JsonRecord = Type.Record(Type.String(), Type.Unknown());
const JsonValue = Type.Unknown();

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const VariantSchema = Type.Object({
  featureFlagVariantId: Type.String(),
  variantKey: Type.String(),
  displayName: Type.String(),
  value: JsonValue,
  sortOrder: Type.Number(),
});

const FeatureFlagSchema = Type.Object({
  featureFlagId:       Type.String(),
  flagKey:             Type.String(),
  displayName:         Type.String(),
  description:         Type.Union([Type.String(), Type.Null()]),
  ownerModuleCode:     Type.String(),
  statusCode:          Type.String(),
  valueTypeCode:       Type.String(),
  defaultVariantKey:   Type.String(),
  createdBy:           Type.String(),
  createdAt:           Type.String(),
  updatedAt:           Type.String(),
  variants:            Type.Array(VariantSchema),
  // Governance fields (Stage 6)
  flagClassCode:       Type.String(),
  riskClassCode:       Type.String(),
  ownerContact:        Type.Union([Type.String(), Type.Null()]),
  reviewDate:          Type.Union([Type.String(), Type.Null()]),
  retirementCondition: Type.Union([Type.String(), Type.Null()]),
  allowedScopeCodes:   Type.Array(Type.String()),
  nonBypassable:       Type.Boolean(),
});

const GovernancePatchBody = Type.Object({
  flagClassCode:       Type.Optional(Type.String()),
  riskClassCode:       Type.Optional(Type.String()),
  ownerContact:        Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reviewDate:          Type.Optional(Type.Union([Type.String(), Type.Null()])),
  retirementCondition: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  allowedScopeCodes:   Type.Optional(Type.Array(Type.String())),
  nonBypassable:       Type.Optional(Type.Boolean()),
});

const FlagImpactSchema = Type.Object({
  activeAssignmentCount:      Type.Number(),
  activeTenantsCount:         Type.Number(),
  activeTenantIds:            Type.Array(Type.String()),
  referencingTriggerRuleKeys: Type.Array(Type.String()),
  currentDefaultVariantKey:   Type.String(),
  currentDefaultValue:        Type.Unknown(),
});

const FeatureFlagBody = Type.Object({
  flagKey: Type.String({ minLength: 1, maxLength: 120 }),
  displayName: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String()),
  ownerModuleCode: Type.String({ minLength: 1, maxLength: 80 }),
  valueTypeCode: Type.Optional(Type.String()),
  defaultVariantKey: Type.Optional(Type.String()),
  variants: Type.Optional(Type.Array(Type.Object({
    variantKey: Type.String({ minLength: 1, maxLength: 80 }),
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    value: JsonValue,
    sortOrder: Type.Optional(Type.Number()),
  }))),
});

const FeatureFlagPatchBody = Type.Object({
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  ownerModuleCode: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  statusCode: Type.Optional(Type.String()),
  defaultVariantKey: Type.Optional(Type.String()),
});

const AssignmentSchema = Type.Object({
  featureFlagAssignmentId: Type.String(),
  tenantId: Type.Union([Type.String(), Type.Null()]),
  environmentId: Type.Union([Type.String(), Type.Null()]),
  featureFlagId: Type.String(),
  variantId: Type.Union([Type.String(), Type.Null()]),
  workflowDefinitionVersionId: Type.Union([Type.String(), Type.Null()]),
  roleCode: Type.Union([Type.String(), Type.Null()]),
  cohortCode: Type.Union([Type.String(), Type.Null()]),
  programmeId: Type.Union([Type.String(), Type.Null()]),
  academicYear: Type.Union([Type.String(), Type.Null()]),
  sourceSystemCode: Type.Union([Type.String(), Type.Null()]),
  priority: Type.Number(),
  statusCode: Type.String(),
  ruleExpression: Type.Union([Type.String(), Type.Null()]),
  configuration: JsonRecord,
  activeFrom: Type.String(),
  activeTo: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const AssignmentBody = Type.Object({
  environmentId: Type.Optional(Type.String()),
  environmentCode: Type.Optional(Type.String()),
  variantKey: Type.Optional(Type.String()),
  workflowDefinitionVersionId: Type.Optional(Type.String()),
  roleCode: Type.Optional(Type.String()),
  cohortCode: Type.Optional(Type.String()),
  programmeId: Type.Optional(Type.String()),
  academicYear: Type.Optional(Type.String()),
  sourceSystemCode: Type.Optional(Type.String()),
  priority: Type.Optional(Type.Integer()),
  ruleExpression: Type.Optional(Type.String()),
  configuration: Type.Optional(JsonRecord),
  activeFrom: Type.Optional(Type.String({ format: 'date-time' })),
  activeTo: Type.Optional(Type.String({ format: 'date-time' })),
});

const EvaluationPreviewBody = Type.Object({
  tenantId: Type.Optional(Type.String()),
  environmentId: Type.Optional(Type.String()),
  environmentCode: Type.Optional(Type.String()),
  roleCode: Type.Optional(Type.String()),
  cohortCode: Type.Optional(Type.String()),
  programmeId: Type.Optional(Type.String()),
  academicYear: Type.Optional(Type.String()),
  sourceSystemCode: Type.Optional(Type.String()),
  workflowDefinitionVersionId: Type.Optional(Type.String()),
});

const EvaluationResultSchema = Type.Object({
  flagKey: Type.String(),
  variantKey: Type.String(),
  value: JsonValue,
  reasonCode: Type.String(),
  assignmentId: Type.Union([Type.String(), Type.Null()]),
});

const WorkflowDefinitionSchema = Type.Object({
  workflowDefinitionId: Type.String(),
  tenantId: Type.Union([Type.String(), Type.Null()]),
  definitionCode: Type.String(),
  displayName: Type.String(),
  ownerModuleCode: Type.String(),
  statusCode: Type.String(),
  currentVersionNumber: Type.Union([Type.Number(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const WorkflowDefinitionVersionSchema = Type.Object({
  workflowDefinitionVersionId: Type.String(),
  workflowDefinitionId: Type.String(),
  versionNumber: Type.Number(),
  statusCode: Type.String(),
  definitionJson: JsonRecord,
  bpmnSourceId: Type.Union([Type.String(), Type.Null()]),
  effectiveFrom: Type.Union([Type.String(), Type.Null()]),
  effectiveTo: Type.Union([Type.String(), Type.Null()]),
  createdBy: Type.String(),
  createdAt: Type.String(),
});

const WorkflowInstanceSchema = Type.Object({
  workflowInstanceId: Type.String(),
  environmentId: Type.Union([Type.String(), Type.Null()]),
  workflowDefinitionVersionId: Type.String(),
  workflowCode: Type.String(),
  subjectEntityType: Type.String(),
  subjectEntityId: Type.Union([Type.String(), Type.Null()]),
  statusCode: Type.String(),
  correlationId: Type.Union([Type.String(), Type.Null()]),
  startedBy: Type.String(),
  startedAt: Type.String(),
  completedAt: Type.Union([Type.String(), Type.Null()]),
  context: JsonRecord,
  createdAt: Type.String(),
});

const WorkflowTaskSchema = Type.Object({
  workflowTaskId: Type.String(),
  workflowInstanceId: Type.String(),
  stepKey: Type.String(),
  taskTypeCode: Type.String(),
  statusCode: Type.String(),
  assigneeActorId: Type.Union([Type.String(), Type.Null()]),
  assigneeRoleCode: Type.Union([Type.String(), Type.Null()]),
  dueAt: Type.Union([Type.String(), Type.Null()]),
  completedBy: Type.Union([Type.String(), Type.Null()]),
  completedAt: Type.Union([Type.String(), Type.Null()]),
  payload: JsonRecord,
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const WorkflowAssignmentRuleSchema = Type.Object({
  workflowAssignmentRuleId: Type.String(),
  tenantId: Type.Union([Type.String(), Type.Null()]),
  workflowDefinitionVersionId: Type.String(),
  stepKey: Type.String(),
  ruleKey: Type.String(),
  priority: Type.Number(),
  roleCode: Type.Union([Type.String(), Type.Null()]),
  organisationalUnitCode: Type.Union([Type.String(), Type.Null()]),
  programmeId: Type.Union([Type.String(), Type.Null()]),
  sourceSystemCode: Type.Union([Type.String(), Type.Null()]),
  assigneeRoleCode: Type.Union([Type.String(), Type.Null()]),
  assigneeExpression: Type.Union([Type.String(), Type.Null()]),
  configuration: JsonRecord,
  active: Type.Boolean(),
  createdAt: Type.String(),
});

const WorkflowAssignmentRuleBody = Type.Object({
  workflowDefinitionVersionId: Type.String(),
  stepKey: Type.String(),
  ruleKey: Type.String(),
  priority: Type.Optional(Type.Integer()),
  roleCode: Type.Optional(Type.String()),
  organisationalUnitCode: Type.Optional(Type.String()),
  programmeId: Type.Optional(Type.String()),
  sourceSystemCode: Type.Optional(Type.String()),
  assigneeRoleCode: Type.Optional(Type.String()),
  assigneeExpression: Type.Optional(Type.String()),
  configuration: Type.Optional(JsonRecord),
  active: Type.Optional(Type.Boolean()),
});

const WorkflowAssignmentContextBody = Type.Object({
  roleCodes: Type.Optional(Type.Array(Type.String())),
  organisationalUnitCode: Type.Optional(Type.String()),
  programmeId: Type.Optional(Type.String()),
  sourceSystemCode: Type.Optional(Type.String()),
});

const WorkflowStartBody = Type.Object({
  environmentId: Type.Optional(Type.String()),
  workflowDefinitionVersionId: Type.String(),
  workflowCode: Type.String(),
  subjectEntityType: Type.String(),
  subjectEntityId: Type.Optional(Type.String()),
  correlationId: Type.Optional(Type.String()),
  context: Type.Optional(JsonRecord),
  task: Type.Optional(Type.Object({
    stepKey: Type.String(),
    taskTypeCode: Type.Optional(Type.String()),
    assigneeActorId: Type.Optional(Type.String()),
    assigneeRoleCode: Type.Optional(Type.String()),
    dueAt: Type.Optional(Type.String({ format: 'date-time' })),
    payload: Type.Optional(JsonRecord),
    assignmentContext: Type.Optional(WorkflowAssignmentContextBody),
  })),
});

const WorkflowTaskCompletionBody = Type.Object({
  payload: Type.Optional(JsonRecord),
});

const WorkflowInstanceCompletionBody = Type.Object({
  statusCode: Type.Optional(Type.Union([Type.Literal('completed'), Type.Literal('cancelled'), Type.Literal('failed')])),
  metadata: Type.Optional(JsonRecord),
});

const EnvironmentSchema = Type.Object({
  deploymentEnvironmentId: Type.String(),
  environmentCode: Type.String(),
  displayName: Type.String(),
  environmentTypeCode: Type.String(),
  productionLike: Type.Boolean(),
  liveIntegrationsAllowed: Type.Boolean(),
  configuration: JsonRecord,
  active: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const EnvironmentRuntimeReportSchema = Type.Object({
  environment: EnvironmentSchema,
  releaseVersion: Type.String(),
  imageDigest: Type.Union([Type.String(), Type.Null()]),
  migrationVersion: Type.String(),
  workflowDefinitions: Type.Array(Type.Object({
    definitionCode: Type.String(),
    currentVersionNumber: Type.Union([Type.Number(), Type.Null()]),
  })),
  featureFlags: Type.Array(Type.Object({
    flagKey: Type.String(),
    statusCode: Type.String(),
    defaultVariantKey: Type.String(),
  })),
});

const PromotionSchema = Type.Object({
  environmentPromotionRecordId: Type.String(),
  sourceEnvironmentId: Type.String(),
  targetEnvironmentId: Type.String(),
  artefactTypeCode: Type.String(),
  artefactReference: Type.String(),
  statusCode: Type.String(),
  requestedBy: Type.String(),
  approvedBy: Type.Union([Type.String(), Type.Null()]),
  promotedAt: Type.Union([Type.String(), Type.Null()]),
  metadata: JsonRecord,
  createdAt: Type.String(),
});

const PromotionBody = Type.Object({
  sourceEnvironmentId: Type.String(),
  targetEnvironmentId: Type.String(),
  artefactTypeCode: Type.String(),
  artefactReference: Type.String(),
  metadata: Type.Optional(JsonRecord),
});

export function platformControlRoutes(fastify: FastifyInstance): void {
  fastify.get('/workflow-definitions', {
    schema: {
      querystring: Type.Object({ statusCode: Type.Optional(Type.String()) }),
      response: { 200: Type.Array(WorkflowDefinitionSchema) },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const query = request.query as { statusCode?: string };
    const definitions = await fastify.workflowDefinitionService.listDefinitions(request.tenantId, query);
    await reply.send(definitions.map((definition) => ({
      ...definition,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    })));
  });

  fastify.get('/workflow-definitions/:workflowDefinitionId/versions', {
    schema: {
      params: Type.Object({ workflowDefinitionId: Type.String() }),
      response: { 200: Type.Array(WorkflowDefinitionVersionSchema), 404: ErrorSchema },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const { workflowDefinitionId } = request.params as { workflowDefinitionId: string };
    const versions = await fastify.workflowDefinitionService.listVersions(workflowDefinitionId, request.tenantId);
    await reply.send(versions.map(workflowVersionToWire));
  });

  fastify.get('/workflow-definitions/:workflowDefinitionId', {
    schema: {
      params: Type.Object({ workflowDefinitionId: Type.String() }),
      response: { 200: WorkflowDefinitionSchema, 404: ErrorSchema },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const { workflowDefinitionId } = request.params as { workflowDefinitionId: string };
    const definition = await fastify.workflowDefinitionService.getDefinition(workflowDefinitionId, request.tenantId);
    await reply.send({
      ...definition,
      createdAt: definition.createdAt.toISOString(),
      updatedAt: definition.updatedAt.toISOString(),
    });
  });

  fastify.get('/workflow-definition-versions/:workflowDefinitionVersionId', {
    schema: {
      params: Type.Object({ workflowDefinitionVersionId: Type.String() }),
      response: { 200: WorkflowDefinitionVersionSchema, 404: ErrorSchema },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const { workflowDefinitionVersionId } = request.params as { workflowDefinitionVersionId: string };
    const version = await fastify.workflowDefinitionService.getVersion(workflowDefinitionVersionId, request.tenantId);
    await reply.send(workflowVersionToWire(version));
  });

  fastify.get('/workflow-assignment-rules', {
    schema: {
      querystring: Type.Object({
        workflowDefinitionVersionId: Type.Optional(Type.String()),
        stepKey: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Array(WorkflowAssignmentRuleSchema) },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const rules = await fastify.workflowResponsibilityService.listAssignmentRules(
      request.tenantId,
      request.query as { workflowDefinitionVersionId?: string; stepKey?: string },
    );
    await reply.send(rules.map(workflowAssignmentRuleToWire));
  });

  fastify.post('/workflow-assignment-rules', {
    schema: {
      body: WorkflowAssignmentRuleBody,
      response: { 201: Type.Object({ workflowAssignmentRuleId: Type.String() }), 422: ErrorSchema },
    },
    preHandler: [requirePermission('workflow:write')],
  }, async (request, reply) => {
    const workflowAssignmentRuleId = await fastify.workflowResponsibilityService.createAssignmentRule(
      request.tenantId,
      request.body as CreateWorkflowAssignmentRuleInput,
    );
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'workflow_assignment_rule',
      entityId: workflowAssignmentRuleId,
      afterValue: request.body,
      actionType: 'create',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(201).send({ workflowAssignmentRuleId });
  });

  fastify.get('/workflow-instances', {
    schema: {
      querystring: Type.Object({
        statusCode: Type.Optional(Type.String()),
        subjectEntityType: Type.Optional(Type.String()),
        subjectEntityId: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Array(WorkflowInstanceSchema) },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const instances = await fastify.workflowInstanceService.listInstances(request.tenantId, request.query as {
      statusCode?: string;
      subjectEntityType?: string;
      subjectEntityId?: string;
    });
    await reply.send(instances.map((instance) => ({
      ...instance,
      startedAt: instance.startedAt.toISOString(),
      completedAt: instance.completedAt?.toISOString() ?? null,
      createdAt: instance.createdAt.toISOString(),
    })));
  });

  fastify.post('/workflow-instances', {
    schema: {
      body: WorkflowStartBody,
      response: {
        201: Type.Object({
          workflowInstanceId: Type.String(),
          workflowTaskId: Type.Optional(Type.String()),
        }),
        404: ErrorSchema,
      },
    },
    preHandler: [requirePermission('workflow:write')],
  }, async (request, reply) => {
    const body = request.body as WorkflowStartBodyShape;
    const instance = await fastify.workflowBridgeService.startWorkflowInstance({
      tenantId: request.tenantId,
      ...(body.environmentId ? { environmentId: body.environmentId } : {}),
      workflowDefinitionVersionId: body.workflowDefinitionVersionId,
      workflowCode: body.workflowCode,
      subjectEntityType: body.subjectEntityType,
      ...(body.subjectEntityId ? { subjectEntityId: body.subjectEntityId } : {}),
      ...(body.correlationId ? { correlationId: body.correlationId } : {}),
      startedBy: request.user.sub,
      context: body.context ?? {},
    });
    await fastify.workflowBridgeService.recordWorkflowEvent({
      tenantId: request.tenantId,
      workflowInstanceId: instance.workflowInstanceId,
      workflowType: body.workflowCode,
      event: 'workflow-started',
      actorId: request.user.sub,
      occurredAt: clockNow().toISOString(),
      metadata: body.context ?? {},
    });

    let workflowTaskId: string | undefined;
    if (body.task) {
      const assignment = await fastify.workflowResponsibilityService.resolveTaskAssignment(
        request.tenantId,
        {
          workflowDefinitionVersionId: body.workflowDefinitionVersionId,
          stepKey: body.task.stepKey,
          roleCodes: body.task.assignmentContext?.roleCodes ?? request.user.roles,
          ...(body.task.assignmentContext?.organisationalUnitCode
            ? { organisationalUnitCode: body.task.assignmentContext.organisationalUnitCode }
            : {}),
          ...(body.task.assignmentContext?.programmeId ? { programmeId: body.task.assignmentContext.programmeId } : {}),
          ...(body.task.assignmentContext?.sourceSystemCode ? { sourceSystemCode: body.task.assignmentContext.sourceSystemCode } : {}),
        },
        {
          ...(body.task.assigneeRoleCode ? { assigneeRoleCode: body.task.assigneeRoleCode } : {}),
          ...(body.task.assigneeActorId ? { assigneeActorId: body.task.assigneeActorId } : {}),
        },
      );
      const task = await fastify.workflowBridgeService.assignWorkflowTask({
        tenantId: request.tenantId,
        workflowInstanceId: instance.workflowInstanceId,
        stepKey: body.task.stepKey,
        ...(body.task.taskTypeCode ? { taskTypeCode: body.task.taskTypeCode } : {}),
        ...(body.task.assigneeActorId ? { assigneeActorId: body.task.assigneeActorId } : {}),
        ...(assignment.assigneeRoleCode ? { assigneeRoleCode: assignment.assigneeRoleCode } : {}),
        ...(body.task.dueAt ? { dueAt: body.task.dueAt } : {}),
        payload: {
          ...(body.task.payload ?? {}),
          workflowAssignment: {
            reasonCode: assignment.reasonCode,
            ...(assignment.ruleKey ? { ruleKey: assignment.ruleKey } : {}),
            ...(assignment.ruleId ? { ruleId: assignment.ruleId } : {}),
            ...(assignment.assigneeExpression ? { assigneeExpression: assignment.assigneeExpression } : {}),
          },
        },
      });
      workflowTaskId = task.workflowTaskId;
    }

    await reply.code(201).send({
      workflowInstanceId: instance.workflowInstanceId,
      ...(workflowTaskId ? { workflowTaskId } : {}),
    });
  });

  fastify.get('/workflow-tasks', {
    schema: {
      querystring: Type.Object({
        statusCode: Type.Optional(Type.String()),
        assigneeRoleCode: Type.Optional(Type.String()),
        workflowInstanceId: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Array(WorkflowTaskSchema) },
    },
    preHandler: [requirePermission('workflow:read')],
  }, async (request, reply) => {
    const tasks = await fastify.workflowTaskService.listTasks(request.tenantId, request.query as {
      statusCode?: string;
      assigneeRoleCode?: string;
      workflowInstanceId?: string;
    });
    await reply.send(tasks.map((task) => ({
      ...task,
      dueAt: task.dueAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    })));
  });

  fastify.post('/workflow-tasks/:workflowTaskId/completion', {
    schema: {
      params: Type.Object({ workflowTaskId: Type.String() }),
      body: WorkflowTaskCompletionBody,
      response: { 204: Type.Null(), 404: ErrorSchema },
    },
    preHandler: [requirePermission('workflow-task:complete')],
  }, async (request, reply) => {
    const { workflowTaskId } = request.params as { workflowTaskId: string };
    const body = request.body as { payload?: Record<string, unknown> };
    await fastify.workflowResponsibilityService.assertCanCompleteTask(request.tenantId, workflowTaskId, {
      actorId: request.user.sub,
      roles: request.user.roles,
    });
    await fastify.workflowBridgeService.completeWorkflowTask({
      tenantId: request.tenantId,
      workflowTaskId,
      completedBy: request.user.sub,
      payload: body.payload ?? {},
    });
    await reply.code(204).send();
  });

  fastify.post('/workflow-instances/:workflowInstanceId/completion', {
    schema: {
      params: Type.Object({ workflowInstanceId: Type.String() }),
      body: WorkflowInstanceCompletionBody,
      response: { 204: Type.Null(), 404: ErrorSchema },
    },
    preHandler: [requirePermission('workflow:write')],
  }, async (request, reply) => {
    const { workflowInstanceId } = request.params as { workflowInstanceId: string };
    const body = request.body as { statusCode?: 'completed' | 'cancelled' | 'failed'; metadata?: Record<string, unknown> };
    await fastify.workflowBridgeService.completeWorkflowInstance({
      tenantId: request.tenantId,
      workflowInstanceId,
      statusCode: body.statusCode ?? 'completed',
      actorId: request.user.sub,
      metadata: body.metadata ?? {},
    });
    await reply.code(204).send();
  });

  fastify.get('/feature-flags', {
    schema: { response: { 200: Type.Array(FeatureFlagSchema) } },
    preHandler: [requirePermission('feature-flag:read')],
  }, async (_request, reply) => {
    const flags = await fastify.featureFlagService.listFlags();
    await reply.send(flags.map(featureFlagToWire));
  });

  fastify.post('/feature-flags', {
    schema: {
      body: FeatureFlagBody,
      response: { 201: Type.Object({ featureFlagId: Type.String() }), 422: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:write')],
  }, async (request, reply) => {
    const featureFlagId = await fastify.featureFlagService.createFlag(
      request.tenantId,
      request.body as CreateFeatureFlagInput,
      request.user.sub,
    );
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'feature_flag',
      entityId: featureFlagId,
      afterValue: request.body,
      actionType: 'create',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(201).send({ featureFlagId });
  });

  fastify.get('/feature-flags/:featureFlagId', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      response: { 200: FeatureFlagSchema, 404: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:read')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    const flag = await fastify.featureFlagService.getFlag(featureFlagId);
    await reply.send(featureFlagToWire(flag));
  });

  fastify.patch('/feature-flags/:featureFlagId', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      body: FeatureFlagPatchBody,
      response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:write')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    await fastify.featureFlagService.updateFlag(featureFlagId, request.body as UpdateFeatureFlagInput);
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'feature_flag',
      entityId: featureFlagId,
      afterValue: request.body,
      actionType: 'update',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(204).send();
  });

  fastify.post('/feature-flags/:featureFlagId/retirement', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      response: { 204: Type.Null(), 404: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:write')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    await fastify.featureFlagService.retireFlag(featureFlagId);
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'feature_flag',
      entityId: featureFlagId,
      afterValue: { statusCode: 'retired' },
      actionType: 'update',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(204).send();
  });

  fastify.patch('/feature-flags/:featureFlagId/governance', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      body: GovernancePatchBody,
      response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:govern')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    await fastify.featureFlagService.updateGovernance(featureFlagId, request.body as UpdateGovernanceInput);
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'feature_flag',
      entityId: featureFlagId,
      afterValue: request.body,
      actionType: 'update',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(204).send();
  });

  fastify.get('/feature-flags/:featureFlagId/impact', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      response: { 200: FlagImpactSchema, 404: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:read')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    const impact = await fastify.featureFlagService.getImpact(featureFlagId);
    await reply.send(impact);
  });

  fastify.get('/feature-flags/:featureFlagId/assignments', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      response: { 200: Type.Array(AssignmentSchema), 404: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:read')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    const assignments = await fastify.featureFlagService.listAssignments(request.tenantId, featureFlagId);
    await reply.send(assignments.map(assignmentToWire));
  });

  fastify.post('/feature-flags/:featureFlagId/assignments', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      body: AssignmentBody,
      response: { 201: Type.Object({ featureFlagAssignmentId: Type.String() }), 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:write')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    const body = assignmentBodyToInput(request.body as AssignmentBodyShape);

    const flag = await fastify.featureFlagService.getFlag(featureFlagId);

    // Non-bypassable flags may never be assigned the 'off' variant — applies to all roles
    const resolvedVariantKey = body.variantKey ?? flag.defaultVariantKey;
    if (flag.nonBypassable && resolvedVariantKey === 'off') {
      return reply.code(422).send({
        type: 'about:blank',
        title: 'Non-bypassable flag',
        status: 422,
        detail: `Flag '${flag.flagKey}' controls a mandatory system control and may not be assigned the 'off' variant.`,
      });
    }

    // Environment-safety and kill-switch flags may only be managed by system-administrators
    if (
      (flag.flagClassCode === 'environment-safety' || flag.flagClassCode === 'kill-switch') &&
      !request.user.roles.includes('system-administrator')
    ) {
      return reply.code(403).send({
        type: 'about:blank',
        title: 'Insufficient permissions',
        status: 403,
        detail: `Flag '${flag.flagKey}' is an ${flag.flagClassCode} flag and may only be managed by system administrators.`,
      });
    }

    const featureFlagAssignmentId = await fastify.featureFlagService.createAssignment(
      request.tenantId,
      featureFlagId,
      body,
      request.user.sub,
    );
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'feature_flag_assignment',
      entityId: featureFlagAssignmentId,
      afterValue: request.body,
      actionType: 'create',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(201).send({ featureFlagAssignmentId });
  });

  fastify.post('/feature-flags/:featureFlagId/evaluation-preview', {
    schema: {
      params: Type.Object({ featureFlagId: Type.String() }),
      body: EvaluationPreviewBody,
      response: { 200: EvaluationResultSchema, 404: ErrorSchema },
    },
    preHandler: [requirePermission('feature-flag:read')],
  }, async (request, reply) => {
    const { featureFlagId } = request.params as { featureFlagId: string };
    const body = request.body as Partial<FeatureFlagEvaluationContext>;
    const result = await fastify.featureFlagService.evaluatePreview(featureFlagId, {
      ...body,
      tenantId: body.tenantId ?? request.tenantId,
    });
    await reply.send(result);
  });

  fastify.get('/environments', {
    schema: {
      querystring: Type.Object({ active: Type.Optional(Type.Boolean()) }),
      response: { 200: Type.Array(EnvironmentSchema) },
    },
    preHandler: [requirePermission('environment:read')],
  }, async (request, reply) => {
    const environments = await fastify.environmentService.listEnvironments(request.query as { active?: boolean });
    await reply.send(environments.map((environment) => ({
      ...environment,
      createdAt: environment.createdAt.toISOString(),
      updatedAt: environment.updatedAt.toISOString(),
    })));
  });

  fastify.get('/environments/:deploymentEnvironmentId', {
    schema: {
      params: Type.Object({ deploymentEnvironmentId: Type.String() }),
      response: { 200: EnvironmentSchema, 404: ErrorSchema },
    },
    preHandler: [requirePermission('environment:read')],
  }, async (request, reply) => {
    const { deploymentEnvironmentId } = request.params as { deploymentEnvironmentId: string };
    const environment = await fastify.environmentService.getEnvironment(deploymentEnvironmentId);
    await reply.send({
      ...environment,
      createdAt: environment.createdAt.toISOString(),
      updatedAt: environment.updatedAt.toISOString(),
    });
  });

  fastify.get('/environment-runtime', {
    schema: { response: { 200: EnvironmentRuntimeReportSchema, 404: ErrorSchema } },
    preHandler: [requirePermission('environment:read')],
  }, async (_request, reply) => {
    const report = await fastify.environmentService.getRuntimeReport();
    await reply.send({
      ...report,
      environment: {
        ...report.environment,
        createdAt: report.environment.createdAt.toISOString(),
        updatedAt: report.environment.updatedAt.toISOString(),
      },
    });
  });

  fastify.get('/environment-promotions', {
    schema: { response: { 200: Type.Array(PromotionSchema) } },
    preHandler: [requirePermission('environment:read')],
  }, async (request, reply) => {
    const promotions = await fastify.environmentService.listPromotionRecords(request.tenantId);
    await reply.send(promotions.map((promotion) => ({
      ...promotion,
      promotedAt: promotion.promotedAt?.toISOString() ?? null,
      createdAt: promotion.createdAt.toISOString(),
    })));
  });

  fastify.post('/environment-promotions', {
    schema: {
      body: PromotionBody,
      response: { 201: Type.Object({ environmentPromotionRecordId: Type.String() }), 404: ErrorSchema },
    },
    preHandler: [requirePermission('environment:write')],
  }, async (request, reply) => {
    const environmentPromotionRecordId = await fastify.environmentService.createPromotionRecord(
      request.tenantId,
      request.body as CreateEnvironmentPromotionInput,
      request.user.sub,
    );
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'environment_promotion_record',
      entityId: environmentPromotionRecordId,
      afterValue: request.body,
      actionType: 'create',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
    });
    await reply.code(201).send({ environmentPromotionRecordId });
  });
}

interface AssignmentBodyShape extends Omit<CreateFeatureFlagAssignmentInput, 'activeFrom' | 'activeTo'> {
  activeFrom?: string;
  activeTo?: string;
}

interface WorkflowStartBodyShape {
  environmentId?: string;
  workflowDefinitionVersionId: string;
  workflowCode: string;
  subjectEntityType: string;
  subjectEntityId?: string;
  correlationId?: string;
  context?: Record<string, unknown>;
  task?: {
    stepKey: string;
    taskTypeCode?: string;
    assigneeActorId?: string;
    assigneeRoleCode?: string;
    dueAt?: string;
    payload?: Record<string, unknown>;
    assignmentContext?: {
      roleCodes?: string[];
      organisationalUnitCode?: string;
      programmeId?: string;
      sourceSystemCode?: string;
    };
  };
}

function assignmentBodyToInput(body: AssignmentBodyShape): CreateFeatureFlagAssignmentInput {
  const { activeFrom, activeTo, ...rest } = body;
  return {
    ...rest,
    ...(activeFrom ? { activeFrom: new Date(activeFrom) } : {}),
    ...(activeTo ? { activeTo: new Date(activeTo) } : {}),
  };
}

function featureFlagToWire(flag: FeatureFlagDto) {
  return {
    ...flag,
    createdAt: flag.createdAt.toISOString(),
    updatedAt: flag.updatedAt.toISOString(),
  };
}

function assignmentToWire(assignment: FeatureFlagAssignmentDto) {
  return {
    ...assignment,
    activeFrom: assignment.activeFrom.toISOString(),
    activeTo: assignment.activeTo?.toISOString() ?? null,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

function workflowVersionToWire(version: {
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
}) {
  return {
    ...version,
    effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
    effectiveTo: version.effectiveTo?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
  };
}

function workflowAssignmentRuleToWire(rule: WorkflowAssignmentRuleDto) {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
  };
}
