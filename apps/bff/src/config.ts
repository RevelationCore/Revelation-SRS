import { loadTelemetryConfig, type TelemetryConfig } from '@revelation-srs/telemetry';

/**
 * BFF configuration (ADR-026). One instance per SPA, each its own
 * confidential Keycloak client.
 */
export interface BffConfig {
  /** METRICS_PORT and OTEL_EXPORTER_OTLP_ENDPOINT (ADR-035); packages/telemetry reads the same values at start. */
  telemetry?: TelemetryConfig;
  nodeEnv:            string;
  port:               number;
  logLevel:           string;
  databaseUrl:        string;
  /** The SPA's own origin, e.g. https://admin.example.com; the only origin allowed for non-safe requests. */
  appOrigin:          string;
  clientId:           string;
  clientSecret:       string;
  /** The realm's public issuer: the browser is sent here, and ID tokens must carry it. */
  oidcIssuer:         string;
  /** Where the BFF itself reaches the realm (cluster-internal); defaults to the issuer. */
  oidcInternalUrl:    string;
  /** Upstreams the proxy may reach, by path prefix: /bff/srs and /bff/wellbeing. */
  upstreams:          Record<string, string>;
  /** AES-256-GCM keys as kid:base64; the first encrypts, all decrypt (rotation). */
  sessionKeys:        Array<{ kid: string; key: Buffer }>;
  idleSeconds:        number;
  absoluteSeconds:    number;
  /** POST /bff/dev/session: development and test only (P-05). */
  devSessions:        boolean;
  proxyTimeoutMs:     number;
}

/** Published development key; refused outside development and test. */
export const DEV_SESSION_KEY = 'dev:' + Buffer.alloc(32, 7).toString('base64');
export const DEV_CLIENT_SECRET = 'dev-bff-secret';

const isDevOrTest = (nodeEnv: string) => nodeEnv === 'development' || nodeEnv === 'test';

export function parseSessionKeys(raw: string): Array<{ kid: string; key: Buffer }> {
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const i = entry.indexOf(':');
    if (i <= 0) throw new Error('BFF_SESSION_KEYS entries must be kid:base64key');
    const key = Buffer.from(entry.slice(i + 1), 'base64');
    if (key.length !== 32) throw new Error(`BFF_SESSION_KEYS key '${entry.slice(0, i)}' must be 32 bytes (AES-256)`);
    return { kid: entry.slice(0, i), key };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BffConfig {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const issuer = (env['OIDC_ISSUER'] ?? 'http://localhost:8081/realms/srs').replace(/\/$/, '');
  const upstreams: Record<string, string> = {};
  if (env['BFF_UPSTREAM_SRS']) upstreams['srs'] = env['BFF_UPSTREAM_SRS'].replace(/\/$/, '');
  if (env['BFF_UPSTREAM_WELLBEING']) upstreams['wellbeing'] = env['BFF_UPSTREAM_WELLBEING'].replace(/\/$/, '');
  const optionalInt = (name: string, fallback: number) => (env[name] ? Number(env[name]) : fallback);
  return {
    nodeEnv,
    telemetry:       loadTelemetryConfig(env),
    port:            optionalInt('PORT', 3010),
    logLevel:        env['LOG_LEVEL'] ?? 'info',
    databaseUrl:     env['DATABASE_URL'] ?? 'postgres://srs:srs@localhost:5432/srs',
    appOrigin:       (env['BFF_APP_ORIGIN'] ?? 'http://localhost:5173').replace(/\/$/, ''),
    clientId:        env['BFF_CLIENT_ID'] ?? 'srs-admin',
    clientSecret:    env['BFF_CLIENT_SECRET'] ?? DEV_CLIENT_SECRET,
    oidcIssuer:      issuer,
    oidcInternalUrl: (env['OIDC_INTERNAL_URL'] ?? issuer).replace(/\/$/, ''),
    upstreams,
    sessionKeys:     parseSessionKeys(env['BFF_SESSION_KEYS'] ?? DEV_SESSION_KEY),
    idleSeconds:     optionalInt('BFF_SESSION_IDLE_SECONDS', 1800),
    absoluteSeconds: optionalInt('BFF_SESSION_MAX_SECONDS', 36_000),
    devSessions:     env['BFF_DEV_SESSIONS'] === 'true',
    proxyTimeoutMs:  optionalInt('BFF_PROXY_TIMEOUT_MS', 30_000),
  };
}

/** Refuses, outside development and test, a configuration that would weaken sessions (P-05). Static. */
export function assertSecureBffConfig(cfg: BffConfig): void {
  if (isDevOrTest(cfg.nodeEnv)) return;
  const problems: string[] = [];
  if (cfg.devSessions) problems.push('BFF_DEV_SESSIONS is for development and test only');
  if (cfg.clientSecret === DEV_CLIENT_SECRET) problems.push('BFF_CLIENT_SECRET is the published development secret');
  if (cfg.sessionKeys.some((k) => `${k.kid}:${k.key.toString('base64')}` === DEV_SESSION_KEY)) problems.push('BFF_SESSION_KEYS holds the published development key');
  if (!cfg.appOrigin.startsWith('https://')) problems.push('BFF_APP_ORIGIN must be https');
  if (!cfg.oidcIssuer.startsWith('https://')) problems.push('OIDC_ISSUER must be https');
  if (Object.keys(cfg.upstreams).length === 0) problems.push('no upstream: set BFF_UPSTREAM_SRS (and BFF_UPSTREAM_WELLBEING for the admin app)');
  if (problems.length > 0) throw new Error(`Refusing to start srs-bff in '${cfg.nodeEnv}' (ADR-026): ${problems.join('; ')}`);
}
