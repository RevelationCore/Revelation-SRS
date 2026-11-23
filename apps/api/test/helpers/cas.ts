import { sql } from 'drizzle-orm';

import type { TestApp } from './test-app.js';

/**
 * BL-198: a CAS is prepared only once every mandatory eligibility check type
 * (value set metadata casMandatory) has been recorded. Records each as a pass.
 */
export async function recordRequiredCasChecks(ctx: TestApp, casCaseId: string, jwt: string): Promise<string[]> {
  const types = (await ctx.db.execute(sql`SELECT m.code FROM value_set_member m JOIN value_set vs ON vs.id = m.value_set_id
    WHERE vs.set_code = 'cas-eligibility-check-type-code' AND (m.source_metadata->>'casMandatory')::boolean IS TRUE ORDER BY m.sort_order`) as unknown as Array<{ code: string }>).map((r) => r.code);
  for (const checkTypeCode of types) {
    const res = await ctx.app.inject({
      method: 'POST', url: `/api/v1/regulatory/cas-cases/${casCaseId}/eligibility-checks`, headers: { authorization: `Bearer ${jwt}` },
      payload: { guidanceVersion: 'Student sponsor guidance 10/2026', checkTypeCode, resultCode: 'pass' },
    });
    if (res.statusCode !== 201) throw new Error(`recordRequiredCasChecks: ${checkTypeCode} ${res.statusCode} ${res.body}`);
  }
  return types;
}
