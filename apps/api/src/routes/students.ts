import { Type } from '@sinclair/typebox';
import { requirePermission, requireSelfOrPermission } from '@revelation-srs/auth';
import { hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance } from 'fastify';

import { clockNow } from '../platform/clock.js';
import type {
  AddressInput,
  CreatePersonInput,
  DisabilityDeclarationInput,
  IdentityChangeRequestDto,
  IdentityVerificationCompletionInput,
  IdentityVerificationCheckDto,
  IdentityVerificationRequestInput,
  PersonIdentityPatch,
} from '../platform/students/service.js';
import type {
  EnrolmentDto,
  EnrolmentHistoryDto,
  EnrolmentTransitionDto,
  FeeLiabilityDto,
} from '../platform/enrolment/service.js';
import type { ChangeRequestDto } from '../platform/registration/service.js';

const PersonIdentitySchema = Type.Object({
  versionId:          Type.String(),
  legalFirstName:     Type.String(),
  legalFamilyName:    Type.String(),
  preferredName:      Type.Union([Type.String(), Type.Null()]),
  preferredPronouns:  Type.Union([Type.String(), Type.Null()]),
  dateOfBirth:        Type.Union([Type.String(), Type.Null()]),
  genderCode:         Type.Union([Type.String(), Type.Null()]),
  nationalityCode:    Type.Union([Type.String(), Type.Null()]),
  domicileCode:       Type.Union([Type.String(), Type.Null()]),
  emailInstitutional: Type.Union([Type.String(), Type.Null()]),
  emailPersonal:      Type.Union([Type.String(), Type.Null()]),
  phoneMobile:        Type.Union([Type.String(), Type.Null()]),
  validFrom:          Type.String(),
  recordedAt:         Type.String(),
});

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const IdentityVerificationCheckSchema = Type.Object({
  verificationCheckId: Type.String(),
  statusCode:          Type.String(),
  confidenceScore:     Type.Union([Type.Number(), Type.Null()]),
  fraudFlag:           Type.Boolean(),
  providerReference:   Type.Union([Type.String(), Type.Null()]),
  requestedAt:         Type.String(),
  completedAt:         Type.Union([Type.String(), Type.Null()]),
  validFrom:           Type.String(),
  recordedAt:          Type.String(),
});

/**
 * Student identity REST endpoints.
 *
 * GET  /students              - list students (paginated)
 * POST /students              - create student record
 * GET  /students/:id          - get student with current identity
 * PATCH /students/:id/identity - update personal data (new bitemporal version)
 * PATCH /students/:id/hesa-id - update HESA student identifier
 * GET  /students/:id/identity-history - full identity version history
 * POST /students/:id/identity-verifications - request identity verification
 * POST /students/:id/identity-verifications/:checkId/completion - complete identity verification
 * GET  /students/:id/identity-verifications - list current identity verification checks
 * GET  /students/:id/addresses - current addresses
 * POST /students/:id/addresses - add/update an address
 * POST /students/:id/disability-declarations - record a disability declaration
 * GET  /students/:id/disability-declarations - list current declarations
 * GET  /students/:id/enrolments - list student's enrolments
 */
export function studentRoutes(fastify: FastifyInstance): void {

  // ── List students ───────────────────────────────────────────────────────────
  fastify.get(
    '/students',
    {
      schema: {
        querystring: Type.Object({
          limit:      Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset:     Type.Optional(Type.Integer({ minimum: 0 })),
          search:     Type.Optional(Type.String()),
          statusCode: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Array(Type.Object({
            personId:       Type.String(),
            studentNumber:  Type.String(),
            legalFirstName:  Type.String(),
            legalFamilyName: Type.String(),
          })),
        },
      },
      preHandler: [requirePermission('student:read:all')],
    },
    async (request, reply) => {
      const q = request.query as { limit?: number; offset?: number; search?: string; statusCode?: string };
      const opts: { limit?: number; offset?: number; search?: string; statusCode?: string } = {};
      if (q.limit      !== undefined) opts.limit      = q.limit;
      if (q.offset     !== undefined) opts.offset     = q.offset;
      if (q.search     !== undefined) opts.search     = q.search;
      if (q.statusCode !== undefined) opts.statusCode = q.statusCode;
      const results = await fastify.studentService.listPersons(request.tenantId, opts);
      await reply.send(results);
    },
  );

  // ── Person status ──────────────────────────────────────────────────────────
  fastify.patch(
    '/students/:personId/status',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          statusCode: Type.Union([
            Type.Literal('prospective'),
            Type.Literal('student'),
            Type.Literal('alumnus'),
            Type.Literal('deceased'),
            Type.Literal('merged'),
          ]),
        }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('student:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const { statusCode } = request.body as { statusCode: 'prospective' | 'student' | 'alumnus' | 'deceased' | 'merged' };

      await fastify.studentService.updatePersonStatus(personId, request.tenantId, statusCode);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'person',
        entityId:         personId,
        fieldName:        'person_status_code',
        afterValue:       { statusCode },
        actionType:       'update',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  // ── HESA identifier ────────────────────────────────────────────────────────
  fastify.patch(
    '/students/:personId/hesa-id',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          hesaId: Type.String({ minLength: 1 }),
        }),
        response: {
          204: Type.Null(),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('student:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as { hesaId: string };

      await fastify.studentService.updateHesaId(personId, request.tenantId, body.hesaId);

      await fastify.audit.record({
        tenantId:        request.tenantId,
        entityType:      'person',
        entityId:        personId,
        fieldName:       'hesa_id',
        afterValue:      { hesaId: body.hesaId },
        actionType:      'update',
        actorType:       'user',
        actorId:         request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:   request.id,
      });

      if (fastify.eventBus.isConnected()) {
        const { EVENT_TYPES } = await import('@revelation-srs/domain');
        await fastify.eventBus.publish(
          EVENT_TYPES.STUDENT_IDENTITY_UPDATED,
          '1.0.0',
          request.tenantId,
          request.id,
          'personal',
          {
            personId,
            changedFields: ['hesaId'],
            effectiveDate: clockNow().toISOString(),
          },
        );
      }

      await reply.code(204).send();
    },
  );

  // ── Create student ──────────────────────────────────────────────────────────
  fastify.post(
    '/students',
    {
      schema: {
        body: Type.Object({
          legalFirstName:     Type.String({ minLength: 1 }),
          legalFamilyName:    Type.String({ minLength: 1 }),
          preferredName:      Type.Optional(Type.String()),
          dateOfBirth:        Type.Optional(Type.String()),
          genderCode:         Type.Optional(Type.String()),
          nationalityCode:    Type.Optional(Type.String()),
          domicileCode:       Type.Optional(Type.String()),
          emailInstitutional: Type.Optional(Type.String()),
          emailPersonal:      Type.Optional(Type.String()),
          phoneMobile:        Type.Optional(Type.String()),
          sourceSystem:       Type.Optional(Type.String()),
          sourceReference:    Type.Optional(Type.String()),
        }),
        response: {
          201: Type.Object({ personId: Type.String(), studentNumber: Type.String() }),
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('student:write')],
    },
    async (request, reply) => {
      const body = request.body as CreatePersonInput;
      const result = await fastify.studentService.createPerson(request.tenantId, body);

      await fastify.audit.record({
        tenantId:        request.tenantId,
        entityType:      'person',
        entityId:        result.personId,
        actionType:      'create',
        actorType:       'user',
        actorId:         request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:   request.id,
      });

      if (fastify.eventBus.isConnected()) {
        const { EVENT_TYPES } = await import('@revelation-srs/domain');
        await fastify.eventBus.publish(
          EVENT_TYPES.STUDENT_CREATED,
          '1.0.0',
          request.tenantId,
          request.id,
          'personal',
          {
            personId:      result.personId,
            studentNumber: result.studentNumber,
            tenantId:      request.tenantId,
            sourceSystem:  body.sourceSystem,
          },
        );
      }

      await reply.code(201).send(result);
    },
  );

  // ── Get student ─────────────────────────────────────────────────────────────
  fastify.get(
    '/students/:personId',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: {
          200: Type.Object({
            personId:        Type.String(),
            studentNumber:   Type.String(),
            hesaId:          Type.Union([Type.String(), Type.Null()]),
            personStatusCode: Type.String(),
            sourceSystem:    Type.Union([Type.String(), Type.Null()]),
            createdAt:       Type.String(),
            identity:        Type.Union([PersonIdentitySchema, Type.Null()]),
          }),
          404: ErrorSchema,
        },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const person = await fastify.studentService.getPerson(personId, request.tenantId);

      if (!person) {
        return reply.code(404).send({
          type:   'https://srs.example.com/errors/not-found',
          title:  'Not Found',
          status: 404,
          detail: `Student '${personId}' not found`,
        });
      }

      await reply.send({
        ...person,
        createdAt: person.createdAt.toISOString(),
        identity: person.identity ? {
          ...person.identity,
          validFrom:   person.identity.validFrom.toISOString(),
          recordedAt:  person.identity.recordedAt.toISOString(),
        } : null,
      });
    },
  );

  // ── Identity verification ─────────────────────────────────────────────────
  fastify.post(
    '/students/:personId/identity-verifications',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          providerReference: Type.Optional(Type.String()),
        }),
        response: {
          201: Type.Object({ verificationCheckId: Type.String() }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('student:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as IdentityVerificationRequestInput;

      const verificationCheckId = await fastify.studentService.requestIdentityVerification(
        personId,
        request.tenantId,
        body,
      );

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'identity_verification_check',
        entityId:      verificationCheckId,
        actionType:    'create',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      if (fastify.eventBus.isConnected()) {
        const { EVENT_TYPES } = await import('@revelation-srs/domain');
        await fastify.eventBus.publish(
          EVENT_TYPES.IDENTITY_VERIFICATION_REQUESTED,
          '1.0.0',
          request.tenantId,
          request.id,
          'personal',
          { personId, verificationCheckId },
        );
      }

      await reply.code(201).send({ verificationCheckId });
    },
  );

  fastify.post(
    '/students/:personId/identity-verifications/:verificationCheckId/completion',
    {
      schema: {
        params: Type.Object({
          personId:             Type.String(),
          verificationCheckId:  Type.String(),
        }),
        body: Type.Object({
          statusCode:         Type.Union([
            Type.Literal('verified'),
            Type.Literal('failed'),
            Type.Literal('fraud-flagged'),
          ]),
          confidenceScore:   Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
          fraudFlag:         Type.Optional(Type.Boolean()),
          providerReference: Type.Optional(Type.String()),
          completedAt:       Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: {
          204: Type.Null(),
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requirePermission('student:write')],
    },
    async (request, reply) => {
      const { personId, verificationCheckId } = request.params as {
        personId: string;
        verificationCheckId: string;
      };
      const body = request.body as IdentityVerificationCompletionInput & { completedAt?: string };
      const input: IdentityVerificationCompletionInput = {
        statusCode: body.statusCode,
      };
      if (body.confidenceScore !== undefined) input.confidenceScore = body.confidenceScore;
      if (body.fraudFlag !== undefined) input.fraudFlag = body.fraudFlag;
      if (body.providerReference !== undefined) input.providerReference = body.providerReference;
      if (body.completedAt !== undefined) input.completedAt = new Date(body.completedAt);

      await fastify.studentService.completeIdentityVerification(
        personId,
        request.tenantId,
        verificationCheckId,
        input,
      );

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'identity_verification_check',
        entityId:      verificationCheckId,
        fieldName:     'status_code',
        afterValue:    { statusCode: body.statusCode },
        actionType:    'update',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      if (fastify.eventBus.isConnected()) {
        const { EVENT_TYPES } = await import('@revelation-srs/domain');
        await fastify.eventBus.publish(
          EVENT_TYPES.IDENTITY_VERIFICATION_COMPLETED,
          '1.0.0',
          request.tenantId,
          request.id,
          body.statusCode === 'fraud-flagged' ? 'special-category' : 'personal',
          {
            personId,
            verificationCheckId,
            statusCode: body.statusCode,
            fraudFlag: body.fraudFlag ?? body.statusCode === 'fraud-flagged',
          },
        );
      }

      await reply.code(204).send();
    },
  );

  fastify.get(
    '/students/:personId/identity-verifications',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: {
          200: Type.Array(IdentityVerificationCheckSchema),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('student:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const checks = await fastify.studentService.listIdentityVerificationChecks(
        personId,
        request.tenantId,
      );

      await reply.send(checks.map(identityVerificationToWire));
    },
  );

  // ── Update identity ─────────────────────────────────────────────────────────
  fastify.patch(
    '/students/:personId/identity',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          legalFirstName:     Type.Optional(Type.String({ minLength: 1 })),
          legalFamilyName:    Type.Optional(Type.String({ minLength: 1 })),
          preferredName:      Type.Optional(Type.String()),
          preferredPronouns:  Type.Optional(Type.Union([Type.String(), Type.Null()])),
          dateOfBirth:        Type.Optional(Type.String()),
          genderCode:         Type.Optional(Type.String()),
          nationalityCode:    Type.Optional(Type.String()),
          domicileCode:       Type.Optional(Type.String()),
          emailInstitutional: Type.Optional(Type.String()),
          emailPersonal:      Type.Optional(Type.String()),
          phoneMobile:        Type.Optional(Type.String()),
          validFrom:          Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: {
          204: Type.Null(),
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as PersonIdentityPatch & { validFrom?: string };
      const { validFrom: vfStr, ...patch } = body;

      // Legal identity change (gender/nationality) requires a governed
      // approval, not direct self-service — staff (student:write) can still
      // correct these directly; a self-service caller must use
      // POST /students/:personId/identity-change-requests instead.
      if (!hasPermission(request.user.roles, 'student:write') && (patch.genderCode !== undefined || patch.nationalityCode !== undefined)) {
        return reply.code(403).send({
          type:   'https://srs.example.com/errors/forbidden',
          title:  'Forbidden',
          status: 403,
          detail: 'Gender and nationality changes require an approval request — use POST /students/:personId/identity-change-requests',
          instance: request.url,
        });
      }

      await fastify.studentService.updatePersonIdentity(
        personId,
        request.tenantId,
        patch,
        vfStr ? new Date(vfStr) : undefined,
      );

      const changedFields = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
      await fastify.audit.record({
        tenantId:        request.tenantId,
        entityType:      'person_identity',
        entityId:        personId,
        actionType:      'update',
        actorType:       'user',
        actorId:         request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:   request.id,
        afterValue:      { changedFields },
      });

      if (fastify.eventBus.isConnected()) {
        const { EVENT_TYPES } = await import('@revelation-srs/domain');
        await fastify.eventBus.publish(
          EVENT_TYPES.STUDENT_IDENTITY_UPDATED,
          '1.0.0',
          request.tenantId,
          request.id,
          'personal',
          {
            personId,
            changedFields,
            effectiveDate: (vfStr ?? clockNow().toISOString()),
          },
        );
      }

      await reply.code(204).send();
    },
  );

  // ── Identity history ────────────────────────────────────────────────────────
  fastify.get(
    '/students/:personId/identity-history',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: {
          200: Type.Array(PersonIdentitySchema),
        },
      },
      preHandler: [requirePermission('student:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const history = await fastify.studentService.getIdentityHistory(personId, request.tenantId);
      await reply.send(
        history.map((v) => ({
          ...v,
          validFrom:  v.validFrom.toISOString(),
          recordedAt: v.recordedAt.toISOString(),
        })),
      );
    },
  );

  // ── Legal identity change requests (workflow-gated) ─────────────────────────
  const IdentityChangeRequestSchema = Type.Object({
    workflowInstanceId: Type.String(),
    workflowTaskId:      Type.String(),
    statusCode:          Type.String(),
    context:             Type.Record(Type.String(), Type.Unknown()),
    startedAt:           Type.String(),
  });

  fastify.post(
    '/students/:personId/identity-change-requests',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          genderCode:      Type.Optional(Type.String()),
          nationalityCode: Type.Optional(Type.String()),
          reason:          Type.Optional(Type.String()),
        }),
        response: {
          202: IdentityChangeRequestSchema,
          404: ErrorSchema, 422: ErrorSchema,
        },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as { genderCode?: string; nationalityCode?: string; reason?: string };
      const { reason, ...patch } = body;

      const changeRequest = await fastify.studentService.requestIdentityChange(
        request.tenantId, personId, patch, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'person_identity_change_request',
        entityId:         changeRequest.workflowInstanceId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(202).send(identityChangeRequestToWire(changeRequest));
    },
  );

  fastify.get(
    '/students/:personId/identity-change-requests',
    {
      schema: {
        params:   Type.Object({ personId: Type.String() }),
        response: { 200: Type.Array(IdentityChangeRequestSchema) },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const requests = await fastify.studentService.listIdentityChangeRequestsForPerson(request.tenantId, personId);
      await reply.send(requests.map(identityChangeRequestToWire));
    },
  );

  fastify.get(
    '/identity-change-requests',
    {
      schema: { response: { 200: Type.Array(IdentityChangeRequestSchema) } },
      preHandler: [requirePermission('student:decide')],
    },
    async (request, reply) => {
      const requests = await fastify.studentService.listPendingIdentityChangeRequests(request.tenantId);
      await reply.send(requests.map(identityChangeRequestToWire));
    },
  );

  fastify.post(
    '/identity-change-requests/:workflowInstanceId/decision',
    {
      schema: {
        params: Type.Object({ workflowInstanceId: Type.String() }),
        body: Type.Object({
          decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
          reason:       Type.Optional(Type.String()),
        }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('student:decide')],
    },
    async (request, reply) => {
      const { workflowInstanceId } = request.params as { workflowInstanceId: string };
      const { decisionCode, reason } = request.body as { decisionCode: 'approved' | 'rejected'; reason?: string };

      await fastify.studentService.decideIdentityChangeRequest(
        request.tenantId, workflowInstanceId, decisionCode, request.user.sub, reason,
      );

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'person_identity_change_request',
        entityId:         workflowInstanceId,
        actionType:       'update',
        fieldName:        'decision_code',
        afterValue:       { decisionCode },
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  // ── Addresses ───────────────────────────────────────────────────────────────
  fastify.get(
    '/students/:personId/addresses',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: {
          200: Type.Array(Type.Object({
            id:              Type.String(),
            addressTypeCode: Type.String(),
            line1:           Type.String(),
            line2:           Type.Union([Type.String(), Type.Null()]),
            city:            Type.Union([Type.String(), Type.Null()]),
            postcode:        Type.Union([Type.String(), Type.Null()]),
            countryCode:     Type.Union([Type.String(), Type.Null()]),
            validFrom:       Type.String(),
          })),
        },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const addresses = await fastify.studentService.listAddresses(personId, request.tenantId);
      await reply.send(
        addresses.map((a) => ({
          id:              a.id,
          addressTypeCode: a.addressTypeCode,
          line1:           a.line1,
          line2:           a.line2,
          city:            a.city,
          postcode:        a.postcode,
          countryCode:     a.countryCode,
          validFrom:       a.validFrom.toISOString(),
        })),
      );
    },
  );

  fastify.post(
    '/students/:personId/addresses',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          addressTypeCode: Type.String(),
          line1:           Type.String({ minLength: 1 }),
          line2:           Type.Optional(Type.String()),
          city:            Type.Optional(Type.String()),
          postcode:        Type.Optional(Type.String()),
          countryCode:     Type.Optional(Type.String()),
          validFrom:       Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: { 201: Type.Object({ addressId: Type.String() }) },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as AddressInput & { validFrom?: string };
      const { validFrom: vfStr, ...addressInput } = body;

      const addrInput: AddressInput = { ...addressInput };
      if (vfStr) addrInput.validFrom = new Date(vfStr);
      const addressId = await fastify.studentService.addAddress(
        personId,
        request.tenantId,
        addrInput,
      );

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'student_address',
        entityId:      addressId,
        actionType:    'create',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      await reply.code(201).send({ addressId });
    },
  );

  const AddressSchema = Type.Object({
    id:              Type.String(),
    addressTypeCode: Type.String(),
    line1:           Type.String(),
    line2:           Type.Union([Type.String(), Type.Null()]),
    city:            Type.Union([Type.String(), Type.Null()]),
    postcode:        Type.Union([Type.String(), Type.Null()]),
    countryCode:     Type.Union([Type.String(), Type.Null()]),
    validFrom:       Type.String(),
  });

  fastify.get(
    '/students/:personId/addresses/:addressId',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), addressId: Type.String() }),
        response: { 200: AddressSchema, 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:read:all')],
    },
    async (request, reply) => {
      const { personId, addressId } = request.params as { personId: string; addressId: string };
      const address = await fastify.studentService.getAddress(personId, addressId, request.tenantId);

      if (!address) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Address '${addressId}' not found`,
        });
      }

      await reply.send({
        id:              address.id,
        addressTypeCode: address.addressTypeCode,
        line1:           address.line1,
        line2:           address.line2,
        city:            address.city,
        postcode:        address.postcode,
        countryCode:     address.countryCode,
        validFrom:       address.validFrom.toISOString(),
      });
    },
  );

  fastify.delete(
    '/students/:personId/addresses/:addressId',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), addressId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('student:read:own', 'student:write')],
    },
    async (request, reply) => {
      const { personId, addressId } = request.params as { personId: string; addressId: string };
      await fastify.studentService.deleteAddress(personId, addressId, request.tenantId);

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'student_address',
        entityId:      addressId,
        actionType:    'delete',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );

  // ── Disability declarations ─────────────────────────────────────────────────
  fastify.post(
    '/students/:personId/disability-declarations',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        body: Type.Object({
          disabilityCategoryCode: Type.String({ minLength: 1 }),
          declarationStatusCode:  Type.Optional(Type.String()),
          notes:                  Type.Optional(Type.Union([Type.String(), Type.Null()])),
        }),
        response: { 201: Type.Object({ declarationId: Type.String() }) },
      },
      preHandler: [requireSelfOrPermission('disability:read:own', 'disability:write')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const body = request.body as DisabilityDeclarationInput;

      const declarationId = await fastify.studentService.addDisabilityDeclaration(
        personId,
        request.tenantId,
        body,
      );

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'disability_declaration',
        entityId:      declarationId,
        actionType:    'create',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      if (fastify.eventBus.isConnected()) {
        const { EVENT_TYPES } = await import('@revelation-srs/domain');
        await fastify.eventBus.publish(
          EVENT_TYPES.STUDENT_DISABILITY_DECLARATION_UPDATED,
          '1.0.0',
          request.tenantId,
          request.id,
          'special-category',
          {
            personId,
            declarationId,
            disabilityCategoryCode: body.disabilityCategoryCode,
            declarationStatusCode:  body.declarationStatusCode ?? 'declared',
          },
        );
      }

      await reply.code(201).send({ declarationId });
    },
  );

  fastify.get(
    '/students/:personId/disability-declarations',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: {
          200: Type.Array(Type.Object({
            declarationId:          Type.String(),
            disabilityCategoryCode: Type.String(),
            declarationStatusCode:  Type.String(),
            declaredAt:             Type.String(),
            validFrom:              Type.String(),
            notes:                  Type.Union([Type.String(), Type.Null()]),
          })),
        },
      },
      preHandler: [requireSelfOrPermission('disability:read:own', 'disability:read')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };

      // Audit read of special-category data
      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'disability_declaration',
        entityId:      personId,
        actionType:    'read',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      const declarations = await fastify.studentService.listDisabilityDeclarations(
        personId,
        request.tenantId,
      );

      await reply.send(
        declarations.map((d) => ({
          ...d,
          declaredAt: d.declaredAt.toISOString(),
          validFrom:  d.validFrom.toISOString(),
        })),
      );
    },
  );

  fastify.patch(
    '/students/:personId/disability-declarations/:declarationId',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), declarationId: Type.String() }),
        body:     Type.Object({ notes: Type.Union([Type.String(), Type.Null()]) }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('disability:read:own', 'disability:write')],
    },
    async (request, reply) => {
      const { personId, declarationId } = request.params as { personId: string; declarationId: string };
      const { notes } = request.body as { notes: string | null };
      await fastify.studentService.updateDisabilityDeclaration(personId, declarationId, request.tenantId, notes);

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'disability_declaration',
        entityId:      declarationId,
        actionType:    'update',
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.post(
    '/students/:personId/disability-declarations/:declarationId/withdrawal',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), declarationId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('disability:read:own', 'disability:write')],
    },
    async (request, reply) => {
      const { personId, declarationId } = request.params as { personId: string; declarationId: string };
      await fastify.studentService.withdrawDisabilityDeclaration(personId, declarationId, request.tenantId);

      await fastify.audit.record({
        tenantId:      request.tenantId,
        entityType:    'disability_declaration',
        entityId:      declarationId,
        actionType:    'update',
        fieldName:     'declaration_status_code',
        afterValue:    { declarationStatusCode: 'withdrawn' },
        actorType:     'user',
        actorId:       request.user.sub,
        correlationId: request.id,
      });

      await reply.code(204).send();
    },
  );

  // ── Student's enrolments ────────────────────────────────────────────────────
  const StudentEnrolmentSchema = Type.Object({
    enrolmentId:         Type.String(),
    personId:            Type.String(),
    programmeId:         Type.Union([Type.String(), Type.Null()]),
    programmeCode:       Type.Union([Type.String(), Type.Null()]),
    programmeName:       Type.Union([Type.String(), Type.Null()]),
    statusCode:          Type.String(),
    modeOfStudyCode:     Type.String(),
    attendanceTypeCode:  Type.Union([Type.String(), Type.Null()]),
    academicYearOfEntry: Type.String(),
    startDate:           Type.Union([Type.String(), Type.Null()]),
    expectedEndDate:     Type.Union([Type.String(), Type.Null()]),
    actualEndDate:       Type.Union([Type.String(), Type.Null()]),
    feeBandCode:         Type.Union([Type.String(), Type.Null()]),
    fundingSourceCode:   Type.Union([Type.String(), Type.Null()]),
    slcReference:        Type.Union([Type.String(), Type.Null()]),
    ucasPersonalId:      Type.Union([Type.String(), Type.Null()]),
    validFrom:           Type.String(),
    recordedAt:          Type.String(),
  });

  const StudentEnrolmentHistorySchema = Type.Intersect([
    StudentEnrolmentSchema,
    Type.Object({
      validTo:       Type.Union([Type.String(), Type.Null()]),
      recordedUntil: Type.Union([Type.String(), Type.Null()]),
    }),
  ]);

  const StudentEnrolmentTransitionSchema = Type.Object({
    transitionId:   Type.String(),
    enrolmentId:    Type.String(),
    fromStatusCode: Type.String(),
    toStatusCode:   Type.String(),
    reasonCode:     Type.Union([Type.String(), Type.Null()]),
    reasonText:     Type.Union([Type.String(), Type.Null()]),
    effectiveAt:    Type.String(),
    actorId:        Type.String(),
    createdAt:      Type.String(),
  });

  const StudentFeeLiabilitySchema = Type.Object({
    feeLiabilityId:    Type.String(),
    enrolmentId:       Type.String(),
    personId:          Type.String(),
    academicYear:      Type.String(),
    feeBandCode:       Type.Union([Type.String(), Type.Null()]),
    fundingSourceCode: Type.Union([Type.String(), Type.Null()]),
    statusCode:        Type.String(),
    generatedAt:       Type.String(),
  });

  fastify.get(
    '/students/:personId/enrolments',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: { 200: Type.Array(StudentEnrolmentSchema) },
      },
      preHandler: [requireSelfOrPermission('enrolment:read:own', 'enrolment:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const enrolments = await fastify.enrolmentService.listPersonEnrolments(
        personId,
        request.tenantId,
      );
      await reply.send(
        enrolments.map((e) => ({
          ...e,
          validFrom:  e.validFrom.toISOString(),
          recordedAt: e.recordedAt.toISOString(),
        })),
      );
    },
  );

  /**
   * Verifies the enrolment both exists and belongs to :personId — the route
   * param is authorised by requireSelfOrPermission, but without this check a
   * self-scoped student could pass any enrolmentId belonging to a different
   * student in the same tenant.
   */
  async function getOwnedEnrolment(
    personId: string,
    enrolmentId: string,
    tenantId: string,
  ): Promise<EnrolmentDto | null> {
    const enrolment = await fastify.enrolmentService.getEnrolment(enrolmentId, tenantId);
    return (enrolment && enrolment.personId === personId) ? enrolment : null;
  }

  fastify.get(
    '/students/:personId/enrolments/:enrolmentId',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: StudentEnrolmentSchema, 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('enrolment:read:own', 'enrolment:read:all')],
    },
    async (request, reply) => {
      const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
      const enrolment = await getOwnedEnrolment(personId, enrolmentId, request.tenantId);
      if (!enrolment) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }
      await reply.send({
        ...enrolment,
        validFrom:  enrolment.validFrom.toISOString(),
        recordedAt: enrolment.recordedAt.toISOString(),
      });
    },
  );

  fastify.get(
    '/students/:personId/enrolments/:enrolmentId/history',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: Type.Array(StudentEnrolmentHistorySchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('enrolment:read:own', 'enrolment:read:all')],
    },
    async (request, reply) => {
      const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
      if (!await getOwnedEnrolment(personId, enrolmentId, request.tenantId)) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }
      const history = await fastify.enrolmentService.getEnrolmentHistory(enrolmentId, request.tenantId);
      await reply.send(history.map((h: EnrolmentHistoryDto) => ({
        ...h,
        validFrom:     h.validFrom.toISOString(),
        validTo:       h.validTo?.toISOString() ?? null,
        recordedAt:    h.recordedAt.toISOString(),
        recordedUntil: h.recordedUntil?.toISOString() ?? null,
      })));
    },
  );

  fastify.get(
    '/students/:personId/enrolments/:enrolmentId/transitions',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: Type.Array(StudentEnrolmentTransitionSchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('enrolment:read:own', 'enrolment:read:all')],
    },
    async (request, reply) => {
      const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
      if (!await getOwnedEnrolment(personId, enrolmentId, request.tenantId)) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }
      const transitions = await fastify.enrolmentService.listStatusTransitions(enrolmentId, request.tenantId);
      await reply.send(transitions.map((t: EnrolmentTransitionDto) => ({
        ...t,
        effectiveAt: t.effectiveAt.toISOString(),
        createdAt:   t.createdAt.toISOString(),
      })));
    },
  );

  fastify.get(
    '/students/:personId/enrolments/:enrolmentId/fee-liabilities',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: Type.Array(StudentFeeLiabilitySchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('enrolment:read:own', 'enrolment:read:all')],
    },
    async (request, reply) => {
      const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
      if (!await getOwnedEnrolment(personId, enrolmentId, request.tenantId)) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }
      const fees = await fastify.enrolmentService.listFeeLiabilities(enrolmentId, request.tenantId);
      await reply.send(fees.map((f: FeeLiabilityDto) => ({
        ...f,
        generatedAt: f.generatedAt.toISOString(),
      })));
    },
  );

  const SelfPgrAssignmentSchema = Type.Object({
    assignmentId:   Type.String(),
    personId:       Type.String(),
    roleDetailCode: Type.String(),
    validFrom:      Type.String(),
  });

  const SelfPgrMilestoneSchema = Type.Object({
    milestoneId:       Type.String(),
    milestoneTypeCode: Type.String(),
    achievedDate:      Type.String(),
    publishedAt:       Type.Union([Type.String(), Type.Null()]),
  });

  fastify.get(
    '/students/:personId/enrolments/:enrolmentId/pgr/supervision',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: Type.Array(SelfPgrAssignmentSchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('pgr-case:read:own', 'pgr-case:read')],
    },
    async (request, reply) => {
      const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
      if (!await getOwnedEnrolment(personId, enrolmentId, request.tenantId)) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }
      const assignments = await fastify.supervisionService.listCurrentAssignments(request.tenantId, enrolmentId);
      await reply.send(assignments.map((a) => ({
        assignmentId:   a.assignmentId,
        personId:       a.personId,
        roleDetailCode: a.roleDetailCode,
        validFrom:      a.validFrom.toISOString(),
      })));
    },
  );

  fastify.get(
    '/students/:personId/enrolments/:enrolmentId/pgr/milestones',
    {
      schema: {
        params:   Type.Object({ personId: Type.String(), enrolmentId: Type.String() }),
        response: { 200: Type.Array(SelfPgrMilestoneSchema), 404: ErrorSchema },
      },
      preHandler: [requireSelfOrPermission('pgr-case:read:own', 'pgr-case:read')],
    },
    async (request, reply) => {
      const { personId, enrolmentId } = request.params as { personId: string; enrolmentId: string };
      if (!await getOwnedEnrolment(personId, enrolmentId, request.tenantId)) {
        return reply.code(404).send({
          type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404,
          detail: `Enrolment '${enrolmentId}' not found`,
        });
      }
      const milestones = await fastify.progressReviewService.listMilestones(request.tenantId, enrolmentId);
      await reply.send(milestones.map((m) => ({
        milestoneId:       m.milestoneId,
        milestoneTypeCode: m.milestoneTypeCode,
        achievedDate:      m.achievedDate,
        publishedAt:       m.publishedAt?.toISOString() ?? null,
      })));
    },
  );

  fastify.get(
    '/students/:personId/module-registration-requests',
    {
      schema: {
        params: Type.Object({ personId: Type.String() }),
        response: {
          200: Type.Array(Type.Object({
            workflowInstanceId: Type.String(),
            workflowTaskId:      Type.String(),
            statusCode:          Type.String(),
            context:             Type.Record(Type.String(), Type.Unknown()),
            startedAt:           Type.String(),
          })),
        },
      },
      preHandler: [requireSelfOrPermission('enrolment:read:own', 'enrolment:read:all')],
    },
    async (request, reply) => {
      const { personId } = request.params as { personId: string };
      const enrolments = await fastify.enrolmentService.listPersonEnrolments(personId, request.tenantId);
      const requests = await fastify.moduleRegistrationService.listChangeRequestsForEnrolments(
        request.tenantId,
        enrolments.map((e) => e.enrolmentId),
      );
      await reply.send(requests.map((r: ChangeRequestDto) => ({
        ...r,
        startedAt: r.startedAt.toISOString(),
      })));
    },
  );
}

function identityVerificationToWire(check: IdentityVerificationCheckDto) {
  return {
    ...check,
    requestedAt: check.requestedAt.toISOString(),
    completedAt: check.completedAt?.toISOString() ?? null,
    validFrom:   check.validFrom.toISOString(),
    recordedAt:  check.recordedAt.toISOString(),
  };
}

function identityChangeRequestToWire(changeRequest: IdentityChangeRequestDto) {
  return {
    ...changeRequest,
    startedAt: changeRequest.startedAt.toISOString(),
  };
}
