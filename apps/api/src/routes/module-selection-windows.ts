import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AllocationMode, SelectionWindowDto } from '../platform/module-selection/window-service.js';
import type { AllocationRunDto } from '../platform/module-selection/allocation-service.js';

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

const ResultSchema = Type.Object({
  proposalId: Type.String(), enrolmentId: Type.String(), orderPosition: Type.Integer(), tier: Type.Integer(),
  choiceSlot: Type.Union([Type.Integer(), Type.Null()]), outcomeCode: Type.String(), allocatedItemId: Nullable(Type.String()),
  moduleCode: Nullable(Type.String()), reason: Nullable(Type.String()),
});
const RunSchema = Type.Object({
  allocationRunId: Type.String(), windowId: Type.String(), kindCode: Type.String(), statusCode: Type.String(), algorithmVersion: Type.String(),
  priorityOrder: Type.Array(Type.String()), inputsHash: Type.String(),
  summary: Type.Object({
    proposals: Type.Integer(), fullyAllocated: Type.Integer(), partlyAllocated: Type.Integer(),
    compulsoryOverflow: Type.Array(Type.Object({ moduleCode: Type.String(), over: Type.Integer() })),
  }),
  createdBy: Type.String(), createdAt: Type.String(), submittedBy: Nullable(Type.String()), approvedBy: Nullable(Type.String()), appliedAt: Nullable(Type.String()),
  results: Type.Optional(Type.Array(ResultSchema)),
});

/** Ranked preference allocation runs (Phase 4 D-30): preview, submit, then a different person approves and applies. */
export function moduleAllocationRoutes(fastify: FastifyInstance): void {
  fastify.post('/module-selection-windows/:moduleSelectionWindowId/allocation-runs', {
    schema: {
      params: Type.Object({ moduleSelectionWindowId: Type.String() }),
      body: Type.Object({ kindCode: Type.Optional(Type.Union([Type.Literal('main'), Type.Literal('top-up')])) }),
      response: { 201: RunSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('module-selection:allocate')],
  }, async (request, reply) => {
    const { moduleSelectionWindowId } = request.params as { moduleSelectionWindowId: string };
    const { kindCode } = request.body as { kindCode?: 'main' | 'top-up' };
    const run = await fastify.allocationService.preview(request.tenantId, moduleSelectionWindowId, kindCode ?? 'main', request.user.sub);
    await auditRun(fastify, request, run, 'create');
    await reply.code(201).send(runToWire(run));
  });

  fastify.get('/module-selection-windows/:moduleSelectionWindowId/allocation-runs', {
    schema: { params: Type.Object({ moduleSelectionWindowId: Type.String() }), response: { 200: Type.Array(RunSchema) } },
    preHandler: [requireAnyPermission('module-selection:allocate', 'module-selection:decide')],
  }, async (request, reply) => {
    const { moduleSelectionWindowId } = request.params as { moduleSelectionWindowId: string };
    await reply.send((await fastify.allocationService.listRuns(request.tenantId, moduleSelectionWindowId)).map(runToWire));
  });

  fastify.get('/allocation-runs/:allocationRunId', {
    schema: { params: Type.Object({ allocationRunId: Type.String() }), response: { 200: RunSchema, 404: ErrorSchema } },
    preHandler: [requireAnyPermission('module-selection:allocate', 'module-selection:decide')],
  }, async (request, reply) => {
    const { allocationRunId } = request.params as { allocationRunId: string };
    await reply.send(runToWire(await fastify.allocationService.getRun(request.tenantId, allocationRunId, { withResults: true })));
  });

  fastify.post('/allocation-runs/:allocationRunId/submission', {
    schema: { params: Type.Object({ allocationRunId: Type.String() }), response: { 200: RunSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('module-selection:allocate')],
  }, async (request, reply) => {
    const { allocationRunId } = request.params as { allocationRunId: string };
    const run = await fastify.allocationService.submit(request.tenantId, allocationRunId, request.user.sub);
    await auditRun(fastify, request, run, 'update');
    await reply.send(runToWire(run));
  });

  fastify.post('/allocation-runs/:allocationRunId/decision', {
    schema: {
      params: Type.Object({ allocationRunId: Type.String() }),
      body: Type.Object({ decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]) }),
      response: { 200: RunSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requirePermission('module-selection:decide')],
  }, async (request, reply) => {
    const { allocationRunId } = request.params as { allocationRunId: string };
    const { decisionCode } = request.body as { decisionCode: 'approved' | 'rejected' };
    const run = await fastify.allocationService.decide(request.tenantId, allocationRunId, decisionCode, request.user.sub);
    await auditRun(fastify, request, run, 'update');
    await reply.send(runToWire(run));
  });
}

function runToWire(run: AllocationRunDto) {
  return { ...run, createdAt: run.createdAt.toISOString(), appliedAt: run.appliedAt?.toISOString() ?? null };
}

async function auditRun(fastify: FastifyInstance, request: FastifyRequest, run: AllocationRunDto, actionType: 'create' | 'update'): Promise<void> {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType: 'module_allocation_run', entityId: run.allocationRunId, actionType,
    afterValue: { statusCode: run.statusCode, inputsHash: run.inputsHash, summary: run.summary },
    actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
  });
}

function windowToWire(window: SelectionWindowDto) {
  return {
    ...window,
    opensAt:  window.opensAt.toISOString(),
    closesAt: window.closesAt.toISOString(),
    resubmissionClosesAt: window.resubmissionClosesAt?.toISOString() ?? null,
  };
}
