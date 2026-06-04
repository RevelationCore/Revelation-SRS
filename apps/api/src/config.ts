/** Typed environment configuration - read once at startup. */
export interface Config {
  port:         number;
  logLevel:     string;
  nodeEnv:      string;
  databaseUrl:  string;
  natsUrl:      string;
  temporalAddress: string;
  jwtSecret:    string;
  keycloakJwksUrl: string | undefined;
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
    temporalAddress: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
    jwtSecret:       process.env['JWT_SECRET'] ?? 'dev-secret-replace-in-production',
    keycloakJwksUrl: optional('KEYCLOAK_JWKS_URL'),
    corsOrigins:     (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(','),
    otelEndpoint:    optional('OTEL_EXPORTER_OTLP_ENDPOINT'),
    otelServiceName: process.env['OTEL_SERVICE_NAME'] ?? 'srs-api',
  };
}
