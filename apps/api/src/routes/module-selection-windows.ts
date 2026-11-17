import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type { AllocationMode, SelectionWindowDto } from '../platform/module-selection/window-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);
const AllocationModeSchema = Type.Union([Type.Literal('first-come'), Type.Literal('ranked')]);

const SelectionWindowSchema = Type.Object({
  moduleSelectionWindowId: Type.String(),
  academicPeriodId:        Type.String(),
  academicYear:            Type.String(),
  periodCode:              Type.String(),
  programmeId:             Nullable(Type.String()),
  fheqLevel:               Type.Union([Type.Integer(), Type.Null()]),
  opensAt:                 Type.String(),
  closesAt:                Type.String(),
  resubmissionClosesAt:    Nullable(Type.String()),
  allocationModeCode:      AllocationModeSchema,
  allocationSeeded:        Type.Boolean(),
});

const SelectionWindowBody = Type.Object({
  academicPeriodId:     Type.String(),
  programmeId:          Type.Optional(Type.String()),
  fheqLevel:            Type.Optional(Type.Integer({ minimum: 3, maximum: 8 })),
  opensAt:              Type.String({ format: 'date-time' }),
  closesAt:             Type.String({ format: 'date-time' }),
  resubmissionClosesAt: Type.Optional(Type.String({ format: 'date-time' })),
  allocationModeCode:   Type.Optional(AllocationModeSchema),
});

const SelectionWindowUpdateBody = Type.Object({
  opensAt:              Type.String({ format: 'date-time' }),
  closesAt:             Type.String({ format: 'date-time' }),
  resubmissionClosesAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  allocationModeCode:   Type.Optional(AllocationModeSchema),
});

/** Module selection windows (Phase 4 D-29). */
export function moduleSelectionWindowsRoutes(fastify: FastifyInstance): void {
  fastify.get(
    '/module-selection-windows',
    {
      schema: {
        querystring: Type.Object({ academicPeriodId: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(SelectionWindowSchema) },
      },
      preHandler: [requirePermission('calendar:read')],
    },
    async (request, reply) => {
      const { academicPeriodId } = request.query as { academicPeriodId?: string };
      const windows = await fastify.selectionWindowService.listWindows(request.tenantId, academicPeriodId ? { academicPeriodId } : {});
      await reply.send(windows.map(windowToWire));
    },
  );

  fastify.post(
    '/module-selection-windows',
    {
      schema: {
        body:     SelectionWindowBody,
        response: { 201: Type.Object({ moduleSelectionWindowId: Type.String() }), 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:write')],
    },
    async (request, reply) => {
      const body = request.body as {
        academicPeriodId: string; programmeId?: string; fheqLevel?: number; opensAt: string; closesAt: string;
        resubmissionClosesAt?: string; allocationModeCode?: AllocationMode;
      };
      const moduleSelectionWindowId = await fastify.selectionWindowService.createWindow(request.tenantId, {
        academicPeriodId: body.academicPeriodId,
        programmeId:      body.programmeId ?? null,
        fheqLevel:        body.fheqLevel ?? null,
        opensAt:          new Date(body.opensAt),
        closesAt:         new Date(body.closesAt),
        resubmissionClosesAt: body.resubmissionClosesAt ? new Date(body.resubmissionClosesAt) : null,
        ...(body.allocationModeCode ? { allocationModeCode: body.allocationModeCode } : {}),
      }, request.user.sub);

      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'module_selection_window', entityId: moduleSelectionWindowId, actionType: 'create',
        afterValue: body, actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
      });
      await reply.code(201).send({ moduleSelectionWindowId });
    },
  );

  fastify.patch(
    '/module-selection-windows/:moduleSelectionWindowId',
    {
      schema: {
        params:   Type.Object({ moduleSelectionWindowId: Type.String() }),
        body:     SelectionWindowUpdateBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('calendar:write')],
    },
    async (request, reply) => {
      const { moduleSelectionWindowId } = request.params as { moduleSelectionWindowId: string };
      const body = request.body as { opensAt: string; closesAt: string; resubmissionClosesAt?: string | null; allocationModeCode?: AllocationMode };
      await fastify.selectionWindowService.updateWindow(moduleSelectionWindowId, request.tenantId, {
        opensAt:  new Date(body.opensAt),
        closesAt: new Date(body.closesAt),
        ...(body.resubmissionClosesAt !== undefined ? { resubmissionClosesAt: body.resubmissionClosesAt ? new Date(body.resubmissionClosesAt) : null } : {}),
        ...(body.allocationModeCode ? { allocationModeCode: body.allocationModeCode } : {}),
      });

      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'module_selection_window', entityId: moduleSelectionWindowId, actionType: 'update',
        afterValue: body, actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
      });
      await reply.code(204).send();
    },
  );
}

function windowToWire(window: SelectionWindowDto) {
  return {
    ...window,
    opensAt:  window.opensAt.toISOString(),
    closesAt: window.closesAt.toISOString(),
    resubmissionClosesAt: window.resubmissionClosesAt?.toISOString() ?? null,
  };
}
