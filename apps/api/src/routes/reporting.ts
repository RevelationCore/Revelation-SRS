import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

// eslint-disable-next-line @typescript-eslint/require-await
export async function reportingRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /reporting/enrolment-volumes ────────────────────────────────────────
  fastify.get(
    '/reporting/enrolment-volumes',
    {
      schema: {
        summary: 'Enrolment volume aggregate',
        description: 'Returns server-side aggregate counts of current enrolments grouped by status, mode of study, academic year of entry, and programme.',
        tags: ['Reporting'],
        response: {
          200: Type.Object({
            total:         Type.Number(),
            byStatus:      Type.Record(Type.String(), Type.Number()),
            byMode:        Type.Record(Type.String(), Type.Number()),
            byYearOfEntry: Type.Record(Type.String(), Type.Record(Type.String(), Type.Number())),
            byProgramme:   Type.Array(Type.Object({
              programmeId:   Type.String(),
              programmeCode: Type.Union([Type.String(), Type.Null()]),
              programmeName: Type.Union([Type.String(), Type.Null()]),
              count:         Type.Number(),
            })),
            generatedAt:   Type.String(),
          }),
        },
      },
      preHandler: [requirePermission('enrolment:read:all')],
    },
    async (request, reply) => {
      const volumes = await fastify.enrolmentService.enrolmentVolumes(request.tenantId);
      return reply.send({
        ...volumes,
        generatedAt: volumes.generatedAt.toISOString(),
      });
    },
  );
}
