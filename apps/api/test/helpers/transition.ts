import type { EnrolmentStatusCode } from '../../src/platform/enrolment/service.js';

import type { TestApp } from './test-app.js';

/**
 * Changes an enrolment's status through the internal service, as an approved
 * status case or award conferment does. The staff-facing direct routes were
 * retired (docs/decisions/phase-1-gap-closure-decisions.md, D-1); tests that
 * need a status as set-up for something downstream use this instead.
 */
export async function transitionEnrolment(
  ctx: TestApp, enrolmentId: string, status: EnrolmentStatusCode,
  options: { reasonCode?: string; reasonText?: string; validFrom?: Date } = {}, tenantId: string = ctx.tenantId,
): Promise<void> {
  const { validFrom, ...reason } = options;
  await ctx.app.enrolmentService.transitionStatus(enrolmentId, tenantId, status, validFrom ?? new Date(), 'test-transition', reason);
}
