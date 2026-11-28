import { randomUUID } from 'node:crypto';

import { wellbeingServiceClientId } from '@revelation-srs/auth';
import { sql } from 'drizzle-orm';

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

/**
 * ADR-034 (BL-406): ends an adjustment early as its wellbeing case would,
 * through the withdrawal hand-off, naming the case that recorded it.
 */
export async function withdrawApprovedAdjustment(
  ctx: TestApp,
  adjustmentId: string,
  opts: { reasonCode?: string; replacementAdjustmentId?: string; tenantId?: string } = {},
): Promise<{ statusCode: number; json: <T>() => T }> {
  const [row] = await ctx.db.execute(sql`SELECT person_id::text AS person_id, source_case_id::text AS source_case_id
    FROM reasonable_adjustment WHERE id = ${adjustmentId}::uuid AND recorded_until IS NULL`) as unknown as Array<{ person_id: string; source_case_id: string | null }>;
  if (!row?.source_case_id) throw new Error(`withdrawApprovedAdjustment: ${adjustmentId} has no current version from a wellbeing case`);
  return ctx.app.inject({
    method: 'POST', url: `/api/v1/students/${row.person_id}/adjustments/${adjustmentId}/withdrawal`,
    headers: { authorization: `Bearer ${await wellbeingServiceJwt(ctx, opts.tenantId)}` },
    payload: {
      sourceCaseId: row.source_case_id, withdrawalReasonCode: opts.reasonCode ?? 'no-longer-needed',
      ...(opts.replacementAdjustmentId ? { replacementAdjustmentId: opts.replacementAdjustmentId } : {}),
    },
  });
}
