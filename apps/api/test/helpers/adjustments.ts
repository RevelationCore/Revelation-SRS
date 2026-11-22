import { randomUUID } from 'node:crypto';

import { wellbeingServiceClientId } from '@revelation-srs/auth';

import type { TestApp } from './test-app.js';

/**
 * ADR-033 (BL-376): only the wellbeing service records a core adjustment,
 * naming the case that approved it. Tests create adjustments that way.
 */
export function wellbeingServiceJwt(ctx: TestApp, tenantId = ctx.tenantId): Promise<string> {
  return ctx.makeJwt({ sub: 'service-account-srs-wellbeing', name: null, roles: ['wellbeing-service'], tenantId, azp: wellbeingServiceClientId(tenantId) });
}

/** Records an adjustment as the wellbeing hand-off would, with a random case unless one is given. */
export async function recordApprovedAdjustment(
  ctx: TestApp,
  personId: string,
  body: Record<string, unknown>,
  opts: { sourceCaseId?: string; idempotencyKey?: string; tenantId?: string } = {},
): Promise<{ adjustmentId: string }> {
  const res = await ctx.app.inject({
    method: 'POST', url: `/api/v1/students/${personId}/adjustments`,
    headers: { authorization: `Bearer ${await wellbeingServiceJwt(ctx, opts.tenantId)}`, ...(opts.idempotencyKey ? { 'x-idempotency-key': opts.idempotencyKey } : {}) },
    payload: { sourceCaseId: opts.sourceCaseId ?? randomUUID(), ...body },
  });
  if (res.statusCode !== 201 && res.statusCode !== 200) throw new Error(`recordApprovedAdjustment: ${res.statusCode} ${res.body}`);
  return res.json<{ adjustmentId: string }>();
}
