import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';

/**
 * RFC 9457 problem details, the error shape the core API uses. `error`
 * repeats `detail` for clients written against the module's earlier
 * `{ error }` bodies.
 */
export interface Problem {
  type:     string;
  title:    string;
  status:   number;
  detail:   string;
  instance: string;
  error:    string;
  [extra: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Content',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
};

export function problem(status: number, detail: string, instance: string, extra: Record<string, unknown> = {}): Problem {
  return { type: 'about:blank', title: TITLES[status] ?? 'Error', status, detail, instance, error: detail, ...extra };
}

/** Sends a problem+json response. */
export function sendProblem(reply: FastifyReply, status: number, detail: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).type('application/problem+json').send(problem(status, detail, reply.request.url, extra));
}

/**
 * Every error leaves as problem+json: schema validation failures as 400,
 * errors carrying a 4xx statusCode as that status, anything else as a 500
 * whose detail reveals nothing.
 */
export function registerProblemHandlers(fastify: FastifyInstance): void {
  fastify.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.validation) {
      return sendProblem(reply, 400, err.message, { validation: err.validation });
    }
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      request.log.error({ err }, 'Unhandled error');
      return sendProblem(reply, 500, 'An unexpected error occurred');
    }
    return sendProblem(reply, status, err.message);
  });

  fastify.setNotFoundHandler((request, reply) => sendProblem(reply, 404, `Route ${request.method} ${request.url} not found`));
}
