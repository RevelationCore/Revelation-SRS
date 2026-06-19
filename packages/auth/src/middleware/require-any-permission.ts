import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { Permission } from '@revelation-srs/domain';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

/**
 * Allows the request if the user holds ANY of the listed permissions.
 * Use for routes accessible to multiple distinct roles.
 */
export function requireAnyPermission(...permissions: Permission[]): preHandlerHookHandler {
  return function checkAnyPermission(
    request: FastifyRequest,
    _reply:  FastifyReply,
    done,
  ): void {
    if (permissions.some((p) => hasPermission(request.user.roles, p))) {
      done();
      return;
    }

    done(new ForbiddenError(
      `Role(s) ${request.user.roles.join(', ')} do not have any of: ${permissions.join(', ')}`,
    ));
  };
}
