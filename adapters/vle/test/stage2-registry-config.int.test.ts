/**
 * Stage 2 — Plugin Registry and Tenant Configuration.
 *
 * Verifies:
 * - assertEndpointAllowed enforces all safety-class and approval rules.
 * - RegistrationLoader fetches, caches, and reflects the latest registration state.
 * - canWrite correctly derives write permission from loaded registration.
 * - effectiveEndpointUrl prefers the registration URL over the config fallback.
 * - HealthReporter posts the correct status code to the registry client.
 * - Auth failure from SRS surfaces as RegistrationAccessError.
 * - Connector app loads registration on startup and decorates the instance.
 * - Re-enable after disable restores canWrite without losing connector state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { RegistrationAccessError } from '../src/registry/client.js';
import {
  EndpointSafetyError,
  assertEndpointAllowed,
} from '../src/registry/endpoint-guard.js';
import { RegistrationLoader }  from '../src/registry/loader.js';
import { HealthReporter }      from '../src/registry/health-reporter.js';

import {
  StubSrsRegistryClient,
  makeRegistration,
} from './helpers/stub-srs-client.js';
import { startTestApp, type TestVleApp } from './helpers/test-app.js';

// ── Suite 1: Endpoint guard ──────────────────────────────────────────────────

describe('Stage 2 — Endpoint guard', () => {
  const enabled = { enabled: true, endpointSafetyClass: 'simulator' as const, liveTrafficApproved: false };

  it('1.1 simulator connector allows simulator registration', () => {
    expect(() => assertEndpointAllowed('simulator', enabled)).not.toThrow();
  });

  it('1.2 external-test connector allows external-test registration', () => {
    expect(() =>
      assertEndpointAllowed('external-test', {
        ...enabled,
        endpointSafetyClass: 'external-test',
      }),
    ).not.toThrow();
  });

  it('1.3 live connector with liveTrafficApproved allows live registration', () => {
    expect(() =>
      assertEndpointAllowed('live', {
        enabled:             true,
        endpointSafetyClass: 'live',
        liveTrafficApproved: true,
      }),
    ).not.toThrow();
  });

  it('1.4 simulator connector blocks external-test registration', () => {
    expect(() =>
      assertEndpointAllowed('simulator', { ...enabled, endpointSafetyClass: 'external-test' }),
    ).toThrow(EndpointSafetyError);
  });

  it('1.5 simulator connector blocks live registration', () => {
    expect(() =>
      assertEndpointAllowed('simulator', {
        enabled:             true,
        endpointSafetyClass: 'live',
        liveTrafficApproved: true,
      }),
    ).toThrow(EndpointSafetyError);
  });

  it('1.6 external-test connector blocks live registration', () => {
    expect(() =>
      assertEndpointAllowed('external-test', {
        enabled:             true,
        endpointSafetyClass: 'live',
        liveTrafficApproved: true,
      }),
    ).toThrow(EndpointSafetyError);
  });

  it('1.7 live registration without liveTrafficApproved is blocked', () => {
    expect(() =>
      assertEndpointAllowed('live', {
        enabled:             true,
        endpointSafetyClass: 'live',
        liveTrafficApproved: false,
      }),
    ).toThrow(EndpointSafetyError);
  });

  it('1.8 disabled registration is always blocked regardless of safety class', () => {
    expect(() =>
      assertEndpointAllowed('simulator', { ...enabled, enabled: false }),
    ).toThrow(EndpointSafetyError);
  });
});

// ── Suite 2: Registration loader ─────────────────────────────────────────────

describe('Stage 2 — Registration loader', () => {
  const REG_ID = '00000000-0000-0000-0000-000000000099';

  it('2.1 load() returns the registration from the client', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);

    const reg = await loader.load();
    expect(reg.registrationId).toBe(REG_ID);
    expect(reg.contractId).toBe('vle-course-provisioning.v1');
    expect(reg.enabled).toBe(true);
  });

  it('2.2 canWrite is false before the first load()', () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);
    expect(loader.canWrite).toBe(false);
  });

  it('2.3 canWrite is true after loading an enabled simulator registration', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);
    await loader.load();
    expect(loader.canWrite).toBe(true);
  });

  it('2.4 canWrite is false when registration is disabled', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID, enabled: false }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);
    await loader.load();
    expect(loader.canWrite).toBe(false);
  });

  it('2.5 canWrite is false when connector safety class is below registration class', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({
      registrationId:      REG_ID,
      endpointSafetyClass: 'external-test',
    }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);
    await loader.load();
    expect(loader.canWrite).toBe(false);
  });

  it('2.6 re-loading after disable reflects updated disabled state', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);

    await loader.load();
    expect(loader.canWrite).toBe(true);

    client.update(REG_ID, { enabled: false });
    await loader.load();
    expect(loader.canWrite).toBe(false);
  });

  it('2.7 re-enabling restores canWrite on next load()', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID, enabled: false }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);

    await loader.load();
    expect(loader.canWrite).toBe(false);

    client.update(REG_ID, { enabled: true });
    await loader.load();
    expect(loader.canWrite).toBe(true);
  });

  it('2.8 load() throws RegistrationAccessError when client returns 403', async () => {
    const client = new StubSrsRegistryClient();
    client.getError = { httpStatus: 403, message: 'Forbidden' };
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);

    await expect(loader.load()).rejects.toThrow(RegistrationAccessError);
    await expect(loader.load()).rejects.toMatchObject({ httpStatus: 403 });
  });

  it('2.9 effectiveEndpointUrl returns registration URL when set', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({
      registrationId: REG_ID,
      endpointUrl:    'https://vle.university.ac.uk',
    }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);
    await loader.load();
    expect(loader.effectiveEndpointUrl('http://fallback.local')).toBe('https://vle.university.ac.uk');
  });

  it('2.10 effectiveEndpointUrl falls back to config when registration URL is null', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID, endpointUrl: null }));
    const loader = new RegistrationLoader(client, 'simulator', REG_ID);
    await loader.load();
    expect(loader.effectiveEndpointUrl('http://fallback.local')).toBe('http://fallback.local');
  });
});

// ── Suite 3: Health reporter ─────────────────────────────────────────────────

describe('Stage 2 — Health reporter', () => {
  const REG_ID = '00000000-0000-0000-0000-000000000099';

  it('3.1 report("healthy") posts correct status to the client', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const reporter = new HealthReporter(client, REG_ID);

    await reporter.report('healthy');

    const checks = client.healthChecks();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toEqual({ registrationId: REG_ID, statusCode: 'healthy' });
  });

  it('3.2 report("degraded") records the degraded status', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const reporter = new HealthReporter(client, REG_ID);

    await reporter.report('degraded');

    expect(client.healthChecks()[0]?.statusCode).toBe('degraded');
  });

  it('3.3 report("unhealthy") records the unhealthy status', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const reporter = new HealthReporter(client, REG_ID);

    await reporter.report('unhealthy');

    expect(client.healthChecks()[0]?.statusCode).toBe('unhealthy');
  });

  it('3.4 multiple report() calls accumulate in order', async () => {
    const client = new StubSrsRegistryClient();
    client.seed(makeRegistration({ registrationId: REG_ID }));
    const reporter = new HealthReporter(client, REG_ID);

    await reporter.report('healthy');
    await reporter.report('degraded');
    await reporter.report('healthy');

    const codes = client.healthChecks().map(h => h.statusCode);
    expect(codes).toEqual(['healthy', 'degraded', 'healthy']);
  });
});

// ── Suite 4: Connector app with registry ─────────────────────────────────────

describe('Stage 2 — Connector app with registry', () => {
  let ctx: TestVleApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  }, 120_000);

  afterAll(() => ctx.teardown());

  it('4.1 connector app starts and has registrationLoader decorated', () => {
    expect(ctx.connector.registrationLoader).toBeDefined();
  });

  it('4.2 registration is loaded on startup (onReady hook)', () => {
    const current = ctx.connector.registrationLoader.current;
    expect(current).not.toBeNull();
    expect(current?.registrationId).toBe(ctx.registrationId);
  });

  it('4.3 canWrite is true after startup with enabled simulator registration', () => {
    expect(ctx.connector.registrationLoader.canWrite).toBe(true);
  });

  it('4.4 effectiveEndpointUrl returns registration URL after startup', () => {
    const url = ctx.connector.registrationLoader.effectiveEndpointUrl('http://fallback');
    expect(url).toBe('http://stub-vle.test');
  });

  it('4.5 healthReporter is decorated on the connector app', () => {
    expect(ctx.connector.healthReporter).toBeDefined();
  });

  it('4.6 healthReporter.report("healthy") posts to the stub SRS client', async () => {
    const before = ctx.stubSrsClient.healthChecks().length;
    await ctx.connector.healthReporter.report('healthy');
    const checks = ctx.stubSrsClient.healthChecks();
    expect(checks.length).toBe(before + 1);
    expect(checks[checks.length - 1]?.statusCode).toBe('healthy');
  });

  it('4.7 disabling registration then reloading sets canWrite to false', async () => {
    ctx.stubSrsClient.update(ctx.registrationId, { enabled: false });
    await ctx.connector.registrationLoader.load();
    expect(ctx.connector.registrationLoader.canWrite).toBe(false);
  });

  it('4.8 re-enabling then reloading restores canWrite', async () => {
    ctx.stubSrsClient.update(ctx.registrationId, { enabled: true });
    await ctx.connector.registrationLoader.load();
    expect(ctx.connector.registrationLoader.canWrite).toBe(true);
  });

  it('4.9 changing endpointUrl in registry propagates on next load', async () => {
    ctx.stubSrsClient.update(ctx.registrationId, { endpointUrl: 'https://new-vle.university.ac.uk' });
    await ctx.connector.registrationLoader.load();
    const url = ctx.connector.registrationLoader.effectiveEndpointUrl('http://fallback');
    expect(url).toBe('https://new-vle.university.ac.uk');
  });
});
