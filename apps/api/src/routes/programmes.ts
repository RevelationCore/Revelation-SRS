import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  CreateModuleInput,
  CreateProgrammeInput,
  LearningOutcomeDto,
  LearningOutcomeInput,
  ModuleDto,
  ModuleRelationshipDto,
  ModuleRelationshipInput,
  ProgrammeDto,
  UpdateModuleInput,
  UpdateProgrammeInput,
} from '../platform/catalogue/service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const ProgrammeSchema = Type.Object({
  programmeId:           Type.String(),
  code:                  Type.String(),
  title:                 Type.String(),
  qualificationTypeCode: Type.Union([Type.String(), Type.Null()]),
  awardingBodyId:        Type.Union([Type.String(), Type.Null()]),
  owningSchool:          Type.Union([Type.String(), Type.Null()]),
  creditFrameworkCode:   Type.Union([Type.String(), Type.Null()]),
  fheqLevel:             Type.Union([Type.Number(), Type.Null()]),
  creditTotal:           Type.Union([Type.Number(), Type.Null()]),
  durationYears:         Type.Union([Type.Number(), Type.Null()]),
  modeOfStudyCode:       Type.Union([Type.String(), Type.Null()]),
  sourceSystemReference: Type.Union([Type.String(), Type.Null()]),
  validFrom:             Type.String(),
  validTo:               Type.Union([Type.String(), Type.Null()]),
  recordedAt:            Type.String(),
  recordedUntil:         Type.Union([Type.String(), Type.Null()]),
});

const ProgrammeBodySchema = Type.Object({
  code:                  Type.String({ minLength: 1 }),
  title:                 Type.String({ minLength: 1 }),
  qualificationTypeCode: Type.Optional(Type.String()),
  awardingBodyId:        Type.Optional(Type.String()),
  owningSchool:          Type.Optional(Type.String()),
  creditFrameworkCode:   Type.Optional(Type.String()),
  fheqLevel:             Type.Optional(Type.Integer({ minimum: 1 })),
  creditTotal:           Type.Optional(Type.Integer({ minimum: 0 })),
  durationYears:         Type.Optional(Type.Integer({ minimum: 0 })),
  modeOfStudyCode:       Type.Optional(Type.String()),
  sourceSystemReference: Type.Optional(Type.String()),
  validFrom:             Type.Optional(Type.String({ format: 'date-time' })),
});

const ModuleSchema = Type.Object({
  moduleId:              Type.String(),
  code:                  Type.String(),
  title:                 Type.String(),
  creditValue:           Type.Union([Type.Number(), Type.Null()]),
  fheqLevel:             Type.Union([Type.Number(), Type.Null()]),
  sourceSystemReference: Type.Union([Type.String(), Type.Null()]),
  validFrom:             Type.String(),
  validTo:               Type.Union([Type.String(), Type.Null()]),
  recordedAt:            Type.String(),
  recordedUntil:         Type.Union([Type.String(), Type.Null()]),
});

const ModuleBodySchema = Type.Object({
  code:                  Type.String({ minLength: 1 }),
  title:                 Type.String({ minLength: 1 }),
  creditValue:           Type.Optional(Type.Integer({ minimum: 0 })),
  fheqLevel:             Type.Optional(Type.Integer({ minimum: 1 })),
  sourceSystemReference: Type.Optional(Type.String()),
  validFrom:             Type.Optional(Type.String({ format: 'date-time' })),
});

const LearningOutcomeSchema = Type.Object({
  learningOutcomeId: Type.String(),
  programmeId:       Type.Union([Type.String(), Type.Null()]),
  moduleId:          Type.Union([Type.String(), Type.Null()]),
  outcomeCode:       Type.String(),
  description:       Type.String(),
  validFrom:         Type.String(),
  recordedAt:        Type.String(),
});

const ModuleRelationshipSchema = Type.Object({
  relationshipId:       Type.String(),
  moduleId:             Type.String(),
  relatedModuleId:      Type.String(),
  relationshipTypeCode: Type.String(),
  validFrom:            Type.String(),
  recordedAt:           Type.String(),
});

export function programmesRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/programmes',
    {
      schema: { response: { 200: Type.Array(ProgrammeSchema) } },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const programmes = await fastify.catalogueService.listProgrammes(request.tenantId);
      await reply.send(programmes.map(programmeToWire));
    },
  );

  fastify.post(
    '/programmes',
    {
      schema: {
        body: ProgrammeBodySchema,
        response: { 201: Type.Object({ programmeId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const body = request.body as CreateProgrammeInput & { validFrom?: string };
      const input = programmeBodyToInput(body);
      const programmeId = await fastify.catalogueService.createProgramme(request.tenantId, input);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'programme',
        entityId:         programmeId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ programmeId });
    },
  );

  fastify.get(
    '/programmes/:programmeId',
    {
      schema: {
        params: Type.Object({ programmeId: Type.String() }),
        response: { 200: ProgrammeSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const { programmeId } = request.params as { programmeId: string };
      const programme = await fastify.catalogueService.getProgramme(programmeId, request.tenantId);
      if (!programme) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Programme '${programmeId}' not found`,
        });
      }

      await reply.send(programmeToWire(programme));
    },
  );

  fastify.patch(
    '/programmes/:programmeId',
    {
      schema: {
        params: Type.Object({ programmeId: Type.String() }),
        body: Type.Partial(ProgrammeBodySchema),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const { programmeId } = request.params as { programmeId: string };
      const body = request.body as UpdateProgrammeInput & { validFrom?: string };
      await fastify.catalogueService.updateProgramme(programmeId, request.tenantId, programmeBodyToInput(body));

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'programme',
        entityId:         programmeId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.get(
    '/programmes/:programmeId/history',
    {
      schema: {
        params: Type.Object({ programmeId: Type.String() }),
        response: { 200: Type.Array(ProgrammeSchema) },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const { programmeId } = request.params as { programmeId: string };
      const history = await fastify.catalogueService.getProgrammeHistory(programmeId, request.tenantId);
      await reply.send(history.map(programmeToWire));
    },
  );

  fastify.get(
    '/modules',
    {
      schema: { response: { 200: Type.Array(ModuleSchema) } },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const modules = await fastify.catalogueService.listModules(request.tenantId);
      await reply.send(modules.map(moduleToWire));
    },
  );

  fastify.post(
    '/modules',
    {
      schema: {
        body: ModuleBodySchema,
        response: { 201: Type.Object({ moduleId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const body = request.body as CreateModuleInput & { validFrom?: string };
      const moduleId = await fastify.catalogueService.createModule(request.tenantId, moduleBodyToInput(body));

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'module',
        entityId:         moduleId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ moduleId });
    },
  );

  fastify.get(
    '/modules/:moduleId',
    {
      schema: {
        params: Type.Object({ moduleId: Type.String() }),
        response: { 200: ModuleSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const { moduleId } = request.params as { moduleId: string };
      const module = await fastify.catalogueService.getModule(moduleId, request.tenantId);
      if (!module) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Module '${moduleId}' not found`,
        });
      }

      await reply.send(moduleToWire(module));
    },
  );

  fastify.patch(
    '/modules/:moduleId',
    {
      schema: {
        params: Type.Object({ moduleId: Type.String() }),
        body: Type.Partial(ModuleBodySchema),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const { moduleId } = request.params as { moduleId: string };
      const body = request.body as UpdateModuleInput & { validFrom?: string };
      await fastify.catalogueService.updateModule(moduleId, request.tenantId, moduleBodyToInput(body));

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'module',
        entityId:         moduleId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.get(
    '/modules/:moduleId/history',
    {
      schema: {
        params: Type.Object({ moduleId: Type.String() }),
        response: { 200: Type.Array(ModuleSchema) },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const { moduleId } = request.params as { moduleId: string };
      const history = await fastify.catalogueService.getModuleHistory(moduleId, request.tenantId);
      await reply.send(history.map(moduleToWire));
    },
  );

  fastify.post(
    '/learning-outcomes',
    {
      schema: {
        body: Type.Object({
          programmeId: Type.Optional(Type.String()),
          moduleId:    Type.Optional(Type.String()),
          outcomeCode: Type.String({ minLength: 1 }),
          description: Type.String({ minLength: 1 }),
          validFrom:   Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: { 201: Type.Object({ learningOutcomeId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const body = request.body as LearningOutcomeInput & { validFrom?: string };
      const input: LearningOutcomeInput = {
        outcomeCode: body.outcomeCode,
        description: body.description,
      };
      if (body.programmeId !== undefined) input.programmeId = body.programmeId;
      if (body.moduleId !== undefined) input.moduleId = body.moduleId;
      if (body.validFrom !== undefined) input.validFrom = new Date(body.validFrom);
      const learningOutcomeId = await fastify.catalogueService.createLearningOutcome(request.tenantId, input);

      await reply.code(201).send({ learningOutcomeId });
    },
  );

  fastify.get(
    '/learning-outcomes',
    {
      schema: {
        querystring: Type.Object({
          programmeId: Type.Optional(Type.String()),
          moduleId:    Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(LearningOutcomeSchema) },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const q = request.query as { programmeId?: string; moduleId?: string };
      const outcomes = await fastify.catalogueService.listLearningOutcomes(request.tenantId, q);
      await reply.send(outcomes.map(learningOutcomeToWire));
    },
  );

  fastify.post(
    '/module-relationships',
    {
      schema: {
        body: Type.Object({
          moduleId:             Type.String(),
          relatedModuleId:      Type.String(),
          relationshipTypeCode: Type.Union([
            Type.Literal('prerequisite'),
            Type.Literal('co-requisite'),
            Type.Literal('exclusion'),
          ]),
          validFrom: Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: { 201: Type.Object({ relationshipId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('catalogue:write')],
    },
    async (request, reply) => {
      const body = request.body as ModuleRelationshipInput & { validFrom?: string };
      const input: ModuleRelationshipInput = {
        moduleId:             body.moduleId,
        relatedModuleId:      body.relatedModuleId,
        relationshipTypeCode: body.relationshipTypeCode,
      };
      if (body.validFrom !== undefined) input.validFrom = new Date(body.validFrom);
      const relationshipId = await fastify.catalogueService.createModuleRelationship(request.tenantId, input);

      await reply.code(201).send({ relationshipId });
    },
  );

  fastify.get(
    '/modules/:moduleId/relationships',
    {
      schema: {
        params: Type.Object({ moduleId: Type.String() }),
        response: { 200: Type.Array(ModuleRelationshipSchema) },
      },
      preHandler: [requirePermission('catalogue:read')],
    },
    async (request, reply) => {
      const { moduleId } = request.params as { moduleId: string };
      const relationships = await fastify.catalogueService.listModuleRelationships(moduleId, request.tenantId);
      await reply.send(relationships.map(moduleRelationshipToWire));
    },
  );
}

function programmeBodyToInput(body: Partial<CreateProgrammeInput> & { validFrom?: string }): CreateProgrammeInput {
  const input = { ...body } as CreateProgrammeInput;
  if (body.validFrom !== undefined) input.validFrom = new Date(body.validFrom);
  return input;
}

function moduleBodyToInput(body: Partial<CreateModuleInput> & { validFrom?: string }): CreateModuleInput {
  const input = { ...body } as CreateModuleInput;
  if (body.validFrom !== undefined) input.validFrom = new Date(body.validFrom);
  return input;
}

function programmeToWire(programme: ProgrammeDto) {
  return {
    ...programme,
    validFrom:     programme.validFrom.toISOString(),
    validTo:       programme.validTo?.toISOString() ?? null,
    recordedAt:    programme.recordedAt.toISOString(),
    recordedUntil: programme.recordedUntil?.toISOString() ?? null,
  };
}

function moduleToWire(module: ModuleDto) {
  return {
    ...module,
    validFrom:     module.validFrom.toISOString(),
    validTo:       module.validTo?.toISOString() ?? null,
    recordedAt:    module.recordedAt.toISOString(),
    recordedUntil: module.recordedUntil?.toISOString() ?? null,
  };
}

function learningOutcomeToWire(outcome: LearningOutcomeDto) {
  return {
    ...outcome,
    validFrom:  outcome.validFrom.toISOString(),
    recordedAt: outcome.recordedAt.toISOString(),
  };
}

function moduleRelationshipToWire(relationship: ModuleRelationshipDto) {
  return {
    ...relationship,
    validFrom:  relationship.validFrom.toISOString(),
    recordedAt: relationship.recordedAt.toISOString(),
  };
}
