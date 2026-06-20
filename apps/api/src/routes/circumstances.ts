import { Type } from '@sinclair/typebox';
import { requirePermission, requireSelfOrPermission } from '@revelation-srs/auth';
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
  outcomeCode: Type.String({ minLength: 1 }),
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
      const personId = request.user.sub;
      const body = request.body as {
        enrolmentId: string;
        description: string;
        moduleOfferingId?: string;
      };

      const input: RecordExceptionalCircumstancesInput = {
        enrolmentId:       body.enrolmentId,
        outcomeCode:       'pending',
        determinationDate: new Date().toISOString().slice(0, 10),
        notes:             body.description,
        ...(body.moduleOfferingId !== undefined ? { moduleOfferingId: body.moduleOfferingId } : {}),
      };

      const exceptionalCircumstancesId =
        await fastify.exceptionalCircumstancesService.recordExceptionalCircumstances(
          request.tenantId,
          personId,
          input,
          personId,
        );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'exceptional_circumstances',
        entityId:         exceptionalCircumstancesId,
        actionType:       'create',
        actorType:        'user',
        actorId:          personId,
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
        response: { 201: Type.Object({ exceptionalCircumstancesId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('circumstances:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as RecordExceptionalCircumstancesInput;
      const exceptionalCircumstancesId = await fastify.exceptionalCircumstancesService.recordExceptionalCircumstances(
        request.tenantId,
        personId,
        body,
        request.user.sub,
      );
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
      await reply.code(201).send({ exceptionalCircumstancesId });
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
        response: { 204: Type.Null(), 404: ErrorSchema },
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

  fastify.post(
    '/students/:personId/misconduct-outcomes',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: MisconductBody,
        response: { 201: Type.Object({ misconductOutcomeId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('mark:write')],
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
      preHandler: [requirePermission('mark:read:all')],
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
