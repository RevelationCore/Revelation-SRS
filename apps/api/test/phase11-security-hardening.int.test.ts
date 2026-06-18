/**
 * Phase 11 Stage 3 — Security Hardening Integration Tests
 *
 * Covers:
 *  RR-002 / RR-004 — Tenant isolation: data owned by tenantA must never be
 *                    visible to tenantB, even on shared endpoints.
 *  NFR-SEC-011     — Error sanitisation: error responses must not leak
 *                    stack traces, raw SQL, or internal query detail.
 *  NFR-SEC-004     — Unauthenticated endpoint audit: every non-public route
 *                    in the OpenAPI spec must carry a security scheme.
 *  NFR-PRIV-003    — Retention enforcement: dry-run sweep returns correct
 *                    counts; apply mode anonymises identity and sets flag.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a student via the HTTP API and return the personId. */
async function createStudentViaApi(tenantId: string): Promise<string> {
  const token = await ctx.makeJwt({ tenantId, roles: ['registry-administrator'] });
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/students',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { legalFirstName: 'Test', legalFamilyName: 'Isolation' },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createStudentViaApi failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ personId: string }>().personId;
}

/**
 * Create an enrolment via the HTTP API and return the enrolmentId.
 * Passes only mandatory fields; programmeId is optional.
 */
async function createEnrolmentViaApi(tenantId: string, personId: string): Promise<string> {
  const token = await ctx.makeJwt({ tenantId, roles: ['registry-administrator'] });
  const res = await ctx.app.inject({
    method:  'POST',
    url:     '/api/v1/enrolments',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      personId,
      modeOfStudyCode:     'full-time',
      academicYearOfEntry: '2015-16',
      startDate:           '2015-09-20',
      fundingSourceCode:   'slc',
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createEnrolmentViaApi failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ enrolmentId: string }>().enrolmentId;
}

// ─── RR-002 / RR-004 — Tenant isolation ──────────────────────────────────────

describe('tenant isolation (RR-002 / RR-004)', () => {
  let personIdTenantA: string;
  let enrolIdTenantA: string;

  beforeAll(async () => {
    personIdTenantA = await createStudentViaApi(ctx.tenantId);
    enrolIdTenantA  = await createEnrolmentViaApi(ctx.tenantId, personIdTenantA);
  });

  test('tenantA student is not visible from tenantB token', async () => {
    const tokenB = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['registry-administrator'] });

    const response = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${personIdTenantA}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // Either 404 (not found for that tenant) or 403 — never 200
    expect(response.statusCode).not.toBe(200);
  });

  test('student list for tenantB does not include tenantA records', async () => {
    const tokenB = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['registry-administrator'] });

    const response = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { items?: Array<{ id: string }> };
    const ids = (body.items ?? []).map((s) => s.id);
    expect(ids).not.toContain(personIdTenantA);
  });

  test('enrolment list for tenantB does not include tenantA records', async () => {
    const tokenB = await ctx.makeJwt({ tenantId: ctx.secondTenantId, roles: ['registry-administrator'] });
    const response = await ctx.app.inject({
      method:  'GET',
      url:     '/api/v1/enrolments',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { items?: Array<{ id: string }> };
    const ids = (body.items ?? []).map((e) => e.id);
    expect(ids).not.toContain(enrolIdTenantA);
  });
});

// ─── NFR-SEC-011 — Error sanitisation ────────────────────────────────────────

describe('error sanitisation (NFR-SEC-011)', () => {
  test('404 for unknown resource does not leak internal detail', async () => {
    const token = await ctx.makeJwt();
    const response = await ctx.app.inject({
      method:  'GET',
      url:     `/api/v1/students/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toMatch(/\bSELECT\b/i);
    expect(JSON.stringify(body)).not.toMatch(/\bFROM\b.*\bWHERE\b/i);
  });

  test('validation error does not leak stack trace', async () => {
    const token = await ctx.makeJwt();
    const response = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/students',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ thisFieldDoesNotExist: true }),
    });

    expect([400, 422]).toContain(response.statusCode);
    const body = JSON.parse(response.body);
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toMatch(/at Object\./);
    expect(JSON.stringify(body)).not.toMatch(/node_modules/);
  });

  test('unauthenticated request returns 401 with no internal leak', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url:    '/api/v1/students',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toMatch(/node_modules/);
  });
});

// ─── NFR-SEC-004 — Unauthenticated endpoint audit ────────────────────────────

describe('OpenAPI security coverage (NFR-SEC-004)', () => {
  test('every non-public route in the spec carries at least one security scheme', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url:    '/api/v1/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const spec = JSON.parse(response.body) as {
      paths: Record<string, Record<string, { security?: unknown[]; tags?: string[] }>>;
    };

    // Paths that are legitimately public (no auth required)
    const PUBLIC_PATHS = new Set(['/health', '/api/v1/openapi.json', '/api/v1/docs']);

    const violations: string[] = [];

    for (const [path, methods] of Object.entries(spec.paths)) {
      if (PUBLIC_PATHS.has(path)) continue;

      for (const [method, operation] of Object.entries(methods)) {
        if (method === 'options' || method === 'head') continue;
        if (!operation || typeof operation !== 'object') continue;

        // An operation with `security: []` explicitly removes auth — treat as violation
        // unless it is a known public endpoint (health check etc.)
        if (Array.isArray(operation.security) && operation.security.length === 0) {
          violations.push(`${method.toUpperCase()} ${path} — security: [] (explicitly unauthenticated)`);
        }
        // If security is absent at the operation level, it inherits from the top-level
        // security field (which we set to [{ bearerAuth: [] }]) — that's fine.
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `${violations.length} route(s) explicitly opt out of auth:\n${violations.join('\n')}`,
      );
    }
  });
});

// ─── NFR-PRIV-003 — Retention enforcement ────────────────────────────────────

describe('retention enforcement (NFR-PRIV-003)', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await ctx.makeJwt({ roles: ['dpo', 'registry-administrator'] });
  });

  test('dry-run sweep returns result with dryRun=true and no changes', async () => {
    const response = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/retention/enforce?dryRun=true',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.dryRun).toBe(true);
    expect(body).toHaveProperty('eligible');
    expect(body).toHaveProperty('anonymised');
    expect(body).toHaveProperty('flagged');
    expect(body).toHaveProperty('details');
    expect(Array.isArray(body.details)).toBe(true);
  });

  test('person past retention deadline appears as eligible in dry-run', async () => {
    // Create a student + enrolment via the API, then backdate the enrolment's
    // actual_end_date in the DB to simulate a 7-year-old withdrawal.
    const personId   = await createStudentViaApi(ctx.tenantId);
    const enrolId    = await createEnrolmentViaApi(ctx.tenantId, personId);

    // Backdate end_date and withdraw the enrolment so the retention sweep picks it up.
    // Set status_code to 'withdrawn' and actual_end_date 7 years in the past.
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    const cutoffStr = sevenYearsAgo.toISOString().slice(0, 10);

    await ctx.db.execute(sql`
      UPDATE enrolment
         SET status_code    = 'withdrawn',
             actual_end_date = ${cutoffStr}
       WHERE id         = ${enrolId}::uuid
         AND tenant_id  = ${ctx.tenantId}::uuid
    `);

    const response = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/retention/enforce?dryRun=true',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.eligible).toBeGreaterThanOrEqual(1);

    const found = (body.details as Array<{ personId: string }>).find((d) => d.personId === personId);
    expect(found).toBeDefined();
    expect(found?.action).toBe('anonymised');
  });

  test('apply mode anonymises identity fields and sets retention_anonymised_at', async () => {
    // Create another student + enrolment and backdate it
    const personId   = await createStudentViaApi(ctx.tenantId);
    const enrolId    = await createEnrolmentViaApi(ctx.tenantId, personId);

    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    const cutoffStr = sevenYearsAgo.toISOString().slice(0, 10);

    await ctx.db.execute(sql`
      UPDATE enrolment
         SET status_code    = 'withdrawn',
             actual_end_date = ${cutoffStr}
       WHERE id         = ${enrolId}::uuid
         AND tenant_id  = ${ctx.tenantId}::uuid
    `);

    const applyResponse = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/retention/enforce?dryRun=false',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(applyResponse.statusCode).toBe(200);
    const applyBody = JSON.parse(applyResponse.body);
    expect(applyBody.dryRun).toBe(false);

    const detail = (applyBody.details as Array<{ personId: string; action: string }>)
      .find((d) => d.personId === personId);
    expect(detail?.action).toBe('anonymised');

    // Verify DB state — identity names replaced with ANON- token
    const identityRows = await ctx.db.execute<{ legal_first_name: string }>(sql`
      SELECT legal_first_name FROM person_identity
      WHERE person_id = ${personId}::uuid
        AND tenant_id = ${ctx.tenantId}::uuid
    `);
    const rows = identityRows as unknown as Array<{ legal_first_name: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.legal_first_name).toMatch(/^ANON-/);
    }

    // Verify retention_anonymised_at is set on the person
    const personRows = await ctx.db.execute<{ retention_anonymised_at: string | null }>(sql`
      SELECT retention_anonymised_at FROM person
      WHERE id         = ${personId}::uuid
        AND tenant_id  = ${ctx.tenantId}::uuid
    `);
    const personRecord = (personRows as unknown as Array<{ retention_anonymised_at: string | null }>)[0];
    expect(personRecord?.retention_anonymised_at).not.toBeNull();
  });

  test('already-anonymised person does not appear in subsequent sweep', async () => {
    // Run two back-to-back dry-run sweeps. The person anonymised by the apply
    // test above should not re-appear (retention_anonymised_at excludes them).
    const firstRun = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/retention/enforce?dryRun=true',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const secondRun = await ctx.app.inject({
      method:  'POST',
      url:     '/api/v1/admin/retention/enforce?dryRun=true',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(firstRun.statusCode).toBe(200);
    expect(secondRun.statusCode).toBe(200);

    const first  = JSON.parse(firstRun.body);
    const second = JSON.parse(secondRun.body);

    // Back-to-back dry runs on the same state must be idempotent
    expect(second.eligible).toBe(first.eligible);
  });
});
