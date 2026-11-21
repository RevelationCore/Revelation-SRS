import { ForbiddenError, hasPermission, type Permission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Self-service access to an enrolment's records (BL-177).
 *
 * A caller holding `staffPermission` may act on any enrolment in the tenant.
 * Anyone else may act only on an enrolment whose person is the one bound to
 * their token (`srsPersonId`, never `sub`); a caller with no bound person
 * may act on none. Checking a role name, or skipping the check when no
 * person is bound, let a student read or change other students' records.
 */
export async function assertOwnEnrolment(
  fastify:         FastifyInstance,
  request:         FastifyRequest,
  enrolmentId:     string | undefined,
  staffPermission: Permission,
): Promise<void> {
  if (hasPermission(request.user.roles, staffPermission)) return;
  const personId = request.user.srsPersonId;
  if (!personId || !enrolmentId) throw new ForbiddenError('You can only see or change your own records');
  const enrolment = await fastify.enrolmentService.getEnrolment(enrolmentId, request.tenantId);
  if (!enrolment || enrolment.personId !== personId) throw new ForbiddenError('You can only see or change your own records');
}

/** The same check for a module registration, through its enrolment. */
export async function assertOwnRegistration(
  fastify:              FastifyInstance,
  request:              FastifyRequest,
  moduleRegistrationId: string,
  staffPermission:      Permission,
): Promise<void> {
  if (hasPermission(request.user.roles, staffPermission)) return;
  const registration = await fastify.moduleRegistrationService.getRegistration(moduleRegistrationId, request.tenantId);
  await assertOwnEnrolment(fastify, request, registration?.enrolmentId, staffPermission);
}
