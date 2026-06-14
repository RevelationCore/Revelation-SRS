import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  ChannelCode,
  CreateCommunicationTemplateInput,
  DispatchCommunicationInput,
} from '../platform/communications/communication-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const CommunicationTemplateSchema = Type.Object({
  templateId:      Type.String(),
  tenantId:        Type.Union([Type.String(), Type.Null()]),
  templateKey:     Type.String(),
  channelCode:     Type.String(),
  localeCode:      Type.String(),
  subjectTemplate: Type.Union([Type.String(), Type.Null()]),
  bodyTemplate:    Type.String(),
  version:         Type.Number(),
  active:          Type.Boolean(),
  createdAt:       Type.String(),
});

const DispatchLogEntrySchema = Type.Object({
  dispatchId:          Type.String(),
  tenantId:            Type.String(),
  templateKey:         Type.String(),
  channelCode:         Type.String(),
  localeCode:          Type.String(),
  subjectEntityType:   Type.String(),
  subjectEntityId:     Type.String(),
  recipientRef:        Type.Union([Type.String(), Type.Null()]),
  payload:             Type.Record(Type.String(), Type.Unknown()),
  workflowInstanceId:  Type.Union([Type.String(), Type.Null()]),
  statusCode:          Type.String(),
  suppressionReason:   Type.Union([Type.String(), Type.Null()]),
  dispatchedAt:        Type.String(),
  dispatchedBy:        Type.String(),
});

const DispatchResultSchema = Type.Object({
  dispatchId:        Type.String(),
  statusCode:        Type.String(),
  localeCode:        Type.String(),
  channelCode:       Type.String(),
  templateKey:       Type.String(),
  suppressionReason: Type.Optional(Type.String()),
});

const CreateTemplateBody = Type.Object({
  templateKey:      Type.String({ minLength: 1 }),
  channelCode:      Type.Union([
    Type.Literal('email'),
    Type.Literal('crm-handoff'),
    Type.Literal('integration-event'),
  ]),
  localeCode:       Type.Optional(Type.String()),
  subjectTemplate:  Type.Optional(Type.String()),
  bodyTemplate:     Type.String({ minLength: 1 }),
});

const DispatchBody = Type.Object({
  templateKey:         Type.String({ minLength: 1 }),
  channelCode:         Type.Union([
    Type.Literal('email'),
    Type.Literal('crm-handoff'),
    Type.Literal('integration-event'),
  ]),
  subjectEntityType:   Type.String({ minLength: 1 }),
  subjectEntityId:     Type.String({ minLength: 1 }),
  recipientRef:        Type.Optional(Type.String()),
  payload:             Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  preferredLocale:     Type.Optional(Type.String()),
  workflowInstanceId:  Type.Optional(Type.String()),
});

export function communicationRoutes(fastify: FastifyInstance): void {
  // ── Templates ───────────────────────────────────────────────────────────────

  fastify.post(
    '/communication-templates',
    {
      schema: {
        body:     CreateTemplateBody,
        response: { 201: CommunicationTemplateSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('communications:write')],
    },
    async (request, reply) => {
      const body = request.body as CreateCommunicationTemplateInput;
      const template = await fastify.communicationService.createTemplate(
        request.tenantId,
        body,
        request.user.sub,
      );
      await reply.code(201).send(templateToWire(template));
    },
  );

  fastify.get(
    '/communication-templates',
    {
      schema: {
        response: { 200: Type.Array(CommunicationTemplateSchema) },
      },
      preHandler: [requirePermission('communications:read')],
    },
    async (request, reply) => {
      const templates = await fastify.communicationService.listTemplates(request.tenantId);
      await reply.send(templates.map(templateToWire));
    },
  );

  fastify.get(
    '/communication-templates/:templateId',
    {
      schema: {
        params:   Type.Object({ templateId: Type.String() }),
        response: { 200: CommunicationTemplateSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('communications:read')],
    },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const template = await fastify.communicationService.getTemplate(templateId);
      await reply.send(templateToWire(template));
    },
  );

  // ── Dispatch ────────────────────────────────────────────────────────────────

  fastify.post(
    '/communications/dispatch',
    {
      schema: {
        body:     DispatchBody,
        response: { 200: DispatchResultSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('communications:write')],
    },
    async (request, reply) => {
      const body = request.body as Omit<DispatchCommunicationInput, 'channelCode'> & { channelCode: ChannelCode };
      const result = await fastify.communicationService.dispatch(
        request.tenantId,
        { ...body, payload: body.payload ?? {} },
        request.user.sub,
      );
      await reply.send(result);
    },
  );

  // ── Dispatch log ────────────────────────────────────────────────────────────

  fastify.get(
    '/communication-dispatch-log',
    {
      schema: {
        querystring: Type.Object({
          subjectEntityType: Type.Optional(Type.String()),
          subjectEntityId:   Type.Optional(Type.String()),
          limit:             Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        }),
        response: { 200: Type.Array(DispatchLogEntrySchema) },
      },
      preHandler: [requirePermission('communications:read')],
    },
    async (request, reply) => {
      const query = request.query as {
        subjectEntityType?: string;
        subjectEntityId?:   string;
        limit?:             number;
      };
      const entries = await fastify.communicationService.listDispatchLog(
        request.tenantId,
        query,
      );
      await reply.send(entries.map(logEntryToWire));
    },
  );
}

function templateToWire(t: Parameters<typeof templateToWire>[0]) {
  return { ...t, createdAt: t.createdAt.toISOString() };
}

function logEntryToWire(e: Parameters<typeof logEntryToWire>[0]) {
  return { ...e, dispatchedAt: e.dispatchedAt.toISOString() };
}
