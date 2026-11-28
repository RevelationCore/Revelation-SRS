import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { loadTelemetryConfig, type TelemetryConfig } from '@revelation-srs/telemetry';
import { DEFAULT_DEV_VLE_CLIENT_SECRET } from '@revelation-srs/service-client';

/**
 * How the connector authenticates to core (ADR-032): as itself, through its
 * tenant's srs-vle-svc-<tenant> client. private_key_jwt outside development
 * and test; a client secret only in development and test.
 */
export interface VleSrsClientConfig {
  srsApiUrlSet:  boolean;
  tokenUrl:      string | undefined;
  clientAuth:    'private_key_jwt' | 'client_secret_basic';
  clientKeyFile: string | undefined;
  clientKeyId:   string | undefined;
  clientSecret:  string;
}

export interface Config {
  /** METRICS_PORT and OTEL_EXPORTER_OTLP_ENDPOINT (ADR-035); packages/telemetry reads the same values at start. */
  telemetry?: TelemetryConfig;
  port:                      number;
  logLevel:                  string;
  nodeEnv:                   string;
  databaseUrl:               string;
  srsApiUrl:                 string;
  natsUrl:                   string;
  tenantId:                  string;
  integrationRegistrationId: string;
  srsClient:                 VleSrsClientConfig;
  vleEndpointUrl:            string;
  /** Which platform driver writes adjustments: stub | canvas | moodle. */
  vlePlatform:               'stub' | 'canvas' | 'moodle';
  /** Canvas access token or Moodle web-service token (not used by stub). */
  vleApiToken:               string | undefined;
  /** Moodle only: quiz-overrides (default; Moodle 5.3+) or groups. */
  moodleStrategy:            'groups' | 'quiz-overrides';
  /** Start the NATS consumer (off for tests that call dispatch() directly). */
  consumerEnabled:           boolean;
  /** Interval for adjustment acknowledgement and coverage reconciliation; 0 disables. */
  reconcileIntervalMs:       number;
  endpointSafetyClass:       'simulator' | 'external-test' | 'live';
  retryMaxAttempts:          number;
  retryBackoffMs:            number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required environment variable ${name} is not set`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requiredUuid(name: string): string {
  const v = required(name);
  if (!UUID.test(v)) throw new Error(`Environment variable ${name} must be a UUID, not '${v}'`);
  return v;
}

function optionalInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : defaultValue;
}

const isDevOrTest = (nodeEnv: string) => nodeEnv === 'development' || nodeEnv === 'test';

export function loadVleSrsClientConfig(nodeEnv: string, env: NodeJS.ProcessEnv = process.env): VleSrsClientConfig {
  const jwks = env['KEYCLOAK_JWKS_URL'];
  return {
    srsApiUrlSet:  Boolean(env['SRS_API_URL']),
    tokenUrl:      env['VLE_SRS_TOKEN_URL'] ?? (jwks ? jwks.replace(/\/certs\/?$/, '/token') : undefined),
    clientAuth:    (env['VLE_SRS_CLIENT_AUTH'] as VleSrsClientConfig['clientAuth'] | undefined) ?? (isDevOrTest(nodeEnv) ? 'client_secret_basic' : 'private_key_jwt'),
    clientKeyFile: env['VLE_SRS_CLIENT_KEY_FILE'],
    clientKeyId:   env['VLE_SRS_CLIENT_KEY_ID'],
    clientSecret:  env['VLE_SRS_CLIENT_SECRET'] ?? DEFAULT_DEV_VLE_CLIENT_SECRET,
  };
}

/**
 * Refuses a configuration that would call core without a verifiable,
 * tenant-bound identity (ADR-032). Static: no token is fetched, so a brief
 * Keycloak outage cannot crash-loop the pod. The retired static token fails
 * loudly in every environment, so stale configuration is not ignored.
 */
export function assertVleSrsClientConfig(nodeEnv: string, cfg: VleSrsClientConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (env['SERVICE_ACCOUNT_TOKEN']) {
    throw new Error(`Refusing to start srs-vle-adapter in '${nodeEnv}' (ADR-032): SERVICE_ACCOUNT_TOKEN is no longer used; the connector authenticates as srs-vle-svc-<tenant>`);
  }
  if (isDevOrTest(nodeEnv)) return;
  const problems: string[] = [];
  if (!cfg.srsApiUrlSet) problems.push('SRS_API_URL is not set');
  if (!cfg.tokenUrl) problems.push('no token endpoint: set KEYCLOAK_JWKS_URL or VLE_SRS_TOKEN_URL');
  if (cfg.clientAuth !== 'private_key_jwt') problems.push('VLE_SRS_CLIENT_AUTH must be private_key_jwt');
  if (!cfg.clientKeyFile) problems.push('VLE_SRS_CLIENT_KEY_FILE is not set');
  else {
    try {
      if (createPrivateKey(readFileSync(cfg.clientKeyFile, 'utf8')).asymmetricKeyType !== 'rsa') problems.push('VLE_SRS_CLIENT_KEY_FILE is not an RSA private key');
    } catch {
      problems.push('VLE_SRS_CLIENT_KEY_FILE is missing, unreadable or not a private key');
    }
  }
  if (problems.length > 0) throw new Error(`Refusing to start srs-vle-adapter in '${nodeEnv}' (ADR-032): ${problems.join('; ')}`);
}

export function loadConfig(): Config {
  const safetyClass = process.env['ENDPOINT_SAFETY_CLASS'] ?? 'simulator';
  if (safetyClass !== 'simulator' && safetyClass !== 'external-test' && safetyClass !== 'live') {
    throw new Error(`Invalid ENDPOINT_SAFETY_CLASS: ${safetyClass}`);
  }
  const platform = process.env['VLE_PLATFORM'] ?? 'stub';
  if (platform !== 'stub' && platform !== 'canvas' && platform !== 'moodle') {
    throw new Error(`Invalid VLE_PLATFORM: ${platform}`);
  }
  if (platform === 'stub' && safetyClass === 'live') {
    throw new Error('VLE_PLATFORM=stub cannot be used with ENDPOINT_SAFETY_CLASS=live');
  }
  const moodleStrategy = process.env['MOODLE_ADJUSTMENT_STRATEGY'] ?? 'quiz-overrides';
  if (moodleStrategy !== 'groups' && moodleStrategy !== 'quiz-overrides') {
    throw new Error(`Invalid MOODLE_ADJUSTMENT_STRATEGY: ${moodleStrategy}`);
  }
  return {
    telemetry:       loadTelemetryConfig(),
    vlePlatform:             platform,
    moodleStrategy,
    vleApiToken:             process.env['VLE_API_TOKEN'],
    consumerEnabled:         (process.env['VLE_CONSUMER_ENABLED'] ?? 'true') !== 'false',
    reconcileIntervalMs:     optionalInt('RECONCILE_INTERVAL_MS', 300_000),
    port:                    optionalInt('PORT', 3002),
    logLevel:                process.env['LOG_LEVEL'] ?? 'info',
    nodeEnv:                 process.env['NODE_ENV'] ?? 'development',
    databaseUrl:             required('DATABASE_URL'),
    srsApiUrl:               process.env['SRS_API_URL'] ?? 'http://localhost:3000',
    natsUrl:                 process.env['NATS_URL'] ?? 'nats://localhost:4222',
    tenantId:                  requiredUuid('TENANT_ID'),
    integrationRegistrationId: requiredUuid('INTEGRATION_REGISTRATION_ID'),
    srsClient:                 loadVleSrsClientConfig(process.env['NODE_ENV'] ?? 'development'),
    vleEndpointUrl:            process.env['VLE_ENDPOINT_URL'] ?? 'http://localhost:3003',
    endpointSafetyClass:     safetyClass,
    retryMaxAttempts:        optionalInt('RETRY_MAX_ATTEMPTS', 5),
    retryBackoffMs:          optionalInt('RETRY_BACKOFF_MS', 500),
  };
}
