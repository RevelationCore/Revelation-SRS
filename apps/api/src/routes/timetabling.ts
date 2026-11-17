import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import { academicPeriods, moduleOfferings, modules, withTenantContext } from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { simulateTimetable } from '../platform/integration/simulators/timetabling-simulator.js';
import { clockNow } from '../platform/clock.js';
import type { PublicationDto, PublicationInput, TimetableSource } from '../platform/timetabling/timetable-service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

const SlotSchema = Type.Object({
  dayOfWeek: Type.Integer({ minimum: 1, maximum: 7 }),
  startTime: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
  endTime: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
  weekCommencing: Type.Array(Type.String({ format: 'date' }), { minItems: 1 }),
  locationRef: Type.Optional(Nullable(Type.String())),
});
const ActivityBody = Type.Object({
  moduleOfferingId: Type.Optional(Type.String()),
  moduleCode: Type.Optional(Type.String()),
  academicYear: Type.Optional(Type.String()),
  periodCode: Type.Optional(Type.String()),
  activityRef: Type.String({ minLength: 1 }),
  activityTypeCode: Type.String({ minLength: 1 }),
  groupSetCode: Type.Optional(Nullable(Type.String())),
  groupCode: Type.Optional(Nullable(Type.String())),
  slots: Type.Array(SlotSchema, { minItems: 1 }),
});
const PublicationBody = Type.Object({
  academicPeriodId: Type.String(),
  sourceVersion: Type.String({ minLength: 1 }),
  fullPeriod: Type.Optional(Type.Boolean()),
  /** 'ttb' (the default) for the timetabling system's file or feed, 'srs-admin' for entry by registry staff. */
  sourceSystemCode: Type.Optional(Type.Union([Type.Literal('ttb'), Type.Literal('srs-admin')])),
  activities: Type.Array(ActivityBody),
});
const PublicationSchema = Type.Object({
  timetablePublicationId: Type.String(), academicPeriodId: Type.String(), sourceSystemCode: Type.String(), sourceVersion: Type.String(),
  fullPeriod: Type.Boolean(), statusCode: Type.String(), rejectionReasons: Type.Array(Type.String()), rowCount: Type.Integer(),
  receivedBy: Type.String(), receivedAt: Type.String(), appliedAt: Nullable(Type.String()),
});
const ActivitySchema = Type.Object({
  activityRef: Type.String(), activityTypeCode: Type.String(), groupSetCode: Nullable(Type.String()), groupCode: Nullable(Type.String()),
  slots: Type.Array(Type.Object({ dayOfWeek: Type.Integer(), startTime: Type.String(), endTime: Type.String(), weekCommencing: Type.Array(Type.String()), locationRef: Nullable(Type.String()) })),
});

/** Timetable publications from the timetabling system, admin entry and the simulator (Phase 4 D-24). */
export function timetablingRoutes(fastify: FastifyInstance): void {
  fastify.post('/timetable-publications', {
    schema: { body: PublicationBody, response: { 201: PublicationSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requirePermission('timetable:manage')],
  }, async (request, reply) => {
    const body = request.body as PublicationInput & { sourceSystemCode?: TimetableSource };
    const { sourceSystemCode, ...input } = body;
    const pub = await fastify.timetableService.receive(request.tenantId, sourceSystemCode ?? 'ttb', input, request.user.sub);
    await audit(fastify, request, pub);
    await reply.code(201).send(toWire(pub));
  });

  fastify.get('/timetable-publications', {
    schema: { querystring: Type.Object({ academicPeriodId: Type.Optional(Type.String()) }), response: { 200: Type.Array(PublicationSchema) } },
    preHandler: [requirePermission('timetable:read')],
  }, async (request, reply) => {
    const { academicPeriodId } = request.query as { academicPeriodId?: string };
    await reply.send((await fastify.timetableService.listPublications(request.tenantId, academicPeriodId)).map(toWire));
  });

  fastify.get('/academic-periods/:academicPeriodId/timetable-status', {
    schema: {
      params: Type.Object({ academicPeriodId: Type.String() }),
      response: { 200: Type.Object({ lastAppliedAt: Nullable(Type.String()), stale: Type.Boolean(), staleAfterHours: Type.Number() }) },
    },
    preHandler: [requirePermission('timetable:read')],
  }, async (request, reply) => {
    const { academicPeriodId } = request.params as { academicPeriodId: string };
    const f = await fastify.timetableService.freshness(request.tenantId, academicPeriodId);
    await reply.send({ ...f, lastAppliedAt: f.lastAppliedAt?.toISOString() ?? null });
  });

  /** Derives a timetable for the period's offerings with the in-repo simulator (source 'simulator'). */
  fastify.post('/academic-periods/:academicPeriodId/timetable-simulation', {
    schema: { params: Type.Object({ academicPeriodId: Type.String() }), response: { 201: PublicationSchema, 404: ErrorSchema } },
    preHandler: [requirePermission('timetable:manage')],
  }, async (request, reply) => {
    const { academicPeriodId } = request.params as { academicPeriodId: string };
    const t = request.tenantId as `${string}-${string}-${string}-${string}-${string}`;
    const { period, offerings } = await withTenantContext(fastify.db, request.tenantId, async (tx) => ({
      period: (await tx.select().from(academicPeriods).where(and(eq(academicPeriods.tenantId, t), eq(academicPeriods.id, academicPeriodId as typeof t))).limit(1))[0],
      offerings: await tx.select({ moduleOfferingId: moduleOfferings.id, moduleCode: modules.code }).from(moduleOfferings)
        .innerJoin(modules, and(eq(modules.id, moduleOfferings.moduleId), isNull(modules.recordedUntil)))
        .where(and(eq(moduleOfferings.tenantId, t), eq(moduleOfferings.academicPeriodId, academicPeriodId as typeof t))),
    }));
    if (!period) throw new NotFoundError('AcademicPeriod', academicPeriodId);
    const input = simulateTimetable({ academicPeriodId, startDate: period.startDate, endDate: period.endDate }, offerings, `sim-${clockNow().toISOString()}`);
    const pub = await fastify.timetableService.receive(request.tenantId, 'simulator', input, request.user.sub);
    await audit(fastify, request, pub);
    await reply.code(201).send(toWire(pub));
  });

  fastify.get('/module-offerings/:moduleOfferingId/timetable', {
    schema: {
      params: Type.Object({ moduleOfferingId: Type.String() }),
      response: { 200: Type.Object({ moduleOfferingId: Type.String(), publicationId: Nullable(Type.String()), activities: Type.Array(ActivitySchema) }) },
    },
    preHandler: [requirePermission('timetable:read')],
  }, async (request, reply) => {
    const { moduleOfferingId } = request.params as { moduleOfferingId: string };
    const current = (await fastify.timetableService.currentFor(request.tenantId, [moduleOfferingId])).get(moduleOfferingId);
    await reply.send(current ?? { moduleOfferingId, publicationId: null, activities: [] });
  });
}

function toWire(p: PublicationDto) {
  return { ...p, receivedAt: p.receivedAt.toISOString(), appliedAt: p.appliedAt?.toISOString() ?? null };
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, pub: PublicationDto): Promise<void> {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType: 'timetable_publication', entityId: pub.timetablePublicationId, actionType: 'create',
    afterValue: { sourceSystemCode: pub.sourceSystemCode, sourceVersion: pub.sourceVersion, statusCode: pub.statusCode, rowCount: pub.rowCount },
    actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
  });
}
