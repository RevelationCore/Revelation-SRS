/** Typed environment configuration - read once at startup. */
export interface Config {
  port:         number;
  logLevel:     string;
  nodeEnv:      string;
  databaseUrl:  string;
  natsUrl:      string;
  attendanceApiUrl: string;
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
  /** Public URL of the admin app, for links in staff notices (e.g. the adjustment task queue). */
  adminAppUrl?:   string | undefined;
  /** The API's public address, printed on issued documents for verification (D-21). */
  publicApiUrl?:  string | undefined;
  corsOrigins:  string[];
  otelEndpoint: string | undefined;
  otelServiceName: string;
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
    databaseUrl:     required('DATABASE_URL'),
    natsUrl:         process.env['NATS_URL'] ?? 'nats://localhost:4222',
    attendanceApiUrl: process.env['ATTENDANCE_API_URL'] ?? 'http://localhost:3004',
    temporalAddress: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
    temporalExecutionEnabled: process.env['TEMPORAL_EXECUTION_ENABLED'] === 'true',
    temporalNamespace: process.env['TEMPORAL_NAMESPACE'] ?? 'srs-local',
    temporalTaskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? 'srs-workflows',
    temporalDecisionWaitMs: optionalInt('TEMPORAL_DECISION_WAIT_MS', 10_000),
    temporalReconcileGraceSeconds: optionalInt('TEMPORAL_RECONCILE_GRACE_SECONDS', 15),
    deploymentEnvironmentCode: process.env['SRS_ENVIRONMENT_CODE'] ?? process.env['NODE_ENV'] ?? 'local',
    releaseVersion: process.env['SRS_RELEASE_VERSION'] ?? process.env['npm_package_version'] ?? '0.0.0',
    imageDigest: optional('SRS_IMAGE_DIGEST'),
    migrationVersion: process.env['SRS_MIGRATION_VERSION'] ?? '0004_business_process_foundations',
    jwtSecret:       process.env['JWT_SECRET'] ?? 'dev-secret-replace-in-production',
    keycloakJwksUrl: optional('KEYCLOAK_JWKS_URL'),
    adminAppUrl:     optional('ADMIN_APP_URL'),
    publicApiUrl:    optional('PUBLIC_API_URL'),
    corsOrigins:     (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(','),
    otelEndpoint:    optional('OTEL_EXPORTER_OTLP_ENDPOINT'),
    otelServiceName: process.env['OTEL_SERVICE_NAME'] ?? 'srs-api',
  };
}
