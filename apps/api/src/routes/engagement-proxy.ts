import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Reverse-proxies /api/v1/engagement/* to the standalone attendance module
 * (modules/attendance). The module is internal-only — it is never exposed
 * through the ingress the way core (api/admin/portal) is — so the browser
 * keeps talking to the same api.example.com origin it always has, and core
 * forwards the request server-side over the cluster-internal network.
 *
 * Hardened in the enterprise readiness plan, item 1.8:
 * - Core authenticates the caller first (the JWT hook runs on this route), so
 *   an anonymous request never reaches the module. The module re-validates
 *   the forwarded token itself.
 * - Only an allow-list of request headers is forwarded (no cookies, no
 *   forwarding headers a caller could forge), and an allow-list of response
 *   headers comes back.
 * - The body is streamed through untouched, so JSON and multipart arrive
 *   byte for byte, up to a size limit (413 beyond it).
 * - The upstream call times out (504); an unreachable module is a 502.
 */

export const ENGAGEMENT_PROXY_BODY_LIMIT = 25 * 1024 * 1024;
export const ENGAGEMENT_PROXY_TIMEOUT_MS = 15_000;

const FORWARD_REQUEST_HEADERS = [
  'authorization', 'content-type', 'accept', 'accept-language', 'idempotency-key',
  'if-match', 'if-none-match', 'x-correlation-id', 'x-request-id',
];
const RETURN_RESPONSE_HEADERS = [
  'content-type', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'location', 'retry-after',
];

class BodyTooLargeError extends Error {}

function problem(reply: FastifyReply, status: number, title: string, detail: string) {
  return reply.code(status).type('application/problem+json').send({
    type: 'about:blank', title, status, detail, instance: reply.request.url,
  });
}

/** Passes bytes through, failing once more than `limit` have gone by. */
function limitBytes(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      seen += chunk.length;
      if (seen > limit) done(new BodyTooLargeError(`Request body exceeds ${limit} bytes`));
      else done(null, chunk);
    },
  });
}

export function engagementProxyRoutes(
  fastify: FastifyInstance,
  opts: { timeoutMs?: number; bodyLimit?: number } = {},
): void {
  const timeoutMs = opts.timeoutMs ?? ENGAGEMENT_PROXY_TIMEOUT_MS;
  const bodyLimit = opts.bodyLimit ?? ENGAGEMENT_PROXY_BODY_LIMIT;

  // In this plugin's scope only: hand the raw request stream to the handler
  // instead of parsing it, whatever the content type.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', (_request, payload, done) => { done(null, payload); });

  fastify.all('/engagement/*', { schema: { hide: true } }, async (request, reply) => {
    // request.url already carries the full incoming path (e.g. /api/v1/engagement/events?x=y)
    // regardless of this route's registration prefix — do not prepend it again.
    const targetUrl = `${fastify.config.attendanceApiUrl}${request.url}`;

    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > bodyLimit) return problem(reply, 413, 'Payload Too Large', `Request body exceeds ${bodyLimit} bytes`);

    const headers: Record<string, string> = {};
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }

    const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body instanceof Readable;
    const limited = hasBody ? (request.body as Readable).pipe(limitBytes(bodyLimit)) : undefined;
    let tooLarge = false;
    limited?.on('error', (err) => { if (err instanceof BodyTooLargeError) tooLarge = true; });

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: request.method,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        ...(limited ? { body: Readable.toWeb(limited), duplex: 'half' } : {}),
      } as RequestInit);
    } catch (err) {
      if (tooLarge) return problem(reply, 413, 'Payload Too Large', `Request body exceeds ${bodyLimit} bytes`);
      if ((err as Error).name === 'TimeoutError') {
        return problem(reply, 504, 'Gateway Timeout', `The attendance service did not answer within ${timeoutMs} ms`);
      }
      request.log.warn({ err }, 'engagement proxy: attendance service unreachable');
      return problem(reply, 502, 'Bad Gateway', 'The attendance service could not be reached');
    }

    void reply.code(res.status);
    for (const name of RETURN_RESPONSE_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) void reply.header(name, value);
    }
    if (!res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as WebReadableStream));
  });
}
