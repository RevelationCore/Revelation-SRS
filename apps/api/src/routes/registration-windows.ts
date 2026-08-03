import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { RegistrationWindowDto } from '../platform/registration/window-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const RegistrationWindowSchema = Type.Object({
  registrationWindowId: Type.String(),
  academicPeriodId:     Type.String(),
  academicYear:         Type.String(),
  periodCode:           Type.String(),
  opensAt:              Type.String(),
  closesAt:             Type.String(),
});

const RegistrationWindowBody = Type.Object({
  academicPeriodId: Type.String(),
  opensAt:          Type.String({ format: 'date-time' }),
  closesAt:         Type.String({ format: 'date-time' }),
});

const RegistrationWindowUpdateBody = Type.Object({
  opensAt:  Type.String({ format: 'date-time' }),
  closesAt: Type.String({ format: 'date-time' }),
});

export function registrationWindowsRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/registration-windows',
    {
      schema: { response: { 200: Type.Array(RegistrationWindowSchema) } },
      preHandler: [requirePermission('calendar:read')],
    },
    async (request, reply) => {
      const windows = await fastify.registrationWindowService.listWindows(request.tenantId);
      await reply.send(windows.map(registrationWindowToWire));
    },
  );

  fastify.post(
    '/registration-windows',
    {
      schema: {
        body:     RegistrationWindowBody,
        response: { 201: Type.Object({ registrationWindowId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:write')],
    },
    async (request, reply) => {
      const body = request.body as { academicPeriodId: string; opensAt: string; closesAt: string };
      const registrationWindowId = await fastify.registrationWindowService.createWindow(request.tenantId, {
        academicPeriodId: body.academicPeriodId,
        opensAt:          new Date(body.opensAt),
        closesAt:         new Date(body.closesAt),
      });

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'registration_window',
        entityId:         registrationWindowId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ registrationWindowId });
    },
  );

  fastify.patch(
    '/registration-windows/:registrationWindowId',
    {
      schema: {
        params:   Type.Object({ registrationWindowId: Type.String() }),
        body:     RegistrationWindowUpdateBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:write')],
    },
    async (request, reply) => {
      const { registrationWindowId } = request.params as { registrationWindowId: string };
      const body = request.body as { opensAt: string; closesAt: string };
      await fastify.registrationWindowService.updateWindow(registrationWindowId, request.tenantId, {
        opensAt:  new Date(body.opensAt),
        closesAt: new Date(body.closesAt),
      });

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'registration_window',
        entityId:         registrationWindowId,
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );
}

function registrationWindowToWire(window: RegistrationWindowDto) {
  return {
    ...window,
    opensAt:  window.opensAt.toISOString(),
    closesAt: window.closesAt.toISOString(),
  };
}
