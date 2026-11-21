/**
 * ADR-029, wellbeing side (BL-233, BL-328): the hand-offs authenticate as
 * the wellbeing service through the tenant's own Keycloak client, with
 * cached per-tenant tokens, and the service refuses to start on stubs or
 * without verifiable credentials outside development and test.
 */
import type { createPublicKey} from 'node:crypto';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { wellbeingServiceClientId } from '@revelation-srs/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { assertSrsHandoffConfig, loadSrsHandoffConfig, type SrsHandoffConfig } from '../src/srs/handoff-config.js';
import { callCoreAsService, ServiceTokenError, ServiceTokenProvider } from '../src/srs/service-token-provider.js';
import { SrsAdjustmentStubClient } from '../src/srs/srs-adjustment-client.js';
import { SrsEcStubClient } from '../src/srs/srs-ec-client.js';

const TENANT_A = '00000000-0000-0000-0000-0000000000a1';
const TENANT_B = '00000000-0000-0000-0000-0000000000b2';
const dir = mkdtempSync(join(tmpdir(), 'wellbeing-svc-'));

function rsaKeyFile(name: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = join(dir, name);
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { file, publicKey };
}

// ── A fake Keycloak token endpoint ───────────────────────────────────────────
interface TokenRequest { form: URLSearchParams; authorization: string | undefined }
let kc: Server;
let tokenUrl: string;
let requests: TokenRequest[] = [];
let tokenStatus = 200;
let issued = 0;

const body = (req: IncomingMessage) => new Promise<string>((resolve) => { let b = ''; req.on('data', (c: Buffer) => { b += String(c); }).on('end', () => resolve(b)); });

beforeAll(async () => {
  kc = createServer((req, res) => {
    void body(req).then((b) => {
      requests.push({ form: new URLSearchParams(b), authorization: req.headers['authorization'] });
      setTimeout(() => {
        if (tokenStatus !== 200) { res.writeHead(tokenStatus, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_client' })); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: `token-${++issued}`, expires_in: 300 }));
      }, 20);
    });
  });
  await new Promise<void>((resolve) => kc.listen(0, '127.0.0.1', resolve));
  tokenUrl = `http://127.0.0.1:${(kc.address() as AddressInfo).port}/realms/srs/protocol/openid-connect/token`;
});
afterAll(() => { kc?.close(); });
beforeEach(() => { requests = []; tokenStatus = 200; });

const production = (overrides: Partial<SrsHandoffConfig> = {}): SrsHandoffConfig => {
  const key = rsaKeyFile(`key-${Math.random().toString(36).slice(2)}.pem`);
  return {
    ...loadSrsHandoffConfig('production', {}), srsApiUrl: 'http://srs-api:3000', srsApiUrlSet: true, tokenUrl,
    clientAuth: 'private_key_jwt', clientKeyFile: key.file, clientKeyId: 'wellbeing-2026-11', ...overrides,
  };
};

describe('assertSrsHandoffConfig', () => {
  it('accepts a complete production configuration', () => {
    expect(() => assertSrsHandoffConfig('production', production())).not.toThrow();
  });

  it.each([
    ['stub clients', { clients: 'stub' as const }, /WELLBEING_SRS_CLIENTS=stub/],
    ['no SRS_API_URL', { srsApiUrlSet: false }, /SRS_API_URL is not set/],
    ['a client secret', { clientAuth: 'client_secret_basic' as const }, /must be private_key_jwt/],
    ['no key file', { clientKeyFile: undefined }, /KEY_FILE is not set/],
    ['a missing key file', { clientKeyFile: join(dir, 'nope.pem') }, /missing, unreadable or not a private key/],
    ['no key id', { clientKeyId: undefined }, /KEY_ID is not set/],
    ['no token endpoint', { tokenUrl: undefined }, /no token endpoint/],
  ])('refuses %s outside development and test', (_label, overrides, message) => {
    expect(() => assertSrsHandoffConfig('production', production(overrides))).toThrow(message);
  });

  it('allows stubs and client secrets in development and test', () => {
    expect(() => assertSrsHandoffConfig('test', { ...loadSrsHandoffConfig('test', {}), clients: 'stub' })).not.toThrow();
    expect(() => assertSrsHandoffConfig('development', loadSrsHandoffConfig('development', {}))).not.toThrow();
  });

  it('buildApp refuses stub clients in production, however they arrive', async () => {
    const config: Config = {
      port: 0, logLevel: 'silent', nodeEnv: 'production', databaseUrl: 'postgres://x:y@127.0.0.1:1/z', srsApiUrl: 'http://srs-api:3000',
      natsUrl: 'nats://127.0.0.1:1', jwtSecret: 'unused', keycloakJwksUrl: 'https://kc.example/realms/srs/protocol/openid-connect/certs',
      corsOrigins: [], srsHandoff: production(),
    };
    await expect(buildApp(config, { srsAdjustmentClient: new SrsAdjustmentStubClient(), srsEcClient: new SrsEcStubClient() })).rejects.toThrow(/stub SRS clients/);
  });
});

describe('ServiceTokenProvider', () => {
  it('asks for the tenant\'s own client with a client secret in development, and caches per tenant', async () => {
    const tokens = new ServiceTokenProvider({ tokenUrl, auth: { method: 'client_secret_basic', secret: 's3cret' } });
    const [a1, a2] = await Promise.all([tokens.getToken(TENANT_A), tokens.getToken(TENANT_A)]);
    expect(a1).toBe(a2);
    expect(await tokens.getToken(TENANT_A)).toBe(a1);
    await tokens.getToken(TENANT_B);

    expect(requests).toHaveLength(2); // one shared fetch for A, one for B
    expect(requests.map((r) => r.form.get('client_id'))).toEqual([wellbeingServiceClientId(TENANT_A), wellbeingServiceClientId(TENANT_B)]);
    expect(requests[0]!.form.get('grant_type')).toBe('client_credentials');
    expect(Buffer.from(requests[0]!.authorization!.replace(/^Basic /, ''), 'base64').toString()).toBe(`${wellbeingServiceClientId(TENANT_A)}:s3cret`);
  });

  it('refreshes once 60 s of the token\'s life is left', async () => {
    let now = 1_000_000;
    const tokens = new ServiceTokenProvider({ tokenUrl, auth: { method: 'client_secret_basic', secret: 's' }, now: () => now });
    const first = await tokens.getToken(TENANT_A);
    now += 239_000;
    expect(await tokens.getToken(TENANT_A)).toBe(first);
    now += 2_000; // 59 s left
    expect(await tokens.getToken(TENANT_A)).not.toBe(first);
    expect(requests).toHaveLength(2);
  });

  it('signs a short-lived client assertion with the service key, and re-reads the key file after rotation', async () => {
    const key = rsaKeyFile('rotating.pem');
    const tokens = new ServiceTokenProvider({ tokenUrl, auth: { method: 'private_key_jwt', keyFile: key.file, keyId: 'k1' } });
    await tokens.getToken(TENANT_A);
    const verifyWith = (assertion: string, publicKey: ReturnType<typeof createPublicKey>) => {
      const [h, p, s] = assertion.split('.');
      return verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, 'base64url'));
    };
    const first = requests[0]!.form;
    expect(first.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    expect(first.has('client_secret')).toBe(false);
    const assertion = first.get('client_assertion')!;
    expect(verifyWith(assertion, key.publicKey)).toBe(true);
    const header = JSON.parse(Buffer.from(assertion.split('.')[0]!, 'base64url').toString()) as { alg: string; kid: string };
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
    expect(header).toMatchObject({ alg: 'RS256', kid: 'k1' });
    expect(claims).toMatchObject({ iss: wellbeingServiceClientId(TENANT_A), sub: wellbeingServiceClientId(TENANT_A), aud: tokenUrl.replace('/protocol/openid-connect/token', '') });
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(60);

    // Rotate: a new key in the same file (with a new mtime) is used next time.
    const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(key.file, rotated.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    utimesSync(key.file, new Date(), new Date(Date.now() + 5_000));
    await tokens.getToken(TENANT_B);
    expect(verifyWith(requests[1]!.form.get('client_assertion')!, rotated.publicKey)).toBe(true);
  });

  it('reports a refused or unreachable token endpoint as a transient ServiceTokenError', async () => {
    tokenStatus = 401;
    const tokens = new ServiceTokenProvider({ tokenUrl, auth: { method: 'client_secret_basic', secret: 'wrong' } });
    await expect(tokens.getToken(TENANT_A)).rejects.toThrow(ServiceTokenError);
    await expect(tokens.getToken(TENANT_A)).rejects.toThrow(/invalid_client/);
    const unreachable = new ServiceTokenProvider({ tokenUrl: 'http://127.0.0.1:1/token', auth: { method: 'client_secret_basic', secret: 's' } });
    await expect(unreachable.getToken(TENANT_A)).rejects.toThrow(ServiceTokenError);
  });
});

describe('callCoreAsService', () => {
  it('drops the token and retries once after a 401, then returns what core says', async () => {
    const seen: string[] = [];
    const core = createServer((req, res) => {
      seen.push(req.headers['authorization'] ?? '');
      res.writeHead(seen.length === 1 ? 401 : 201).end();
    });
    await new Promise<void>((resolve) => core.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(core.address() as AddressInfo).port}/api/v1/students/x/adjustments`;
    try {
      const tokens = new ServiceTokenProvider({ tokenUrl, auth: { method: 'client_secret_basic', secret: 's' } });
      const res = await callCoreAsService(tokens, TENANT_A, url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(201);
      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]); // a fresh token on the retry
      expect(requests).toHaveLength(2);
    } finally {
      core.close();
    }
  });
});
