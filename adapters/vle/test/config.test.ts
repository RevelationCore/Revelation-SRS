/**
 * BL-333: the connector serves one tenant and one integration registration.
 * Both must be UUIDs, so the deployment's placeholder ConfigMap
 * (srs-vle-adapter-config: "set-per-deployment") refuses to start.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function env(overrides: Record<string, string>): void {
  process.env = {
    ...saved,
    DATABASE_URL: 'postgresql://x@localhost/x',
    TENANT_ID: '00000000-0000-0000-0000-000000000001',
    INTEGRATION_REGISTRATION_ID: '2b9d2c1e-6a1f-4c8e-9a3b-0c5d7e9f1a2b',
    ...overrides,
  };
}

describe('VLE connector configuration', () => {
  it('accepts UUIDs for the tenant and the integration registration', () => {
    env({});
    expect(loadConfig()).toMatchObject({ tenantId: '00000000-0000-0000-0000-000000000001' });
  });

  it('refuses the deployment placeholder for either', () => {
    env({ TENANT_ID: 'set-per-deployment' });
    expect(() => loadConfig()).toThrow(/TENANT_ID must be a UUID/);
    env({ INTEGRATION_REGISTRATION_ID: 'set-per-deployment' });
    expect(() => loadConfig()).toThrow(/INTEGRATION_REGISTRATION_ID must be a UUID/);
  });
});
