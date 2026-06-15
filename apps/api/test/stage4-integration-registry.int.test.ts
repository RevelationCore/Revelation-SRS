/**
 * Stage 4 — Plugin Registry Runtime APIs
 *
 * Verifies that integration contracts, registrations, and exchanges are
 * manageable through the runtime API with correct tenant isolation,
 * permission enforcement, endpoint safety class rules, health check updates,
 * replay initiation, contract deprecation enforcement, and multiple-registration support.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { startTestApp, type TestApp } from './helpers/test-app.js';

let ctx: TestApp;

beforeAll(async () => {
  ctx = await startTestApp();
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function adminJwt(tenantId?: string) {
  return ctx.makeJwt({ roles: ['tenant-administrator'], tenantId });
}

async function createRegistration(
  opts: {
    contractId?: string;
    transportCode?: string;
    endpointSafetyClass?: string;
    liveTrafficApproved?: boolean;
    replaySupported?: boolean;
    tenantId?: string;
  } = {},
) {
  const jwt = await adminJwt(opts.tenantId);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/integration-registrations',
    headers: { authorization: `Bearer ${jwt}` },
    payload: {
      contractId:          opts.contractId ?? 'exam-scheduling.v1',
      transportCode:       opts.transportCode ?? 'manual-api',
      endpointSafetyClass: opts.endpointSafetyClass ?? 'simulator',
      liveTrafficApproved: opts.liveTrafficApproved ?? false,
      replaySupported:     opts.replaySupported ?? false,
    },
  });
  return res;
}

// ---------------------------------------------------------------------------
// 1. Contract catalogue
// ---------------------------------------------------------------------------

describe('Stage 4 — contract catalogue', () => {
  it('lists all 6 seeded integration contracts', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-contracts',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const contracts = res.json<Array<{ contractId: string }>>();
    expect(contracts.length).toBeGreaterThanOrEqual(6);
    const ids = contracts.map(c => c.contractId);
    expect(ids).toContain('ofs-regulatory-extracts.v1');
    expect(ids).toContain('exam-scheduling.v1');
    expect(ids).toContain('hesa-student-return.{year}');
  });

  it('returns a specific contract by contractId', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-contracts/ofs-regulatory-extracts.v1',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const contract = res.json<{
      contractId: string;
      displayName: string;
      directionCode: string;
      dataClassificationCode: string;
      currentContractVersion: string;
    }>();
    expect(contract.contractId).toBe('ofs-regulatory-extracts.v1');
    expect(contract.displayName).toBe('OfS Regulatory Extracts');
    expect(contract.directionCode).toBe('outbound');
    expect(contract.dataClassificationCode).toBe('regulatory');
    expect(contract.currentContractVersion).toBe('1.0.0');
  });

  it('returns 404 for an unknown contract', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-contracts/does-not-exist.v9',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when caller lacks integration:manage permission', async () => {
    const jwt = await ctx.makeJwt({ roles: ['student'] });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-contracts',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 2. Registration CRUD
// ---------------------------------------------------------------------------

describe('Stage 4 — registration CRUD', () => {
  let registrationId: string;

  it('creates a registration for a known contract', async () => {
    const res = await createRegistration({ contractId: 'exam-scheduling.v1', transportCode: 'manual-api' });
    expect(res.statusCode).toBe(201);
    const reg = res.json<{
      registrationId: string;
      contractId: string;
      transportCode: string;
      enabled: boolean;
      endpointSafetyClass: string;
      liveTrafficApproved: boolean;
      systemManaged: boolean;
    }>();
    expect(reg.contractId).toBe('exam-scheduling.v1');
    expect(reg.transportCode).toBe('manual-api');
    expect(reg.enabled).toBe(false);
    expect(reg.endpointSafetyClass).toBe('simulator');
    expect(reg.liveTrafficApproved).toBe(false);
    expect(reg.systemManaged).toBe(false);
    registrationId = reg.registrationId;
  });

  it('returns 404 when creating a registration for an unknown contract', async () => {
    const res = await createRegistration({ contractId: 'no-such-contract.v99' });
    expect(res.statusCode).toBe(404);
  });

  it('retrieves the registration by ID', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/integration-registrations/${registrationId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ registrationId: string }>().registrationId).toBe(registrationId);
  });

  it('lists registrations and includes the created one', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-registrations',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ registrationId: string }>>();
    expect(list.some(r => r.registrationId === registrationId)).toBe(true);
  });

  it('filters registrations by contractId', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-registrations?contractId=exam-scheduling.v1',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ contractId: string }>>();
    expect(list.every(r => r.contractId === 'exam-scheduling.v1')).toBe(true);
  });

  it('updates registration fields via PATCH', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/integration-registrations/${registrationId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        displayName: 'Updated Exam Scheduling',
        transportCode: 'manual-file',
        replaySupported: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<{ displayName: string; transportCode: string; replaySupported: boolean }>();
    expect(updated.displayName).toBe('Updated Exam Scheduling');
    expect(updated.transportCode).toBe('manual-file');
    expect(updated.replaySupported).toBe(true);
  });

  it('returns 404 when getting a non-existent registration', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-registrations/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 3. Enable / disable
// ---------------------------------------------------------------------------

describe('Stage 4 — enable and disable', () => {
  it('enables a simulator registration (no safety restriction)', async () => {
    const createRes = await createRegistration({ endpointSafetyClass: 'simulator' });
    expect(createRes.statusCode).toBe(201);
    const { registrationId } = createRes.json<{ registrationId: string }>();

    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/enable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ enabled: boolean }>().enabled).toBe(true);
  });

  it('rejects enabling an external-production registration in non-prod without liveTrafficApproved', async () => {
    const createRes = await createRegistration({
      endpointSafetyClass: 'external-production',
      liveTrafficApproved: false,
    });
    expect(createRes.statusCode).toBe(201);
    const { registrationId } = createRes.json<{ registrationId: string }>();

    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/enable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows enabling an external-production registration when liveTrafficApproved is true', async () => {
    const createRes = await createRegistration({
      endpointSafetyClass: 'external-production',
      liveTrafficApproved: true,
    });
    expect(createRes.statusCode).toBe(201);
    const { registrationId } = createRes.json<{ registrationId: string }>();

    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/enable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ enabled: boolean; liveTrafficApproved: boolean }>())
      .toMatchObject({ enabled: true, liveTrafficApproved: true });
  });

  it('allows enabling an external-test registration (test environments are fine)', async () => {
    const createRes = await createRegistration({ endpointSafetyClass: 'external-test' });
    expect(createRes.statusCode).toBe(201);
    const { registrationId } = createRes.json<{ registrationId: string }>();

    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/enable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ enabled: boolean }>().enabled).toBe(true);
  });

  it('disables an enabled registration', async () => {
    const createRes = await createRegistration({ endpointSafetyClass: 'simulator' });
    const { registrationId } = createRes.json<{ registrationId: string }>();
    const jwt = await adminJwt();

    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/enable`,
      headers: { authorization: `Bearer ${jwt}` },
    });

    const disableRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/disable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json<{ enabled: boolean }>().enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Health checks
// ---------------------------------------------------------------------------

describe('Stage 4 — health checks', () => {
  it('records a healthy status and sets lastHealthCheckAt', async () => {
    const createRes = await createRegistration();
    const { registrationId } = createRes.json<{ registrationId: string }>();
    const jwt = await adminJwt();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/health-check`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { statusCode: 'healthy' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<{
      healthStatusCode: string;
      lastHealthCheckAt: string;
      lastSuccessfulExchangeAt: string;
    }>();
    expect(updated.healthStatusCode).toBe('healthy');
    expect(updated.lastHealthCheckAt).not.toBeNull();
    expect(updated.lastSuccessfulExchangeAt).not.toBeNull();
  });

  it('records a degraded status without setting lastSuccessfulExchangeAt', async () => {
    const createRes = await createRegistration();
    const { registrationId } = createRes.json<{ registrationId: string }>();
    const jwt = await adminJwt();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/health-check`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { statusCode: 'degraded' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<{ healthStatusCode: string; lastSuccessfulExchangeAt: string | null }>();
    expect(updated.healthStatusCode).toBe('degraded');
    expect(updated.lastSuccessfulExchangeAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Replay / backfill
// ---------------------------------------------------------------------------

describe('Stage 4 — replay', () => {
  it('rejects replay when replaySupported is false', async () => {
    const createRes = await createRegistration({ replaySupported: false });
    const { registrationId } = createRes.json<{ registrationId: string }>();
    const jwt = await adminJwt();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/replay`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { fromDate: '2026-01-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('creates a replay exchange when replaySupported is true', async () => {
    const createRes = await createRegistration({ replaySupported: true });
    const { registrationId } = createRes.json<{ registrationId: string }>();
    const jwt = await adminJwt();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/replay`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { fromDate: '2026-01-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(201);
    const exchange = res.json<{
      exchangeId: string;
      registrationId: string;
      exchangeTypeCode: string;
      statusCode: string;
      directionCode: string;
    }>();
    expect(exchange.registrationId).toBe(registrationId);
    expect(exchange.exchangeTypeCode).toBe('replay-backfill');
    expect(exchange.statusCode).toBe('requested');
    expect(exchange.directionCode).toBe('inbound');
  });
});

// ---------------------------------------------------------------------------
// 6. Exchange list and get
// ---------------------------------------------------------------------------

describe('Stage 4 — exchange listing', () => {
  let registrationId: string;
  let exchangeId: string;

  beforeAll(async () => {
    // Create a registration with replay support and trigger a replay to generate an exchange
    const createRes = await createRegistration({ replaySupported: true });
    registrationId = createRes.json<{ registrationId: string }>().registrationId;

    const jwt = await adminJwt();
    const replayRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${registrationId}/replay`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { fromDate: '2025-09-01T00:00:00.000Z' },
    });
    exchangeId = replayRes.json<{ exchangeId: string }>().exchangeId;
  });

  it('lists exchanges for the tenant', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-exchanges',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ exchangeId: string }>>();
    expect(list.some(e => e.exchangeId === exchangeId)).toBe(true);
  });

  it('filters exchanges by registrationId', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/integration-exchanges?registrationId=${registrationId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ registrationId: string }>>();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every(e => e.registrationId === registrationId)).toBe(true);
  });

  it('retrieves a specific exchange by ID', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/integration-exchanges/${exchangeId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ exchangeId: string }>().exchangeId).toBe(exchangeId);
  });

  it('returns 404 for a non-existent exchange', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-exchanges/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 7. Tenant isolation
// ---------------------------------------------------------------------------

describe('Stage 4 — tenant isolation', () => {
  let tenant1RegId: string;

  beforeAll(async () => {
    // Create a registration for tenant 1
    const res = await createRegistration({ tenantId: ctx.tenantId });
    expect(res.statusCode).toBe(201);
    tenant1RegId = res.json<{ registrationId: string }>().registrationId;
  });

  it('tenant 2 cannot see tenant 1 registrations', async () => {
    const jwt = await adminJwt(ctx.secondTenantId);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-registrations',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ registrationId: string }>>();
    expect(list.some(r => r.registrationId === tenant1RegId)).toBe(false);
  });

  it('tenant 2 gets 404 when fetching a tenant 1 registration by ID', async () => {
    const jwt = await adminJwt(ctx.secondTenantId);
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/integration-registrations/${tenant1RegId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('tenant 2 cannot enable a tenant 1 registration', async () => {
    const jwt = await adminJwt(ctx.secondTenantId);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/integration-registrations/${tenant1RegId}/enable`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 8. Contract deprecation enforcement
// ---------------------------------------------------------------------------

describe('Stage 4 — contract deprecation', () => {
  beforeAll(async () => {
    // Seed a deprecated contract directly in the test database
    await ctx.db.execute(sql`
      INSERT INTO integration_contract
        (contract_id, display_name, owner_module_code, direction_code, pattern_type,
         current_contract_version, data_classification_code, deprecated_at)
      VALUES
        ('legacy-vle-sync.v0', 'Legacy VLE Sync (deprecated)', 'catalogue', 'outbound',
         'rest-push', '0.9.0', 'operational', '2025-06-01T00:00:00Z')
      ON CONFLICT (contract_id) DO NOTHING
    `);
  });

  it('lists a deprecated contract with deprecatedAt populated', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-contracts/legacy-vle-sync.v0',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const contract = res.json<{ deprecatedAt: string | null; contractId: string }>();
    expect(contract.contractId).toBe('legacy-vle-sync.v0');
    expect(contract.deprecatedAt).not.toBeNull();
  });

  it('rejects creating a registration for a deprecated contract', async () => {
    const res = await createRegistration({ contractId: 'legacy-vle-sync.v0' });
    expect(res.statusCode).toBe(422);
  });

  it('includes deprecatedAt: null on active contracts', async () => {
    const jwt = await adminJwt();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-contracts/exam-scheduling.v1',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ deprecatedAt: string | null }>().deprecatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Multiple registrations per contract per tenant
// ---------------------------------------------------------------------------

describe('Stage 4 — multiple registrations per contract', () => {
  it('allows a tenant to hold two registrations for the same contract', async () => {
    const first = await createRegistration({
      contractId:    'slc-enrolment-exchange.v1',
      transportCode: 'manual-file',
    });
    expect(first.statusCode).toBe(201);

    const second = await createRegistration({
      contractId:    'slc-enrolment-exchange.v1',
      transportCode: 'sftp-push',
    });
    expect(second.statusCode).toBe(201);

    const firstId  = first.json<{ registrationId: string }>().registrationId;
    const secondId = second.json<{ registrationId: string }>().registrationId;
    expect(firstId).not.toBe(secondId);

    const jwt = await adminJwt();
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/integration-registrations?contractId=slc-enrolment-exchange.v1',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const ids = list.json<Array<{ registrationId: string }>>().map(r => r.registrationId);
    expect(ids).toContain(firstId);
    expect(ids).toContain(secondId);
  });
});
