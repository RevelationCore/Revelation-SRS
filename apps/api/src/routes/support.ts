import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { EmploymentLinkDto } from '../platform/support/employment-service.js';
import type { SupportAwardDto, SupportInstalmentDto } from '../platform/support/support-service.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

const InstalmentSchema = Type.Object({
  instalmentId: Type.String(), awardId: Type.String(), paymentTypeCode: Type.String(), currencyCode: Type.String(), amountMinorUnits: Type.Integer(),
  periodStart: Type.String(), periodEnd: Type.String(), dueDate: Type.String(), statusCode: Type.String(),
  approvedBy: Nullable(Type.String()), approvedAt: Nullable(Type.String()), paymentReference: Nullable(Type.String()),
  paidOn: Nullable(Type.String()), paidAmountMinorUnits: Type.Union([Type.Integer(), Type.Null()]),
  rejectionReason: Nullable(Type.String()), createdBy: Type.String(),
});
const AwardSchema = Type.Object({
  awardId: Type.String(), personId: Type.String(), enrolmentId: Type.String(), awardTypeCode: Type.String(),
  awardReference: Type.String(), funder: Type.String(), startDate: Type.String(), endDate: Nullable(Type.String()),
  statusCode: Type.String(), createdBy: Type.String(), approvedBy: Nullable(Type.String()), approvedAt: Nullable(Type.String()),
  instalments: Type.Array(InstalmentSchema),
});
const WarningSchema = Type.Object({ ruleCode: Type.String(), message: Type.String() });
const LinkSchema = Type.Object({
  linkId: Type.String(), personId: Type.String(), hrEmploymentReference: Type.String(), roleTypeCode: Type.String(),
  startDate: Type.String(), endDate: Nullable(Type.String()), weeklyHours: Type.Number(),
  moduleOfferingIds: Type.Array(Type.String()), supervisorAgreedAt: Nullable(Type.String()), sourceCode: Type.String(),
});
const LimitSchema = Type.Object({ ruleCode: Type.String(), maxWeeklyHours: Type.Number(), description: Type.String(), isDefault: Type.Boolean() });
const DateString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

/**
 * Student support schedules and the payroll instruction (F-SIS-PAY-01), and
 * student employment links with their work-limit checks (AJ-32).
 */
export function supportRoutes(fastify: FastifyInstance): void {
  // ── Support awards and instalments ─────────────────────────────────────────

  fastify.get('/students/:personId/support-awards', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(AwardSchema) } },
    preHandler: [requirePermission('support:read')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    await reply.send((await fastify.supportService.listForPerson(request.tenantId, personId)).map(awardToWire));
  });

  fastify.post('/students/:personId/support-awards', {
    schema: {
      params: Type.Object({ personId: Type.String() }),
      body: Type.Object({
        enrolmentId: Type.String(), awardTypeCode: Type.String({ minLength: 1 }),
        awardReference: Type.String({ minLength: 1, maxLength: 100 }), funder: Type.String({ minLength: 1, maxLength: 200 }),
        startDate: DateString, endDate: Type.Optional(DateString),
      }),
      response: { 201: AwardSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('support:write')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const award = await fastify.supportService.createAward(request.tenantId, personId, request.body as never, request.user.sub);
    await audit(fastify, request, 'support_award', award.awardId, 'create', `Recorded ${award.awardTypeCode} award ${award.awardReference}`);
    await reply.code(201).send(awardToWire(award));
  });

  fastify.post('/support-awards/:awardId/approve', {
    schema: { params: Type.Object({ awardId: Type.String() }), response: { 200: AwardSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('support:approve')],
  }, async (request, reply) => {
    const { awardId } = request.params as { awardId: string };
    const award = await fastify.supportService.approveAward(request.tenantId, awardId, request.user.sub);
    await audit(fastify, request, 'support_award', awardId, 'update', 'Approved support award');
    await reply.send(awardToWire(award));
  });

  fastify.post('/support-awards/:awardId/instalments', {
    schema: {
      params: Type.Object({ awardId: Type.String() }),
      body: Type.Object({
        paymentTypeCode: Type.String({ minLength: 1 }), amountMinorUnits: Type.Integer({ minimum: 1, description: 'Amount in pence (GBP minor units)' }),
        periodStart: DateString, periodEnd: DateString, dueDate: DateString,
      }),
      response: { 201: InstalmentSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('support:write')],
  }, async (request, reply) => {
    const { awardId } = request.params as { awardId: string };
    const instalment = await fastify.supportService.addInstalment(request.tenantId, awardId, request.body as never, request.user.sub);
    await audit(fastify, request, 'support_instalment', instalment.instalmentId, 'create', 'Recorded support instalment');
    await reply.code(201).send(instalmentToWire(instalment));
  });

  fastify.post('/support-instalments/:instalmentId/approve', {
    schema: { params: Type.Object({ instalmentId: Type.String() }), response: { 200: InstalmentSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('support:approve')],
  }, async (request, reply) => {
    const { instalmentId } = request.params as { instalmentId: string };
    const instalment = await fastify.supportService.approveInstalment(request.tenantId, instalmentId, request.user.sub);
    await audit(fastify, request, 'support_instalment', instalmentId, 'update', 'Approved support instalment; payroll instructed');
    await reply.send(instalmentToWire(instalment));
  });

  fastify.post('/support-instalments/:instalmentId/cancel', {
    schema: { params: Type.Object({ instalmentId: Type.String() }), response: { 200: InstalmentSchema, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('support:write')],
  }, async (request, reply) => {
    const { instalmentId } = request.params as { instalmentId: string };
    const instalment = await fastify.supportService.cancelInstalment(request.tenantId, instalmentId);
    await audit(fastify, request, 'support_instalment', instalmentId, 'update', 'Cancelled planned support instalment');
    await reply.send(instalmentToWire(instalment));
  });

  // ── Employment links and work limits ───────────────────────────────────────

  fastify.get('/students/:personId/employment-links', {
    schema: {
      params: Type.Object({ personId: Type.String() }),
      response: { 200: Type.Object({ links: Type.Array(LinkSchema), warnings: Type.Array(WarningSchema) }) },
    },
    preHandler: [requirePermission('employment-link:read')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    const [links, warnings] = await Promise.all([
      fastify.employmentService.listLinks(request.tenantId, personId),
      fastify.employmentService.warnings(request.tenantId, personId),
    ]);
    await reply.send({ links: links.map(linkToWire), warnings });
  });

  fastify.put('/students/:personId/employment-links/:hrEmploymentReference', {
    schema: {
      params: Type.Object({ personId: Type.String(), hrEmploymentReference: Type.String({ minLength: 1, maxLength: 100 }) }),
      body: Type.Object({
        roleTypeCode: Type.String({ minLength: 1 }), startDate: DateString, endDate: Type.Optional(Type.Union([DateString, Type.Null()])),
        weeklyHours: Type.Number({ minimum: 0, maximum: 168 }), moduleOfferingIds: Type.Optional(Type.Array(Type.String())),
        supervisorAgreedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
      }),
      response: { 200: Type.Object({ link: LinkSchema, warnings: Type.Array(WarningSchema) }), 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireAnyPermission('employment-link:write', 'integration:manage')],
  }, async (request, reply) => {
    const { personId, hrEmploymentReference } = request.params as { personId: string; hrEmploymentReference: string };
    const source = hasPermission(request.user.roles, 'integration:manage') ? 'connector' : 'person';
    const result = await fastify.employmentService.upsertLink(request.tenantId, personId, hrEmploymentReference, request.body as never, source, request.user.sub);
    await audit(fastify, request, 'student_employment_link', result.link.linkId, 'update', `Employment link ${hrEmploymentReference} recorded (${source})`);
    await reply.send({ link: linkToWire(result.link), warnings: result.warnings });
  });

  fastify.get('/work-limits', {
    schema: { response: { 200: Type.Array(LimitSchema) } },
    preHandler: [requireAnyPermission('employment-link:read', 'config:read')],
  }, async (request, reply) => {
    await reply.send(await fastify.employmentService.listLimits(request.tenantId));
  });

  fastify.put('/work-limits/:ruleCode', {
    schema: {
      params: Type.Object({ ruleCode: Type.String() }),
      body: Type.Object({ maxWeeklyHours: Type.Number({ minimum: 0, maximum: 168 }) }),
      response: { 200: LimitSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('config:write')],
  }, async (request, reply) => {
    const { ruleCode } = request.params as { ruleCode: string };
    const { maxWeeklyHours } = request.body as { maxWeeklyHours: number };
    const limit = await fastify.employmentService.setLimit(request.tenantId, ruleCode, maxWeeklyHours, request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId, entityType: 'work_limit_rule', entityId: request.tenantId, fieldName: ruleCode,
      afterValue: { maxWeeklyHours }, actionType: 'update', actorType: 'user', actorId: request.user.sub,
      actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Work limit ${ruleCode} set to ${maxWeeklyHours} h/week`,
    });
    await reply.send(limit);
  });
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function instalmentToWire(i: SupportInstalmentDto) {
  return { ...i, approvedAt: i.approvedAt?.toISOString() ?? null };
}

function awardToWire(a: SupportAwardDto) {
  return { ...a, approvedAt: a.approvedAt?.toISOString() ?? null, instalments: a.instalments.map(instalmentToWire) };
}

function linkToWire(l: EmploymentLinkDto) {
  return { ...l, supervisorAgreedAt: l.supervisorAgreedAt?.toISOString() ?? null };
}
