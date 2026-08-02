import { and, desc, eq } from 'drizzle-orm';
import { auditRecords } from '@revelation-srs/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;
let jwt: string;
let dpoJwt: string;

beforeAll(async () => {
  ctx    = await startTestApp();
  jwt    = await ctx.makeJwt();
  dpoJwt = await ctx.makeJwt({ roles: ['dpo'] });
}, 120_000);

afterAll(async () => { await ctx?.teardown(); });

describe('Audit hash-chaining & review (BPR-D19)', () => {
  it('chains each new audit record to the previous one for the same tenant', async () => {
    // Two writes that both go through AuditService.record() via the students route.
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Chain', legalFamilyName: 'One' },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { legalFirstName: 'Chain', legalFamilyName: 'Two' },
    });
    expect(second.statusCode).toBe(201);

    const rows = await ctx.db.select().from(auditRecords)
      .where(and(eq(auditRecords.tenantId, ctx.tenantId as `${string}-${string}-${string}-${string}-${string}`)))
      .orderBy(desc(auditRecords.occurredAt))
      .limit(2);

    expect(rows).toHaveLength(2);
    const [newest, previous] = rows;
    expect(newest?.recordHash).toBeTruthy();
    expect(previous?.recordHash).toBeTruthy();
    expect(newest?.previousRecordHash).toBe(previous?.recordHash);
  });

  it('seals a partition and opens a review case with a finding', async () => {
    const seal = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/audit-review/seal',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { rangeStart: '2020-01-01T00:00:00.000Z', rangeEnd: new Date().toISOString() },
    });
    expect(seal.statusCode).toBe(201);

    const openCase = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/audit-review/cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { ownerId: 'dpo-01' },
    });
    expect(openCase.statusCode).toBe(201);
    const { auditReviewCaseId } = openCase.json<{ auditReviewCaseId: string }>();

    const [someAuditRow] = await ctx.db.select({ id: auditRecords.id }).from(auditRecords)
      .where(eq(auditRecords.tenantId, ctx.tenantId as `${string}-${string}-${string}-${string}-${string}`))
      .limit(1);
    expect(someAuditRow).toBeTruthy();

    const finding = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/audit-review/cases/${auditReviewCaseId}/findings`,
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { auditRecordId: someAuditRow!.id, findingTypeCode: 'no-concern', description: 'Routine review, nothing found' },
    });
    expect(finding.statusCode).toBe(201);
  });

  it('404s adding a finding to an unknown review case', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/audit-review/cases/00000000-0000-0000-0000-000000000000/findings',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { auditRecordId: '00000000-0000-0000-0000-000000000000', findingTypeCode: 'no-concern' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('lists review cases so staff can browse open work', async () => {
    const openCase = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/audit-review/cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
      payload: { ownerId: 'dpo-03' },
    });
    expect(openCase.statusCode).toBe(201);
    const { auditReviewCaseId } = openCase.json<{ auditReviewCaseId: string }>();

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/audit-review/cases',
      headers: { authorization: `Bearer ${dpoJwt}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<Array<{ auditReviewCaseId: string; ownerId: string; statusCode: string }>>())
      .toContainEqual(expect.objectContaining({ auditReviewCaseId, ownerId: 'dpo-03', statusCode: 'open' }));
  });
});
