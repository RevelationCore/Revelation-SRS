import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance } from 'fastify';

import type { MemberInclusion } from '../platform/value-sets/service.js';

const ProblemSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

const MemberSchema = Type.Object({
  code:          Type.String(),
  displayLabel:  Type.String(),
  description:   Type.Union([Type.String(), Type.Null()]),
  sortOrder:     Type.Number(),
  activeFrom:    Type.Union([Type.String(), Type.Null()]),
  activeTo:      Type.Union([Type.String(), Type.Null()]),
  sourceMetadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  active:        Type.Boolean(),
  hidden:        Type.Boolean(),
  selectable:    Type.Boolean(),
});

const SetSchema = Type.Object({
  setCode:       Type.String(),
  displayName:   Type.String(),
  source:        Type.String(),
  sourceVersion: Type.Union([Type.String(), Type.Null()]),
  description:   Type.Union([Type.String(), Type.Null()]),
  isExtensible:  Type.Boolean(),
  allowsTenantHide: Type.Boolean(),
  members:       Type.Array(MemberSchema),
});

const ManagedMemberSchema = Type.Object({
  code:          Type.String(),
  displayLabel:  Type.String(),
  description:   Type.Union([Type.String(), Type.Null()]),
  sortOrder:     Type.Number(),
  activeFrom:    Type.Union([Type.String(), Type.Null()]),
  activeTo:      Type.Union([Type.String(), Type.Null()]),
  active:        Type.Boolean(),
  hidden:        Type.Boolean(),
  selectable:    Type.Boolean(),
  isTenantOwned: Type.Boolean(),
  platformLabel: Type.String(),
  platformDescription: Nullable(Type.String()),
  overridden:    Type.Boolean(),
  wordings:      Type.Array(Type.Object({
    scope:        Type.Union([Type.Literal('tenant'), Type.Literal('platform')]),
    localeCode:   Nullable(Type.String()),
    displayLabel: Nullable(Type.String()),
    description:  Nullable(Type.String()),
    updatedBy:    Nullable(Type.String()),
    updatedAt:    Type.String(),
  })),
});

/**
 * include: 'selectable' (default) — what a picker offers; 'all' — every
 * member, retired, scheduled and hidden ones too, so screens can label
 * any code a record holds.
 */
const IncludeQuery = Type.Optional(Type.Union([Type.Literal('selectable'), Type.Literal('all')]));
/** The reader's language (e.g. 'cy-GB'): wording in that language wins where there is any. */
const LocaleQuery = Type.Optional(Type.String({ minLength: 2, maxLength: 20 }));

/**
 * Value set REST endpoints.
 *
 * GET  /api/v1/value-sets                        - list all value sets
 * GET  /api/v1/value-sets/:setCode               - get set with active members
 * GET  /api/v1/fields/:entity/:field/value-set   - get set for a data-model field
 * POST /api/v1/value-sets/:setCode/members       - add tenant extension (tenant-admin)
 * PUT  /api/v1/value-sets/:setCode/members/:code/wording       - relabel or translate a value
 * PUT  /api/v1/value-sets/:setCode/members/:code/hidden        - hide or show a platform value
 * DELETE /api/v1/value-sets/:setCode/members/:code/customisation - back to the platform wording
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
            allowsTenantHide: Type.Boolean(),
            usedBy:        Type.Array(Type.Object({ entityName: Type.String(), fieldName: Type.String() })),
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
          include:  IncludeQuery,
          locale:   LocaleQuery,
        }),
        response: {
          200: SetSchema,
          404: Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number() }),
        },
      },
    },
    async (request, reply) => {
      const { setCode }  = request.params as { setCode: string };
      const { activeAt, include, locale } = request.query as { activeAt?: string; include?: MemberInclusion; locale?: string };

      const result = await fastify.valueSetService.getValueSet(
        setCode,
        request.tenantId,
        { ...(activeAt ? { activeAt: new Date(activeAt) } : {}), ...(include ? { include } : {}), ...(locale ? { locale } : {}) },
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
          include:  IncludeQuery,
          locale:   LocaleQuery,
        }),
        response: {
          200: Type.Intersect([SetSchema, Type.Object({ entityName: Type.String(), fieldName: Type.String() })]),
          404: Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) }),
        },
      },
    },
    async (request, reply) => {
      const { entity, field } = request.params as { entity: string; field: string };
      const { activeAt, include, locale } = request.query as { activeAt?: string; include?: MemberInclusion; locale?: string };

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
        { ...(activeAt ? { activeAt: new Date(activeAt) } : {}), ...(include ? { include } : {}), ...(locale ? { locale } : {}) },
      );

      await reply.send({ ...result, entityName: entity, fieldName: field });
    },
  );

  // - List all members (management view — includes inactive/scheduled) -
  fastify.get(
    '/value-sets/:setCode/members',
    {
      schema: {
        params: Type.Object({ setCode: Type.String() }),
        response: {
          200: Type.Array(ManagedMemberSchema),
          404: Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number() }),
        },
      },
      preHandler: [requirePermission('config:read')],
    },
    async (request, reply) => {
      const { setCode } = request.params as { setCode: string };
      const members = await fastify.valueSetService.listAllMembers(setCode, request.tenantId);
      await reply.send(members);
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
          activeFrom:   Type.Optional(Type.String({ format: 'date' })),
          activeTo:     Type.Optional(Type.String({ format: 'date' })),
        }),
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const { setCode } = request.params as { setCode: string };
      const body = request.body as {
        code: string; displayLabel: string; description?: string; sortOrder?: number;
        activeFrom?: string; activeTo?: string;
      };

      const member = await fastify.valueSetService.addTenantValue(
        setCode,
        request.tenantId,
        body,
      );

      await reply.code(201).send(member);
    },
  );

  // - Update a tenant-owned member -
  fastify.patch(
    '/value-sets/:setCode/members/:memberCode',
    {
      schema: {
        params: Type.Object({ setCode: Type.String(), memberCode: Type.String() }),
        body: Type.Object({
          displayLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          description:  Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
          sortOrder:    Type.Optional(Type.Integer({ minimum: 0 })),
          activeFrom:   Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
          activeTo:     Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
        }),
        response: {
          204: Type.Null(),
          404: Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number() }),
        },
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const { setCode, memberCode } = request.params as { setCode: string; memberCode: string };
      const body = request.body as {
        displayLabel?: string; description?: string | null;
        sortOrder?: number; activeFrom?: string; activeTo?: string | null;
      };

      const outcome = await fastify.valueSetService.updateTenantValue(
        setCode, request.tenantId, memberCode, body,
      );

      if (outcome === 'not-found') {
        return reply.code(404).send({
          type:   'https://srs.example.com/errors/not-found',
          title:  'Not Found',
          status: 404,
          detail: `Member '${memberCode}' not found or not editable in value set '${setCode}'`,
        });
      }

      await reply.code(204).send(null);
    },
  );

  // - Relabel or translate a value -
  fastify.put(
    '/value-sets/:setCode/members/:memberCode/wording',
    {
      schema: {
        params: Type.Object({ setCode: Type.String(), memberCode: Type.String() }),
        body: Type.Object({
          localeCode:   Type.Optional(Type.Union([Type.String({ minLength: 2, maxLength: 20 }), Type.Null()])),
          displayLabel: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
          description:  Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
          scope:        Type.Optional(Type.Union([Type.Literal('tenant'), Type.Literal('platform')])),
        }),
        response: { 200: ManagedMemberSchema, 403: ProblemSchema, 404: ProblemSchema, 422: ProblemSchema },
      },
    },
    async (request, reply) => {
      const { setCode, memberCode } = request.params as { setCode: string; memberCode: string };
      const body = request.body as { localeCode?: string | null; displayLabel?: string | null; description?: string | null; scope?: 'tenant' | 'platform' };
      const scope = body.scope ?? 'tenant';
      // An institution words its own values; only the platform's translators word everyone's.
      const needed = scope === 'platform' ? 'value-set:translate-platform' : 'config:write';
      if (!hasPermission(request.user.roles, needed)) throw new ForbiddenError(`Requires ${needed}`);
      const member = await fastify.valueSetService.setWording(setCode, request.tenantId, memberCode, { ...body, scope }, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'value_set_member_label', entityId: request.tenantId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `${setCode}/${memberCode}: ${scope} wording${body.localeCode ? ` (${body.localeCode})` : ''} ${body.displayLabel || body.description ? 'set' : 'removed'}`,
      });
      await reply.send(member);
    },
  );

  // - Hide a platform value from this institution's pickers, or show it -
  fastify.put(
    '/value-sets/:setCode/members/:memberCode/hidden',
    {
      schema: {
        params: Type.Object({ setCode: Type.String(), memberCode: Type.String() }),
        body: Type.Object({ hidden: Type.Boolean() }),
        response: { 200: ManagedMemberSchema, 404: ProblemSchema, 422: ProblemSchema },
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const { setCode, memberCode } = request.params as { setCode: string; memberCode: string };
      const { hidden } = request.body as { hidden: boolean };
      const member = await fastify.valueSetService.setHidden(setCode, request.tenantId, memberCode, hidden, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'value_set_member_override', entityId: request.tenantId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `${setCode}/${memberCode}: ${hidden ? 'hidden' : 'shown'}`,
      });
      await reply.send(member);
    },
  );

  // - Back to the platform wording in every language, shown in pickers again -
  fastify.delete(
    '/value-sets/:setCode/members/:memberCode/customisation',
    {
      schema: {
        params: Type.Object({ setCode: Type.String(), memberCode: Type.String() }),
        response: { 200: ManagedMemberSchema, 404: ProblemSchema },
      },
      preHandler: [requirePermission('config:write')],
    },
    async (request, reply) => {
      const { setCode, memberCode } = request.params as { setCode: string; memberCode: string };
      const member = await fastify.valueSetService.clearCustomisation(setCode, request.tenantId, memberCode);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'value_set_member_label', entityId: request.tenantId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: `${setCode}/${memberCode}: platform wording restored`,
      });
      await reply.send(member);
    },
  );
}
