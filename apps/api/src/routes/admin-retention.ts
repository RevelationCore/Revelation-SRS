import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

const RetentionDetailSchema = Type.Object({
  personId: Type.String(),
  action:   Type.Union([
    Type.Literal('anonymised'),
    Type.Literal('flagged-for-dpo'),
    Type.Literal('skipped-award-hold'),
  ]),
  reason: Type.Optional(Type.String()),
});

const RetentionSweepResultSchema = Type.Object({
  tenantId:   Type.String(),
  dryRun:     Type.Boolean(),
  checkedAt:  Type.String(),
  eligible:   Type.Number(),
  anonymised: Type.Number(),
  flagged:    Type.Number(),
  skipped:    Type.Number(),
  details:    Type.Array(RetentionDetailSchema),
});

// eslint-disable-next-line @typescript-eslint/require-await
export async function adminRetentionRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /admin/retention/enforce ─────────────────────────────────────────
  //
  // Trigger a retention enforcement sweep for the caller's tenant.
  // ?dryRun=true  (default) — returns counts/details without making any changes.
  // ?dryRun=false           — applies irreversible anonymisation to eligible records.
  //
  // Requires permission: retention:enforce

  fastify.post(
    '/admin/retention/enforce',
    {
      schema: {
        summary:     'Retention enforcement sweep',
        description: 'Run a data retention sweep for the tenant. In dry-run mode (default), identifies eligible persons and returns counts without making changes. Set dryRun=false to apply irreversible anonymisation.',
        tags:        ['Admin', 'Privacy'],
        querystring: Type.Object({
          dryRun: Type.Optional(Type.Boolean({ default: true })),
        }),
        response: {
          200: RetentionSweepResultSchema,
        },
      },
      preHandler: [requirePermission('retention:enforce')],
    },
    async (request, reply) => {
      const { dryRun = true } = request.query as { dryRun?: boolean };
      const result = await fastify.retentionService.runRetentionSweep(request.tenantId, dryRun);
      return reply.send(result);
    },
  );
}
