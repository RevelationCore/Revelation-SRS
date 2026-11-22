import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertDocumentScannerConfig, loadDocumentScannerConfig } from '@revelation-srs/documents';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { loadSrsHandoffConfig } from '../src/srs/handoff-config.js';

/**
 * Outside development and test the service refuses to start on HS256 tokens
 * (enterprise readiness plan, item 1.6).
 */

const base: Config = {
  port: 0, logLevel: 'silent', nodeEnv: 'production',
  databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
  srsApiUrl: 'http://127.0.0.1:1', natsUrl: 'nats://127.0.0.1:1',
  jwtSecret: 'dev-secret-replace-in-production', keycloakJwksUrl: undefined, corsOrigins: [],
  // ADR-030: production needs a real scanner; clamd is not contacted at start.
  documentScanner: { mode: 'clamd', clamdHost: '127.0.0.1', clamdPort: 1, timeoutMs: 30_000, maxConcurrency: 4 },
};

describe('insecure token configuration', () => {
  it.each([
    ['the published default secret', 'dev-secret-replace-in-production'],
    ['a short secret', 'short'],
    ['a long secret', 'x'.repeat(64)],
  ])('refuses production with no JWKS and %s', async (_label, jwtSecret) => {
    await expect(buildApp({ ...base, jwtSecret })).rejects.toThrow(/srs-wellbeing refuses to start: NODE_ENV=production needs KEYCLOAK_JWKS_URL/);
  });

  it('starts in production with Keycloak keys and real hand-off clients (ADR-029)', async () => {
    const keyFile = join(mkdtempSync(join(tmpdir(), 'wb-key-')), 'key.pem');
    writeFileSync(keyFile, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const srsHandoff = {
      ...loadSrsHandoffConfig('production', {}), srsApiUrl: 'http://127.0.0.1:1', srsApiUrlSet: true,
      tokenUrl: 'http://127.0.0.1:1/realms/srs/protocol/openid-connect/token', clientKeyFile: keyFile, clientKeyId: 'k1',
    };
    const app = await buildApp({ ...base, keycloakJwksUrl: 'http://127.0.0.1:1/realms/srs/protocol/openid-connect/certs', srsHandoff });
    await app.close();
  });
});

describe('insecure document scanning (ADR-030)', () => {
  it('refuses the no-op scanner, and clamd without CLAMD_HOST, outside development and test', () => {
    expect(() => assertDocumentScannerConfig('srs-wellbeing', 'production', loadDocumentScannerConfig({ DOCUMENT_SCANNER: 'noop' }))).toThrow(/Refusing to start srs-wellbeing/);
    expect(() => assertDocumentScannerConfig('srs-wellbeing', 'production', loadDocumentScannerConfig({}))).toThrow(/CLAMD_HOST is not set/);
    expect(() => assertDocumentScannerConfig('srs-wellbeing', 'production', loadDocumentScannerConfig({ CLAMD_HOST: 'srs-clamav' }))).not.toThrow();
  });
});
