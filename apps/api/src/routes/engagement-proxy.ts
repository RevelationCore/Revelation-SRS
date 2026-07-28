import type { FastifyInstance } from 'fastify';

/**
 * Reverse-proxies /api/v1/engagement/* to the standalone attendance module
 * (modules/attendance). The module is internal-only — it is never exposed
 * through the ingress the way core (api/admin/portal) is — so the browser
 * keeps talking to the same api.example.com origin it always has, and core
 * forwards the request server-side over the cluster-internal network.
 *
 * Auth is re-validated by the module itself (it shares the same JWT/Keycloak
 * configuration via @revelation-srs/auth); this proxy forwards the original
 * Authorization header rather than trying to re-derive trust.
 */
export function engagementProxyRoutes(fastify: FastifyInstance): void {
  fastify.all('/engagement/*', { schema: { hide: true }, config: { skipAuth: true } }, async (request, reply) => {
    // request.url already carries the full incoming path (e.g. /api/v1/engagement/events?x=y)
    // regardless of this route's registration prefix — do not prepend it again.
    const targetUrl = `${fastify.config.attendanceApiUrl}${request.url}`;

    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value !== 'string') continue;
      if (['host', 'content-length', 'connection'].includes(key.toLowerCase())) continue;
      forwardHeaders[key] = value;
    }

    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const res = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
    });

    const responseBody = await res.text();
    void reply.code(res.status);
    const contentType = res.headers.get('content-type');
    if (contentType) void reply.header('content-type', contentType);
    await reply.send(responseBody);
  });
}
