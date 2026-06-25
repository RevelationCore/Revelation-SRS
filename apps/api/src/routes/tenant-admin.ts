import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  AcademicRuleDto,
  CreateAcademicRuleInput,
  CreateTenantInput,
  TenantDto,
  UpdateAcademicRuleInput,
  UpdateTenantInput,
} from '../platform/tenant-admin/service.js';

const JsonRecord = Type.Record(Type.String(), Type.Unknown());

const TenantSchema = Type.Object({
  tenantId: Type.String(),
  code: Type.String(),
  name: Type.String(),
  configuration: JsonRecord,
  active: Type.Boolean(),
  createdAt: Type.String(),
});

const AcademicRuleSchema = Type.Object({
  academicRuleId: Type.String(),
  programmeId: Type.Union([Type.String(), Type.Null()]),
  ruleTypeCode: Type.String(),
  ruleKey: Type.String(),
  ruleValue: JsonRecord,
  description: Type.Union([Type.String(), Type.Null()]),
  appliesToLevel: Type.Union([Type.Number(), Type.Null()]),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const TenantBody = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 50 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  configuration: Type.Optional(JsonRecord),
  active: Type.Optional(Type.Boolean()),
});

const TenantPatchBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  configuration: Type.Optional(JsonRecord),
  active: Type.Optional(Type.Boolean()),
});

const AcademicRuleBody = Type.Object({
  programmeId: Type.Optional(Type.String()),
  ruleTypeCode: Type.String({ minLength: 1, maxLength: 100 }),
  ruleKey: Type.String({ minLength: 1, maxLength: 100 }),
  ruleValue: JsonRecord,
  description: Type.Optional(Type.String()),
  appliesToLevel: Type.Optional(Type.Integer({ minimum: 0 })),
  validFrom: Type.Optional(Type.String({ format: 'date-time' })),
});

const AcademicRulePatchBody = Type.Partial(AcademicRuleBody);

export function tenantAdminRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/tenants',
    {
      schema: { response: { 200: Type.Array(TenantSchema) } },
      preHandler: [requirePermission('tenant:manage')],
    },
    async (_request, reply) => {
      const tenants = await fastify.tenantAdminService.listTenants();
      await reply.send(tenants.map(tenantToWire));
    },
  );

  fastify.post(
    '/tenants',
    {
      schema: {
        body: TenantBody,
        response: { 201: Type.Object({ tenantId: Type.String() }), 409: ErrorSchema },
      },
      preHandler: [requirePermission('tenant:manage')],
    },
    async (request, reply) => {
      const body = request.body as CreateTenantInput;
      const tenantId = await fastify.tenantAdminService.createTenant(body);

      await fastify.audit.record({
        entityType: 'tenant',
        entityId: tenantId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ tenantId });
    },
  );

  fastify.get(
    '/tenants/:tenantId',
    {
      schema: {
        params: Type.Object({ tenantId: Type.String() }),
        response: { 200: TenantSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('tenant:manage')],
    },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const tenant = await fastify.tenantAdminService.getTenant(tenantId);
      if (!tenant) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Tenant '${tenantId}' not found`,
        });
      }
      await reply.send(tenantToWire(tenant));
    },
  );

  fastify.patch(
    '/tenants/:tenantId',
    {
      schema: {
        params: Type.Object({ tenantId: Type.String() }),
        body: TenantPatchBody,
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('tenant:manage')],
    },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as UpdateTenantInput;
      await fastify.tenantAdminService.updateTenant(tenantId, body);

      await fastify.audit.record({
        entityType: 'tenant',
        entityId: tenantId,
        afterValue: body,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.get(
    '/tenant/configuration',
    {
      schema: { response: { 200: JsonRecord } },
      preHandler: [requirePermission('config:read')],
    },
    async (request, reply) => {
      const tenant = await fastify.tenantAdminService.getTenant(request.tenantId);
      await reply.send(tenant?.configuration ?? {});
    },
  );

  fastify.patch(
    '/tenant/configuration',
    {
      schema: {
        body: JsonRecord,
        response: { 200: JsonRecord },
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const patch = request.body as Record<string, unknown>;
      const configuration = await fastify.tenantAdminService.mergeTenantConfiguration(request.tenantId, patch);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'tenant_configuration',
        entityId: request.tenantId,
        afterValue: patch,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.send(configuration);
    },
  );

  fastify.get(
    '/academic-rules',
    {
      schema: {
        querystring: Type.Object({
          ruleTypeCode: Type.Optional(Type.String()),
          ruleKey: Type.Optional(Type.String()),
          programmeId: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(AcademicRuleSchema) },
      },
      preHandler: [requirePermission('rule:read')],
    },
    async (request, reply) => {
      const query = request.query as { ruleTypeCode?: string; ruleKey?: string; programmeId?: string };
      const opts: { ruleTypeCode?: string; ruleKey?: string; programmeId?: string } = {};
      if (query.ruleTypeCode !== undefined) opts.ruleTypeCode = query.ruleTypeCode;
      if (query.ruleKey !== undefined) opts.ruleKey = query.ruleKey;
      if (query.programmeId !== undefined) opts.programmeId = query.programmeId;
      const rules = await fastify.tenantAdminService.listAcademicRules(request.tenantId, opts);
      await reply.send(rules.map(academicRuleToWire));
    },
  );

  fastify.post(
    '/academic-rules',
    {
      schema: {
        body: AcademicRuleBody,
        response: { 201: Type.Object({ academicRuleId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('rule:write')],
    },
    async (request, reply) => {
      const body = academicRuleBodyToCreateInput(request.body as RequiredAcademicRuleBodyShape);
      const academicRuleId = await fastify.tenantAdminService.createAcademicRule(request.tenantId, body);
      fastify.rules.invalidateTenant(request.tenantId);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'academic_rule',
        entityId: academicRuleId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ academicRuleId });
    },
  );

  fastify.get(
    '/academic-rules/:academicRuleId/history',
    {
      schema: {
        params: Type.Object({ academicRuleId: Type.String() }),
        response: { 200: Type.Array(AcademicRuleSchema) },
      },
      preHandler: [requirePermission('rule:read')],
    },
    async (request, reply) => {
      const { academicRuleId } = request.params as { academicRuleId: string };
      const history = await fastify.tenantAdminService.getAcademicRuleHistory(academicRuleId, request.tenantId);
      await reply.send(history.map(academicRuleToWire));
    },
  );

  fastify.get(
    '/academic-rules/:academicRuleId',
    {
      schema: {
        params: Type.Object({ academicRuleId: Type.String() }),
        response: { 200: AcademicRuleSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('rule:read')],
    },
    async (request, reply) => {
      const { academicRuleId } = request.params as { academicRuleId: string };
      const rule = await fastify.tenantAdminService.getAcademicRule(academicRuleId, request.tenantId);
      if (!rule) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `AcademicRule '${academicRuleId}' not found`,
        });
      }
      await reply.send(academicRuleToWire(rule));
    },
  );

  fastify.patch(
    '/academic-rules/:academicRuleId',
    {
      schema: {
        params: Type.Object({ academicRuleId: Type.String() }),
        body: AcademicRulePatchBody,
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('rule:write')],
    },
    async (request, reply) => {
      const { academicRuleId } = request.params as { academicRuleId: string };
      const body = academicRuleBodyToInput(request.body as AcademicRuleBodyShape);
      await fastify.tenantAdminService.updateAcademicRule(academicRuleId, request.tenantId, body);
      fastify.rules.invalidateTenant(request.tenantId);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'academic_rule',
        entityId: academicRuleId,
        afterValue: body,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );
}

interface AcademicRuleBodyShape {
  programmeId?: string;
  ruleTypeCode?: string;
  ruleKey?: string;
  ruleValue?: Record<string, unknown>;
  description?: string;
  appliesToLevel?: number;
  validFrom?: string;
}

interface RequiredAcademicRuleBodyShape extends AcademicRuleBodyShape {
  ruleTypeCode: string;
  ruleKey: string;
  ruleValue: Record<string, unknown>;
}

function academicRuleBodyToCreateInput(body: RequiredAcademicRuleBodyShape): CreateAcademicRuleInput {
  return {
    ruleTypeCode: body.ruleTypeCode,
    ruleKey: body.ruleKey,
    ruleValue: body.ruleValue,
    ...(body.programmeId !== undefined ? { programmeId: body.programmeId } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.appliesToLevel !== undefined ? { appliesToLevel: body.appliesToLevel } : {}),
    ...(body.validFrom !== undefined ? { validFrom: new Date(body.validFrom) } : {}),
  };
}

function academicRuleBodyToInput(body: AcademicRuleBodyShape): UpdateAcademicRuleInput {
  return {
    ...(body.programmeId !== undefined ? { programmeId: body.programmeId } : {}),
    ...(body.ruleTypeCode !== undefined ? { ruleTypeCode: body.ruleTypeCode } : {}),
    ...(body.ruleKey !== undefined ? { ruleKey: body.ruleKey } : {}),
    ...(body.ruleValue !== undefined ? { ruleValue: body.ruleValue } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.appliesToLevel !== undefined ? { appliesToLevel: body.appliesToLevel } : {}),
    ...(body.validFrom !== undefined ? { validFrom: new Date(body.validFrom) } : {}),
  };
}

function tenantToWire(tenant: TenantDto) {
  return {
    ...tenant,
    createdAt: tenant.createdAt.toISOString(),
  };
}

function academicRuleToWire(rule: AcademicRuleDto) {
  return {
    ...rule,
    validFrom: rule.validFrom.toISOString(),
    validTo: rule.validTo?.toISOString() ?? null,
    recordedAt: rule.recordedAt.toISOString(),
    recordedUntil: rule.recordedUntil?.toISOString() ?? null,
  };
}
