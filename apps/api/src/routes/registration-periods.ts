import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { ReenrolmentConfirmation, ReenrolmentPeriod } from '@revelation-srs/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { NonRegistrationCaseDto } from '../platform/registration-periods/non-registration-service.js';
import type { ConfirmationDto, MyRegistrationDto, PeriodDto } from '../platform/registration-periods/service.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Json = Type.Record(Type.String(), Type.Unknown());

/** Annual and initial registration (BP-02-010; D-8). */
export function registrationPeriodRoutes(fastify: FastifyInstance): void {
  fastify.post('/registration-periods', {
    schema: {
      body: Type.Object({
        academicYear: Type.String({ pattern: '^\\d{4}-\\d{2}$' }), programmeId: Type.Optional(Type.String()),
        opensAt: Type.String({ format: 'date-time' }), closesAt: Type.String({ format: 'date-time' }), reminderAt: Type.Optional(Type.String({ format: 'date-time' })),
        periodTypeCode: Type.Optional(Type.Union([Type.Literal('annual'), Type.Literal('initial')])),
      }),
      response: { 201: Json, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('registration-period:manage')],
  }, async (request, reply) => {
    const period = await fastify.registrationPeriodService.openPeriod(request.tenantId, request.body as never, request.user.sub);
    await audit(fastify, request, 'reenrolment_period', period.id, 'create', `Opened ${period.periodTypeCode} registration ${period.academicYear}`);
    await reply.code(201).send(periodToWire(period));
  });

  fastify.get('/registration-periods', {
    schema: { response: { 200: Type.Array(Json) } },
    preHandler: [requirePermission('registration:read')],
  }, async (request, reply) => {
    const termsVersion = await fastify.registrationPeriodService.termsVersion(request.tenantId);
    await reply.send((await fastify.registrationPeriodService.listPeriods(request.tenantId)).map((p) => ({ ...periodToWire(p), termsVersion })));
  });

  fastify.get('/registration-periods/:periodId', {
    schema: { params: Type.Object({ periodId: Type.String() }), response: { 200: Json, 404: ErrorSchema } },
    preHandler: [requirePermission('registration:read')],
  }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };
    const termsVersion = await fastify.registrationPeriodService.termsVersion(request.tenantId);
    await reply.send({ ...periodToWire(await fastify.registrationPeriodService.getPeriod(request.tenantId, periodId)), termsVersion });
  });

  fastify.post('/registration-periods/:periodId/refresh', {
    schema: { params: Type.Object({ periodId: Type.String() }), response: { 200: Type.Object({ added: Type.Integer() }), 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('registration-period:manage')],
  }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };
    await reply.send({ added: await fastify.registrationPeriodService.refreshPeriod(request.tenantId, periodId) });
  });

  fastify.post('/registration-periods/:periodId/closure', {
    schema: { params: Type.Object({ periodId: Type.String() }), response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema } },
    preHandler: [requirePermission('registration-period:manage')],
  }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };
    const { period, lapsed } = await fastify.registrationPeriodService.closePeriod(request.tenantId, periodId, request.user.sub);
    await audit(fastify, request, 'reenrolment_period', periodId, 'update', `Closed registration; ${lapsed.length} lapsed`);
    await reply.send({ ...periodToWire(period), lapsedCount: lapsed.length });
  });

  fastify.get('/registration-periods/:periodId/confirmations', {
    schema: {
      params: Type.Object({ periodId: Type.String() }),
      querystring: Type.Object({ statusCode: Type.Optional(Type.Union([Type.Literal('pending'), Type.Literal('confirmed'), Type.Literal('lapsed')])) }),
      response: { 200: Type.Array(Json), 404: ErrorSchema },
    },
    preHandler: [requirePermission('registration:read')],
  }, async (request, reply) => {
    const { periodId } = request.params as { periodId: string };
    const { statusCode } = request.query as { statusCode?: string };
    const rows = await fastify.registrationPeriodService.listConfirmations(request.tenantId, periodId, statusCode);
    await reply.send(rows.map(confirmationToWire));
  });

  fastify.get('/students/:personId/registrations', {
    schema: { params: Type.Object({ personId: Type.String() }), response: { 200: Type.Array(Json), 403: ErrorSchema } },
    preHandler: [requireAnyPermission('registration:read', 'registration:confirm:own')],
  }, async (request, reply) => {
    const { personId } = request.params as { personId: string };
    assertOwn(request, personId, 'registration:read');
    const rows = await fastify.registrationPeriodService.registrationsForPerson(request.tenantId, personId);
    await reply.send(rows.map(myRegistrationToWire));
  });

  fastify.post('/registration-confirmations/:confirmationId/confirmation', {
    schema: {
      params: Type.Object({ confirmationId: Type.String() }),
      body: Type.Object({ acceptedTermsVersion: Type.String({ minLength: 1 }), assistedReasonCode: Type.Optional(Type.String()) }),
      response: { 200: Json, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: [requireAnyPermission('registration:confirm:assisted', 'registration:confirm:own')],
  }, async (request, reply) => {
    const { confirmationId } = request.params as { confirmationId: string };
    const body = request.body as { acceptedTermsVersion: string; assistedReasonCode?: string };
    const assisted = hasPermission(request.user.roles, 'registration:confirm:assisted');
    if (!assisted) assertOwn(request, await fastify.registrationPeriodService.personForConfirmation(request.tenantId, confirmationId), 'registration:confirm:assisted');
    const confirmed = await fastify.registrationPeriodService.confirm(request.tenantId, confirmationId, {
      acceptedTermsVersion: body.acceptedTermsVersion, channel: assisted ? 'assisted' : 'portal',
      ...(assisted && body.assistedReasonCode ? { assistedReasonCode: body.assistedReasonCode } : {}),
    }, request.user.sub);
    await audit(fastify, request, 'reenrolment_confirmation', confirmationId, 'update', assisted ? `Registration confirmed on the student's behalf (${body.assistedReasonCode ?? ''})` : 'Registration confirmed');
    await reply.send(confirmationRowToWire(confirmed));
  });
}


/** Failure to register (BP-02-011; D-9): cases opened when registrations lapse. */
export function nonRegistrationRoutes(fastify: FastifyInstance): void {
  const Id = Type.Object({ caseId: Type.String() });
  const manage = [requirePermission('non-registration:manage')];
  const svc = () => fastify.nonRegistrationService;

  fastify.get('/non-registration-cases', {
    schema: { querystring: Type.Object({ open: Type.Optional(Type.Boolean()), enrolmentId: Type.Optional(Type.String()) }), response: { 200: Type.Array(Json) } },
    preHandler: [requireAnyPermission('non-registration:manage', 'registration:read')],
  }, async (request, reply) => {
    const q = request.query as { open?: boolean; enrolmentId?: string };
    const cases = await svc().listCases(request.tenantId, { ...(q.open ? { open: true } : {}), ...(q.enrolmentId ? { enrolmentId: q.enrolmentId } : {}) });
    await reply.send(cases.map(caseToWire));
  });

  fastify.get('/non-registration-cases/:caseId', {
    schema: { params: Id, response: { 200: Json, 404: ErrorSchema } },
    preHandler: [requireAnyPermission('non-registration:manage', 'registration:read')],
  }, async (request, reply) => {
    await reply.send(caseToWire(await svc().getCase(request.tenantId, (request.params as { caseId: string }).caseId)));
  });

  fastify.post('/non-registration-cases/:caseId/contact-attempts', {
    schema: {
      params: Id,
      body: Type.Object({ channelCode: Type.String({ minLength: 1 }), reference: Type.Optional(Type.String()), message: Type.Optional(Type.String({ maxLength: 2000 })) }),
      response: { 201: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: manage,
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const dto = await svc().recordContact(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', caseId, 'update', `Contact attempt recorded (${(request.body as { channelCode: string }).channelCode})`);
    await reply.code(201).send(caseToWire(dto));
  });

  fastify.post('/non-registration-cases/:caseId/written-statement', {
    schema: { params: Id, body: Type.Object({ reference: Type.String({ minLength: 1 }) }), response: { 201: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
    preHandler: manage,
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const dto = await svc().recordWrittenNonContinuation(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', caseId, 'update', 'Student confirmed in writing they will not continue');
    await reply.code(201).send(caseToWire(dto));
  });

  fastify.post('/non-registration-cases/:caseId/referral', {
    schema: { params: Id, body: Type.Object({ statusCaseId: Type.String() }), response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema } },
    preHandler: manage,
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const dto = await svc().refer(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', caseId, 'update', 'Referred to the student\'s own status request');
    await reply.send(caseToWire(dto));
  });

  fastify.post('/non-registration-cases/:caseId/decision', {
    schema: {
      params: Id,
      body: Type.Object({
        reason: Type.String({ minLength: 1, maxLength: 2000 }), policyVersion: Type.String({ minLength: 1 }),
        effectiveDate: Type.Optional(Type.String({ format: 'date' })), lastEngagementDate: Type.Optional(Type.String({ format: 'date' })),
      }),
      response: { 200: Json, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    preHandler: manage,
  }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const dto = await svc().decideNonRegistration(request.tenantId, caseId, request.body as never, request.user.sub);
    await audit(fastify, request, 'business_case', caseId, 'update', 'Non-registration decided; withdrawal case opened for decision');
    await reply.send(caseToWire(dto));
  });
}

function caseToWire(c: NonRegistrationCaseDto) {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    ...c,
    periodClosesAt: c.periodClosesAt.toISOString(), openedAt: c.openedAt.toISOString(),
    contactAttempts: c.contactAttempts.map((a) => ({ ...a, contactedAt: a.contactedAt.toISOString() })),
    writtenNonContinuation: c.writtenNonContinuation ? { ...c.writtenNonContinuation, receivedAt: c.writtenNonContinuation.receivedAt.toISOString() } : null,
    outcome: c.outcome ? { ...c.outcome, decidedAt: c.outcome.decidedAt.toISOString(), effectiveAt: c.outcome.effectiveAt.toISOString() } : null,
    decisionAllowedFrom: iso(c.decisionAllowedFrom), ukviReportDueBy: iso(c.ukviReportDueBy), subject: c.subject ?? null,
  };
}

function assertOwn(request: FastifyRequest, personId: string, staffPermission: string): void {
  if (hasPermission(request.user.roles, staffPermission as never)) return;
  if (!request.user.srsPersonId || request.user.srsPersonId !== personId) throw new ForbiddenError('You can only see or confirm your own registration');
}

async function audit(fastify: FastifyInstance, request: FastifyRequest, entityType: string, entityId: string, actionType: 'create' | 'update', reasonText: string) {
  await fastify.audit.record({
    tenantId: request.tenantId, entityType, entityId, actionType, actorType: 'user', actorId: request.user.sub,
    actorDisplayName: request.user.displayName, correlationId: request.id, reasonText,
  });
}

function periodRowToWire(p: ReenrolmentPeriod) {
  const { id, tenantId: _t, ...rest } = p;
  return { periodId: id, ...rest, opensAt: p.opensAt.toISOString(), closesAt: p.closesAt.toISOString(), reminderAt: p.reminderAt?.toISOString() ?? null, closedAt: p.closedAt?.toISOString() ?? null };
}
function periodToWire(p: PeriodDto) {
  return { ...periodRowToWire(p), counts: p.counts };
}
function confirmationRowToWire(c: ReenrolmentConfirmation) {
  const { id, tenantId: _t, versionId: _v, recordedAt: _ra, recordedUntil: _ru, validFrom: _vf, validTo: _vt, ...rest } = c;
  return { confirmationId: id, ...rest, confirmedAt: c.confirmedAt?.toISOString() ?? null };
}
function confirmationToWire(c: ConfirmationDto) {
  return { ...confirmationRowToWire(c), subject: c.subject ?? null };
}
function myRegistrationToWire(r: MyRegistrationDto) {
  return { confirmation: confirmationRowToWire(r.confirmation), period: periodRowToWire(r.period), enrolment: r.enrolment, blockers: r.blockers, termsVersion: r.termsVersion };
}

