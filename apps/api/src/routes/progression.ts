import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';
import { hasPermission } from '@revelation-srs/domain';

import type {
  EvaluateProgressionInput,
  ProgressionDecisionDto,
} from '../platform/progression/progression-service.js';
import type { AwardDto } from '../platform/progression/award-service.js';
import type { HearDto } from '../platform/progression/hear-service.js';

import { RuleVersionSchema } from './rule-version-schema.js';

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const ProgressionDecisionSchema = Type.Object({
  progressionDecisionId: Type.String(),
  enrolmentId: Type.String(),
  academicYear: Type.String(),
  yearOfStudy: Type.String(),
  decisionCode: Type.String(),
  examBoardId: Type.Union([Type.String(), Type.Null()]),
  locked: Type.Boolean(),
  actorId: Type.String(),
  validFrom: Type.String(),
  validTo: Type.Union([Type.String(), Type.Null()]),
  recordedAt: Type.String(),
  recordedUntil: Type.Union([Type.String(), Type.Null()]),
});

const AwardSchema = Type.Object({
  awardId:             Type.String(),
  enrolmentId:         Type.String(),
  personId:            Type.String(),
  examBoardId:         Type.String(),
  qualificationCode:   Type.String(),
  classificationCode:  Type.String(),
  awardDate:           Type.String(),
  hearGeneratedAt:     Type.Union([Type.String(), Type.Null()]),
  certificateIssuedAt: Type.Union([Type.String(), Type.Null()]),
  validFrom:           Type.String(),
  validTo:             Type.Union([Type.String(), Type.Null()]),
  recordedAt:          Type.String(),
  recordedUntil:       Type.Union([Type.String(), Type.Null()]),
});

const EvaluateProgressionBody = Type.Object({
  academicYear: Type.String({ minLength: 1 }),
});

const ProgressionQuery = Type.Object({
  academicYear: Type.String({ minLength: 1 }),
});

export function progressionRoutes(fastify: FastifyInstance): void {
  // ── Progression decision ──────────────────────────────────────────────────

  fastify.post(
    '/enrolments/:enrolmentId/progression',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        body: EvaluateProgressionBody,
        response: { 201: Type.Object({ progressionDecisionId: Type.String() }), 403: ErrorSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('progression:write')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const body = request.body as EvaluateProgressionInput;
      const progressionDecisionId = await fastify.progressionService.evaluateProgression(
        enrolmentId,
        request.tenantId,
        body.academicYear,
        request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'progression_decision',
        entityId: progressionDecisionId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ progressionDecisionId });
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/progression',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        querystring: ProgressionQuery,
        response: { 200: ProgressionDecisionSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('progression:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const { academicYear } = request.query as { academicYear: string };
      const decision = await fastify.progressionService.getProgressionDecision(enrolmentId, request.tenantId, academicYear);
      await reply.send(decisionToWire(decision));
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/progression/history',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(ProgressionDecisionSchema), 404: ErrorSchema },
      },
      preHandler: [requirePermission('progression:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const history = await fastify.progressionService.getProgressionHistory(enrolmentId, request.tenantId);
      await reply.send(history.map(decisionToWire));
    },
  );

  fastify.get(
    '/progression-decisions/:progressionDecisionId/evidence',
    {
      schema: {
        params: Type.Object({ progressionDecisionId: Type.String() }),
        response: {
          200: Type.Object({
            requiredCredits: Type.Number(), earnedCredits: Type.Number(), compensationCredits: Type.Number(), unresolvedCredits: Type.Number(),
            compensationThreshold: Type.Union([Type.Number(), Type.Null()]), compensationCreditLimit: Type.Number(),
            condonementThreshold: Type.Union([Type.Number(), Type.Null()]), decisionCode: Type.String(),
            recognisedCredits: Type.Number(), recognisedCreditIds: Type.Array(Type.String()),
            appliedExceptions: Type.Array(Type.Object({ exceptionId: Type.String(), ruleCode: Type.String(), exceptionTypeCode: Type.String() })),
            minimumModulePasses: Type.Union([Type.Number(), Type.Null()]),
            modulesPassed: Type.Union([Type.Number(), Type.Null()]),
            ruleVersions: Type.Array(RuleVersionSchema, { description: 'The rule versions the decision used (D-35); empty for evidence recorded before that' }),
            calculatedAt: Type.String(),
          }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('progression:read')],
    },
    async (request, reply) => {
      const { progressionDecisionId } = request.params as { progressionDecisionId: string };
      const evidence = await fastify.progressionService.getCalculationEvidence(request.tenantId, progressionDecisionId);
      await reply.send({ ...evidence, calculatedAt: evidence.calculatedAt.toISOString() });
    },
  );

  // ── Classification recommendation ─────────────────────────────────────────

  fastify.get(
    '/enrolments/:enrolmentId/classification',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: {
          200: Type.Object({
            enrolmentId:        Type.String(),
            aggregateMark:      Type.Number(),
            classificationCode: Type.String(),
            algorithm:          Type.String(),
            boundariesApplied:  Type.Array(Type.Object({ code: Type.String(), minimumMark: Type.Number() })),
            outcomeCount:       Type.Number(),
            totalCreditValue:   Type.Number(),
            earnedCredits:      Type.Number(),
            recognisedCredits:  Type.Number(),
            requiredCredits:    Type.Union([Type.Number(), Type.Null()]),
            inDiscretionZone:   Type.Boolean(),
            discretionZone:     Type.Union([Type.Object({ widthPercent: Type.Number(), nextBoundaryCode: Type.String(), nextBoundaryMark: Type.Number() }), Type.Null()]),
            ruleVersions:       Type.Array(RuleVersionSchema),
          }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const recommendation = await fastify.awardService.calculateClassification(enrolmentId, request.tenantId);
      await reply.send(recommendation);
    },
  );

  // ── Confer award (retired) ────────────────────────────────────────────────
  // Direct conferral bypassed the separation between the board's
  // recommendation and the delegated authority's conferment (BPR-D14;
  // BP-06-003 steps 4–5). Use POST /enrolments/{id}/award-recommendations,
  // then POST /award-recommendations/{id}/conferment by someone else.

  fastify.post(
    '/enrolments/:enrolmentId/award',
    {
      schema: {
        deprecated: true,
        description: 'Retired. Awards are conferred through a recommendation and a separate conferment.',
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 410: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      await reply.code(410).send({
        type:   'https://srs.example.com/errors/gone',
        title:  'Gone',
        status: 410,
        detail: 'Direct award conferral is retired. Record the board\'s recommendation with POST /api/v1/enrolments/{enrolmentId}/award-recommendations; '
          + 'a different delegated authority then confers it with POST /api/v1/award-recommendations/{recommendationId}/conferment.',
        instance: request.url,
      });
    },
  );

  // ── Read current award ────────────────────────────────────────────────────

  fastify.get(
    '/enrolments/:enrolmentId/award',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: { 200: AwardSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('exam-board:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const award = await fastify.awardService.getCurrentAward(enrolmentId, request.tenantId);
      await reply.send(awardToWire(award));
    },
  );

  // ── Generate HEAR ─────────────────────────────────────────────────────────

  fastify.post(
    '/enrolments/:enrolmentId/hear',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: {
          201: Type.Object({
            enrolmentId:     Type.String(),
            awardId:         Type.String(),
            hearGeneratedAt: Type.String(),
            document:        Type.Unknown(),
          }),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('exam-board:ratify')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const hear = await fastify.hearService.generateHear(enrolmentId, request.tenantId, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'award',
        entityId:         hear.awardId,
        fieldName:        'hear_document',
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send(hearToWire(hear));
    },
  );

  // ── Read HEAR ─────────────────────────────────────────────────────────────
  // Accepts exam-board:read (board members, registry admin) OR
  // student:read:own (the student reading their own HEAR).

  fastify.get(
    '/enrolments/:enrolmentId/hear',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: {
          200: Type.Object({
            enrolmentId:     Type.String(),
            awardId:         Type.String(),
            hearGeneratedAt: Type.String(),
            document:        Type.Unknown(),
          }),
          403: ErrorSchema,
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const roles = request.user.roles;

      const hasAll = hasPermission(roles, 'exam-board:read');
      const hasOwn = hasPermission(roles, 'student:read:own');

      if (!hasAll && !hasOwn) {
        return reply.code(403).send({
          type:   'https://srs.example.com/errors/forbidden',
          title:  'Forbidden',
          status: 403,
          detail: 'Requires exam-board:read or student:read:own',
        });
      }

      const hear = await fastify.hearService.getHear(enrolmentId, request.tenantId);

      // If accessing via student:read:own, verify the HEAR belongs to this user
      if (!hasAll && hasOwn) {
        if (hear.document.student.personId !== request.user.srsPersonId) {
          return reply.code(403).send({
            type:   'https://srs.example.com/errors/forbidden',
            title:  'Forbidden',
            status: 403,
            detail: 'You may only access your own HEAR',
          });
        }
      }

      await reply.send(hearToWire(hear));
    },
  );
}

function decisionToWire(decision: ProgressionDecisionDto) {
  return {
    ...decision,
    validFrom: decision.validFrom.toISOString(),
    validTo: decision.validTo?.toISOString() ?? null,
    recordedAt: decision.recordedAt.toISOString(),
    recordedUntil: decision.recordedUntil?.toISOString() ?? null,
  };
}

function hearToWire(hear: HearDto) {
  return {
    ...hear,
    hearGeneratedAt: hear.hearGeneratedAt.toISOString(),
  };
}

function awardToWire(award: AwardDto) {
  return {
    ...award,
    hearGeneratedAt:     award.hearGeneratedAt?.toISOString() ?? null,
    certificateIssuedAt: award.certificateIssuedAt?.toISOString() ?? null,
    validFrom:           award.validFrom.toISOString(),
    validTo:             award.validTo?.toISOString() ?? null,
    recordedAt:          award.recordedAt.toISOString(),
    recordedUntil:       award.recordedUntil?.toISOString() ?? null,
  };
}
