import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { Permission } from '@revelation-srs/domain';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

/**
 * Allows the request if:
 *   1. The user holds `allPermission` (staff), OR
 *   2. The user holds `ownPermission` (student) AND the route's :personId
 *      param matches the caller's own srsPersonId JWT claim.
 *
 * Use for routes that staff can call on any student but students can only
 * call on themselves.
 */
export function requireSelfOrPermission(
  ownPermission: Permission,
  allPermission:  Permission,
): preHandlerHookHandler {
  return function checkSelfOrPermission(
    request: FastifyRequest,
    _reply:  FastifyReply,
    done,
  ): void {
    if (hasPermission(request.user.roles, allPermission)) {
      done();
      return;
    }

    if (hasPermission(request.user.roles, ownPermission)) {
      const params    = request.params as Record<string, string>;
      const personId  = params['personId'];
      if (personId && personId === request.user.srsPersonId) {
        done();
        return;
      }
    }

    done(new ForbiddenError(
      `Role(s) ${request.user.roles.join(', ')} do not have permission '${allPermission}'`,
    ));
  };
}
