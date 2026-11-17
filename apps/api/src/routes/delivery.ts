import { randomUUID } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { ValidationError, hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DeliveryItemDto, DeliveryReplyActor, DeliveryTaskDto, FlowConfigDto } from '../platform/delivery/delivery-service.js';
import { INBOUND_FLOWS, type ExternalRecordDto } from '../platform/delivery/inbound.js';
import { runExtract } from '../platform/delivery/producers/extracts.js';
import { TIMETABLING_FLOW, runTimetableDemandSnapshot } from '../platform/delivery/producers/timetable-demand.js';

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

const ExternalRecordSchema = Type.Object({
  externalRecordId: Type.String(),
  flowCode: Type.String(),
  flowName: Type.String(),
  sourceLabel: Type.String(),
  personId: Type.String(),
  recordKey: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  summary: Type.String(),
  observedAt: Type.String(),
  receivedAt: Type.String(),
  receivedVia: Type.String(),
  current: Type.Boolean(),
});
const InboundFlowSchema = Type.Object({
  flowCode: Type.String(),
  sourceSystem: Type.String(),
  sourceLabel: Type.String(),
  name: Type.String(),
  handling: Type.String(),
  handlingNote: Type.Optional(Type.String()),
  defined: Type.Boolean(),
  fields: Type.Array(Type.Object({
    name: Type.String(),
    label: Type.String(),
    type: Type.String(),
    required: Type.Boolean(),
    valueSet: Type.Optional(Type.Object({ entity: Type.String(), field: Type.String() })),
    min: Type.Optional(Type.Number()),
  })),
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

  fastify.post('/delivery-flows/:flowCode/run', {
    schema: {
      params: Type.Object({ flowCode: Type.String() }),
      body: Type.Object({ academicPeriodId: Type.String() }),
      response: {
        200: Type.Object({
          flowCode: Type.String(), periodCode: Type.String(),
          offerings: Type.Integer(), created: Type.Integer(), unchanged: Type.Integer(),
        }),
        404: ErrorSchema, 422: ErrorSchema,
      },
    },
    preHandler: [requireAnyPermission('config:write', 'delivery:fulfil')],
  }, async (request, reply) => {
    const { flowCode } = request.params as { flowCode: string };
    const { academicPeriodId } = request.body as { academicPeriodId: string };
    // F-SIS-TTB-01 runs a roster snapshot for reconciliation (Phase 4 D-26); the others are aggregate extracts.
    const result = flowCode === TIMETABLING_FLOW
      ? { flowCode, ...(await runTimetableDemandSnapshot(fastify.deliveryService, fastify.db, request.tenantId, academicPeriodId)) }
      : await runExtract(fastify.deliveryService, fastify.db, request.tenantId, flowCode, academicPeriodId);
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'delivery_flow_config',
      entityId: academicPeriodId,
      actionType: 'create',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
      reasonText: `Ran ${flowCode} for ${result.periodCode}: ${result.created} item(s), ${result.unchanged} unchanged`,
    });
    await reply.send(result);
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

  fastify.get('/students/:personId/entitlements', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(ItemSchema) } },
    preHandler: [requirePermission('student:read:all')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    await reply.send((await fastify.deliveryService.entitlementsForPerson(request.tenantId, personId)).map(itemToWire));
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
      // Optional { targetCount }: what the target now holds, for a roster snapshot (Phase 4 D-26).
      response: { 204: Type.Null(), 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireAnyPermission('integration:manage', 'delivery:fulfil')],
  }, async (request, reply) => {
    const { deliveryItemId } = request.params as { deliveryItemId: string };
    const actor = actorOf(request);
    const targetCount = (request.body as { targetCount?: unknown } | null | undefined)?.targetCount;
    if (targetCount !== undefined && (typeof targetCount !== 'number' || !Number.isInteger(targetCount) || targetCount < 0)) {
      throw new ValidationError('targetCount must be a whole number');
    }
    const result = await fastify.deliveryService.acknowledge(request.tenantId, deliveryItemId, actor, targetCount === undefined ? {} : { targetCount });
    await auditPerson(fastify, request, actor, deliveryItemId, result.statusCode === 'failed' ? 'Integration task: target count did not match' : 'Integration task: confirmed applied');
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

/**
 * Inbound: what adjacent systems report about a student (F-LIB-SIS-01,
 * F-ACC-SIS-01, ...). Informational only — never changes academic status.
 */
export function inboundRoutes(fastify: FastifyInstance): void {
  fastify.get('/inbound-flows', {
    schema: { response: { 200: Type.Array(InboundFlowSchema) } },
    preHandler: [requireAnyPermission('external-record:read', 'integration:manage')],
  }, async (_request, reply) => {
    await reply.send(INBOUND_FLOWS.map(({ summarise: _s, recordKeyField: _k, ...flow }) => ({ ...flow, defined: flow.handling === 'record' })));
  });

  fastify.post('/inbound/:flowCode', {
    schema: {
      params: Type.Object({ flowCode: Type.String() }),
      body: Type.Object({
        personId: Type.Optional(Type.String()),
        studentNumber: Type.Optional(Type.String()),
        payload: Type.Record(Type.String(), Type.Unknown()),
        observedAt: Type.Optional(Type.String({ format: 'date-time' })),
        idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
      }),
      response: { 200: ExternalRecordSchema, 201: ExternalRecordSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('integration:manage')],
  }, async (request, reply) => {
    const { flowCode } = request.params as { flowCode: string };
    const body = request.body as { personId?: string; studentNumber?: string; payload: Record<string, unknown>; observedAt?: string; idempotencyKey: string };
    const { record, replayed } = await fastify.inboundRecordService.receive(request.tenantId, flowCode, body, 'connector', request.user.sub);
    await reply.code(replayed ? 200 : 201).send(recordToWire(record));
  });

  fastify.get('/students/:personId/external-records', {
    schema: {
      params: Type.Object({ personId: Type.String() }),
      response: { 200: Type.Array(ExternalRecordSchema) },
    },
    preHandler: [requirePermission('external-record:read')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    await reply.send((await fastify.inboundRecordService.listForPerson(request.tenantId, personId)).map(recordToWire));
  });

  fastify.post('/students/:personId/external-records/:flowCode', {
    schema: {
      params: Type.Object({ personId: Type.String(), flowCode: Type.String() }),
      body: Type.Object({
        payload: Type.Record(Type.String(), Type.Unknown()),
        observedAt: Type.Optional(Type.String({ format: 'date-time' })),
      }),
      response: { 201: ExternalRecordSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('external-record:write')],
  }, async (request, reply) => {
    const { personId, flowCode } = request.params as { personId: string; flowCode: string };
    const body = request.body as { payload: Record<string, unknown>; observedAt?: string };
    const { record } = await fastify.inboundRecordService.receive(request.tenantId, flowCode, {
      personId, payload: body.payload, ...(body.observedAt ? { observedAt: body.observedAt } : {}), idempotencyKey: `manual:${randomUUID()}`,
    }, 'person', request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId,
      entityType: 'external_record',
      entityId: record.externalRecordId,
      actionType: 'create',
      actorType: 'user',
      actorId: request.user.sub,
      actorDisplayName: request.user.displayName,
      correlationId: request.id,
      reasonText: `Entered by hand: ${flowCode}`,
    });
    await reply.code(201).send(recordToWire(record));
  });
}

function recordToWire(record: ExternalRecordDto) {
  return { ...record, observedAt: record.observedAt.toISOString(), receivedAt: record.receivedAt.toISOString() };
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
