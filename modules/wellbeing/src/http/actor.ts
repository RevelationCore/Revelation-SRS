import type { FastifyReply } from 'fastify';

import { sendProblem } from './problem.js';

/**
 * The acting user comes from the token, never the request (ADR-028, the
 * engineering pattern for the acting user). A client that still names its
 * own reviewer, assessor or decider is refused rather than silently
 * ignored, so old callers fail loudly.
 */
export function actorFieldSent(body: unknown, field: string): boolean {
  return typeof body === 'object' && body !== null && field in body;
}

export function refuseActorField(reply: FastifyReply, field: string) {
  return sendProblem(reply, 400, `${field} is not accepted: the signed-in user is recorded as the actor`, { title: 'Actor taken from the token' });
}
