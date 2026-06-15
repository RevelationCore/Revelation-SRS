import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startTestApp, type TestWellbeingApp } from './helpers/test-db.js';

let ctx: TestWellbeingApp;

const PERSON_ID  = '11111111-0000-0000-0000-000000000001';
const PERSON_ID2 = '11111111-0000-0000-0000-000000000002';

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
});

// ── Case creation ─────────────────────────────────────────────────────────────

describe('Stage 3 — POST /api/v1/disability-cases', () => {
  it('creates a wellbeing case + disability support case and returns 201', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        personId:        PERSON_ID,
        supportTypeCode: 'dsa',
        notes:           'Initial DSA referral',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; wellbeingCaseId: string }>();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.wellbeingCaseId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 401 without a JWT', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      payload: { personId: PERSON_ID, supportTypeCode: 'dsa' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('default statusCode is assessment_pending', async () => {
    const createRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: PERSON_ID, supportTypeCode: 'institutional' },
    });

    const { id } = createRes.json<{ id: string }>();

    const getRes = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${id}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    const detail = getRes.json<{ statusCode: string }>();
    expect(detail.statusCode).toBe('assessment_pending');
  });
});

// ── Case list ─────────────────────────────────────────────────────────────────

describe('Stage 3 — GET /api/v1/disability-cases?personId=', () => {
  let caseId: string;

  beforeAll(async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: PERSON_ID2, supportTypeCode: 'dsa' },
    });
    caseId = res.json<{ id: string }>().id;
  });

  it('returns cases for the given personId', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases?personId=${PERSON_ID2}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; personId: string }> }>();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((c) => c.personId === PERSON_ID2)).toBe(true);
    expect(body.items.some((c) => c.id === caseId)).toBe(true);
  });

  it('returns empty list for a person with no cases', async () => {
    const unknownPerson = '99999999-0000-0000-0000-000000000001';
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases?personId=${unknownPerson}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it('returns 400 when personId is missing', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Case detail and audit ─────────────────────────────────────────────────────

describe('Stage 3 — GET /api/v1/disability-cases/:caseId', () => {
  let caseId: string;

  beforeAll(async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        personId:        PERSON_ID,
        supportTypeCode: 'dsa',
        dsaAwardRef:     'DSA-2026-001',
      },
    });
    caseId = res.json<{ id: string }>().id;
  });

  it('returns case detail with 200', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      id: string; dsaAwardRef: string; evidence: unknown[]; entitlements: unknown[];
    }>();
    expect(body.id).toBe(caseId);
    expect(body.dsaAwardRef).toBe('DSA-2026-001');
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(Array.isArray(body.entitlements)).toBe(true);
  });

  it('creates an audit_log entry on read', async () => {
    await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ sub: 'auditor-001' })}` },
    });

    const rows = await ctx.db.execute(sql`
      SELECT * FROM wellbeing.audit_log
      WHERE  resource_type = 'disability-case'
        AND  resource_id   = ${caseId}::uuid
        AND  action_code   = 'read'
        AND  actor_id      = 'auditor-001'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for an unknown case', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/disability-cases/00000000-dead-dead-dead-000000000000',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Status transition ─────────────────────────────────────────────────────────

describe('Stage 3 — PATCH /api/v1/disability-cases/:caseId/status', () => {
  let caseId: string;

  beforeAll(async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: PERSON_ID, supportTypeCode: 'dsa' },
    });
    caseId = res.json<{ id: string }>().id;
  });

  it('transitions status and returns 204', async () => {
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/disability-cases/${caseId}/status`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { statusCode: 'active' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('new status is visible via GET', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    expect(res.json<{ statusCode: string }>().statusCode).toBe('active');
  });

  it('bitemporal: old version is preserved in the database', async () => {
    // Two versions exist: original (recorded_until set) + new (recorded_until NULL)
    const rows = await ctx.db.execute(sql`
      SELECT count(*) AS cnt
      FROM   wellbeing.disability_support_case
      WHERE  id = ${caseId}::uuid
    `);
    expect(Number(rows[0]?.['cnt'])).toBe(2);
  });

  it('creates a write audit entry on status transition', async () => {
    const rows = await ctx.db.execute(sql`
      SELECT * FROM wellbeing.audit_log
      WHERE  resource_type = 'disability-case'
        AND  resource_id   = ${caseId}::uuid
        AND  action_code   = 'write'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(2); // create + status-transition
  });

  it('returns 404 when transitioning a non-existent case', async () => {
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     '/api/v1/disability-cases/00000000-dead-dead-dead-000000000000/status',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { statusCode: 'active' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Evidence references ───────────────────────────────────────────────────────

describe('Stage 3 — evidence reference lifecycle', () => {
  let caseId:     string;
  let evidenceId: string;

  beforeAll(async () => {
    const caseRes = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: PERSON_ID, supportTypeCode: 'dsa' },
    });
    caseId = caseRes.json<{ id: string }>().id;
  });

  it('POST /evidence registers evidence and returns an EDRMS document ref', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/disability-cases/${caseId}/evidence`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        evidenceTypeCode: 'medical',
        filename:         'gp-letter.pdf',
        contentType:      'application/pdf',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ evidenceId: string; documentRef: string; documentUrl: string }>();
    expect(body.evidenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.documentRef).toBeTruthy();
    expect(body.documentUrl).toBeTruthy();
    evidenceId = body.evidenceId;
  });

  it('evidence appears in case detail', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    const evidence = res.json<{ evidence: Array<{ id: string; statusCode: string }> }>().evidence;
    const ev = evidence.find((e) => e.id === evidenceId);
    expect(ev).toBeDefined();
    expect(ev?.statusCode).toBe('pending');
  });

  it('PATCH /evidence/:id/status updates the status to received', async () => {
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     `/api/v1/evidence/${evidenceId}/status`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { statusCode: 'received' },
    });
    expect(res.statusCode).toBe(204);
  });

  it('updated status is visible via case detail', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });
    const evidence = res.json<{ evidence: Array<{ id: string; statusCode: string }> }>().evidence;
    const ev = evidence.find((e) => e.id === evidenceId);
    expect(ev?.statusCode).toBe('received');
  });

  it('returns 404 when updating evidence for an unknown case', async () => {
    const res = await ctx.app.inject({
      method:  'PATCH',
      url:     '/api/v1/evidence/00000000-dead-dead-dead-000000000000/status',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { statusCode: 'verified' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── DSA entitlements ──────────────────────────────────────────────────────────

describe('Stage 3 — DSA entitlement management', () => {
  let caseId:        string;
  let entitlementId: string;

  beforeAll(async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: { personId: PERSON_ID, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-2026-002' },
    });
    caseId = res.json<{ id: string }>().id;
  });

  it('POST /dsa-entitlements creates an entitlement and returns 201', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     `/api/v1/disability-cases/${caseId}/dsa-entitlements`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        entitlementTypeCode: 'equipment',
        providerRef:         'EQUIP-001',
        effectiveFrom:       '2026-06-15',
        approvedBy:          'disability-advisor-001',
      },
    });

    expect(res.statusCode).toBe(201);
    entitlementId = res.json<{ id: string }>().id;
    expect(entitlementId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /dsa-entitlements lists the entitlement', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}/dsa-entitlements`,
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; entitlementTypeCode: string }> }>();
    const e = body.items.find((i) => i.id === entitlementId);
    expect(e).toBeDefined();
    expect(e?.entitlementTypeCode).toBe('equipment');
  });

  it('creates a read-audit entry when listing entitlements', async () => {
    await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${caseId}/dsa-entitlements`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ sub: 'auditor-002' })}` },
    });

    const rows = await ctx.db.execute(sql`
      SELECT * FROM wellbeing.audit_log
      WHERE  resource_type = 'dsa-entitlement'
        AND  action_code   = 'read'
        AND  actor_id      = 'auditor-002'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 when adding an entitlement to an unknown case', async () => {
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases/00000000-dead-dead-dead-000000000000/dsa-entitlements',
      headers: { authorization: `Bearer ${ctx.makeJwt()}` },
      payload: {
        entitlementTypeCode: 'equipment',
        effectiveFrom:       '2026-06-15',
        approvedBy:          'advisor-001',
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('Stage 3 — tenant isolation', () => {
  let tenant1CaseId: string;

  beforeAll(async () => {
    // Create a case in tenant 1
    const res = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${ctx.makeJwt({ tenantId: ctx.tenantId })}` },
      payload: { personId: PERSON_ID, supportTypeCode: 'dsa' },
    });
    tenant1CaseId = res.json<{ id: string }>().id;
  });

  it('GET for tenant 2 cannot retrieve tenant 1 case', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases/${tenant1CaseId}`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ tenantId: ctx.secondTenantId })}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('list for tenant 2 does not include tenant 1 cases', async () => {
    const res = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/disability-cases?personId=${PERSON_ID}`,
      headers: { authorization: `Bearer ${ctx.makeJwt({ tenantId: ctx.secondTenantId })}` },
    });
    const items = res.json<{ items: Array<{ id: string }> }>().items;
    expect(items.some((c) => c.id === tenant1CaseId)).toBe(false);
  });
});
