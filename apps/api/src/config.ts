import { loadDocumentScannerConfig, type DocumentScannerConfig } from '@revelation-srs/documents';
import { DEFAULT_DEV_JWT_SECRET, tokenEnv } from '@revelation-srs/auth';

/** Typed environment configuration - read once at startup. */
export interface Config {
  port:         number;
  logLevel:     string;
  nodeEnv:      string;
  /** Malware scanning of uploads (ADR-030): clamd by default; noop only in development and test. */
  documentScanner?: DocumentScannerConfig;
  /**
   * Secret HMAC key for the IP hash in the public verification log
   * (BL-184). Required outside development and test: a hash with a known
   * key can be reversed by hashing every IPv4 address.
   */
  publicVerifyIpKey?: string | undefined;
  databaseUrl:  string;
  natsUrl:      string;
  attendanceApiUrl: string;
  /** How long the engagement proxy waits for the attendance module (default 15 s). */
  engagementProxyTimeoutMs?: number | undefined;
  /**
   * Which proxies' X-Forwarded-For to believe when working out the client IP
   * (Fastify `trustProxy`; see trustProxySetting). Off by default: with
   * nothing in front of the API, the header is whatever the client sent.
   * Behind the ingress, name the ingress's addresses so per-IP rate limits
   * see callers, not the ingress pod.
   */
  trustProxy?: false | string | undefined;
  /** Postgres statement_timeout for the API pool (default 30 s; the worker sets 5 minutes). */
  dbStatementTimeoutMs?: number;
  /** Postgres idle_in_transaction_session_timeout (default 60 s). */
  dbIdleInTransactionTimeoutMs?: number;
  temporalAddress: string;
  /** Live Temporal execution. Off unless TEMPORAL_EXECUTION_ENABLED=true. */
  temporalExecutionEnabled?: boolean;
  temporalNamespace?: string;
  temporalTaskQueue?: string;
  /** How long a decision request waits for the workflow's outcome. */
  temporalDecisionWaitMs?: number;
  /** The reconciler leaves commands/starts younger than this to the API. */
  temporalReconcileGraceSeconds?: number;
  deploymentEnvironmentCode: string;
  releaseVersion: string;
  imageDigest: string | undefined;
  migrationVersion: string;
  jwtSecret:    string;
  keycloakJwksUrl: string | undefined;
  /** Expected token issuer; defaults to the realm the JWKS URL sits under. */
  keycloakIssuer?: string | undefined;
  /** Expected token audience; defaults to 'srs-api'. */
  keycloakAudience?: string[] | undefined;
  /** Allowed clock skew for token expiry, in seconds (default 30). */
  jwtClockToleranceSeconds?: number | undefined;
  /** Public URL of the admin app, for links in staff notices (e.g. the adjustment task queue). */
  adminAppUrl?:   string | undefined;
  /** The API's public address, printed on issued documents for verification (D-21). */
  publicApiUrl?:  string | undefined;
  /**
   * How outbound email leaves the SRS. Only 'fake' ships: the in-repo fake
   * mail server, whose mailboxes and send-in form are on the admin Email
   * simulator page. Its routes exist only while this is 'fake'.
   */
  emailTransport?: 'fake';
  /** The institution's sending address; the default for staff email and notices. */
  emailFromAddress?: string;
  corsOrigins:  string[];
  otelEndpoint: string | undefined;
  otelServiceName: string;
}

function emailTransport(value: string | undefined): 'fake' {
  if (value === undefined || value === '' || value === 'fake') return 'fake';
  throw new Error(`EMAIL_TRANSPORT '${value}' is not supported; the only transport is 'fake'`);
}

/**
 * TRUST_PROXY names the proxies whose X-Forwarded-For is believed: a
 * comma-separated list of addresses, CIDRs or proxy-addr's named ranges
 * (`loopback`, `linklocal`, `uniquelocal`). Unset or 'false' trusts none.
 *
 * Two values are refused rather than accepted silently:
 * - 'true' would let any client choose its own IP address;
 * - a hop count, because Fastify 5 deliberately ignores one (it cannot
 *   check the immediate peer), so the setting would do nothing.
 */
export function trustProxySetting(value: string | undefined): false | string {
  const v = value?.trim();
  if (!v || v === 'false') return false;
  if (v === 'true') throw new Error("TRUST_PROXY 'true' would let any client choose its IP address; name the proxies (addresses, CIDRs or 'uniquelocal')");
  if (/^\d+$/.test(v)) throw new Error(`TRUST_PROXY '${v}' is a hop count, which Fastify ignores; name the proxies instead (addresses, CIDRs or 'uniquelocal')`);
  return v;
}

/** Used only in development and test, where no key is configured. */
export const DEV_PUBLIC_VERIFY_IP_KEY = 'development-only-public-verify-ip-key';
const MIN_PUBLIC_VERIFY_IP_KEY_LENGTH = 32;

/**
 * The key for the public verification IP hash, or null when there is none
 * fit to use: then the public routes refuse rather than hash with a known
 * key (BL-184). Development and test fall back to a fixed key.
 */
export function publicVerifyIpKey(nodeEnv: string, configured: string | undefined): string | null {
  if (configured !== undefined && configured.length >= MIN_PUBLIC_VERIFY_IP_KEY_LENGTH) return configured;
  return nodeEnv === 'development' || nodeEnv === 'test' ? (configured || DEV_PUBLIC_VERIFY_IP_KEY) : null;
}

/** Refuse to start the API outside development and test without a secret key. */
export function assertPublicVerifyIpKey(service: string, nodeEnv: string, configured: string | undefined): void {
  if (publicVerifyIpKey(nodeEnv, configured) !== null) return;
  throw new Error(`Refusing to start ${service} in '${nodeEnv}' (BL-184): PUBLIC_VERIFY_IP_KEY must be a secret of at least ${MIN_PUBLIC_VERIFY_IP_KEY_LENGTH} characters`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required environment variable ${name} is not set`);
  return v;
}

function optional(name: string): string | undefined {
  return process.env[name] ?? undefined;
}

function optionalInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : defaultValue;
}

export function loadConfig(): Config {
  return {
    port:            optionalInt('PORT', 3000),
    logLevel:        process.env['LOG_LEVEL'] ?? 'info',
    nodeEnv:         process.env['NODE_ENV'] ?? 'development',
    documentScanner: loadDocumentScannerConfig(),
    // PUBLIC_VERIFY_IP_SALT is the old name, still read.
    publicVerifyIpKey: optional('PUBLIC_VERIFY_IP_KEY') ?? optional('PUBLIC_VERIFY_IP_SALT'),
    databaseUrl:     required('DATABASE_URL'),
    natsUrl:         process.env['NATS_URL'] ?? 'nats://localhost:4222',
    attendanceApiUrl: process.env['ATTENDANCE_API_URL'] ?? 'http://localhost:3004',
    engagementProxyTimeoutMs: optionalInt('ENGAGEMENT_PROXY_TIMEOUT_MS', 15_000),
    trustProxy:      trustProxySetting(process.env['TRUST_PROXY']),
    dbStatementTimeoutMs:         optionalInt('DB_STATEMENT_TIMEOUT_MS', 30_000),
    dbIdleInTransactionTimeoutMs: optionalInt('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 60_000),
    temporalAddress: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
    temporalExecutionEnabled: process.env['TEMPORAL_EXECUTION_ENABLED'] === 'true',
    temporalNamespace: process.env['TEMPORAL_NAMESPACE'] ?? 'srs-local',
    temporalTaskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? 'srs-workflows',
    temporalDecisionWaitMs: optionalInt('TEMPORAL_DECISION_WAIT_MS', 10_000),
    temporalReconcileGraceSeconds: optionalInt('TEMPORAL_RECONCILE_GRACE_SECONDS', 15),
    deploymentEnvironmentCode: process.env['SRS_ENVIRONMENT_CODE'] ?? process.env['NODE_ENV'] ?? 'local',
    releaseVersion: process.env['SRS_RELEASE_VERSION'] ?? process.env['npm_package_version'] ?? '0.0.0',
    imageDigest: optional('SRS_IMAGE_DIGEST'),
    migrationVersion: process.env['SRS_MIGRATION_VERSION'] ?? '0001_security_and_tenant_isolation',
    jwtSecret:       process.env['JWT_SECRET'] ?? DEFAULT_DEV_JWT_SECRET,  // development and test only (assertSecureAuthConfig)
    keycloakJwksUrl: optional('KEYCLOAK_JWKS_URL'),
    ...tokenEnv(),
    adminAppUrl:     optional('ADMIN_APP_URL'),
    publicApiUrl:    optional('PUBLIC_API_URL'),
    emailTransport:  emailTransport(process.env['EMAIL_TRANSPORT']),
    emailFromAddress: process.env['EMAIL_FROM_ADDRESS'] ?? 'registry@revelation.example.ac.uk',
    corsOrigins:     (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(','),
    otelEndpoint:    optional('OTEL_EXPORTER_OTLP_ENDPOINT'),
    otelServiceName: process.env['OTEL_SERVICE_NAME'] ?? 'srs-api',
  };
}
