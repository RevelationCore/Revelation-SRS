import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

/**
 * Outside development and test the service refuses to start on HS256 tokens
 * (enterprise readiness plan, item 1.6).
 */

const base: Config = {
  port: 0, logLevel: 'silent', nodeEnv: 'production',
  databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
  srsApiUrl: 'http://127.0.0.1:1', natsUrl: 'nats://127.0.0.1:1',
  jwtSecret: 'dev-secret-replace-in-production', keycloakJwksUrl: undefined, corsOrigins: [],
};

describe('insecure token configuration', () => {
  it.each([
    ['the published default secret', 'dev-secret-replace-in-production'],
    ['a short secret', 'short'],
    ['a long secret', 'x'.repeat(64)],
  ])('refuses production with no JWKS and %s', async (_label, jwtSecret) => {
    await expect(buildApp({ ...base, jwtSecret })).rejects.toThrow(/srs-wellbeing refuses to start: NODE_ENV=production needs KEYCLOAK_JWKS_URL/);
  });

  it('starts in production with Keycloak keys', async () => {
    const app = await buildApp({ ...base, keycloakJwksUrl: 'http://127.0.0.1:1/realms/srs/protocol/openid-connect/certs' });
    await app.close();
  });
});
