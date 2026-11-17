import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { studentApplications, withTenantContext } from '@revelation-srs/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createUcasSimulator } from '../platform/integration/simulators/ucas-simulator.js';
import type { UcasOutboundItem } from '../platform/regulatory/ucas-decision-outbox.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Json = Type.Record(Type.String(), Type.Unknown());

/** UCAS outbound decisions and results mapped to conditions (Phase 3 D-14, D-15). */
export function ucasDecisionRoutes(fastify: FastifyInstance): void {
  // The simulator's replies are reconciled exactly as an inbound UCAS status would be.
  const simulator = createUcasSimulator(async (tenantId, sourceReference, _cycle, statusCode) => {
    const [app] = await withTenantContext(fastify.db, tenantId, (tx) => tx.select({ id: studentApplications.id }).from(studentApplications).where(and(
      eq(studentApplications.tenantId, tenantId as never), eq(studentApplications.sourceReference, sourceReference), inArray(studentApplications.channelCode, ['ucas', 'clearing']),
    )).limit(1));
    if (app) await fastify.ucasDecisionOutbox.reconcile(tenantId, app.id, statusCode);
  });

  fastify.post('/regulatory/ucas/decisions/dispatch', {
    schema: { response: { 200: Json } },
    preHandler: [requirePermission('regulatory:write')],
  }, async (request, reply) => {
    const file = await fastify.ucasDecisionOutbox.dispatch(request.tenantId, request.user.sub, simulator);
    await audit(fastify, request, `UCAS decisions dispatched by ${file.transport}: ${file.processedCount}`);
    await reply.send(file);
  });

  fastify.get('/regulatory/ucas/decisions', {
    schema: { querystring: Type.Object({ attention: Type.Optional(Type.Boolean()) }), response: { 200: Type.Array(Json) } },
    preHandler: [requirePermission('regulatory:read')],
  }, async (request, reply) => {
    const { attention } = request.query as { attention?: boolean };
    await reply.send((await fastify.ucasDecisionOutbox.list(request.tenantId, attention ? { attentionOnly: true } : {})).map(itemWire));
  });

  fastify.post('/regulatory/ucas/results', {
    schema: {
      body: Type.Object({
        ucasPersonalId: Type.String({ pattern: '^\\d{10}$' }), cycle: Type.String({ minLength: 4, maxLength: 10 }), awardingBody: Type.String({ minLength: 1, maxLength: 100 }),
        qualificationTypeCode: Type.String({ minLength: 1 }), subject: Type.String({ minLength: 1, maxLength: 100 }), series: Type.String({ minLength: 1, maxLength: 20 }),
        grade: Type.String({ minLength: 1, maxLength: 10 }), publishedOn: Type.Optional(Type.String({ format: 'date' })),
      }),
      response: { 200: Json },
    },
    preHandler: [requireAnyPermission('application:receive', 'regulatory:write')],
  }, async (request, reply) => {
    const summary = await fastify.ucasResultsService.receive(request.tenantId, request.body as never, request.user.sub);
    await reply.send(summary);
  });

  fastify.post('/admissions-offers/:offerId/conditions/suggested-met-confirmation', {
    schema: { params: Type.Object({ offerId: Type.String() }), response: { 200: Type.Object({ confirmed: Type.Array(Type.String()) }), 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('offer:decide')],
  }, async (request, reply) => {
    const { offerId } = request.params as { offerId: string };
    const result = await fastify.ucasResultsService.confirmSuggestedMet(request.tenantId, offerId, request.user.sub);
    await audit(fastify, request, `Confirmed ${result.confirmed.length} condition(s) met from matched UCAS results`);
    await reply.send(result);
  });
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType: 'integration_exchange', entityId: request.tenantId, actionType: 'update', actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function itemWire(i: UcasOutboundItem) {
  return { ...i, queuedAt: i.queuedAt.toISOString(), sentAt: i.sentAt?.toISOString() ?? null };
}
