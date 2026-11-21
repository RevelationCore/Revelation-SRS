import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@revelation-srs/domain';
import { tenants } from '@revelation-srs/db';
import { eq } from 'drizzle-orm';
import { fetchWithTimeout } from '@revelation-srs/auth';

import { addClosureDay, type GovUkBankHolidays, importBankHolidays, listNonWorkingDays } from '../platform/calendar/working-days.js';

const ErrorSchema = Type.Object({ type: Type.String(), title: Type.String(), status: Type.Number(), detail: Type.Optional(Type.String()) });
const DaySchema = Type.Object({
  id: Type.String(), date: Type.String(), divisionCode: Type.String(), description: Type.String(), source: Type.String(), createdBy: Type.String(), createdAt: Type.String(),
});
const GOV_UK_URL = 'https://www.gov.uk/bank-holidays.json';

/**
 * The working-day calendar for statutory deadlines (Phase 5 D-42): bank
 * holidays by division, from the GOV.UK file, and the institution's own
 * closure days.
 */
export function nonWorkingDayRoutes(fastify: FastifyInstance): void {
  fastify.get('/calendar/non-working-days', {
    schema: {
      querystring: Type.Object({ from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), divisionCode: Type.Optional(Type.String()) }),
      response: { 200: Type.Array(DaySchema) },
    },
    preHandler: [requirePermission('calendar:read')],
  }, async (request, reply) => {
    const rows = await listNonWorkingDays(fastify.db, request.tenantId, request.query as { from?: string; to?: string; divisionCode?: string });
    await reply.send(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  });

  // The GOV.UK bank-holidays.json, uploaded; or, with calendar.bankHolidays.source 'gov-uk' and no body, fetched from GOV.UK.
  fastify.post('/calendar/non-working-days/import', {
    schema: {
      body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      response: { 200: Type.Object({ imported: Type.Number(), source: Type.String() }), 422: ErrorSchema, 502: ErrorSchema },
    },
    preHandler: [requirePermission('calendar:write')],
  }, async (request, reply) => {
    let data = request.body as GovUkBankHolidays | undefined;
    let source = 'upload';
    if (!data || Object.keys(data).length === 0) {
      const [row] = await fastify.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, request.tenantId as `${string}-${string}-${string}-${string}-${string}`)).limit(1);
      const cfg = (((row?.configuration?.['calendar'] ?? {}) as Record<string, unknown>)['bankHolidays'] ?? {}) as Record<string, unknown>;
      if (cfg['source'] !== 'gov-uk') throw new ValidationError('Upload the GOV.UK bank-holidays.json, or set calendar.bankHolidays.source to gov-uk to fetch it');
      const res = await fetchWithTimeout(GOV_UK_URL);
      if (!res.ok) { await reply.code(502).send({ type: 'about:blank', title: 'Bad Gateway', status: 502, detail: `GOV.UK returned ${res.status}` }); return; }
      data = await res.json() as GovUkBankHolidays;
      source = 'gov-uk';
    }
    const result = await importBankHolidays(fastify.db, request.tenantId, data, request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId, entityType: 'non_working_day', entityId: request.tenantId, actionType: 'create', actorType: 'user',
      actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Imported ${result.imported} bank holidays (${source})`,
    });
    await reply.send({ ...result, source });
  });

  fastify.post('/calendar/non-working-days', {
    schema: {
      body: Type.Object({ date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), description: Type.String({ minLength: 1, maxLength: 200 }) }),
      response: { 201: DaySchema, 422: ErrorSchema },
    },
    preHandler: [requirePermission('calendar:write')],
  }, async (request, reply) => {
    const row = await addClosureDay(fastify.db, request.tenantId, request.body as { date: string; description: string }, request.user.sub);
    await fastify.audit.record({
      tenantId: request.tenantId, entityType: 'non_working_day', entityId: row.id, actionType: 'create', actorType: 'user',
      actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Closure day ${row.date}`,
    });
    await reply.code(201).send({ ...row, createdAt: row.createdAt.toISOString() });
  });
}
