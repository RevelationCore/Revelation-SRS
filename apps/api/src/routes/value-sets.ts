import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

/**
 * Value set REST endpoints.
 *
 * GET  /api/v1/value-sets                        - list all value sets
 * GET  /api/v1/value-sets/:setCode               - get set with active members
 * GET  /api/v1/fields/:entity/:field/value-set   - get set for a data-model field
 * POST /api/v1/value-sets/:setCode/members       - add tenant extension (tenant-admin)
 *
 * All GET endpoints are accessible to any authenticated role - the UI
 * needs value sets before rendering forms.  POST requires tenant-administrator.
 *
 * activeAt query parameter (ISO 8601) enables historical value set lookups
 * for audit trail reconstruction and HESA return processing.
 */
export function valueSetsRoutes(fastify: FastifyInstance): void {
  // - List all value sets -
  fastify.get(
    '/value-sets',
    {
      schema: {
        querystring: Type.Object({
          source: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Array(Type.Object({
            setCode:       Type.String(),
            displayName:   Type.String(),
            source:        Type.String(),
            sourceVersion: Type.Union([Type.String(), Type.Null()]),
            description:   Type.Union([Type.String(), Type.Null()]),
            isExtensible:  Type.Boolean(),
          })),
        },
      },
    },
    async (request, reply) => {
      const sets = await fastify.valueSetService.listValueSets();
      const { source } = request.query as { source?: string };
      const result = source ? sets.filter((s) => s.source === source) : sets;
      await reply.send(result);
    },
  );

  // - Get a specific value set with members -
  fastify.get(
    '/value-sets/:setCode',
    {
      schema: {
        params: Type.Object({ setCode: Type.String() }),
        querystring: Type.Object({
          activeAt: Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: {
          200: Type.Object({
            setCode:       Type.String(),
            displayName:   Type.String(),
            source:        Type.String(),
            sourceVersion: Type.Union([Type.String(), Type.Null()]),
            description:   Type.Union([Type.String(), Type.Null()]),
            isExtensible:  Type.Boolean(),
            members: Type.Array(Type.Object({
              code:          Type.String(),
              displayLabel:  Type.String(),
              description:   Type.Union([Type.String(), Type.Null()]),
              sortOrder:     Type.Number(),
              activeFrom:    Type.String(),
              activeTo:      Type.Union([Type.String(), Type.Null()]),
              sourceMetadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
            })),
          }),
          404: Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number() }),
        },
      },
    },
    async (request, reply) => {
      const { setCode }  = request.params as { setCode: string };
      const { activeAt } = request.query as { activeAt?: string };

      const result = await fastify.valueSetService.getValueSet(
        setCode,
        request.tenantId,
        activeAt ? { activeAt: new Date(activeAt) } : {},
      );

      if (!result) {
        return reply.code(404).send({
          type:   'https://srs.example.com/errors/not-found',
          title:  'Not Found',
          status: 404,
          detail: `Value set '${setCode}' does not exist`,
        });
      }

      await reply.send(result);
    },
  );

  // - Get value set for a data-model field -
  fastify.get(
    '/fields/:entity/:field/value-set',
    {
      schema: {
        params: Type.Object({
          entity: Type.String(),
          field:  Type.String(),
        }),
        querystring: Type.Object({
          activeAt: Type.Optional(Type.String({ format: 'date-time' })),
        }),
      },
    },
    async (request, reply) => {
      const { entity, field } = request.params as { entity: string; field: string };
      const { activeAt }      = request.query as { activeAt?: string };

      const setCode = await fastify.valueSetService.getValueSetForField(entity, field);
      if (!setCode) {
        return reply.code(404).send({
          type:   'https://srs.example.com/errors/not-found',
          title:  'Not Found',
          status: 404,
          detail: `No value set registered for ${entity}.${field}`,
        });
      }

      const result = await fastify.valueSetService.getValueSet(
        setCode,
        request.tenantId,
        activeAt ? { activeAt: new Date(activeAt) } : {},
      );

      await reply.send(result);
    },
  );

  // - Add tenant extension value -
  fastify.post(
    '/value-sets/:setCode/members',
    {
      schema: {
        params: Type.Object({ setCode: Type.String() }),
        body: Type.Object({
          code:         Type.String({ minLength: 1, maxLength: 50 }),
          displayLabel: Type.String({ minLength: 1, maxLength: 200 }),
          description:  Type.Optional(Type.String({ maxLength: 500 })),
          sortOrder:    Type.Optional(Type.Integer({ minimum: 0 })),
        }),
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const { setCode } = request.params as { setCode: string };
      const body = request.body as {
        code: string; displayLabel: string; description?: string; sortOrder?: number;
      };

      const member = await fastify.valueSetService.addTenantValue(
        setCode,
        request.tenantId,
        body,
      );

      await reply.code(201).send(member);
    },
  );
}
