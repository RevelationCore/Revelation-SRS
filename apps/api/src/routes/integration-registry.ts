import { requirePermission } from '@revelation-srs/auth';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type {
  CreateRegistrationInput,
  UpdateRegistrationInput,
} from '../platform/integration/registry-service.js';

const JsonRecord = Type.Record(Type.String(), Type.Unknown());

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const RetryPolicySchema = Type.Object({
  maxAttempts:        Type.Number(),
  backoffCoefficient: Type.Number(),
  initialInterval:    Type.String(),
  deadLetterSubject:  Type.String(),
});

const ContractSchema = Type.Object({
  contractId:              Type.String(),
  displayName:             Type.String(),
  ownerModuleCode:         Type.String(),
  directionCode:           Type.String(),
  patternType:             Type.String(),
  currentContractVersion:  Type.String(),
  dataClassificationCode:  Type.String(),
  deprecatedAt:            Type.Union([Type.String(), Type.Null()]),
  minimumSupportedVersion: Type.Union([Type.String(), Type.Null()]),
  createdAt:               Type.String(),
});

const RegistrationSchema = Type.Object({
  registrationId:           Type.String(),
  tenantId:                 Type.String(),
  contractId:               Type.String(),
  displayName:              Type.String(),
  contractVersion:          Type.String(),
  transportCode:            Type.String(),
  subjectFilter:            Type.Union([Type.String(), Type.Null()]),
  consumerGroup:            Type.Union([Type.String(), Type.Null()]),
  endpointUrl:              Type.Union([Type.String(), Type.Null()]),
  fileSchedule:             Type.Union([Type.String(), Type.Null()]),
  secretRef:                Type.Union([Type.String(), Type.Null()]),
  replaySupported:          Type.Boolean(),
  retryPolicy:              Type.Union([RetryPolicySchema, Type.Null()]),
  enabled:                  Type.Boolean(),
  endpointSafetyClass:      Type.String(),
  liveTrafficApproved:      Type.Boolean(),
  systemManaged:            Type.Boolean(),
  healthStatusCode:         Type.Union([Type.String(), Type.Null()]),
  lastHealthCheckAt:        Type.Union([Type.String(), Type.Null()]),
  lastSuccessfulExchangeAt: Type.Union([Type.String(), Type.Null()]),
  registeredAt:             Type.String(),
  lastUpdatedAt:            Type.String(),
});

const ExchangeSchema = Type.Object({
  exchangeId:       Type.String(),
  registrationId:   Type.String(),
  contractId:       Type.String(),
  directionCode:    Type.String(),
  exchangeTypeCode: Type.String(),
  idempotencyKey:   Type.String(),
  correlationId:    Type.Union([Type.String(), Type.Null()]),
  sourceReference:  Type.Union([Type.String(), Type.Null()]),
  statusCode:       Type.String(),
  attemptCount:     Type.Number(),
  lastAttemptAt:    Type.Union([Type.String(), Type.Null()]),
  lastError:        Type.Union([Type.String(), Type.Null()]),
  payloadHash:      Type.Union([Type.String(), Type.Null()]),
  payloadSummary:   Type.Union([JsonRecord, Type.Null()]),
  receivedAt:       Type.Union([Type.String(), Type.Null()]),
  sentAt:           Type.Union([Type.String(), Type.Null()]),
  createdAt:        Type.String(),
});

// ---------------------------------------------------------------------------
// Route function
// ---------------------------------------------------------------------------

export async function integrationRegistryRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = () => fastify.integrationRegistryService;

  // --- Contracts ---

  fastify.get(
    '/integration-contracts',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        querystring: Type.Object({ limit: Type.Optional(Type.Number()) }),
        response: {
          200: Type.Array(ContractSchema),
          403: ErrorSchema,
        },
      },
    },
    async (_req, reply) => {
      const contracts = await svc().listContracts();
      return reply.send(contracts);
    },
  );

  fastify.get(
    '/integration-contracts/:contractId',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ contractId: Type.String() }),
        response: {
          200: ContractSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { contractId } = req.params as { contractId: string };
      const contract = await svc().getContract(contractId);
      return reply.send(contract);
    },
  );

  // --- Registrations ---

  fastify.get(
    '/integration-registrations',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        querystring: Type.Object({
          contractId: Type.Optional(Type.String()),
          enabled:    Type.Optional(Type.Boolean()),
          limit:      Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Array(RegistrationSchema),
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const q = req.query as { contractId?: string; enabled?: boolean; limit?: number };
      const registrations = await svc().listRegistrations(req.tenantId, {
        ...(q.contractId !== undefined ? { contractId: q.contractId } : {}),
        ...(q.enabled    !== undefined ? { enabled:    q.enabled }    : {}),
        ...(q.limit      !== undefined ? { limit:      q.limit }      : {}),
      });
      return reply.send(registrations);
    },
  );

  fastify.get(
    '/integration-registrations/:registrationId',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ registrationId: Type.String() }),
        response: {
          200: RegistrationSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { registrationId } = req.params as { registrationId: string };
      const registration = await svc().getRegistration(registrationId, req.tenantId);
      return reply.send(registration);
    },
  );

  fastify.post(
    '/integration-registrations',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        body: Type.Object({
          contractId:         Type.String({ minLength: 1 }),
          displayName:        Type.Optional(Type.String()),
          transportCode:      Type.String({ minLength: 1 }),
          endpointUrl:        Type.Optional(Type.Union([Type.String(), Type.Null()])),
          subjectFilter:      Type.Optional(Type.Union([Type.String(), Type.Null()])),
          consumerGroup:      Type.Optional(Type.Union([Type.String(), Type.Null()])),
          fileSchedule:       Type.Optional(Type.Union([Type.String(), Type.Null()])),
          secretRef:          Type.Optional(Type.Union([Type.String(), Type.Null()])),
          replaySupported:    Type.Optional(Type.Boolean()),
          retryPolicy:        Type.Optional(Type.Union([RetryPolicySchema, Type.Null()])),
          endpointSafetyClass: Type.Optional(
            Type.Union([
              Type.Literal('simulator'),
              Type.Literal('external-test'),
              Type.Literal('external-production'),
            ]),
          ),
          liveTrafficApproved: Type.Optional(Type.Boolean()),
        }),
        response: {
          201: RegistrationSchema,
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const registration = await svc().createRegistration(
        req.tenantId,
        req.body as CreateRegistrationInput,
        req.user.sub,
      );
      return reply.code(201).send(registration);
    },
  );

  fastify.patch(
    '/integration-registrations/:registrationId',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ registrationId: Type.String() }),
        body: Type.Object({
          displayName:        Type.Optional(Type.String()),
          transportCode:      Type.Optional(Type.String()),
          endpointUrl:        Type.Optional(Type.Union([Type.String(), Type.Null()])),
          subjectFilter:      Type.Optional(Type.Union([Type.String(), Type.Null()])),
          consumerGroup:      Type.Optional(Type.Union([Type.String(), Type.Null()])),
          fileSchedule:       Type.Optional(Type.Union([Type.String(), Type.Null()])),
          secretRef:          Type.Optional(Type.Union([Type.String(), Type.Null()])),
          replaySupported:    Type.Optional(Type.Boolean()),
          retryPolicy:        Type.Optional(Type.Union([RetryPolicySchema, Type.Null()])),
          endpointSafetyClass: Type.Optional(
            Type.Union([
              Type.Literal('simulator'),
              Type.Literal('external-test'),
              Type.Literal('external-production'),
            ]),
          ),
          liveTrafficApproved: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: RegistrationSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { registrationId } = req.params as { registrationId: string };
      const registration = await svc().updateRegistration(
        registrationId,
        req.tenantId,
        req.body as UpdateRegistrationInput,
        req.user.sub,
      );
      return reply.send(registration);
    },
  );

  fastify.post(
    '/integration-registrations/:registrationId/enable',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ registrationId: Type.String() }),
        response: {
          200: RegistrationSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { registrationId } = req.params as { registrationId: string };
      const registration = await svc().enableRegistration(
        registrationId,
        req.tenantId,
        req.user.sub,
      );
      return reply.send(registration);
    },
  );

  fastify.post(
    '/integration-registrations/:registrationId/disable',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ registrationId: Type.String() }),
        response: {
          200: RegistrationSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { registrationId } = req.params as { registrationId: string };
      const registration = await svc().disableRegistration(
        registrationId,
        req.tenantId,
        req.user.sub,
      );
      return reply.send(registration);
    },
  );

  fastify.post(
    '/integration-registrations/:registrationId/health-check',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ registrationId: Type.String() }),
        body: Type.Object({
          statusCode: Type.String({ minLength: 1 }),
        }),
        response: {
          200: RegistrationSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { registrationId } = req.params as { registrationId: string };
      const { statusCode } = req.body as { statusCode: string };
      const registration = await svc().recordHealthCheck(
        registrationId,
        req.tenantId,
        statusCode,
        req.user.sub,
      );
      return reply.send(registration);
    },
  );

  fastify.post(
    '/integration-registrations/:registrationId/replay',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ registrationId: Type.String() }),
        body: Type.Object({
          fromDate: Type.String({ format: 'date-time' }),
        }),
        response: {
          201: ExchangeSchema,
          400: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { registrationId } = req.params as { registrationId: string };
      const { fromDate } = req.body as { fromDate: string };
      const exchange = await svc().initiateReplay(
        registrationId,
        req.tenantId,
        new Date(fromDate),
        req.user.sub,
      );
      return reply.code(201).send(exchange);
    },
  );

  // --- Exchanges ---

  fastify.get(
    '/integration-exchanges',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        querystring: Type.Object({
          registrationId: Type.Optional(Type.String()),
          statusCode:     Type.Optional(Type.String()),
          directionCode:  Type.Optional(Type.String()),
          limit:          Type.Optional(Type.Number()),
        }),
        response: {
          200: Type.Array(ExchangeSchema),
          403: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const q = req.query as {
        registrationId?: string;
        statusCode?: string;
        directionCode?: string;
        limit?: number;
      };
      const exchanges = await svc().listExchanges(req.tenantId, {
        ...(q.registrationId !== undefined ? { registrationId: q.registrationId } : {}),
        ...(q.statusCode     !== undefined ? { statusCode:     q.statusCode }     : {}),
        ...(q.directionCode  !== undefined ? { directionCode:  q.directionCode }  : {}),
        ...(q.limit          !== undefined ? { limit:          q.limit }          : {}),
      });
      return reply.send(exchanges);
    },
  );

  fastify.get(
    '/integration-exchanges/:exchangeId',
    {
      preHandler: [requirePermission('integration:manage')],
      schema: {
        params: Type.Object({ exchangeId: Type.String() }),
        response: {
          200: ExchangeSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { exchangeId } = req.params as { exchangeId: string };
      const exchange = await svc().getExchange(exchangeId, req.tenantId);
      return reply.send(exchange);
    },
  );
}
