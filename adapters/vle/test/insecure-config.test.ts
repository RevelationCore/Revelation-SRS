/**
 * ADR-032: outside development and test the connector authenticates to core
 * as srs-vle-svc-<tenant> with private_key_jwt, and the retired static token
 * fails start-up in every environment rather than being silently ignored.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertVleSrsClientConfig, loadVleSrsClientConfig } from '../src/config.js';

const dir = mkdtempSync(join(tmpdir(), 'vle-adr032-'));
const keyFile = join(dir, 'key.pem');
writeFileSync(keyFile, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
const notAKey = join(dir, 'not-a-key.pem');
writeFileSync(notAKey, 'hello');

const good = {
  SRS_API_URL: 'http://srs-api:3000',
  KEYCLOAK_JWKS_URL: 'http://keycloak:8080/realms/srs/protocol/openid-connect/certs',
  VLE_SRS_CLIENT_KEY_FILE: keyFile,
};
const check = (env: Record<string, string>, nodeEnv = 'production') =>
  () => assertVleSrsClientConfig(nodeEnv, loadVleSrsClientConfig(nodeEnv, env), env);

describe('VLE connector refuses insecure configuration (ADR-032)', () => {
  it('starts in production with private_key_jwt, a key, a token URL and the API URL', () => {
    expect(check(good)).not.toThrow();
    expect(loadVleSrsClientConfig('production', good).tokenUrl).toBe('http://keycloak:8080/realms/srs/protocol/openid-connect/token');
  });

  it('refuses the retired static token in every environment', () => {
    for (const nodeEnv of ['production', 'development', 'test']) {
      expect(check({ ...good, SERVICE_ACCOUNT_TOKEN: 'x' }, nodeEnv)).toThrow(/SERVICE_ACCOUNT_TOKEN is no longer used/);
    }
  });

  it('refuses a client secret, a missing or invalid key, no token URL and no API URL', () => {
    expect(check({ ...good, VLE_SRS_CLIENT_AUTH: 'client_secret_basic' })).toThrow(/must be private_key_jwt/);
    const { VLE_SRS_CLIENT_KEY_FILE: _k, ...noKey } = good;
    expect(check(noKey)).toThrow(/VLE_SRS_CLIENT_KEY_FILE is not set/);
    expect(check({ ...good, VLE_SRS_CLIENT_KEY_FILE: notAKey })).toThrow(/not a private key/);
    const { KEYCLOAK_JWKS_URL: _j, ...noToken } = good;
    expect(check(noToken)).toThrow(/no token endpoint/);
    const { SRS_API_URL: _s, ...noApi } = good;
    expect(check(noApi)).toThrow(/SRS_API_URL is not set/);
  });

  it('allows the development secret in development and test', () => {
    expect(check({}, 'development')).not.toThrow();
    expect(loadVleSrsClientConfig('test', {}).clientAuth).toBe('client_secret_basic');
  });
});
