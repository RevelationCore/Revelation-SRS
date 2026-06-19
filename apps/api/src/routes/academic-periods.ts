import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  AcademicPeriodDto,
  AcademicPeriodInput,
  ModuleOfferingDto,
  ModuleOfferingInput,
} from '../platform/calendar/service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const AcademicPeriodSchema = Type.Object({
  academicPeriodId: Type.String(),
  academicYear:     Type.String(),
  periodCode:       Type.String(),
  periodTypeCode:   Type.String(),
  startDate:        Type.String(),
  endDate:          Type.String(),
});

const ModuleOfferingSchema = Type.Object({
  moduleOfferingId: Type.String(),
  moduleId:         Type.String(),
  moduleCode:       Type.String(),
  moduleTitle:      Type.String(),
  academicPeriodId: Type.String(),
  periodCode:       Type.String(),
  deliveryModeCode: Type.Union([Type.String(), Type.Null()]),
  capacity:         Type.Union([Type.Number(), Type.Null()]),
});

export function academicPeriodsRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/academic-periods',
    {
      schema: {
        querystring: Type.Object({ academicYear: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(AcademicPeriodSchema) },
      },
      preHandler: [requirePermission('calendar:read')],
    },
    async (request, reply) => {
      const q = request.query as { academicYear?: string };
      const periods = await fastify.calendarService.listAcademicPeriods(request.tenantId, q);
      await reply.send(periods);
    },
  );

  fastify.post(
    '/academic-periods',
    {
      schema: {
        body: Type.Object({
          academicYear:   Type.String({ minLength: 1 }),
          periodCode:     Type.String({ minLength: 1 }),
          periodTypeCode: Type.Union([Type.Literal('semester'), Type.Literal('term'), Type.Literal('year')]),
          startDate:      Type.String(),
          endDate:        Type.String(),
        }),
        response: { 201: Type.Object({ academicPeriodId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:write')],
    },
    async (request, reply) => {
      const body = request.body as AcademicPeriodInput;
      const academicPeriodId = await fastify.calendarService.createAcademicPeriod(request.tenantId, body);

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'academic_period',
        entityId:      academicPeriodId,
        actionType:    'create',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      await reply.code(201).send({ academicPeriodId });
    },
  );

  fastify.get(
    '/academic-periods/:academicPeriodId',
    {
      schema: {
        params: Type.Object({ academicPeriodId: Type.String() }),
        response: { 200: AcademicPeriodSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:read')],
    },
    async (request, reply) => {
      const { academicPeriodId } = request.params as { academicPeriodId: string };
      const period = await fastify.calendarService.getAcademicPeriod(academicPeriodId, request.tenantId);
      if (!period) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Academic period '${academicPeriodId}' not found`,
        });
      }

      await reply.send(academicPeriodToWire(period));
    },
  );

  fastify.get(
    '/module-offerings',
    {
      schema: {
        querystring: Type.Object({
          academicPeriodId: Type.Optional(Type.String()),
          moduleId:         Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(ModuleOfferingSchema) },
      },
      preHandler: [requirePermission('calendar:read')],
    },
    async (request, reply) => {
      const q = request.query as { academicPeriodId?: string; moduleId?: string };
      const offerings = await fastify.calendarService.listModuleOfferings(request.tenantId, q);
      await reply.send(offerings.map(moduleOfferingToWire));
    },
  );

  fastify.post(
    '/module-offerings',
    {
      schema: {
        body: Type.Object({
          moduleId:         Type.String(),
          academicPeriodId: Type.String(),
          deliveryModeCode: Type.Optional(Type.String()),
          capacity:         Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        response: { 201: Type.Object({ moduleOfferingId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:write')],
    },
    async (request, reply) => {
      const body = request.body as ModuleOfferingInput;
      const moduleOfferingId = await fastify.calendarService.createModuleOffering(request.tenantId, body);

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'module_offering',
        entityId:      moduleOfferingId,
        actionType:    'create',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      await reply.code(201).send({ moduleOfferingId });
    },
  );

  fastify.get(
    '/module-offerings/:moduleOfferingId',
    {
      schema: {
        params: Type.Object({ moduleOfferingId: Type.String() }),
        response: { 200: ModuleOfferingSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:read')],
    },
    async (request, reply) => {
      const { moduleOfferingId } = request.params as { moduleOfferingId: string };
      const offering = await fastify.calendarService.getModuleOffering(moduleOfferingId, request.tenantId);
      if (!offering) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Module offering '${moduleOfferingId}' not found`,
        });
      }

      await reply.send(moduleOfferingToWire(offering));
    },
  );
}

function academicPeriodToWire(period: AcademicPeriodDto) {
  return period;
}

function moduleOfferingToWire(offering: ModuleOfferingDto) {
  return offering;
}
