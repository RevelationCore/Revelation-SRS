import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DeliveryItemDto, DeliveryReplyActor, DeliveryTaskDto, FlowConfigDto } from '../platform/delivery/delivery-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const ItemProps = {
  deliveryItemId: Type.String(),
  flowCode: Type.String(),
  targetSystem: Type.String(),
  subjectType: Type.String(),
  subjectId: Type.String(),
  personId: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Record(Type.String(), Type.Unknown()),
  summary: Type.String(),
  fulfilmentModeCode: Type.String(),
  statusCode: Type.String(),
  failureReason: Type.Union([Type.String(), Type.Null()]),
  requestPublishedAt: Type.Union([Type.String(), Type.Null()]),
  deliveredAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
};
const ItemSchema = Type.Object(ItemProps);
const TaskSchema = Type.Object({
  ...ItemProps,
  flowName: Type.String(),
  targetLabel: Type.String(),
  studentNumber: Type.Union([Type.String(), Type.Null()]),
  studentName: Type.Union([Type.String(), Type.Null()]),
  ownerDescription: Type.Union([Type.String(), Type.Null()]),
  overdue: Type.Boolean(),
});
const FlowSchema = Type.Object({
  flowCode: Type.String(),
  targetSystem: Type.String(),
  targetLabel: Type.String(),
  name: Type.String(),
  producer: Type.String(),
  producerNote: Type.String(),
  fulfilmentModeCode: Type.String(),
  ownerDescription: Type.Union([Type.String(), Type.Null()]),
  alertAfterHours: Type.Integer(),
  notifyEmail: Type.Union([Type.String(), Type.Null()]),
  lastOverdueNoticeAt: Type.Union([Type.String(), Type.Null()]),
  isDefault: Type.Boolean(),
});
const FlowBody = Type.Object({
  fulfilmentModeCode: Type.String({ minLength: 1 }),
  ownerDescription: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
  alertAfterHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 8760 })),
  notifyEmail: Type.Optional(Type.Union([Type.String({ maxLength: 254 }), Type.Null()])),
});

function actorOf(request: FastifyRequest): DeliveryReplyActor {
  return hasPermission(request.user.roles, 'integration:manage') ? 'connector' : 'person';
}

/**
 * Platform delivery ledger: outbound flows to adjacent systems (library,
 * CRM, ...), their per-tenant fulfilment settings, the staff task queue for
 * flows worked by hand, and the replies a connector or a person sends.
 */
export function deliveryRoutes(fastify: FastifyInstance): void {
  fastify.get('/delivery-flows', {
    schema: { response: { 200: Type.Array(FlowSchema) } },
    preHandler: [requireAnyPermission('config:read', 'delivery:fulfil')],
  }, async (request, reply) => {
    await reply.send((await fastify.deliveryService.listFlows(request.tenantId)).map(flowToWire));
  });

  fastify.put('/delivery-flows/:flowCode', {
    schema: {
      params: Type.Object({ flowCode: Type.String() }),
      body: FlowBody,
      response: { 200: FlowSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('config:write')],
  }, async (request, reply) => {
    const { flowCode } = request.params as { flowCode: string };
    const body = request.body as { fulfilmentModeCode: string; ownerDescription?: string | null; alertAfterHours?: number; notifyEmail?: string | null };
    const before = (await fastify.deliveryService.listFlows(request.tenantId)).find((f) => f.flowCode === flowCode);
    const updated = await fastify.deliveryService.setFlow(request.tenantId, flowCode, body, request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'delivery_flow_config',
      entityId: request.tenantId,
      fieldName: `${flowCode}.fulfilment_mode_code`,
      beforeValue: before ? { fulfilmentModeCode: before.fulfilmentModeCode, isDefault: before.isDefault } : null,
      afterValue: { fulfilmentModeCode: updated.fulfilmentModeCode, ownerDescription: updated.ownerDescription, alertAfterHours: updated.alertAfterHours, notifyEmail: updated.notifyEmail },
      actionType: 'update',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
      reasonText: `Delivery flow ${flowCode} set to ${body.fulfilmentModeCode}`,
    });
    await reply.send(flowToWire(updated));
  });

  fastify.get('/delivery-tasks', {
    schema: {
      querystring: Type.Object({ flowCode: Type.Optional(Type.String()) }),
      response: { 200: Type.Array(TaskSchema) },
    },
    preHandler: [requirePermission('delivery:fulfil')],
  }, async (request, reply) => {
    const { flowCode } = request.query as { flowCode?: string };
    const tasks = await fastify.deliveryService.listTasks(request.tenantId, flowCode ? { flowCode } : {});
    await reply.send(tasks.map(taskToWire));
  });

  fastify.get('/delivery-items', {
    schema: {
      querystring: Type.Object({ flowCode: Type.Optional(Type.String()), subjectId: Type.Optional(Type.String()) }),
      response: { 200: Type.Array(ItemSchema) },
    },
    preHandler: [requireAnyPermission('integration:manage', 'delivery:fulfil')],
  }, async (request, reply) => {
    const query = request.query as { flowCode?: string; subjectId?: string };
    const items = await fastify.deliveryService.listItems(request.tenantId, {
      ...(query.flowCode ? { flowCode: query.flowCode } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    });
    await reply.send(items.map(itemToWire));
  });

  fastify.post('/delivery-items/:deliveryItemId/acknowledge', {
    schema: {
      params: Type.Object({ deliveryItemId: Type.String() }),
      response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requireAnyPermission('integration:manage', 'delivery:fulfil')],
  }, async (request, reply) => {
    const { deliveryItemId } = request.params as { deliveryItemId: string };
    const actor = actorOf(request);
    await fastify.deliveryService.acknowledge(request.tenantId, deliveryItemId, actor);
    await auditPerson(fastify, request, actor, deliveryItemId, 'Integration task: confirmed applied');
    await reply.code(204).send();
  });

  fastify.post('/delivery-items/:deliveryItemId/failure', {
    schema: {
      params: Type.Object({ deliveryItemId: Type.String() }),
      body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema },
    },
    preHandler: [requireAnyPermission('integration:manage', 'delivery:fulfil')],
  }, async (request, reply) => {
    const { deliveryItemId } = request.params as { deliveryItemId: string };
    const { reason } = request.body as { reason: string };
    const actor = actorOf(request);
    await fastify.deliveryService.reportFailure(request.tenantId, deliveryItemId, reason, actor);
    await auditPerson(fastify, request, actor, deliveryItemId, 'Integration task: reported cannot apply');
    await reply.code(204).send();
  });
}

async function auditPerson(fastify: FastifyInstance, request: FastifyRequest, actor: DeliveryReplyActor, id: string, reasonText: string): Promise<void> {
  if (actor !== 'person') return;
  await fastify.audit.record({
    tenantId: request.tenantId,
    entityType: 'delivery_item',
    entityId: id,
    actionType: 'update',
    actorType: 'user',
    actorId: request.user.sub,
    actorDisplayName: request.user.displayName,
    correlationId: request.id,
    reasonText,
  });
}

function itemToWire(item: DeliveryItemDto) {
  return {
    ...item,
    requestPublishedAt: item.requestPublishedAt?.toISOString() ?? null,
    deliveredAt: item.deliveredAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

function taskToWire(task: DeliveryTaskDto) {
  return { ...task, ...itemToWire(task) };
}

function flowToWire(flow: FlowConfigDto) {
  return { ...flow, lastOverdueNoticeAt: flow.lastOverdueNoticeAt?.toISOString() ?? null };
}
