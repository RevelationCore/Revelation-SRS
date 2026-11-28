import { bindServiceRoles, wellbeingServiceClientId } from '@revelation-srs/auth';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from './helpers/test-app.js';

/**
 * ADR-029 (BL-234, guard BL-332): the wellbeing service's two hand-offs to
 * core. The wellbeing-service role counts only from the tenant's own
 * srs-wellbeing-svc-<tenantId> client, on a token that names no person, and
 * grants only adjustment:record-approved and circumstances:record-determined.
 */

let ctx: TestApp;
let registry: string;

beforeAll(async () => {
  ctx = await startTestApp();
  registry = await ctx.makeJwt({ roles: ['registry-administrator'] });
}, 120_000);
afterAll(async () => { await ctx?.teardown(); });

const service = (opts: { tenantId?: string; azp?: string; srsPersonId?: string; roles?: string[] } = {}) => ctx.makeJwt({
  sub: 'service-account-srs-wellbeing', name: null,
  roles: opts.roles ?? ['wellbeing-service'],
  ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  azp: opts.azp ?? wellbeingServiceClientId(opts.tenantId ?? ctx.tenantId),
  ...(opts.srsPersonId ? { srsPersonId: opts.srsPersonId } : {}),
});

async function student(name: string): Promise<{ personId: string; enrolmentId: string }> {
  const s = await ctx.app.inject({ method: 'POST', url: '/api/v1/students', headers: { authorization: `Bearer ${registry}` }, payload: { legalFirstName: name, legalFamilyName: 'Service' } });
  const personId = s.json<{ personId: string }>().personId;
  const e = await ctx.app.inject({ method: 'POST', url: '/api/v1/enrolments', headers: { authorization: `Bearer ${registry}` }, payload: { personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2027-28', startDate: '2027-09-20' } });
  return { personId, enrolmentId: e.json<{ enrolmentId: string }>().enrolmentId };
}

const adjustment = (token: string, f: { personId: string; enrolmentId: string }, extra: Record<string, unknown> = {}) => ctx.app.inject({
  method: 'POST', url: `/api/v1/students/${f.personId}/adjustments`, headers: { authorization: `Bearer ${token}` },
  payload: { enrolmentId: f.enrolmentId, adjustmentTypeCode: 'extra-time', scopeCode: 'exam', validFrom: '2027-09-01T00:00:00.000Z', amount: { value: 25, unitCode: 'percent-of-duration' }, ...extra },
});
const circumstances = (token: string, f: { personId: string; enrolmentId: string }) => ctx.app.inject({
  method: 'POST', url: `/api/v1/students/${f.personId}/exceptional-circumstances`, headers: { authorization: `Bearer ${token}` },
  payload: { enrolmentId: f.enrolmentId, outcomeCode: 'defer', determinationDate: '2027-11-10' },
});

describe('bindServiceRoles', () => {
  const tenantId = '00000000-0000-0000-0000-0000000000aa';
  it('keeps the role only from the tenant\'s own client, on a token naming no person', () => {
    expect(bindServiceRoles(['wellbeing-service'], { tenantId, azp: wellbeingServiceClientId(tenantId) }).roles).toEqual(['wellbeing-service']);
    expect(bindServiceRoles(['wellbeing-service'], { tenantId, azp: wellbeingServiceClientId('another-tenant') }).dropped).toEqual(['wellbeing-service']);
    expect(bindServiceRoles(['wellbeing-service'], { tenantId, azp: 'srs-admin' }).roles).toEqual([]);
    expect(bindServiceRoles(['wellbeing-service'], { tenantId }).roles).toEqual([]);
    expect(bindServiceRoles(['wellbeing-service'], { tenantId, azp: wellbeingServiceClientId(tenantId), srsPersonId: 'p' }).roles).toEqual([]);
    expect(bindServiceRoles(['student', 'wellbeing-service'], { tenantId, azp: 'srs-portal' }).roles).toEqual(['student']);
  });
});

describe('the two hand-off routes', () => {
  it('accept the wellbeing service from its own client, and audit the client as the actor', async () => {
    const f = await student('Granted');
    const adj = await adjustment(await service(), f, { sourceCaseId: '9a1b2c3d-0000-4000-8000-000000000001' });
    expect(adj.statusCode, adj.body).toBe(201);
    const ec = await circumstances(await service(), f);
    expect(ec.statusCode, ec.body).toBe(201);

    const [row] = await ctx.db.execute(sql`
      SELECT actor_display_name FROM audit_record
      WHERE entity_id = ${adj.json<{ adjustmentId: string }>().adjustmentId}::uuid ORDER BY occurred_at DESC LIMIT 1`) as unknown as Array<{ actor_display_name: string }>;
    expect(row?.actor_display_name).toBe(wellbeingServiceClientId(ctx.tenantId));
  });

  it('require the approving case when the service records an adjustment', async () => {
    const f = await student('NoCase');
    expect((await adjustment(await service(), f)).statusCode).toBe(422);
  });

  it.each([
    ['another tenant\'s client', { azp: wellbeingServiceClientId('00000000-0000-0000-0000-0000000000ff') }],
    ['a browser client', { azp: 'srs-admin' }],
    ['a token that names a person', { srsPersonId: '00000000-0000-0000-0000-0000000000ee' }],
    ['the broad integration role', { roles: ['integration-service'] }],
  ])('refuse %s', async (_label, opts) => {
    const f = await student('Refused');
    expect((await adjustment(await service(opts), f, { sourceCaseId: '9a1b2c3d-0000-4000-8000-000000000002' })).statusCode).toBe(403);
    expect((await circumstances(await service(opts), f)).statusCode).toBe(403);
  });

  it('leave the staff EC path as it was; staff no longer record a core adjustment (ADR-033)', async () => {
    const f = await student('Staff');
    expect((await adjustment(registry, f)).statusCode).toBe(403);
    expect((await circumstances(registry, f)).statusCode).toBe(201);
  });

  it('give the service nothing else, not even reads', async () => {
    const f = await student('NothingElse');
    const res = await ctx.app.inject({ method: 'GET', url: `/api/v1/students/${f.personId}`, headers: { authorization: `Bearer ${await service()}` } });
    expect(res.statusCode).toBe(403);
  });
});
