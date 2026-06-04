import { ForbiddenError, hasPermission } from '@revelation-srs/domain';
import type { Permission } from '@revelation-srs/domain';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

/**
 * Route-level permission guard.
 *
 * Usage:
 *   fastify.get('/students', {
 *     preHandler: [requirePermission('student:read:all')],
 *     handler: ...
 *   });
 */
export function requirePermission(permission: Permission): preHandlerHookHandler {
  return function checkPermission(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): void {
    if (!hasPermission(request.user.roles, permission)) {
      throw new ForbiddenError(
        `Role(s) ${request.user.roles.join(', ')} do not have permission '${permission}'`,
      );
    }
  };
}
