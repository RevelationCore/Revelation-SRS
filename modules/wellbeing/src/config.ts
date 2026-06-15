export interface Config {
  port:            number;
  logLevel:        string;
  nodeEnv:         string;
  databaseUrl:     string;
  srsApiUrl:       string;
  natsUrl:         string;
  jwtSecret:       string;
  keycloakJwksUrl: string | undefined;
  corsOrigins:     string[];
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required environment variable ${name} is not set`);
  return v;
}

function optionalInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  return v ? parseInt(v, 10) : defaultValue;
}

export function loadConfig(): Config {
  return {
    port:            optionalInt('PORT', 3001),
    logLevel:        process.env['LOG_LEVEL'] ?? 'info',
    nodeEnv:         process.env['NODE_ENV'] ?? 'development',
    databaseUrl:     required('DATABASE_URL'),
    srsApiUrl:       process.env['SRS_API_URL'] ?? 'http://localhost:3000',
    natsUrl:         process.env['NATS_URL'] ?? 'nats://localhost:4222',
    jwtSecret:       process.env['JWT_SECRET'] ?? 'dev-secret-replace-in-production',
    keycloakJwksUrl: process.env['KEYCLOAK_JWKS_URL'],
    corsOrigins:     (process.env['CORS_ORIGINS'] ?? 'http://localhost:5173').split(','),
  };
}
