import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DEFAULT_DEV_WELLBEING_CLIENT_SECRET } from '@revelation-srs/auth';

import { SrsAdjustmentHttpClient, SrsAdjustmentStubClient, type SrsAdjustmentClient } from './srs-adjustment-client.js';
import { SrsEcHttpClient, SrsEcStubClient, type SrsEcClient } from './srs-ec-client.js';
import { ServiceTokenProvider, type ClientAuth } from './service-token-provider.js';

/**
 * How the wellbeing service reaches core for its hand-offs (ADR-029).
 *
 * Real HTTP clients are the default everywhere. Stubs are chosen only by
 * WELLBEING_SRS_CLIENTS=stub, and only in development and test: the service
 * once shipped with stubs as the silent fallback, and approved adjustments
 * never reached core (BL-233).
 */
export interface SrsHandoffConfig {
  clients:       'http' | 'stub';
  srsApiUrl:     string;
  srsApiUrlSet:  boolean;
  tokenUrl:      string | undefined;
  clientAuth:    'private_key_jwt' | 'client_secret_basic';
  clientKeyFile: string | undefined;
  clientKeyId:   string | undefined;
  clientSecret:  string;
}

const isDevOrTest = (nodeEnv: string) => nodeEnv === 'development' || nodeEnv === 'test';

export function loadSrsHandoffConfig(nodeEnv: string, env: NodeJS.ProcessEnv = process.env): SrsHandoffConfig {
  const jwks = env['KEYCLOAK_JWKS_URL'];
  return {
    clients:       env['WELLBEING_SRS_CLIENTS'] === 'stub' ? 'stub' : 'http',
    srsApiUrl:     env['SRS_API_URL'] ?? 'http://localhost:3000',
    srsApiUrlSet:  Boolean(env['SRS_API_URL']),
    tokenUrl:      env['WELLBEING_SRS_TOKEN_URL'] ?? (jwks ? jwks.replace(/\/certs\/?$/, '/token') : undefined),
    clientAuth:    (env['WELLBEING_SRS_CLIENT_AUTH'] as SrsHandoffConfig['clientAuth'] | undefined) ?? (isDevOrTest(nodeEnv) ? 'client_secret_basic' : 'private_key_jwt'),
    clientKeyFile: env['WELLBEING_SRS_CLIENT_KEY_FILE'],
    clientKeyId:   env['WELLBEING_SRS_CLIENT_KEY_ID'],
    clientSecret:  env['WELLBEING_SRS_CLIENT_SECRET'] ?? DEFAULT_DEV_WELLBEING_CLIENT_SECRET,
  };
}

/**
 * Refuses, outside development and test, a configuration that would leave
 * the hand-offs on stubs or without verifiable credentials. Static: no token
 * is fetched, so a brief Keycloak outage cannot crash-loop the pod.
 */
export function assertSrsHandoffConfig(nodeEnv: string, cfg: SrsHandoffConfig): void {
  if (isDevOrTest(nodeEnv)) return;
  const problems: string[] = [];
  if (cfg.clients === 'stub') problems.push('WELLBEING_SRS_CLIENTS=stub is for development and test only');
  if (!cfg.srsApiUrlSet) problems.push('SRS_API_URL is not set');
  if (!cfg.tokenUrl) problems.push('no token endpoint: set KEYCLOAK_JWKS_URL or WELLBEING_SRS_TOKEN_URL');
  if (cfg.clientAuth !== 'private_key_jwt') problems.push('WELLBEING_SRS_CLIENT_AUTH must be private_key_jwt');
  if (!cfg.clientKeyId) problems.push('WELLBEING_SRS_CLIENT_KEY_ID is not set');
  if (!cfg.clientKeyFile) problems.push('WELLBEING_SRS_CLIENT_KEY_FILE is not set');
  else {
    try {
      const key = createPrivateKey(readFileSync(cfg.clientKeyFile, 'utf8'));
      if (key.asymmetricKeyType !== 'rsa') problems.push('WELLBEING_SRS_CLIENT_KEY_FILE is not an RSA private key');
    } catch {
      problems.push('WELLBEING_SRS_CLIENT_KEY_FILE is missing, unreadable or not a private key');
    }
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start srs-wellbeing in '${nodeEnv}' (ADR-029): ${problems.join('; ')}`);
  }
}

/** The hand-off clients the configuration asks for. */
export function createSrsHandoffClients(nodeEnv: string, cfg: SrsHandoffConfig): { adjustment: SrsAdjustmentClient; ec: SrsEcClient } {
  if (cfg.clients === 'stub') {
    if (!isDevOrTest(nodeEnv)) throw new Error('Stub SRS clients are for development and test only (ADR-029)');
    return { adjustment: new SrsAdjustmentStubClient(), ec: new SrsEcStubClient() };
  }
  if (!cfg.tokenUrl) throw new Error('No token endpoint for the SRS hand-offs: set KEYCLOAK_JWKS_URL or WELLBEING_SRS_TOKEN_URL, or WELLBEING_SRS_CLIENTS=stub in development');
  const auth: ClientAuth = cfg.clientAuth === 'private_key_jwt'
    ? { method: 'private_key_jwt', keyFile: cfg.clientKeyFile ?? '', keyId: cfg.clientKeyId ?? '' }
    : { method: 'client_secret_basic', secret: cfg.clientSecret };
  const tokens = new ServiceTokenProvider({ tokenUrl: cfg.tokenUrl, auth });
  return { adjustment: new SrsAdjustmentHttpClient(cfg.srsApiUrl, tokens), ec: new SrsEcHttpClient(cfg.srsApiUrl, tokens) };
}

/** True for the stub clients, which buildApp refuses outside development and test. */
export function isStubClient(client: unknown): boolean {
  return client instanceof SrsAdjustmentStubClient || client instanceof SrsEcStubClient;
}
