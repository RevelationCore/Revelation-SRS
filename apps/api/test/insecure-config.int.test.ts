import { assertDocumentScannerConfig, loadDocumentScannerConfig } from '@revelation-srs/documents';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

/**
 * Outside development and test the API refuses to start on HS256 tokens
 * (enterprise readiness plan, item 1.6): with no JWKS, whatever JWT_SECRET
 * holds (the published default, a short one or a long one), anyone with the
 * secret could mint a token for any tenant.
 */

const base: Config = {
  port: 0, logLevel: 'silent', nodeEnv: 'production',
  databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
  natsUrl: 'nats://127.0.0.1:1', attendanceApiUrl: 'http://127.0.0.1:1', temporalAddress: '127.0.0.1:1',
  deploymentEnvironmentCode: 'production', releaseVersion: '0.0.0-test', imageDigest: undefined,
  migrationVersion: 'test', jwtSecret: 'dev-secret-replace-in-production', keycloakJwksUrl: undefined,
  corsOrigins: [], otelEndpoint: undefined, otelServiceName: 'srs-api-test',
  documentScanner: { mode: 'clamd', clamdHost: '127.0.0.1', clamdPort: 1, timeoutMs: 30_000, maxConcurrency: 4 },
};

describe('insecure token configuration', () => {
  it.each([
    ['the published default secret', 'dev-secret-replace-in-production'],
    ['a short secret', 'short'],
    ['a long secret', 'x'.repeat(64)],
  ])('refuses production with no JWKS and %s', async (_label, jwtSecret) => {
    await expect(buildApp({ ...base, jwtSecret })).rejects.toThrow(/srs-api refuses to start: NODE_ENV=production needs KEYCLOAK_JWKS_URL/);
  });

  it('refuses any environment but development and test', async () => {
    await expect(buildApp({ ...base, nodeEnv: 'staging' })).rejects.toThrow(/NODE_ENV=staging needs KEYCLOAK_JWKS_URL/);
  });

  it('starts in production with Keycloak keys', async () => {
    const app = await buildApp({ ...base, keycloakJwksUrl: 'http://127.0.0.1:1/realms/srs/protocol/openid-connect/certs' });
    await app.close();
  });
});

describe('insecure document scanning (ADR-030)', () => {
  const jwks = 'http://127.0.0.1:1/realms/srs/protocol/openid-connect/certs';
  it('refuses the no-op scanner outside development and test', async () => {
    await expect(buildApp({ ...base, keycloakJwksUrl: jwks, documentScanner: { mode: 'noop', clamdPort: 3310, timeoutMs: 30_000, maxConcurrency: 4 } })).rejects.toThrow(/no-op document scanner is for development and test only/);
    expect(() => assertDocumentScannerConfig('srs-api', 'production', loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'noop' }))).toThrow(/Refusing to start srs-api/);
  });

  it('refuses clamd without CLAMD_HOST outside development and test', async () => {
    await expect(buildApp({ ...base, keycloakJwksUrl: jwks, documentScanner: { mode: 'clamd', clamdPort: 3310, timeoutMs: 30_000, maxConcurrency: 4 } })).rejects.toThrow(/CLAMD_HOST is not set/);
    expect(() => assertDocumentScannerConfig('srs-api', 'production', loadDocumentScannerConfig({}))).toThrow(/CLAMD_HOST is not set/);
  });
});
