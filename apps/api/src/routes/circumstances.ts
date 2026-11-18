import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission, requireSelfOrPermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  ExceptionalCircumstancesDto,
  RecordExceptionalCircumstancesInput,
  UpdateExceptionalCircumstancesInput,
} from '../platform/circumstances/ec-service.js';
import type {
  MisconductOutcomeDto,
  RecordMisconductOutcomeInput,
} from '../platform/circumstances/misconduct-service.js';
import { clockNow } from '../platform/clock.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const EcSchema = Type.Object({
  exceptionalCircumstancesId: Type.String(),
  enrolmentId: Type.String(),
  personId: Type.String(),
  moduleOfferingId: Type.Union([Type.String(), Type.Null()]),
  moduleCode:       Type.Union([Type.String(), Type.Null()]),
  moduleTitle:      Type.Union([Type.String(), Type.Null()]),
  outcomeCode: Type.String(),
  determinationDate: Type.String(),
  notes: Type.Union([Type.String(), Type.Null()]),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const EcBody = Type.Object({
  enrolmentId: Type.String(),
  moduleOfferingId: Type.Optional(Type.String()),
  outcomeCode: Type.Optional(Type.String({ minLength: 1, description: 'A proposed outcome: the claim is recorded pending and this is proposed for someone else to decide (D-41)' })),
  determinationDate: Type.String({ format: 'date' }),
  notes: Type.Optional(Type.String()),
});

const EcPatchBody = Type.Object({
  moduleOfferingId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  outcomeCode: Type.Optional(Type.String({ minLength: 1 })),
  determinationDate: Type.Optional(Type.String({ format: 'date' })),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ListQuery = Type.Object({
  enrolmentId: Type.Optional(Type.String()),
});

const MisconductEffectSchema = Type.Object({
  penaltyEffectId: Type.String(),
  misconductOutcomeId: Type.String(),
  targetEntityType: Type.String(),
  targetEntityId: Type.String(),
  penaltyDetail: Type.Union([Type.String(), Type.Null()]),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const MisconductSchema = Type.Object({
  misconductCaseId: Type.String(),
  misconductOutcomeId: Type.String(),
  enrolmentId: Type.String(),
  personId: Type.String(),
  caseReference: Type.String(),
  caseStatusCode: Type.String(),
  penaltyCode: Type.String(),
  effectiveDate: Type.String(),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
  penaltyEffects: Type.Array(MisconductEffectSchema),
});

const MisconductBody = Type.Object({
  enrolmentId: Type.String(),
  caseReference: Type.String({ minLength: 1 }),
  caseStatusCode: Type.Optional(Type.String({ minLength: 1 })),
  penaltyCode: Type.String({ minLength: 1 }),
  effectiveDate: Type.String({ format: 'date' }),
  penaltyEffects: Type.Optional(Type.Array(Type.Object({
    targetEntityType: Type.Union([Type.Literal('mark'), Type.Literal('module_registration')]),
    targetEntityId: Type.String(),
    penaltyDetail: Type.Optional(Type.String()),
  }))),
});

// ── Student-facing EC submission (R-API-003) ──────────────────────────────────

const EcSubmissionBody = Type.Object({
  enrolmentId:     Type.String({ minLength: 1 }),
  description:     Type.String({ minLength: 1, maxLength: 4000 }),
  moduleOfferingId: Type.Optional(Type.String()),
});

export function circumstancesRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/exceptional-circumstances/submissions',
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: EcSubmissionBody,
        response: {
          201: Type.Object({ exceptionalCircumstancesId: Type.String() }),
          403: ErrorSchema,
          422: ErrorSchema,
        },
        description: 'Student self-service EC submission (sets outcome to pending, determination date to today)',
      },
      preHandler: [requirePermission('circumstances:submit')],
    },
    async (request, reply) => {
      const personId = request.user.srsPersonId;
      if (!personId) {
        await reply.code(403).send({ title: 'Forbidden', detail: 'No SRS person linked to this account' });
        return;
      }
      const body = request.body as {
        enrolmentId: string;
        description: string;
        moduleOfferingId?: string;
      };

      const input: RecordExceptionalCircumstancesInput = {
        enrolmentId:       body.enrolmentId,
        outcomeCode:       'pending',
        determinationDate: clockNow().toISOString().slice(0, 10),
        notes:             body.description,
        ...(body.moduleOfferingId !== undefined ? { moduleOfferingId: body.moduleOfferingId } : {}),
      };

      const exceptionalCircumstancesId =
        await fastify.exceptionalCircumstancesService.recordExceptionalCircumstances(
          request.tenantId,
          personId,
          input,
          request.user.sub,
        );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exceptional_circumstances',
        entityId:         exceptionalCircumstancesId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ exceptionalCircumstancesId });
    },
  );

  fastify.post(
    '/students/:personId/exceptional-circumstances',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: EcBody,
        response: { 201: Type.Object({ exceptionalCircumstancesId: Type.String(), determinationId: Type.Optional(Type.String()) }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('circumstances:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as RecordExceptionalCircumstancesInput;
      const exceptionalCircumstancesId = await fastify.exceptionalCircumstancesService.recordExceptionalCircumstances(
        request.tenantId,
        personId,
        { ...body, outcomeCode: 'pending' },
        request.user.sub,
      );
      // An outcome recorded with the claim is a proposal, decided by someone else (D-41).
      let determinationId: string | undefined;
      if (body.outcomeCode && body.outcomeCode !== 'pending') {
        determinationId = (await fastify.ecDeterminationService.propose(request.tenantId, exceptionalCircumstancesId,
          { outcomeCode: body.outcomeCode, reason: body.notes?.trim() || 'Proposed when the claim was recorded' }, request.user.sub)).id;
      }
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exceptional_circumstances',
        entityId: exceptionalCircumstancesId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ exceptionalCircumstancesId, ...(determinationId ? { determinationId } : {}) });
    },
  );

  fastify.get(
    '/students/:personId/exceptional-circumstances',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        querystring: ListQuery,
        response: { 200: Type.Array(EcSchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('circumstances:read:own', 'circumstances:read')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const { enrolmentId } = request.query as { enrolmentId?: string };
      const rows = await fastify.exceptionalCircumstancesService.listExceptionalCircumstances(personId, request.tenantId, enrolmentId);
      await reply.send(rows.map(ecToWire));
    },
  );

  fastify.patch(
    '/exceptional-circumstances/:ecId',
    {
      schema: {
        params: Type.Object({ ecId: Type.String() }),
        body: EcPatchBody,
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('circumstances:write')],
    },
    async (request, reply) => {
      const { ecId } = request.params as { ecId: string };
      const body = request.body as UpdateExceptionalCircumstancesInput;
      await fastify.exceptionalCircumstancesService.updateExceptionalCircumstances(ecId, request.tenantId, body, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'exceptional_circumstances',
        entityId: ecId,
        afterValue: body,
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(204).send();
    },
  );

  // ── EC determinations (D-41) ─────────────────────────────────────────────

  const DeterminationSchema = Type.Object({
    id: Type.String(), exceptionalCircumstancesId: Type.String(), proposedOutcomeCode: Type.String(), reason: Type.String(),
    statusCode: Type.String(), proposedBy: Type.String(), proposedAt: Type.String(), recordedBy: Type.String(),
    workflowInstanceId: Type.Union([Type.String(), Type.Null()]), decidedBy: Type.Union([Type.String(), Type.Null()]),
    decidedAt: Type.Union([Type.String(), Type.Null()]), decisionReason: Type.Union([Type.String(), Type.Null()]),
  });
  const detWire = (d: { proposedAt: Date; decidedAt: Date | null } & Record<string, unknown>) => ({ ...d, proposedAt: d.proposedAt.toISOString(), decidedAt: d.decidedAt?.toISOString() ?? null });

  fastify.post(
    '/exceptional-circumstances/:ecId/determination-proposals',
    {
      schema: {
        params: Type.Object({ ecId: Type.String() }),
        body: Type.Object({ outcomeCode: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
        response: { 201: DeterminationSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('circumstances:write')],
    },
    async (request, reply) => {
      const { ecId } = request.params as { ecId: string };
      const det = await fastify.ecDeterminationService.propose(request.tenantId, ecId, request.body as { outcomeCode: string; reason: string }, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'ec_determination', entityId: det.id, actionType: 'create', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Proposed EC outcome ${det.proposedOutcomeCode}`,
      });
      await reply.code(201).send(detWire(det));
    },
  );

  fastify.get(
    '/ec-determinations',
    {
      schema: { querystring: Type.Object({ statusCode: Type.Optional(Type.String()), ecId: Type.Optional(Type.String()) }), response: { 200: Type.Array(DeterminationSchema) } },
      preHandler: [requireAnyPermission('circumstances:read', 'circumstances:decide')],
    },
    async (request, reply) => {
      const q = request.query as { statusCode?: string; ecId?: string };
      await reply.send((await fastify.ecDeterminationService.list(request.tenantId, q)).map(detWire));
    },
  );

  fastify.post(
    '/ec-determinations/:determinationId/decision',
    {
      schema: {
        params: Type.Object({ determinationId: Type.String() }),
        body: Type.Object({ decisionCode: Type.Union([Type.Literal('upheld'), Type.Literal('not-upheld')]), reason: Type.Optional(Type.String({ maxLength: 2000 })) }),
        response: { 200: DeterminationSchema, 202: DeterminationSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requirePermission('circumstances:decide')],
    },
    async (request, reply) => {
      const { determinationId } = request.params as { determinationId: string };
      const { decisionCode, reason } = request.body as { decisionCode: 'upheld' | 'not-upheld'; reason?: string };
      const { decisionStatus, ...det } = await fastify.ecDeterminationService.decide(request.tenantId, determinationId, decisionCode, request.user.sub, reason);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'ec_determination', entityId: determinationId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `EC determination ${decisionCode}`,
      });
      await reply.code(decisionStatus === 'pending' ? 202 : 200).send(detWire(det));
    },
  );

  fastify.post(
    '/students/:personId/misconduct-outcomes',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: MisconductBody,
        response: { 201: Type.Object({ misconductOutcomeId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('misconduct:record')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as RecordMisconductOutcomeInput;
      const misconductOutcomeId = await fastify.misconductService.recordMisconductOutcome(request.tenantId, personId, body, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'misconduct_outcome',
        entityId: misconductOutcomeId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });
      await reply.code(201).send({ misconductOutcomeId });
    },
  );

  fastify.get(
    '/students/:personId/misconduct-outcomes',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        querystring: ListQuery,
        response: { 200: Type.Array(MisconductSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('misconduct:read')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const { enrolmentId } = request.query as { enrolmentId?: string };
      const rows = await fastify.misconductService.listMisconductOutcomes(personId, request.tenantId, enrolmentId);
      await reply.send(rows.map(misconductToWire));
    },
  );
}

function ecToWire(row: ExceptionalCircumstancesDto) {
  return {
    ...row,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
    recordedUntil: row.recordedUntil?.toISOString() ?? null,
  };
}

function misconductToWire(row: MisconductOutcomeDto) {
  return {
    ...row,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
    recordedUntil: row.recordedUntil?.toISOString() ?? null,
    penaltyEffects: row.penaltyEffects.map((effect) => ({
      ...effect,
      validFrom: effect.validFrom.toISOString(),
      validTo: effect.validTo?.toISOString() ?? null,
      recordedAt: effect.recordedAt.toISOString(),
      recordedUntil: effect.recordedUntil?.toISOString() ?? null,
    })),
  };
}
